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

### Setting the time

`vercel.json` schedules the job in **UTC**, and it ships set to `0 18 * * *` —
18:00 UTC, which is **midnight in UTC+6 (Bangladesh)**. If you're somewhere
else, change the hour to `24 − your UTC offset`:

| Your timezone | Line in `vercel.json` |
|---|---|
| UTC+6 (Dhaka) | `"schedule": "0 18 * * *"` |
| UTC+5:30 (India) | `"schedule": "30 18 * * *"` |
| UTC+1 (London, summer) | `"schedule": "0 23 * * *"` |
| UTC−5 (New York) | `"schedule": "0 5 * * *"` |

Vercel's free Hobby plan allows one trigger per day, which is exactly what a
nightly reminder needs. The job is safe to run more than once — it records
which day it last nagged you about, so a retry can't produce a second
notification.

> The reminder is always about the **day that just ended**, and it's skipped
> entirely on days you've already logged. Tapping it opens that day's log.

## 4. Use it from your phone

Open the URL on your phone, sign in, and (optional but recommended) use the
browser menu → **"Add to Home Screen"** so it opens like an app.

## 5. Invite your friends

Send them the URL and the invite code. They tap **Sign up**, enter their own
name, email, password and the code — and get a completely separate, private
tracker. Nobody can see anyone else's data.

To stop new sign-ups, change `INVITE_CODE` in Vercel and redeploy; existing
accounts keep working.

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
