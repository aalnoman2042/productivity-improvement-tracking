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
- **Trackers** (`/trackers`) — create, edit, set goals, archive; one-click
  starter pack for a new account.

## Data model (MongoDB)

Three collections, all with `$jsonSchema` validators so the BSON types stay
honest (`ObjectId` refs, `Date` timestamps, numeric values, real booleans):

- `users` — email (unique), name, scrypt `passwordHash`, `createdAt`
- `trackers` — `userId`, name, type, unit, color, category, goal, archived, order
- `entries` — `userId`, `trackerId`, `date` (`YYYY-MM-DD`), `value`, optional
  `meta` (sleep times & quality), `note`, timestamps.
  Unique on `(userId, trackerId, date)`.

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
