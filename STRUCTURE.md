# PIT — system design

How this app is put together, and why. `README.md` explains what it does for
the person using it; this explains what it does for the person changing it.

Read `AGENTS.md` first if you are an AI agent: this is **Next.js 16 App
Router**, and its conventions differ from older ones in ways that will bite.

---

## 1. What it is, in one paragraph

A personal life-tracking PWA. You define **trackers** (study time, sleep,
prayers, junk food, clean streaks), log each day in taps, and the app judges
the record: a score out of 100, trends, patterns, grades, advice and an AI
coach. It is invite-only, every account is private, it works offline, and it
installs to a phone's home screen. One person owns it; a few friends use it.

---

## 2. Stack

| Layer | Choice | Note |
|---|---|---|
| Framework | Next.js 16 (App Router) | React 19 + React Compiler |
| Language | TypeScript, strict | `npx tsc --noEmit` must stay clean |
| Styling | Tailwind CSS v4 | Theme tokens in `app/globals.css` |
| Database | MongoDB Atlas | Schema enforced by `$jsonSchema` validators |
| Auth | JWT in an httpOnly cookie | `jose`, scrypt password hashing |
| Charts | Recharts | Lazily imported *and* lazily mounted |
| AI | Groq (free tier) | `openai/gpt-oss-120b` / `-20b` |
| Push | Web Push (VAPID) | Plus polled cron for scheduling |
| Tests | Vitest | Pure `lib/` logic only — see §11 |
| Layout | Two rules in `globals.css` | `.page-width` (header, page and footer share one width, growing at 1280/1536px) and `.card-stack` (a stack of cards on a phone, two columns on a big screen). The daily log uses a plain grid instead — it has `position: sticky` bars, and sticky inside multi-column is unreliable. |
| Hosting | Vercel | Every push to `main` auto-deploys |

---

## 3. The shape of a request

```
Browser
  │
  ├─ page navigation ─────────────► proxy.ts (middleware)
  │                                   ├─ moved addresses (/today, /books, /welcome)
  │                                   ├─ reads the session cookie (signature + expiry only)
  │                                   ├─ signed out → the pitch, or /login for deep links
  │                                   └─ signed in  → app/(app)/…
  │
  └─ data ────────────────────────► app/api/**/route.ts
                                      ├─ currentUserId()  ← every route, no exceptions
                                      ├─ lib/*            ← the actual thinking
                                      └─ lib/db.ts        ← Mongo, validated
```

**The proxy is a gate, not an authority.** It only checks that the cookie's
signature and expiry hold, because the edge runtime has no database. Every
API route independently calls `currentUserId()`, which does the real check.
A revoked session gets a page shell and no data.

---

## 4. Directory map

```
app/
  (app)/            authenticated pages; the layout owns Nav + SwipeNav
    page.tsx        Daily log — the app opens here
    dashboard/      charts
    status/         where you stand + the AI coach
    trackers/       tracker CRUD, packs, Challenges, Books
    history/        month calendar, notes search
    tracker/[id]/   one tracker's whole story
    settings/       account, reminders, data
    admin/          owner-only counts, health, and the 🔔 nudge
    catchup/        the blank days, in one list, answerable in taps
  start/            first-run tour (signed in, outside the app shell)
  welcome/          the signed-out pitch, served at / by a proxy rewrite
  login|signup|forgot|reset/
  error.tsx         a screen that threw     ← uses `unstable_retry`, not `reset`
  global-error.tsx  the root layout threw   ← gets NO global styles
  not-found.tsx     404 (signed-in readers only; the proxy catches the rest)
  api/              route handlers — see §6

components/         client components; presentation and interaction
lib/                pure logic, shared helpers, and the database
                    (e.g. nudge.ts — how one hand-sent push is worded;
                     bookComments.ts — what you made of a book, as you went;
                     rest.ts — what a run may step over, and the one
                       definition of a run in the codebase;
                     catchup.ts — which days are blank, and never today;
                     targets.ts — a number with a date on it, and the
                       arrival date your own pace implies;
                     pixels.ts — a year laid out as calendar weeks)
tests/              vitest specs, one per lib module
scripts/            one-off tools (icons, VAPID keys, demo seed, db check)
public/sw.js        the service worker
proxy.ts            middleware: auth gate + moved addresses
```

**The rule that keeps this navigable:** anything testable lives in `lib/`.
A `route.ts` may only export request handlers, so shared logic cannot live
there even when only two routes need it. Components render; they don't decide.

---

## 5. Data model

Thirteen collections, every one with a `$jsonSchema` validator in `lib/db.ts`,
so the BSON types stay honest (real `ObjectId` refs, real `Date`s, real
booleans). Collections self-create on first write — there is never any manual
Atlas work. `npm run check:db` reads back what the cluster is actually
enforcing and compares it to the code.

| Collection | Key fields | Unique on |
|---|---|---|
| `users` | email, passwordHash, `reminder{enabled,tzOffset,time,place}` | email |
| `trackers` | name, type, unit, color, category, goal, `target{kind,value,by}`, habit, `reminder{times,mode}` | — |
| `entries` | trackerId, date, value, `meta`, note | (userId, trackerId, date) |
| `dayNotes` | date, text | (userId, date) |
| `tasks` | date, text, done, order | — (many per day) |
| `books` | title, author, status, pages, pagesRead, rating, `comments[]` | — |
| `challenges` | trackerId, startDate, days, target, direction | — |
| `aiReviews` | text, snapshot, today, model | — (latest wins) |
| `weeklyReviews` | weekStart, weekEnd, text, snapshot, digest | (userId, weekEnd) |
| `restDays` | date, reason | (userId, date) |
| `pushSubs` | endpoint, keys | endpoint |
| `rateLimits` | count, resetAt | `_id` = `action:subject` (TTL) |
| `cronRuns` | job, startedAt, result | — (TTL, 30 days) |

`restDays` is the odd one out and the point of it: a row there records
that a day was **deliberately** empty. It adds to nothing — not days logged,
not the score, not a grade — and the only thing it changes is that a *run*
may step over it (`lib/rest`). A planned Sunday is not the week you quit,
and an app that cannot tell them apart teaches you to log a lie.

**The three that deliberately touch no number** — `dayNotes`, `tasks` and
`books` (comments included: they are added and removed, never edited, each
stamped with the day it was written) — exist outside the scoring system
entirely. A day with a written
note, three ticked tasks and a finished book, but nothing logged, is still a
day with nothing logged. This is not an oversight; see §12.

---

## 6. The API

Every handler starts with `currentUserId()` and scopes every query by
`userId`. There is no admin bypass, no shared data, no cross-account read.

```
entries/            day upsert (bulk), increment (stopwatch), recent, range, month
notes/              the day's own note        notes/search  across everything written
tasks/              the day's to-do list      tasks/carry   bring leftovers forward
trackers/           CRUD + [id]/history       challenges/   "this, every day, for N days"
books/              the shelf
stats/              period stats              stats/compare week-vs-week, month-vs-month
report/             all-time grades           insights/correlations  the pattern engine
coach/              the daily AI read         coach/ask     a question box
                                              coach/weekly  the week in review, kept
reminders/          settings, subscribe, test, digest, flush
cron/               reminders, tracker-reminders  (CRON_SECRET, polled externally)
export/ import/     JSON + CSV backup, and the way back in
auth/               signup, login, logout, me, profile, password, forgot, reset
admin/users         counts only, for accounts in ADMIN_EMAILS
admin/storage       collection sizes against the cluster's ceiling — sizes
                    only, no row is ever read
admin/health        cron health for both jobs, what can receive a push, and
                    whether the live schema matches the code
```

### Why writes are POST even when they shouldn't be

The offline queue in `lib/sync.ts` speaks exactly one verb. So ticking a task
is `POST /api/tasks/<id>`, not `PATCH`, and the day note is `POST` rather than
`PUT`. REST purity loses to a checkbox that works in a tunnel — deliberately,
and consistently.

---

## 7. Offline-first, in three layers

**1. `lib/sync.ts` — the cache and the queue.**
Reads are cached in `localStorage`; writes go out immediately when online and
queue when not. `post()` throws `PermanentError` on a 4xx (the server's own
message), retries 5xx later, and drains on reconnect. `cacheSnapshot` memoises
by raw string, so `useSyncExternalStore` never re-parses per render.

**2. `lib/useCached.ts` — the hook.**
Paints the last known copy first, refreshes behind it. Revalidates on focus,
on reconnect, and on a 60s timer — all skipped while the tab is hidden.
Returns `{data, loading, refreshing, stale, error, refresh, update}`.

**3. `public/sw.js` — the shell.**
Precaches the four nav tabs plus the calendar. Navigations are network-first
with a 2.5s timeout falling back to cache; assets are stale-while-revalidate;
`/api/` is never cached. `CACHE` must be renamed whenever the precache list
changes, or old clients keep serving the old shell.

**What this buys:** every screen opens instantly from cache, a day logged in
a tunnel arrives when the signal does, and nothing is lost by a dead screen.

---

## 8. The domain logic

All of it pure, all of it in `lib/`, all of it tested.

**Scoring and judgement**
- `score.ts` — the day score out of 100: goals 50, logging 20, sleep band 15,
  clean 15, weights redistributing when a part is N/A.
- `direction.ts` — **which way is up, decided once.** `wantMore` (habit beats
  type default), `readTrend`, and the shared "that's noise" threshold. Three
  copies of this rule is how the coach and the patterns card end up
  disagreeing in front of the same person.
- `report.ts` — all-time grades per tracker and per category.
- `insights.ts` (what's happening) vs `advice.ts` (what to do about it).
- `correlate.ts` — the pattern engine. Contrasts, never coefficients;
  associations, never causes.
- `periodCompare.ts` — this week vs last, this month vs last. One set of
  arithmetic for both, matched to the *same days* of the previous stretch.

**Time and the calendar**
- `dates.ts` — parsing, ranges, buckets, and `isBeyondToday`, the guard that
  makes the Tomorrow tab safe (§12).
- `clock.ts` — the night axis, so a 1am bedtime sorts after a 11pm one.
- `streak.ts`, `milestones.ts`, `challenges.ts`.

**The day itself**
- `draft.ts` — the day-draft model and the strict 24-hour cap.
- `trackers.ts` — the eight tracker types, categories, template packs.
- `tasks.ts`, `notes.ts`, `books.ts` — the three that count for nothing.
- `prayerTimes.ts` — the five waqts from solar position. No API, no key, no
  network. Returns `null` where the sun never reaches the angle, rather than
  inventing a time.

---

## 9. The AI subsystem

Three features, one door, one set of facts.

```
gatherCoachFacts()   ← what leaves this server is decided HERE, once
      │                numbers and tracker names only. No notes. No email.
      ▼
  askGroq()          ← one door: same failure messages, one fallback chain
      │
      ├── /api/coach          the daily read      · 1 per 8 hours · JSON card
      ├── /api/coach/ask      the question box    · 10 per hour   · prose
      └── /api/coach/weekly   the week in review  · kept for good · JSON card
```

**Rules that make it trustworthy:**

1. **No number on any card comes from the AI.** The score, momentum,
   sparkline, streak, grade and sleep line are all computed by the app and
   stored beside the review. A clumsy generation cannot make the figures lie.
2. **The model never does arithmetic.** It copies figures verbatim; the
   accuracy rules in each prompt outrank the style rules.
3. **It never sees a word anyone wrote.** Not a note, not a task, not an
   email. The welcome page promises this out loud.
4. **Every model-authored string is untrusted.** `parseReview` validates
   field by field and drops evidence that looks like a JSON paste.
5. **Failures are classified, not lumped.** `classifyFailure` decides whether
   a second model is worth trying: a withdrawn model or an unusable
   generation yes, a spent quota no (the cap is per minute and shared).

---

## 10. Reminders

The hard part is not sending; it is *scheduling* on a host that fires cron
once a day while every reminder belongs to a person's own clock.

```
GitHub Actions (every 15 min)  ──►  /api/cron/reminders          the daily ask
                               ──►  /api/cron/tracker-reminders   per-tracker + waqts
Opening the app (throttled)    ──►  /api/reminders/flush          your own, only
vercel.json (twice a day)      ──►  both, as a backstop
```

Both endpoints are **polled, not scheduled**: each poll asks who is due.
The daily ask is *owed rather than scheduled* — once your hour passes it
stays due for the rest of your local day, so a stalled poller delivers late
instead of skipping the night in silence. Per-tracker slots expire instead,
with a three-hour grace window, and a prayer tracker recomputes its five
times from the sun every day.

**Switched off is not unreachable.** Turning the daily reminder off stops
*everything the schedule sends* — the ask, the Sunday digest and the
gone-quiet check-in all read `reminder.enabled` — but it keeps the browser's
subscription, so a message sent **by hand** can still arrive. That message is
`/api/admin/nudge` (admins only, `lib/nudge`): one push, to one person, now.
It never stamps `reminder.lastSentFor`, so a nudge at noon cannot swallow the
ask at eleven. "Receives nothing at all" is a separate control on the Account
page, which unregisters the device.

**One poll is bounded.** `runReminders` does database work for at most
`REMINDER_BATCH` (250) people per run, taking whoever has gone longest
without their ask first. Because the ask is owed rather than scheduled,
anyone past the cap is delivered on the next poll instead of being dropped —
and the number deferred is recorded in `cronRuns` and shown on /admin, so a
schedule that needs polling more often says so.

> **This is the one part that needs setup outside the code:** the repository
> needs a `PIT_URL` variable and a `CRON_SECRET` secret, and `PIT_URL` must
> point at a deployment with Vercel Deployment Protection **off**. Until
> then, reminders only fire when the app is opened.

---

## 11. Testing, and its honest limits

437 tests, one spec per `lib/` module, all pure. `npm test`.

**What is not covered, stated plainly:** not one of the ~47 route handlers
has a test. Every bug that has actually mattered on this project was found by
probing by hand — a prompt leaking JSON field names, a model withdrawn by the
provider, a validator whose backslashes were eaten on the way to disk. A unit
test could not have caught any of them.

What partially fills the gap:
- `npm run check:db` — reads back the live validators and indexes and compares
  them to the code. Read-only; safe against production.
- The Groq prompt harness: dump a synthetic `buildCoachFacts()` payload from a
  throwaway spec, then POST it to Groq from a scratch script that reads the
  SYSTEM prompt straight out of the route, so the check cannot drift from
  production. **Synthetic fixtures only — never the owner's rows.**

---

### Failure is contained

`app/error.tsx` catches anything that throws, which means anything that throws
takes the **whole screen**. So every card that is *supplementary* to its page
is wrapped in `components/CardBoundary` and can only ever replace itself with
a sentence. What is not wrapped is deliberate: the tracker inputs on the daily
log and the calendar on History are the point of those pages, and hiding them
quietly would be worse than failing loudly.

## 12. Invariants — do not regress these

1. **A day's time (duration + sleep) ≤ 1440 minutes,** enforced on the
   server, in the stopwatch, and on the page.
2. **A slip is not a blank.** A broken streak is `value 0` *with* meta, so it
   stays on record instead of reading as a day you never logged.
3. **Unlogged fails an "at least" goal and passes an "at most" one.**
4. **Bad habits invert everything:** more is worse, growth is a warning, and
   the grade counts the days it *didn't* happen.
5. **Deleting anything with history requires typing a phrase** and sending
   back the count you were shown.
6. **A note never invents a day**, and neither does a task. Nothing you write
   can inflate days logged, the score, or a streak.
7. **The server never trusts a client's "today" for anything that guards** —
   but date-scoped features accept `?today=`, because "today" is the reader's
   clock, not UTC's. `isBeyondToday` allows exactly one day of slack for the
   far side of the date line, and refuses next week.
8. **A day that hasn't happened cannot be logged.** Tomorrow is reachable to
   *plan* precisely because the server refuses to record it.
9. **No number on an AI card comes from the AI** (§9).
10. **The daily ask is owed, not scheduled** (§10).
11. **A message sent by hand never marks the schedule as done.** An admin
    nudge sends a push and stamps nothing; the night's ask is still owed.
12. **Reminders off means the app stops asking, not that the device is
    gone.** The subscription survives the switch; only unregistering the
    device ends delivery entirely.
13. **A rest day bridges a run; it never lengthens one.** It is a flag with
    no value attached, so it cannot add to days logged, a score, a grade or
    a challenge's `met` — it can only stop a gap reading as a collapse.
14. **A projection is drawn from movement that happened.** No movement, or
    movement away from the target, means no arrival date at all — the card
    says so rather than printing something reassuring (`lib/targets`).
15. **The catch-up screen offers taps only.** Reconstructing a yes/no from
    memory is honest; typing last Tuesday's sleep is invention, and this app
    would rather keep a gap than gain a made-up number.

---

## 13. Deploying

`git push` to `main`. Vercel builds and deploys. That is the whole procedure.

Before pushing: `npm test`, `npm run lint`, `npx tsc --noEmit`,
`npm run build:local`. All four must be clean.

`npm run lint` also runs `check:shape`, which enforces the one React Compiler
rule nothing else catches: **in a component, compute everything before the
first early return.** A `const` declared after one and read from the JSX can
be emitted out of scope — a `ReferenceError` that appears only in production,
on code that dev, ESLint, `tsc` and `next build` all call clean.

Environment lives in Vercel's project settings (and `.env.local` for
development). Adding a variable requires a redeploy to take effect. The
version number lives in **three** places — `package.json`, the lockfile's own
root entries, and `lib/version.ts`, which is what Account → About shows and
what every backup is stamped with.
