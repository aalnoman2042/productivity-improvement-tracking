# PIT — Productivity Improvement Tracker

Track everything that makes a day good — sleep, study, work, workouts, food,
habits, weight — and watch the trends. Each account is private; friends sign up
with an invite code and see only their own data.

## Run locally

```powershell
npm install
npm run dev
```

Open http://localhost:3000. Settings live in `.env.local` (copy `.env.example`
if it's missing). Data is stored in MongoDB — a local server in dev, MongoDB
Atlas in production.

`dev` passes `--webpack` because Windows Application Control blocks Next's
native SWC binary on this machine, and Turbopack won't run on the WASM
fallback. Drop the flag on a machine where the native binding loads. `build`
keeps the default for Vercel, which has no such problem — use `npm run
build:local` to build here.

## How it works

Everything you track is a **tracker**, and its *type* decides both how you enter
it and how it's charted:

| Type | Good for | You enter | Chart |
|---|---|---|---|
| `duration` | Study, work, workout, reading | Hours/minutes, or a stopwatch | Stacked bars + share donut |
| `sleep` | Sleep | Bedtime & wake time (+ quality 1–5) | Hours per night, and the night itself |
| `count` | Water, meals, junk food | A number, with +/− buttons | Bars per day |
| `scale` | Mood, diet quality, focus | 1–5 rating | Trend line |
| `check` | Vitamins, meditation | Done / not done | Completion + streak |
| `prayer` | Namaz | Tap each of the five prayers | Prayers per day out of 5 |
| `streak` | No fap, no smoking | Clean / slipped | Days clean, best run, slips |
| `measure` | Weight, calories | A decimal + unit | Trend line |

Any tracker can carry a **goal** ("at least 3h study per day", "at most 2 junk
meals per week"). The dashboard scores every day or week against it.

The stopwatch adds its minutes to the day's total, so several sessions add up.
It survives a refresh — the running timer is kept in `localStorage`.

### Sleep: how long, and when

Hours slept is only half of it — you can sleep eight hours and still be doing
it from 3am. So sleep gets two charts: one for how much, and one for the night
itself, where each bar runs from the time you got into bed up to the time you
got out of it.

Averaging bedtimes is the part that's easy to get wrong. 23:40 and 00:20 are
forty minutes apart, but on a midnight-based clock they're 1,400 minutes apart,
so the naive average lands at lunchtime. Everything in [`lib/clock.ts`](./lib/clock.ts)
is measured on a **night axis** instead — minutes since 18:00, wrapping once —
which puts an evening bedtime and the morning after it in order and makes the
average, the range bar and "22 min earlier than last week" all mean something.

### Namaz and clean streaks

`prayer` trackers store *which* prayers you prayed, not just how many — the
five buttons on the daily log write `meta.parts`, so "I keep missing Fajr" is
a question the data can answer.

`streak` trackers count **days since the last slip**, not consecutive
check-ins. A day you didn't open the app doesn't reset a three-month run; only
marking a slip does. A slip is stored as value `0` *with* a `meta.status`,
which is what keeps it distinct from a day you never filled in.

## Pages

The app **opens on the log**, because logging is a daily act and reading the
charts is a weekly one — the most frequent thing shouldn't be the deepest.
Signed out, `/` **is the welcome page**: the pitch, the screenshots, and the
way in, served at the root itself (the old `/welcome` address forwards there). On a phone, swiping left or right moves between the bottom
tabs, with a light slide so the page follows the finger.

- **Today** (`/`) — log a day; every tracker gets the input its type needs. It
  **saves as you type** (and when you leave the page), shows how much of the
  day is filled in, groups trackers into collapsible sections, and can copy
  yesterday onto a blank day. Also where you delete logged days (see below).
  `?date=YYYY-MM-DD` opens on a specific day.
  - **Quick log** walks one tracker at a time, full screen, with controls big
    enough to hit without looking and Enter to move on — a twelve-tracker day
    becomes a rhythm instead of a scroll. It starts on the first thing not yet
    filled in.
  - **Notes** sit at the foot of the day: one free-text note about the day
    itself, plus a short note pinned to any tracker you filled in ("woke
    twice", "finished chapter 4"). Both save themselves, and both are read
    back on the calendar rather than disappearing into the day they were
    typed on.
  - **Undo** stays available for ten seconds after each save. The page saves
    itself a second after you stop typing, which is right for logging on a
    phone at midnight and wrong for the moment you notice you typed into the
    wrong row.
- **Stats** (`/dashboard`) — period selector (week / 15 days / month / 6 months
  / year), stat tiles, time donut + trend, sleep charts, then one card per
  habit grouped by category.
- **History** (`/history`) — a month at a time, opened from the Status page.
  Each day is a square: a ring means you logged it, the fill says how it went
  against your goals. Two channels rather than one, because a blank day and a
  bad day are different things and collapsing them hides exactly the gaps
  you're looking for. Tap any day to open it ready to fill in.
- **Trackers** (`/trackers`) — create, edit, set goals, archive, delete, and add
  ready-made packs: **Essentials** and **Faith & discipline** (namaz, Quran,
  a clean streak). Adding a pack twice skips what you already have. Past eight
  trackers a search box appears, matching on name, category or kind. Two
  things that aren't trackers but are set up the same way live here too:
  - **🏆 Challenges** — "this, every day, for N days", watching a tracker
    over a window.
  - **📚 Books** — a shelf, deliberately not a tracker type: a book is one
    slow thing with a start, a middle and an end rather than a question asked
    every day. Wishlist → reading now (page progress and a pace, "about
    10/day, 19 to go") → read (a rating, the date). One tap moves a book and
    stamps the dates for you. The headline is the count the shelf exists for:
    how many you have actually read, all time and this year. Nothing here
    touches a day's score, a streak or the coach. (`/books` forwards here —
    the shelf briefly had a tab of its own.)
- **Status** (`/status`) — where you stand over a week, two weeks or a month:
  days logged, goals hit, what's falling short and what to fix first, then
  every tracker's numbers. It holds History's old slot in the nav — "how am
  I doing?" is the daily question — and links to the calendar for the
  day-by-day. **Share** renders the summary to a PNG for the phone's share
  sheet — an image says nothing to anyone the user didn't send it to.
- **Tracker detail** (`/tracker/[id]`) — one habit's whole story: month-by-month
  totals, the last three months day by day, streak and milestone badges, and
  every note ever written on it, searchable. Tracker names link here from
  Trackers, Stats and Status.
- **Account** (`/settings`) — profile, password, the daily reminder (and
  the hour it arrives), and your data: CSV/JSON download and backup import.

`/today` still redirects to `/`, query string intact, so notifications sitting
unread in a tray from before the move still land on the right day.

## Lifestyle warnings

The Status page turns the period into plain statements, worst first: short
sleep, missed prayers, a streak that keeps resetting, goals you're not
hitting, trackers you've stopped filling in. Every one carries the number it
came from, and nothing is shown that the data doesn't support — see
[`lib/insights.ts`](./lib/insights.ts).

## Daily reminder

With push notifications set up, PIT asks once a day how your day went —
*"The day is finished — how was it? Tell me, so I can track your life
better."* Tapping it opens the day's log.

```powershell
npm run vapid-keys   # once; paste the output into .env.local
```

Turn it on per device from the Account page (each phone or computer subscribes
separately) and use **Send a test** to confirm it arrives. On iPhone, PIT must
be added to the Home Screen first — iOS only delivers push to installed
web apps.

**The hour is yours to choose.** Account → Daily reminder → *Ask me at*
stores a local time against your account; 11 PM is what it was before anyone
could change it, and what an account that never touches the field keeps. A
reminder set for the morning asks about *yesterday* — nobody can report on a
day that hasn't happened yet.

Because the time is per person, the endpoint is **polled** rather than
scheduled: an external scheduler (cron-job.org, every 15 minutes — the same
one that drives per-tracker reminders) calls `/api/cron/reminders`, and each
poll works out whose hour has come. Polls before anybody's hour do nothing and
aren't even logged. Once the hour passes the reminder is *owed* rather than
scheduled, so a scheduler that stalls delivers late instead of skipping the
day. The once-a-day cron in `vercel.json` remains as a backstop;
[DEPLOY.md](./DEPLOY.md) covers both.

### The Sunday week in review

The same run also sends a digest when the day that just ended is a
Sunday — *"Your week: 6/7 days logged · Sleep 7h 5m a night, bedtime 22 min
earlier than last week · Namaz 4.1/5 — Fajr missed most."* Every line is a
number read off what was logged (see [`lib/digest.ts`](./lib/digest.ts)); a
week with nothing in it sends nothing. It's stamped per week the same way the
nudge is stamped per day, so a retry can't send it twice — and a phone that
was off on Sunday still gets it on Monday or Tuesday, after which the week is
stale and quietly dropped. Tapping it opens the Status page, and **Send my
week in review** in the reminder settings shows you yours (last 7 days)
without waiting for Sunday.

## Your data

**Download CSV / Download JSON** on the Account page export everything you've
logged — archived trackers and their history included. CSV is one row per
entry with sleep times, prayers and streak status broken out into columns,
made for Excel and Google Sheets. JSON is the full backup: trackers with
their goals, entries with their meta, the notes written about each day and
the bookshelf, in a shape close enough to the database that nothing is lost
in translation. (The CSV stays entries-only — it is a spreadsheet of days,
and a shelf of books is not that.)

**Import a backup** (same section) loads a JSON export back in. It's a merge,
never a wipe: trackers are matched by name and type (created when there's no
match), days in the file overwrite the same days here, books are matched by
title and author so importing twice leaves one copy, and nothing not in the
file is touched — so it works both as disaster recovery into an empty account
and as filling gaps in a live one. Every imported row passes the same
validation as a day typed by hand.

### Knowing it still runs

A cron job that quietly stops looks exactly like a run of days you happened to
log early — the only symptom is the absence of something, which is what nobody
notices. So every run that did something writes a row to `cronRuns`, failures
included — a poll that arrived before anybody's hour writes nothing, or four
an hour would bury the rest — and the Account page reads the last one back: *"Schedule last ran 6 hours ago, sending
1 reminder."* Going quiet for more than 26 hours, or failing, is called out
rather than left to be inferred.

## Attempt limits

`proxy.ts` has to let `/api/auth/*` through unauthenticated — it's where you go
to *get* a session — which left password guessing and reset-mail sending
unbounded. [`lib/rateLimit.ts`](./lib/rateLimit.ts) counts attempts per
(action, subject) in a fixed window, kept in MongoDB so the count holds across
serverless instances instead of resetting whenever a new one warms up.

| Route | Per address | Per account |
|---|---|---|
| `login` | 10 / 15 min | 6 / 15 min per email |
| `signup` | 10 / hour | — |
| `forgot` | 8 / hour | 3 / hour per email |
| `reset` | 10 / hour | — |
| `password` | — | 10 / 15 min per user |

Two subjects where it's worth it: the address stops one machine working through
a password list, and the email stops a rotating pool converging on one account
— or pumping one inbox full of reset mail, which matters here because that mail
goes out through a personal Gmail account. Refusals are a `429` with
`Retry-After` and a message that names the wait. If the database is unhappy the
check fails **open**: a guard rail shouldn't be able to lock you out of your own
app.

## Deleting days

**Delete logged days** at the bottom of the daily log clears a date range — a single
day, a weekend, a whole month. It's a two-step action: check the range first,
then type back the number of days it found. The server independently re-counts
and refuses if the total has changed since you looked, so you can never confirm
a deletion you haven't seen the size of. Deleted days are also dropped from the
offline cache and queue, so nothing resurrects them later.

## Data model (MongoDB)

Eight collections, all with `$jsonSchema` validators so the BSON types stay
honest (`ObjectId` refs, `Date` timestamps, numeric values, real booleans):

- `users` — email (unique), name, scrypt `passwordHash`, `createdAt`, optional
  `reminder` (`enabled`, `tzOffset`, `time`, `lastSentFor`)
- `trackers` — `userId`, name, type, unit, color, category, goal, archived, order
- `entries` — `userId`, `trackerId`, `date` (`YYYY-MM-DD`), `value`, optional
  `meta` (sleep times & quality, `parts` for namaz, `status` for streaks),
  `note`, timestamps. Unique on `(userId, trackerId, date)`.
- `dayNotes` — `userId`, `date`, `text`: the note about a day itself, unique
  on `(userId, date)`. Its own collection so it survives on a day with nothing
  logged, and so it can't change what any number on that day means.
- `books` — `userId`, title, author, `status` (wishlist / reading / finished /
  dropped), `pages`, `pagesRead`, `rating`, `startedOn`, `finishedOn`, note.
- `pushSubs` — one row per subscribed browser: `userId`, `endpoint` (unique),
  `keys`. Rows are deleted automatically when a push service reports the
  endpoint is gone.
- `rateLimits` — attempt counters keyed `action:subject` (see below). Rows
  delete themselves when their window closes, via a TTL index on `resetAt`.
- `cronRuns` — one row per run of a scheduled job that actually did
  something, kept for 30 days.

## Demo data

To fill an account with a believable month of history:

```powershell
npm run seed:demo -- your@email.com
npm run seed:demo -- demo@example.com --create "Demo" "password"   # make it too
```

Sixteen trackers covering **all eight types**, five categories, and every
shape of goal — daily and weekly, "at least" and "at most". The month is
deliberately imperfect, because a flawless one demonstrates nothing: three
blank days so gaps are visible on the calendar, two streak slips so the run
has something to have survived, an archived tracker that kept its history,
and a Fajr that gets missed far more than the other four prayers. Bedtime
walks back about ninety minutes across the month, so the sleep clock has a
trend to show.

It **replaces** that account's trackers and entries. Nothing else is touched.
`--create` also bypasses the sign-up form's 8-character password minimum, which
is usually what you want for an account whose password goes on a slide.

## Why it opens fast

Three things, because a tracker you have to wait for is a tracker you stop
filling in:

- **Screens paint from the last copy first.** `lib/useCached.ts` reads what it
  showed you last time out of `localStorage` and puts it up immediately, then
  replaces it when the fresh response lands. The cache is the single source of
  truth, read through `useSyncExternalStore`, so two screens on the same data
  can't disagree.
- **Schema sync is off the request path.** The validator and index sync is a
  dozen round trips to MongoDB, and a serverless instance is rebuilt often
  enough that paying for it on the way to every read was noticeable. `db()`
  starts it in the background; only account creation and saving a day wait for
  it, via `dbReady()`. Set `PIT_SKIP_SCHEMA_SYNC=1` to skip it entirely once
  the database is known to be in shape.
- **The app shell is served from the cache.** The service worker answers with
  the cached HTML and JavaScript and refreshes them behind you, instead of
  making every open wait for the network. API responses are never cached
  there — the pages already know when their own copy is stale.

## Staying current

Open screens keep themselves up to date rather than waiting for a reload:

- when you come back to the tab, and when the window regains focus
- when the connection returns — the offline queue is sent first, so the
  refresh reads back a server that already has what you typed
- on a quiet 60-second timer while the tab is actually visible
- immediately in another tab of the same browser, which shares the cache

So logging namaz on your phone shows up on the laptop dashboard within about a
minute, or the moment you click back into it. Repeat requests within ten
seconds are folded into one, and a hidden tab makes none at all.

## Tests

```powershell
npm test
```

Vitest, over the pure logic where a mistake is silent: the night-axis maths
(`lib/clock.ts`), streak counting (`lib/streak.ts`), draft↔entry conversion
(`lib/draft.ts`), the digest's sentences (`lib/digest.ts`), milestones, and
the offline queue's merge behaviour (`lib/sync.ts`).

## Stack

Next.js (App Router) · TypeScript · Tailwind v4 · Recharts · MongoDB ·
sessions as signed JWT cookies (`jose`) with passwords hashed using Node's
`scrypt`; every route is guarded in `proxy.ts` and every query is scoped by
`userId`. Changing your password stamps `passwordChangedAt` into new tokens
and `currentUserId` rejects older ones — so a password change signs out every
other device. The app is light-themed for everyone by default; the toggle in
the header switches to dark per device.

Saves are **partial**: the daily log sends only the trackers you changed and
the server upserts per entry, so two devices editing different rows of the
same day can't overwrite each other — and queued offline saves of the same
day merge by tracker rather than replacing. On browsers with Background Sync,
the offline queue is mirrored into IndexedDB and the service worker drains it
even after the tab is closed.

## Deploy online

See [DEPLOY.md](./DEPLOY.md) for the Vercel + MongoDB Atlas walkthrough.
