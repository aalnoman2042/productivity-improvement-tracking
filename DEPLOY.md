# Deploying PIT online (Vercel + MongoDB Atlas)

Follow these steps once and you'll be able to use PIT from your PC **and** your
phone at a `https://…vercel.app` URL.

## 1. Push the code to GitHub

```powershell
cd D:\PIT\pit
git add -A
git commit -m "PIT initial version"
```

Then create an empty repository on https://github.com/new (name it `pit`,
**Private** is fine) and:

```powershell
git remote add origin https://github.com/<your-username>/pit.git
git branch -M main
git push -u origin main
```

> `.env.local` is gitignored — your PIN and secrets are never pushed.

## 2. Create a free MongoDB Atlas database (your online data storage)

1. Go to https://www.mongodb.com/cloud/atlas/register and sign up (free).
2. Create a cluster — choose the **M0 Free** tier, any provider, a region near
   you (e.g. Singapore or Mumbai).
3. When asked to create a **database user**, set a username and password —
   write the password down (avoid `@`, `:`, `/` characters in it to keep the
   URL simple).
4. Under **Network Access**, add IP address `0.0.0.0/0` ("allow access from
   anywhere") — required because Vercel's servers have changing IPs.
5. Click **Connect → Drivers** on your cluster and copy the connection string.
   It looks like:

   ```
   mongodb+srv://youruser:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

   Replace `<password>` with your real password.

No collections to create — the app creates its own on first use (database
name `pit`).

## 3. Deploy on Vercel

1. Go to https://vercel.com and sign up **with your GitHub account**.
2. Click **Add New → Project** and import your `pit` repository.
3. Before clicking Deploy, open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `MONGODB_URI` | the `mongodb+srv://…` string from Atlas (with your password filled in) |
   | `INVITE_CODE` | the code friends must type to create an account |
   | `SESSION_SECRET` | a long random string (60+ random characters) |

   To generate a good `SESSION_SECRET`, run this in PowerShell and paste the output:

   ```powershell
   -join ((1..48) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
   ```

4. Click **Deploy**. After ~1 minute you get your URL, e.g.
   `https://pit-yourname.vercel.app`.

## 3b. Turn on the nightly reminder (optional)

PIT can send a phone notification each night reminding you to log the day.
Skip this and everything else still works — the Account page just says
reminders aren't set up.

1. Generate the keys once, on your PC:

   ```powershell
   cd D:\PIT\pit
   npm run vapid-keys
   ```

2. Add all four values it prints to Vercel → Project → Settings →
   **Environment Variables**:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | from the script |
   | `VAPID_PRIVATE_KEY` | from the script |
   | `VAPID_SUBJECT` | `mailto:your@email.com` |
   | `CRON_SECRET` | from the script — Vercel sends it to the job automatically |

3. Redeploy, then open **Account** in the app and tap **Turn on reminders**.
   Do this on every device you want notified; **Send a test** confirms it
   works. On iPhone, add PIT to your Home Screen first — iOS only delivers
   notifications to installed web apps.

   > **Set the variables *before* the build, not after.** Anything named
   > `NEXT_PUBLIC_*` is baked into the browser bundle when the site is
   > compiled, not read when it runs. Deploy first and add the key second and
   > the Account page will keep saying push isn't set up until you redeploy —
   > the server has the key, but the page in the browser doesn't.

4. Confirm it's actually running. The Account page reports the schedule
   itself: *"✓ Schedule last ran 6 hours ago, sending 1 reminder."* Nothing
   there after the first night means the cron isn't firing — check the job
   under Vercel → Project → **Cron Jobs**. You can also trigger a run by hand:

   ```powershell
   curl.exe -H "Authorization: Bearer <CRON_SECRET>" https://your-site.vercel.app/api/cron/reminders
   ```

   It answers with what it did — `checked`, `notified`, `skipped` — and
   running it twice in one night can't send twice.

### Setting the time

The hour is chosen **in the app**: Account → Daily reminder → *Ask me at*. It
is stored per account, in your own timezone, and applies to every device you
have switched reminders on for.

### 3b-i. The thing that has to be awake (do this, or times don't work)

A reminder set for 18:00 needs *something* to notice that it is 18:00. Vercel's
free plan fires a cron **once a day**, so on its own it can only ever deliver
at one moment — which is exactly the "the only notification I get is the
11 PM one" symptom. Two schedules need polling:

| Endpoint | What it sends |
|---|---|
| `/api/cron/reminders` | the daily ask at your hour, the Sunday digest, the three-day check-in |
| `/api/cron/tracker-reminders` | per-tracker times (gym at 18:00, namaz at all five waqts) |

**The repo already ships the poller**: `.github/workflows/reminders.yml` calls
both every 15 minutes from GitHub Actions, free. Turn it on once, in the
GitHub repo under **Settings → Secrets and variables → Actions**:

- **Variables** tab → New variable: `PIT_URL` = `https://your-site.vercel.app`
  (no trailing slash)
- **Secrets** tab → New secret: `CRON_SECRET` = the same value you put in Vercel

Then open **Actions → Reminders → Run workflow** once to prove it: the run log
prints the HTTP status and what each endpoint did. Two caveats about GitHub's
scheduler — it runs late when busy (5−20 minutes, which the three-hour grace
window on a slot absorbs), and it pauses schedules on a repository with no
activity for 60 days (a commit, or the Enable button, brings it back).

Prefer not to use GitHub? Any HTTP scheduler does — cron-job.org (free) with
the two URLs above, every 15 minutes, sending
`Authorization: Bearer <CRON_SECRET>` (or `?key=<CRON_SECRET>` if headers are
awkward). Calling either endpoint often is safe: everything is stamped per
day, so nothing sends twice.

**Two things happen even with no poller at all**, so the app is never
completely silent: the daily cron in `vercel.json` runs both schedules once
(17:00 and 15:30 UTC), and **opening PIT sends anything already due for you**
— the app pokes `/api/reminders/flush` when it comes to the front, at most
once every ten minutes, for your account only.

### Where the daily cron fires

`vercel.json` schedules both jobs once a day in **UTC** as a backstop, shipped
as `0 17 * * *` (17:00 UTC = 11 PM in UTC+6) and `30 15 * * *`. If you are not
running a poller, set the first to `23 − your UTC offset`:

| Your timezone | Line in `vercel.json` |
|---|---|
| UTC+6 (Dhaka) | `"schedule": "0 17 * * *"` |
| UTC+5:30 (India) | `"schedule": "30 17 * * *"` |
| UTC+1 (London, summer) | `"schedule": "0 22 * * *"` |
| UTC−5 (New York) | `"schedule": "0 4 * * *"` |

> The reminder goes out **every day**, logged or not — the ask is the closing
> ritual of the day, and tapping it opens that day's log. One set for the
> morning asks about *yesterday*: nobody can report on a day that has not
> happened yet. And after three days with nothing logged, PIT checks in on
> its own, whether or not the daily ask is switched on.

## 3c. Turn on per-tracker reminders (optional, needs 3b)

Any tracker can carry its own daily reminder times — "Gym at 18:00", or up to
five for a prayer tracker, one per waqt — set when adding or editing the
tracker on the Trackers page. Each time fires **only while the day still
needs it**: most trackers go quiet once logged, a prayer tracker only once
all five prayers are in. Pushes arrive on every device where you've turned
reminders on (step 3b).

This is the schedule that needs the poller from **3b-i** — the GitHub Action
in the repo already calls it every 15 minutes, alongside the daily ask. Turn
that on and there is nothing else to do here.

Whatever polls it, the endpoint is safe to call as often as you like. Each
reminder sends at most once per day, is skipped once the tracker is logged,
and one that couldn't be delivered within 3 hours of its time is dropped
rather than arriving at midnight. You can test it by hand:

```powershell
curl.exe -H "Authorization: Bearer <CRON_SECRET>" https://your-site.vercel.app/api/cron/tracker-reminders
```

It answers with what it did — `checked`, `notified`, `skipped`. The
Account page reports on this schedule too, as soon as any tracker has a time
set: if it says the schedule has never run, nothing is polling it.

## 4. Use it from your phone

Open the URL on your phone, sign in, and (optional but recommended) use the
browser menu → **"Add to Home Screen"** so it opens like an app.

## 5. Invite your friends

Send them the URL and the invite code. They tap **Sign up**, enter their own
name, email, password and the code — and get a completely separate, private
tracker. Nobody can see anyone else's data.

To stop new sign-ups, change `INVITE_CODE` in Vercel and redeploy; existing
accounts keep working.

## 6. Running it for a crowd (hundreds or thousands of accounts)

Everything in this file so far is the free-tier setup — right for the owner
and a handful of friends. Two thousand people using it at once is a different
question, and most of the answer is **not** in the code: the app was made to
stay inside its limits, but the limits belong to the services under it.

**What the code now does on its own**

- The admin page reads accounts **a page at a time**, and counts trackers,
  logged days and devices only for the rows on screen. It used to group every
  entry in the database on every load — fine at five accounts, a full scan of
  millions of rows at two thousand.
- The daily reminder poll works through **at most `REMINDER_BATCH` (250)
  people per run**, oldest-ask-first. The ask is *owed, not scheduled*, so
  anyone past the cap is simply first in line fifteen minutes later; the
  number deferred is recorded and shown on /admin. Raise `REMINDER_BATCH`, or
  poll more often, if that line stops being zero.
- The free AI has a **whole-app daily budget** (`aiDay` in `lib/rateLimit`,
  900 requests). Past it, the coach says the budget is spent and comes back
  tomorrow, instead of every user getting a raw 429 from Groq.
- The Mongo pool size is `MONGO_POOL_SIZE` (default 10 **per serverless
  instance** — connections in flight are instances × this).

**What you have to buy, because no code change avoids it**

| Limit | Free tier | What 2,000 users need |
|---|---|---|
| Atlas storage | 512 MB (M0) | The owner's own account uses ~1.4 MB of documents+indexes. 2,000 accounts logging for a year will not fit — plan on **M10 or larger**, and watch the 💾 Database card on /admin, which turns amber at 70%. |
| Atlas connections | ~500 on shared tiers | Instances × `MONGO_POOL_SIZE`. If pages start failing to load under load, that is what "too many connections" looks like — lower the pool or move up a tier. |
| Atlas CPU | shared, throttled | M0 is a shared box. Sustained traffic gets throttled, and throttling looks like a slow app, not an error. |
| Groq (the AI) | ~1,000 requests **per day, per key**, 8,000 tokens/minute | This is per *key*, not per person: 2,000 people cannot each have a daily read. Either buy a paid tier, or accept that the AI is first-come-first-served each day (which is what the budget above makes it). |
| Vercel | Hobby | Hobby is for non-commercial use and has its own concurrency and cron limits. A real crowd belongs on Pro. |
| Web push | free | The one part that genuinely scales; sending is per-device and cheap. |

Also set **`PIT_SKIP_SCHEMA_SYNC=1`** once the collections exist and the
validators are current: without it, every cold serverless start issues a
dozen `collMod` commands, which is a real load on a shared cluster and buys
nothing after the first deploy. Run `npm run check:db` after any change to
`lib/db.ts` to confirm the cluster matches before switching the sync off
again.

## Updating the app later

Any time the code changes:

```powershell
cd D:\PIT\pit
git add -A
git commit -m "describe the change"
git push
```

Vercel redeploys automatically on every push.

## Notes

- Your local dev data (in the MongoDB running on your PC) and the online Atlas
  data are separate databases. To use the online database from your PC too,
  put the same `mongodb+srv://…` string in `.env.local` as `MONGODB_URI`.
- To change the invite code later: edit `INVITE_CODE` in Vercel → Project →
  Settings → Environment Variables, then redeploy.
