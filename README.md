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

## How it works

Everything you track is a **tracker**, and its *type* decides both how you enter
it and how it's charted:

| Type | Good for | You enter | Chart |
|---|---|---|---|
| `duration` | Study, work, workout, reading | Hours/minutes, or a stopwatch | Stacked bars + share donut |
| `sleep` | Sleep | Bedtime & wake time (+ quality 1–5) | Hours per night vs target |
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

### Namaz and clean streaks

`prayer` trackers store *which* prayers you prayed, not just how many — the
five buttons on the daily log write `meta.parts`, so "I keep missing Fajr" is
a question the data can answer.

`streak` trackers count **days since the last slip**, not consecutive
check-ins. A day you didn't open the app doesn't reset a three-month run; only
marking a slip does. A slip is stored as value `0` *with* a `meta.status`,
which is what keeps it distinct from a day you never filled in.

## Pages

- **Dashboard** (`/`) — period selector (week / 15 days / month / 6 months /
  year), stat tiles, time donut + trend, sleep chart, then one card per habit
  grouped by category.
- **Today** (`/today`) — log a day; every tracker gets the input its type
  needs. It **saves as you type** (and when you leave the page), shows how much
  of the day is filled in, groups trackers into collapsible sections, and can
  copy yesterday onto a blank day. Also where you delete logged days (see
  below). `?date=YYYY-MM-DD` opens on a specific day.
- **Trackers** (`/trackers`) — create, edit, set goals, archive, and add
  ready-made packs: **Essentials** and **Faith & discipline** (namaz, Quran,
  a clean streak). Adding a pack twice skips what you already have.
- **Account** (`/settings`) — a read on your last 30 days (see below), profile,
  password, and the nightly reminder.

## Lifestyle warnings

The Account page turns the last 30 days into plain statements, worst first:
short sleep, missed prayers, a streak that keeps resetting, goals you're not
hitting, trackers you've stopped filling in. Every one carries the number it
came from, and nothing is shown that the data doesn't support — see
[`lib/insights.ts`](./lib/insights.ts).

## Nightly reminder

With push notifications set up, PIT nudges you each night to fill in the day
that just ended — and stays quiet on days you've already logged.

```powershell
npm run vapid-keys   # once; paste the output into .env.local
```

Turn it on per device from the Account page (each phone or computer subscribes
separately) and use **Send a test** to confirm it arrives. Tapping the
notification opens that day's log. On iPhone, PIT must be added to the Home
Screen first — iOS only delivers push to installed web apps.

The schedule lives in `vercel.json` and fires once a day in UTC;
[DEPLOY.md](./DEPLOY.md) explains how to set it to your local midnight.

## Deleting days

**Delete logged days** at the bottom of `/today` clears a date range — a single
day, a weekend, a whole month. It's a two-step action: check the range first,
then type back the number of days it found. The server independently re-counts
and refuses if the total has changed since you looked, so you can never confirm
a deletion you haven't seen the size of. Deleted days are also dropped from the
offline cache and queue, so nothing resurrects them later.

## Data model (MongoDB)

Four collections, all with `$jsonSchema` validators so the BSON types stay
honest (`ObjectId` refs, `Date` timestamps, numeric values, real booleans):

- `users` — email (unique), name, scrypt `passwordHash`, `createdAt`, optional
  `reminder` (`enabled`, `tzOffset`, `lastSentFor`)
- `trackers` — `userId`, name, type, unit, color, category, goal, archived, order
- `entries` — `userId`, `trackerId`, `date` (`YYYY-MM-DD`), `value`, optional
  `meta` (sleep times & quality, `parts` for namaz, `status` for streaks),
  `note`, timestamps. Unique on `(userId, trackerId, date)`.
- `pushSubs` — one row per subscribed browser: `userId`, `endpoint` (unique),
  `keys`. Rows are deleted automatically when a push service reports the
  endpoint is gone.

## Demo data

To fill an account with a believable month of history:

```powershell
npm run seed:demo -- your@email.com
```

This **replaces** that account's trackers and entries. Nothing else is touched.

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

## Stack

Next.js (App Router) · TypeScript · Tailwind v4 · Recharts · MongoDB ·
sessions as signed JWT cookies (`jose`) with passwords hashed using Node's
`scrypt`; every route is guarded in `proxy.ts` and every query is scoped by
`userId`.

## Deploy online

See [DEPLOY.md](./DEPLOY.md) for the Vercel + MongoDB Atlas walkthrough.
