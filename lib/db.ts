import { MongoClient, type Db } from "mongodb";

// Cache the client across dev hot-reloads so we don't pile up connections.
const g = globalThis as typeof globalThis & {
  _pitMongo?: Promise<MongoClient>;
  _pitSchema?: Promise<void>;
};

function getClient(): Promise<MongoClient> {
  const existing = g._pitMongo;
  if (existing) return existing;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  const connecting = new MongoClient(uri, {
    // Every page load is a handful of small queries, so the pool stays tiny —
    // but idle sockets are kept long enough that the next request on a warm
    // instance doesn't pay for a new handshake.
    //
    // Tunable because the ceiling is the *cluster's*, not this process's:
    // each serverless instance opens its own pool, so the connections in
    // flight are (instances × this number), and a shared-tier Atlas cluster
    // caps at 500. Raise it for a bigger cluster; lower it if Atlas starts
    // refusing connections under load, which is what "too many connections"
    // looks like from a page that simply won't load.
    maxPoolSize: Number(process.env.MONGO_POOL_SIZE) || 10,
    minPoolSize: 0,
    maxIdleTimeMS: 60_000,
    // Fail fast and show an error rather than hanging the page for 30 seconds.
    serverSelectionTimeoutMS: 8_000,
    connectTimeoutMS: 8_000,
  }).connect();

  // Don't leave a rejected promise cached for every later request to trip
  // over — a failed connect should be retried by the next one.
  connecting.catch(() => {
    if (g._pitMongo === connecting) g._pitMongo = undefined;
  });

  g._pitMongo = connecting;
  return connecting;
}

/**
 * BSON schema validators — these are what keep the data properly typed in
 * MongoDB (ObjectId refs, Date timestamps, numeric values, real booleans)
 * instead of whatever JSON happens to arrive.
 */
const VALIDATORS: Record<string, object> = {
  users: {
    bsonType: "object",
    required: ["email", "name", "passwordHash", "createdAt"],
    properties: {
      email: { bsonType: "string", description: "lowercase, unique" },
      name: { bsonType: "string" },
      passwordHash: { bsonType: "string" },
      createdAt: { bsonType: "date" },
      // Password reset: only the hash of the token is kept, never the token.
      resetTokenHash: { bsonType: ["string", "null"] },
      resetExpires: { bsonType: ["date", "null"] },
      // Stamped into every session; changing the password orphans old tokens.
      passwordChangedAt: { bsonType: ["date", "null"] },
      // Whether this account was created with the invite code. The app is
      // open to everyone; the **AI coach** is not, because it runs on one
      // shared free-tier allowance that cannot be split between strangers.
      // Absent on every account created before the field, and all of those
      // WERE invited — see `lib/access.ts`, which reads absent as invited.
      invited: { bsonType: ["bool", "null"] },
      // What an hour of this person's life is worth to them, so the app can
      // price the time they spend (`lib/timeValue`). Absent for everyone who
      // never set one, and the whole feature is invisible until they do.
      timeValue: {
        bsonType: ["object", "null"],
        required: ["perMinute", "currency"],
        properties: {
          perMinute: { bsonType: "number", minimum: 0, maximum: 10000 },
          currency: { bsonType: "string", maxLength: 4 },
        },
      },
      // The three things the cortisol page needs that no tracker records:
      // the awakening response flattens with age, differs a little by sex,
      // and a persistently low mood tracks a flatter evening slope. All
      // optional, and absent for everyone who never opened that page.
      cortisol: {
        bsonType: ["object", "null"],
        properties: {
          age: { bsonType: ["number", "null"], minimum: 10, maximum: 120 },
          sex: { enum: ["male", "female", "other", null] },
          mood: { bsonType: ["number", "null"], minimum: 1, maximum: 5 },
          updatedAt: { bsonType: ["date", "null"] },
        },
      },
      // What this account's trackers mean, for the health page.
      //
      // Only two things are kept: the AI's last answer (`lib/roleAI`) and any
      // role the reader set by hand. The keyword rules are recomputed on
      // every read because they are pure and instant, and a cached copy of a
      // pure function is only a second place for it to be wrong.
      //
      // `signature` is the fingerprint of the tracker list the AI answered
      // for. When it stops matching, the answer is stale and the page offers
      // to re-run rather than spending a shared allowance on its own.
      health: {
        bsonType: ["object", "null"],
        properties: {
          roles: { bsonType: ["array", "null"] },
          // Free-form by necessity: the keys are tracker ids and the values
          // are role names defined in `lib/trackerRoles`. Listing them here
          // would be a second copy of that list to keep in step, and what
          // reaches this field has already been through `cleanOverrides`.
          overrides: { bsonType: ["object", "null"] },
          signature: { bsonType: ["string", "null"] },
          aiAt: { bsonType: ["date", "null"] },
        },
      },
      // Nightly "did you log today?" push. The cron decides *when* it fires;
      // tzOffset only decides *which day* the reminder is about.
      reminder: {
        bsonType: ["object", "null"],
        properties: {
          enabled: { bsonType: "bool" },
          // Minutes to add to UTC to get local time (+360 for UTC+6).
          tzOffset: { bsonType: "number", minimum: -840, maximum: 840 },
          // The local time the ask should arrive, "HH:MM". Absent on rows
          // written before it was anyone's choice — those read as 23:00.
          time: {
            bsonType: ["string", "null"],
            pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$",
          },
          // Where to put the sun for a prayer tracker whose times are
          // computed rather than typed (`lib/prayerTimes`). Coordinates
          // only, rounded to a neighbourhood, and never sent anywhere.
          place: {
            bsonType: ["object", "null"],
            required: ["lat", "lon"],
            properties: {
              lat: { bsonType: "number", minimum: -90, maximum: 90 },
              lon: { bsonType: "number", minimum: -180, maximum: 180 },
              label: { bsonType: ["string", "null"], maxLength: 60 },
              method: { enum: ["karachi", "mwl", "isna", "egypt", "makkah"] },
              asr: { enum: ["standard", "hanafi"] },
            },
          },
          // The last day-to-log we nagged about, so a re-run can't double-send.
          lastSentFor: { bsonType: ["string", "null"] },
          // The Sunday whose week-in-review has been sent, same idea.
          lastDigestFor: { bsonType: ["string", "null"] },
        },
      },
    },
  },
  trackers: {
    bsonType: "object",
    required: ["userId", "name", "type", "unit", "color", "category", "archived", "createdAt"],
    properties: {
      userId: { bsonType: "objectId" },
      name: { bsonType: "string", maxLength: 60 },
      type: {
        enum: [
          "duration",
          "sleep",
          "count",
          "scale",
          "check",
          "measure",
          "prayer",
          "streak",
        ],
      },
      unit: { bsonType: "string" },
      color: { bsonType: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      // Free-form so you can invent your own categories.
      category: { bsonType: "string", minLength: 1, maxLength: 30 },
      goal: {
        bsonType: ["object", "null"],
        required: ["target", "period", "direction"],
        properties: {
          target: { bsonType: "number", minimum: 0 },
          period: { enum: ["day", "week"] },
          direction: { enum: ["min", "max"] },
        },
      },
      // Every goal this tracker has ever carried, oldest first, each with
      // the day it came into force. `goal` above is still the one in force
      // NOW; this is what makes the past judgeable at the promise that was
      // actually in place then — raise a target and last week must not
      // retroactively become a week you failed. See `lib/goalHistory.ts`.
      // Absent on every tracker whose goal has never changed.
      goalHistory: {
        bsonType: ["array", "null"],
        maxItems: 200,
        items: {
          bsonType: "object",
          required: ["from", "goal"],
          properties: {
            from: { bsonType: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            goal: {
              bsonType: ["object", "null"],
              required: ["target", "period", "direction"],
              properties: {
                target: { bsonType: "number", minimum: 0 },
                period: { enum: ["day", "week"] },
                direction: { enum: ["min", "max"] },
              },
            },
          },
        },
      },
      // A number to reach by a date, which is a different question from the
      // daily goal above: "total" adds up (20 books this year), "level" is
      // arrived at (70 kg by December). Null on almost every tracker.
      target: {
        bsonType: ["object", "null"],
        required: ["kind", "value", "by"],
        properties: {
          kind: { enum: ["total", "level"] },
          value: { bsonType: "number", minimum: 0 },
          by: { bsonType: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          // When the count started. Null means "from the first day logged".
          from: {
            bsonType: ["string", "null"],
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          },
        },
      },
      // Good habits are built up, bad ones cut down — growth on a bad one
      // reads as falling behind. Absent on old rows, which read as "good".
      habit: { enum: ["good", "bad", null] },
      // Daily pushes at chosen local times — up to five, one per waqt for a
      // prayer tracker. lastSentFor stamps the latest slot handled
      // ("YYYY-MM-DD HH:MM"), so the polling schedule can call in as often
      // as it likes without double-sending.
      reminder: {
        bsonType: ["object", "null"],
        required: ["times"],
        properties: {
          times: {
            bsonType: "array",
            minItems: 1,
            maxItems: 5,
            items: { bsonType: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
          },
          // "prayer" recomputes the five times from the sun every day, which
          // is what a waqt actually is; `times` then holds only the last
          // computed set, as the fallback for a day with no location on file.
          mode: { enum: ["fixed", "prayer", null] },
          lastSentFor: { bsonType: ["string", "null"] },
        },
      },
      archived: { bsonType: "bool" },
      order: { bsonType: "number" },
      createdAt: { bsonType: "date" },
    },
  },
  entries: {
    bsonType: "object",
    required: ["userId", "trackerId", "date", "value", "updatedAt"],
    properties: {
      userId: { bsonType: "objectId" },
      trackerId: { bsonType: "objectId" },
      date: { bsonType: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      value: { bsonType: "number", minimum: 0 },
      note: { bsonType: ["string", "null"] },
      meta: {
        bsonType: ["object", "null"],
        properties: {
          start: { bsonType: ["string", "null"], pattern: "^\\d{2}:\\d{2}$" },
          end: { bsonType: ["string", "null"], pattern: "^\\d{2}:\\d{2}$" },
          quality: { bsonType: ["number", "null"], minimum: 1, maximum: 5 },
          // Sleep: the day's naps, each with the minutes slept and the clock
          // time it started when a timer recorded one. The minutes are also
          // counted in `value` — the times above describe the night only.
          naps: {
            bsonType: ["array", "null"],
            maxItems: 12,
            items: {
              bsonType: "object",
              required: ["mins"],
              properties: {
                mins: { bsonType: "number", minimum: 1, maximum: 1440 },
                at: { bsonType: ["string", "null"], pattern: "^\\d{2}:\\d{2}$" },
              },
            },
          },
          // Namaz: which of the five prayers were prayed.
          parts: {
            bsonType: ["array", "null"],
            items: { bsonType: "string" },
            maxItems: 5,
          },
          // Clean-streak trackers: a slip is stored as value 0 *with* meta, so
          // it stays on record instead of reading as a day you never logged.
          status: { enum: ["clean", "slip", null] },
        },
      },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
    },
  },
  // "This tracker, every day, for N days." A challenge owns no entries —
  // it just watches a tracker over a date window, so deleting one costs
  // nothing but the challenge itself.
  challenges: {
    bsonType: "object",
    required: ["userId", "name", "trackerId", "startDate", "days", "direction", "createdAt"],
    properties: {
      userId: { bsonType: "objectId" },
      name: { bsonType: "string", maxLength: 60 },
      trackerId: { bsonType: "objectId" },
      startDate: { bsonType: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      days: { bsonType: "number", minimum: 1, maximum: 365 },
      // The daily bar for numeric trackers; null means "just log it".
      target: { bsonType: ["number", "null"], minimum: 0 },
      direction: { enum: ["min", "max"] },
      createdAt: { bsonType: "date" },
    },
  },
  // "Life right now" analyses written by the AI coach — one row per run,
  // newest is what the Status page shows. Text only; the numbers it was
  // built from live in the entries themselves.
  aiReviews: {
    bsonType: "object",
    required: ["userId", "text", "createdAt"],
    properties: {
      userId: { bsonType: "objectId" },
      text: { bsonType: "string", maxLength: 10000 },
      // The numbers the review was written against, computed by the app —
      // kept so an old review is never re-read beside newer figures.
      snapshot: { bsonType: ["object", "null"] },
      today: { bsonType: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      model: { bsonType: ["string", "null"] },
      createdAt: { bsonType: "date" },
    },
  },
  // "Have to do it today" — one row per task, hung off a date.
  //
  // Its own collection and NOT a tracker, for the reason the shelf isn't one
  // either: a tracker asks the same question every day, and a task is one
  // thing, once. Nothing here reaches the day score, days logged, a streak
  // or the AI — a day of ticked boxes with nothing logged is still a day
  // with nothing logged.
  tasks: {
    bsonType: "object",
    required: ["userId", "date", "text", "done", "createdAt"],
    properties: {
      userId: { bsonType: "objectId" },
      date: { bsonType: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      text: { bsonType: "string", minLength: 1, maxLength: 140 },
      done: { bsonType: "bool" },
      order: { bsonType: "number" },
      // Stamped when it was ticked, cleared when it is un-ticked. Not used
      // for anything yet; it is the one fact a checkbox destroys.
      doneAt: { bsonType: ["date", "null"] },
      createdAt: { bsonType: "date" },
    },
  },
  // The week in review, written once and then kept.
  //
  // Its own collection rather than a flag on `aiReviews`, because the two
  // have opposite lifetimes: the daily read is a snapshot that the next one
  // replaces, this is a record meant to still be readable next year. One row
  // per week per person, which the unique index enforces.
  weeklyReviews: {
    bsonType: "object",
    required: ["userId", "weekStart", "weekEnd", "text", "createdAt"],
    properties: {
      userId: { bsonType: "objectId" },
      weekStart: { bsonType: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      weekEnd: { bsonType: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      text: { bsonType: "string", maxLength: 10000 },
      // The week's own numbers, computed by the app — so an old review is
      // never re-read beside figures it was not written against.
      snapshot: { bsonType: ["object", "null"] },
      /** The plain lines the weekly push is built from, kept for the same reason. */
      digest: { bsonType: ["array", "null"], items: { bsonType: "string" } },
      model: { bsonType: ["string", "null"] },
      createdAt: { bsonType: "date" },
    },
  },
  // One row per browser that agreed to receive reminders — a phone and a
  // laptop are separate rows, so both get the nudge.
  pushSubs: {
    bsonType: "object",
    required: ["userId", "endpoint", "keys", "createdAt"],
    properties: {
      userId: { bsonType: "objectId" },
      endpoint: { bsonType: "string" },
      keys: {
        bsonType: "object",
        required: ["p256dh", "auth"],
        properties: {
          p256dh: { bsonType: "string" },
          auth: { bsonType: "string" },
        },
      },
      label: { bsonType: ["string", "null"] },
      createdAt: { bsonType: "date" },
      lastUsedAt: { bsonType: ["date", "null"] },
    },
  },
  // The day's own note — the sentence the numbers can't hold. One row per
  // logged day at most; clearing the text deletes the row, so "wrote nothing"
  // and "cleared it" are the same state rather than two.
  dayNotes: {
    bsonType: "object",
    required: ["userId", "date", "text", "updatedAt"],
    properties: {
      userId: { bsonType: "objectId" },
      date: { bsonType: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      text: { bsonType: "string", maxLength: 2000 },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
    },
  },
  // The bookshelf. Not a tracker: a book is one slow thing with a start, a
  // middle and an end, rather than a question asked again every day.
  books: {
    bsonType: "object",
    required: ["userId", "title", "status", "pagesRead", "createdAt"],
    properties: {
      userId: { bsonType: "objectId" },
      title: { bsonType: "string", minLength: 1, maxLength: 200 },
      author: { bsonType: ["string", "null"], maxLength: 120 },
      status: { enum: ["wishlist", "reading", "finished", "dropped"] },
      // Null when nobody typed a page count — an unknown total is not zero.
      pages: { bsonType: ["number", "null"], minimum: 1, maximum: 100000 },
      pagesRead: { bsonType: "number", minimum: 0, maximum: 100000 },
      rating: { bsonType: ["number", "null"], minimum: 1, maximum: 5 },
      startedOn: {
        bsonType: ["string", "null"],
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      },
      finishedOn: {
        bsonType: ["string", "null"],
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      },
      note: { bsonType: ["string", "null"], maxLength: 1000 },
      // What the reader made of it, as they went. A list rather than one
      // field, because the thought you had at chapter nine is not the same
      // thing as a review written after the last page.
      comments: {
        bsonType: ["array", "null"],
        maxItems: 100,
        items: {
          bsonType: "object",
          required: ["id", "text", "on"],
          properties: {
            id: { bsonType: "string" },
            text: { bsonType: "string", minLength: 1, maxLength: 600 },
            // Blank when a stored stamp was unreadable — the words matter
            // more than the date they carry.
            on: { bsonType: "string", pattern: "^(\\d{4}-\\d{2}-\\d{2})?$" },
          },
        },
      },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: ["date", "null"] },
    },
  },
  // A day taken off on purpose. Deliberately its own collection and not a
  // flag on an entry: there is no entry — that is the whole point. It marks
  // a day the reader chose to skip, so a run can step over it (`lib/rest`),
  // and it can never add to a count.
  restDays: {
    bsonType: "object",
    required: ["userId", "date", "createdAt"],
    properties: {
      userId: { bsonType: "objectId" },
      date: { bsonType: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      reason: { bsonType: ["string", "null"], maxLength: 120 },
      createdAt: { bsonType: "date" },
    },
  },
  // The one timer that is running right now — the stopwatch on a time
  // tracker, or the nap on a sleep row. One row per person at most, which is
  // what the unique index says out loud.
  //
  // It lives here rather than in the browser it was started from because a
  // timer you cannot reach is a timer you cannot stop: the laptop gets shut,
  // the hour keeps counting, and the phone in your pocket — the one device
  // you actually have — has no idea any of it is happening.
  timers: {
    bsonType: "object",
    required: ["userId", "trackerId", "date", "startedAt", "kind", "updatedAt"],
    properties: {
      userId: { bsonType: "objectId" },
      trackerId: { bsonType: "objectId" },
      // The day the minutes belong to, which is the day it was *started* on
      // and not necessarily the day it is stopped on.
      date: { bsonType: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      startedAt: { bsonType: "date" },
      // Which of the two it is — see `lib/timer.ts`. A stopwatch's minutes
      // go straight to the day's total; a nap's are handed to the draft.
      kind: { enum: ["duration", "nap"] },
      updatedAt: { bsonType: "date" },
    },
  },
  // The monthly cortisol check-up — the answers the daily log cannot know:
  // how long sleep takes to arrive, whether the morning has daylight in it,
  // when the last coffee was, whether the work is on shifts.
  //
  // One row per person per month, and kept rather than overwritten, because
  // a check-up is a dated fact and not a setting: June's answers describe
  // June, and next month gets its own row to be compared against.
  cortisolChecks: {
    bsonType: "object",
    required: ["userId", "month", "answers", "createdAt", "updatedAt"],
    properties: {
      userId: { bsonType: "objectId" },
      month: { bsonType: "string", pattern: "^\\d{4}-\\d{2}$" },
      // Free-form by necessity — the questions are data in
      // `lib/cortisolCheck`, and a validator listing them here would be a
      // second copy of that list to keep in step. What reaches this field
      // has already been through `cleanAnswers`, which drops anything that
      // is not a known question answered in a known shape.
      answers: { bsonType: "object" },
      score: { bsonType: ["number", "null"], minimum: 0, maximum: 100 },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
    },
  },
  // Attempt counters for the routes reachable without a session. `_id` is
  // "action:subject" and rows delete themselves once the window has passed.
  rateLimits: {
    bsonType: "object",
    required: ["count", "resetAt"],
    properties: {
      _id: { bsonType: "string" },
      count: { bsonType: "number" },
      resetAt: { bsonType: "date" },
    },
  },
  // One row per run of the nightly reminder, so "did it fire?" has an answer
  // that doesn't depend on noticing you weren't reminded.
  cronRuns: {
    bsonType: "object",
    required: ["job", "startedAt", "ok"],
    properties: {
      job: { bsonType: "string" },
      startedAt: { bsonType: "date" },
      finishedAt: { bsonType: ["date", "null"] },
      ok: { bsonType: "bool" },
      tookMs: { bsonType: ["number", "null"] },
      checked: { bsonType: ["number", "null"] },
      notified: { bsonType: ["number", "null"] },
      stakes: { bsonType: ["number", "null"] },
      // Check-ins sent to people who had gone quiet for days.
      lapses: { bsonType: ["number", "null"] },
      skipped: { bsonType: ["number", "null"] },
      // Asks that were due but past this poll's batch cap — the schedule
      // saying it needs to be polled more often, out loud.
      deferred: { bsonType: ["number", "null"] },
      digests: { bsonType: ["number", "null"] },
      error: { bsonType: ["string", "null"] },
    },
  },
};

async function ensureSchema(d: Db): Promise<void> {
  const existing = new Set(
    (await d.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name)
  );

  // One round trip per collection, so run them together rather than in turn.
  await Promise.all(
    Object.entries(VALIDATORS).map(([name, schema]) => {
      const validator = { $jsonSchema: schema };
      return existing.has(name)
        ? // Keep validators current without touching the stored documents.
          d.command({ collMod: name, validator, validationLevel: "moderate" })
        : d.createCollection(name, { validator });
    })
  );

  await Promise.all([
    d.collection("users").createIndex({ email: 1 }, { unique: true }),
    // Every poll of the daily schedule asks "who has reminders on, longest
    // un-asked first?" — which is a collection scan and a sort in memory
    // without this. Fifteen minutes apart, forever, for every account.
    d
      .collection("users")
      .createIndex({ "reminder.enabled": 1, "reminder.lastSentFor": 1 }),
    d.collection("trackers").createIndex({ userId: 1, order: 1 }),
    d
      .collection("entries")
      .createIndex({ userId: 1, trackerId: 1, date: 1 }, { unique: true }),
    d.collection("entries").createIndex({ userId: 1, date: 1 }),
    d.collection("challenges").createIndex({ userId: 1, createdAt: -1 }),
    // One note per day per person — the write is an upsert on exactly this.
    d.collection("dayNotes").createIndex({ userId: 1, date: 1 }, { unique: true }),
    // Many tasks per day, read a day at a time. Not unique, unlike the note.
    d.collection("tasks").createIndex({ userId: 1, date: 1 }),
    // One rest day per date per person — the write is an upsert on this.
    d.collection("restDays").createIndex({ userId: 1, date: 1 }, { unique: true }),
    d.collection("books").createIndex({ userId: 1, createdAt: -1 }),
    d.collection("aiReviews").createIndex({ userId: 1, createdAt: -1 }),
    // One review per week per person — the write is an upsert on exactly this.
    d
      .collection("weeklyReviews")
      .createIndex({ userId: 1, weekEnd: 1 }, { unique: true }),
    // The same browser re-subscribing must update its row, not add another.
    d.collection("pushSubs").createIndex({ endpoint: 1 }, { unique: true }),
    d.collection("pushSubs").createIndex({ userId: 1 }),
    // One running timer per person, enforced where no client can talk it
    // out of it. Every read of it is this lookup.
    d.collection("timers").createIndex({ userId: 1 }, { unique: true }),
    // One check-up per person per month — the write is an upsert on this.
    d
      .collection("cortisolChecks")
      .createIndex({ userId: 1, month: 1 }, { unique: true }),
    // Both of these are self-cleaning: MongoDB drops the row once the date
    // field is in the past (plus the TTL), so neither collection grows.
    d
      .collection("rateLimits")
      .createIndex({ resetAt: 1 }, { expireAfterSeconds: 0 }),
    d
      .collection("cronRuns")
      .createIndex({ startedAt: -1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }),
  ]);
}

/**
 * Start the validator/index sync if it hasn't been started on this instance,
 * and hand back the promise so a caller that needs it can wait.
 *
 * It is deliberately *not* awaited by `db()`. The sync is a dozen round trips
 * to the database, and a serverless instance is thrown away and rebuilt often
 * enough that paying for it on the way to every read made the app feel slow to
 * open. Reads run straight away; the sync catches up behind them.
 */
function startSchemaSync(d: Db): Promise<void> | null {
  if (process.env.PIT_SKIP_SCHEMA_SYNC === "1") return null;
  if (!g._pitSchema) {
    g._pitSchema = ensureSchema(d).catch((err) => {
      // Let the next request try again rather than caching the failure.
      g._pitSchema = undefined;
      console.error("Schema sync failed:", err);
    });
  }
  return g._pitSchema;
}

export async function db(): Promise<Db> {
  const client = await getClient();
  const d = client.db(process.env.MONGODB_DB || "pit");
  startSchemaSync(d);
  return d;
}

/**
 * Like `db()`, but waits for the indexes to exist first. Used by the writes
 * that depend on a unique index to be correct — creating an account, and
 * upserting a day's entries.
 */
export async function dbReady(): Promise<Db> {
  const client = await getClient();
  const d = client.db(process.env.MONGODB_DB || "pit");
  await startSchemaSync(d);
  return d;
}
