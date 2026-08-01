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
| `measure` | Weight, calories | A decimal + unit | Trend line |

Any tracker can carry a **goal** ("at least 3h study per day", "at most 2 junk
meals per week"). The dashboard scores every day or week against it.

The stopwatch adds its minutes to the day's total, so several sessions add up.
It survives a refresh — the running timer is kept in `localStorage`.

## Pages

- **Dashboard** (`/`) — period selector (week / 15 days / month / 6 months /
  year), stat tiles, time donut + trend, sleep chart, one card per habit.
- **Today** (`/today`) — log a day; every tracker gets the input its type needs.
  Also where you delete logged days (see below). `?date=YYYY-MM-DD` opens on a
  specific day.
- **Trackers** (`/trackers`) — create, edit, set goals, archive; one-click
  starter pack for a new account.
- **Account** (`/settings`) — profile, password, and the nightly reminder.

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
  `meta` (sleep times & quality), `note`, timestamps.
  Unique on `(userId, trackerId, date)`.
- `pushSubs` — one row per subscribed browser: `userId`, `endpoint` (unique),
  `keys`. Rows are deleted automatically when a push service reports the
  endpoint is gone.

## Demo data

To fill an account with a believable month of history:

```powershell
npm run seed:demo -- your@email.com
```

This **replaces** that account's trackers and entries. Nothing else is touched.

## Stack

Next.js (App Router) · TypeScript · Tailwind v4 · Recharts · MongoDB ·
sessions as signed JWT cookies (`jose`) with passwords hashed using Node's
`scrypt`; every route is guarded in `proxy.ts` and every query is scoped by
`userId`.

## Deploy online

See [DEPLOY.md](./DEPLOY.md) for the Vercel + MongoDB Atlas walkthrough.
