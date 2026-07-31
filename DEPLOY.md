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
