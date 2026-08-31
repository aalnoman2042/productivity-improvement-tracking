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
| AI | Groq **and** Google, both free tiers | `lib/ai.ts` is one door: gpt-oss-120b/20b, falling through to gemini-3.5-flash/-lite when a quota, a key or a model fails. A daily cap belongs to a *key*, so the answer to "quota spent" is another provider, not another model. |
| Push | Web Push (VAPID) | Plus polled cron for scheduling. **Browsers only** — an Android WebView has no Push API, so the app schedules its own (§11) |
| Android app | Capacitor 8, pinned | A WebView on `server.url`; carries no copy of PIT, so a deploy needs no reinstall (§11). `android/` is generated in CI, never committed |
| Tests | Vitest | Pure `lib/` logic, **and now route handlers** — see §12 |
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
scripts/            one-off tools (icons, VAPID keys, demo seed, db check,
                    and the two the Android app needs: make-keystore.mjs
                    once per lifetime, android-overrides.mjs every build)
public/sw.js        the service worker
proxy.ts            middleware: auth gate + moved addresses

capacitor.config.ts the Android shell: what it is called, and the URL it opens
capacitor/www/      the only files the APK carries — error.html, and a stub
                    index.html that exists because Capacitor insists on one
android-overlay/    what CI puts back after generating android/: the signing
                    config, one manifest permission, the notification icon
android/            NOT in the repository. Generated, patched, built, discarded
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
| `users` | email, passwordHash, `reminder{enabled,tzOffset,time,place}`, `timeValue{perMinute,currency}` | email |
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
day with nothing logged. This is not an oversight; see §13.

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
- `dates.ts` — parsing, buckets, and `isBeyondToday`, the guard that makes
  the Tomorrow tab safe (§13). Also the **calendar periods**: every range in
  this app is a unit you can name — a Monday-to-Sunday week, a half-month, a
  calendar month, Jan–Jun or Jul–Dec, a year — identified by its first day
  and picked by `components/PeriodPicker`. `periodRange(period, anchor,
  today)` counts a finished unit whole and a running one up to today;
  `previousRange` is what it is compared against.
- `clock.ts` — the night axis, so a 1am bedtime sorts after a 11pm one.
- `streak.ts`, `milestones.ts`, `challenges.ts`.

**The day itself**
- `draft.ts` — the day-draft model, the strict 24-hour cap, and
  `slipNeedsReason` (a streak slip must say why).
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

**The Android app does not wait to be told.** An Android WebView has no
Push API, so every one of the arrows above stops at its door. Instead the
phone reads the hour off the account and writes it onto its own alarm clock
(`lib/native.ts`), which is both weaker and stronger than push: it cannot
carry a message the server computed — no "your challenge ends today", no
Sunday digest — but it fires with no signal, with PIT closed, and with
nothing on the internet awake. The account's setting stays the one setting;
only the delivery differs. It is re-armed on every resume, because Android
exempts only the *next* occurrence from Doze, and because a force-stop or a
reboot before first unlock throws the alarm away.

> **This is the one part that needs setup outside the code:** the repository
> needs a `PIT_URL` variable and a `CRON_SECRET` secret, and `PIT_URL` must
> point at a deployment with Vercel Deployment Protection **off**. Until
> then, reminders only fire when the app is opened.

---

## 11. The Android shell

The APK is a WebView pointed at the deployed site. It carries **no copy of
PIT** — `capacitor.config.ts` sets `server.url` and that is the entire
mechanism — so a push to `main` is on the phone at its next launch, with
nothing rebuilt and nothing reinstalled. The only thing that needs a new APK
is a change to something *native*: the name, the icon, a permission, a plugin,
the URL it points at.

```
git push  ──►  Vercel  ──►  protrackive.vercel.app  ──►  the browser
                                     │                └──►  the APK's WebView
                                     │
  .github/workflows/apk.yml  ──►  a new APK, only when the native side changes
```

**`android/` is not in this repository.** It is generated by
`npx cap add android` during the build, patched by
`scripts/android-overrides.mjs` from the files in `android-overlay/`, signed,
and thrown away. The patch writes files Capacitor's generator never writes —
Gradle merges repeated `android { }` blocks and AGP merges build-type
manifests — so exactly one generated line is ever touched, and it is an
append. A canary in the same script fails the build the day the template
stops looking the way it looks now, because the alternative is an APK that
builds, signs, uploads and cannot be installed.

**Three things the web version gets for free and the shell has to be told.**
A WebView is not a browser in standalone mode; it is not a browser at all.

| Fact | How it is known | Why it isn't automatic |
|---|---|---|
| "I am the app" | `PITApp` appended to the user agent, read through `lib/native.ts` | Nothing else distinguishes the WebView from Chrome. Being on the *request* is the point — the inline script in the root layout can stamp `data-shell="native"` on `<html>` before the first paint |
| Install offers stay hidden | `[data-shell="native"] .hide-installed` | `@media (display-mode: standalone)` does not match a WebView, so the installed app would spend its life offering to install itself |
| Content clears the status bar | `--safe-area-inset-*`, published by Capacitor's System Bars plugin, with `env()` as the fallback | Android 15 and 16 draw every app edge to edge and removed the opt-out |

**Push does not exist here** — an Android WebView has no Push API at all, so
nothing the server sends can arrive. The daily ask is kept by the phone
instead (§10). The one screen the APK does carry is `capacitor/www/error.html`,
shown when the WebView cannot reach the site; it is served from the app's own
assets, which means Capacitor's bridge is *not* injected into it and it can
call nothing — including the back-button listener, so on that one screen back
falls through to Capacitor's default and retries the address that failed. It
behaves as a second Try again; the way out is the home button.

---

## 12. Testing, and its honest limits

510 tests. `npm test`.

**What used to be missing, and now partly isn't.** For most of this
project's life not one route handler had a test, and the reason was mundane:
a `route.ts` imports `@/lib/...` and vitest had no alias for `@`, so every
attempt failed at resolution rather than at an assertion. `vitest.config.mts`
adds the alias and `tests/helpers/fakeDb.ts` is just enough MongoDB to run a
handler; `/api/entries`, `/api/rest` and `/api/catchup` have tests, including
a regression for the note-wiping bug below. The rest of the handlers still
don't. Every bug that has actually mattered on this project was found by
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

## 13. Invariants — do not regress these

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
15. **An hour is only priced at a price its owner set,** and what counts
    as time badly spent is only ever the habit flag they set too. The app
    never decides either. Sleep is priced in the total and judged in
    neither column — see `lib/timeValue`.
16. **The APK carries no copy of PIT.** It is a WebView on the deployed
    URL, so what is deployed is what opens. Anything that would put app
    code inside the APK breaks the only reason it needs no reinstall.
17. **A reminder in the Android app is the phone's own.** Nothing the
    server sends can reach a WebView, so the hour is an alarm the device
    keeps — re-armed on every resume, because `allowWhileIdle` exempts
    only the next occurrence from Doze.
18. **The signing key is never generated in CI.** The repository is
    public, so an artifact or a workflow input is a public place. A key
    born on a runner is a key anyone can sign as PIT with.
19. **The catch-up screen offers taps only.** Reconstructing a yes/no from
    memory is honest; typing last Tuesday's sleep is invention, and this app
    would rather keep a gap than gain a made-up number.

---

## 14. Deploying

`git push` to `main`. Vercel builds and deploys. That is the whole procedure —
**for the phone too**, which is the point of the shell (§11): the APK opens
the deployed site, so a deploy is on it at the next launch with nothing to
reinstall.

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
