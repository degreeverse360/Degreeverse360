# Deploying Degreeverse360 — from an Android phone

This guide uses only free-tier services with web dashboards, so every step works from Chrome on your Android phone. No terminal required except one one-time step, which also has a phone-friendly workaround noted below.

You'll set up three things:
1. A **PostgreSQL database** (Supabase — free tier)
2. The **backend API** (Render — free tier)
3. The **frontend** (Netlify or Vercel — free tier, drag-and-drop)

---

## Step 1 — Create the database (Supabase)

1. Go to **supabase.com** → Sign up / log in.
2. Create a **New Project**. Pick any name (e.g. `degreeverse360`) and a strong database password — save it somewhere safe.
3. Once the project is ready, go to **Project Settings → Database → Connection string → URI**. Copy it — it looks like:
   `postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres`
   Replace `[YOUR-PASSWORD]` with the password you set. This is your `DATABASE_URL`.
4. Go to the **SQL Editor** tab in Supabase (in-browser, works fine on mobile). Open this project's `backend/src/db/schema.sql` file, copy its full contents, paste into the SQL editor, and click **Run**. This creates all 17 tables, default statuses, and default lead sources.

You now have a live, shared database reachable from anywhere.

---

## Step 2 — Deploy the backend (Render)

1. First, get this project's code into a GitHub repository — easiest way on phone:
   - Go to **github.com**, sign in, create a **New repository** named `degreeverse360`.
   - Use GitHub's web uploader (repository page → **Add file → Upload files**) to upload the entire `backend/` folder contents (or the whole project).
2. Go to **render.com** → sign up/log in → **New → Web Service**.
3. Connect your GitHub account and select the `degreeverse360` repo.
4. Set:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance type**: Free
5. Under **Environment Variables**, add each of these (from `backend/.env.example`):
   - `DATABASE_URL` → your Supabase connection string from Step 1
   - `DB_SSL` → `true`
   - `JWT_SECRET` → any long random string (30+ characters, mash your keyboard)
   - `JWT_EXPIRES_IN` → `7d`
   - `CORS_ORIGIN` → `*` for now (tighten later to your real frontend URL)
   - `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` → your choice
6. Click **Create Web Service**. Render will build and start it — watch the logs tab until it says `Degreeverse360 CRM API running on port ...`.
7. Copy your service's URL, e.g. `https://degreeverse360-api.onrender.com`. Your API base for the frontend is that URL **plus `/api`**, e.g. `https://degreeverse360-api.onrender.com/api`.
8. **Create your first Super Admin login**: Render's free tier lets you open a **Shell** tab in the browser for your service (under the service dashboard). Run:
   ```
   npm run seed
   ```
   This creates the Super Admin account using the `SEED_ADMIN_*` values you set above. (If your plan has no Shell tab, temporarily set `SEED_SAMPLE_DATA=true` and redeploy — the seed script also runs safely if you trigger a "Manual Deploy" after adding a short-lived deploy hook script — or ask a teammate with a laptop to run `npm run seed` once, pointed at the same `DATABASE_URL`.)

**Note on Render's free tier:** it sleeps after inactivity and takes ~30–60 seconds to wake up on the next request. This is fine for a small team; upgrade to a paid instance later if that delay becomes annoying.

---

## Step 3 — Deploy the frontend (Netlify)

1. Go to **netlify.com** → sign up/log in.
2. Use **Add new site → Deploy manually** — this lets you literally drag and drop the `frontend` folder (Netlify's drop zone works via the mobile file picker too).
3. Once deployed, you'll get a URL like `https://degreeverse360.netlify.app`. Share this with your whole team — it's the CRM's web address.
4. Open it, and on the login screen, paste your **API server URL** from Step 2 (e.g. `https://degreeverse360-api.onrender.com/api`) into the "API server URL" field and tap **Save**. This only needs to be done once per device/browser — it's remembered after that.
5. Log in with your Super Admin email/password from Step 2.6.

---

## Step 4 — Add your team

1. Log in as Super Admin.
2. Go to **Counselors → + Add team member**. Create an account for each counselor and admin, choosing their role. Share each person's email + a temporary password with them directly (e.g. via WhatsApp) — have them change it after first login (**user menu → change password**, or ask and we can add a settings screen for this).
3. Every counselor logs into the same site URL from their own phone or computer, and will only ever see leads assigned to them. Admins and Super Admins see everything.

---

## Updating the app later

- **Frontend changes**: re-upload the `frontend` folder to Netlify (drag-and-drop again, or connect it to your GitHub repo for auto-deploys).
- **Backend changes**: push updated code to the GitHub repo; Render redeploys automatically if connected to the repo.
- **Database changes**: run any new SQL migrations through Supabase's SQL Editor.

## Custom domain (optional)

Both Render and Netlify let you attach a custom domain (e.g. `crm.degreeverse.com`) for free under **Settings → Domains**, provided you can edit DNS records for your domain (e.g. through GoDaddy/Namecheap/Cloudflare — all manageable from a phone browser).

## Costs

Everything above fits in free tiers for a small team (Supabase free database, Render free web service, Netlify free static hosting). As your lead volume grows, the first thing worth upgrading is Render's plan, to remove the sleep/wake delay.
