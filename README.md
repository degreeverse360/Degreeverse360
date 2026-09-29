# Degreeverse360 CRM

A complete lead-to-enrollment CRM built for Degreeverse — capture leads from Facebook/Instagram/Google Ads, WhatsApp, your website, and manual entry; assign them to counselors; track every follow-up, call, and note; manage applications and payments; and see real-time dashboards and reports.

**Role-based visibility is built in at the database and API level:**
- **Super Admin** — full access: manage users, settings, courses/universities, all leads, all reports.
- **Admin** — manage all leads, assign counselors, view all reports.
- **Counselor** — sees and can act **only on leads assigned to them.** They cannot see other counselors' leads, and cannot reassign a lead to someone else.

## What's in this project

```
degreeverse360/
├── backend/          Node.js + Express REST API, PostgreSQL
│   ├── src/
│   │   ├── server.js         App entry point
│   │   ├── config/db.js      Database connection
│   │   ├── middleware/       Auth (JWT) + error handling
│   │   ├── routes/           auth, users, leads, followups, dashboard,
│   │   │                     settings, csv, reports, notifications
│   │   ├── db/schema.sql     Full PostgreSQL schema (17 tables)
│   │   └── db/seed.js        Creates the first Super Admin account
│   ├── package.json
│   └── .env.example
├── frontend/         Plain HTML/CSS/JS single-page app (no build step)
│   ├── index.html
│   ├── css/style.css
│   └── js/            api.js, app.js, pages.js, leadform.js
├── README.md          (this file)
├── DEPLOYMENT.md       Step-by-step hosting guide — doable entirely from a phone
└── API_DOCS.md         Every API endpoint, with example requests
```

## How it works, in short

1. **Backend** is a REST API. It owns the database and all business logic (who can see what, activity logging, duplicate detection, etc).
2. **Frontend** is a static set of HTML/CSS/JS files. It calls the backend over the internet. Because it's static, it can be hosted almost anywhere — even opened as a plain webpage — as long as it can reach your backend's URL.
3. Since your team is on **different devices** and counselors must only see their own assigned leads, you need the backend running somewhere reachable from the internet (see `DEPLOYMENT.md`), with one shared PostgreSQL database. Every device — phone, tablet, laptop — then just opens the same frontend URL and logs in with their own account.

## Quick start (for local testing on a computer)

```bash
# 1. Install PostgreSQL locally, or use a free hosted database (see DEPLOYMENT.md)
# 2. Backend
cd backend
cp .env.example .env        # edit DATABASE_URL and JWT_SECRET
npm install
psql "$DATABASE_URL" -f src/db/schema.sql
npm run seed                 # creates your first Super Admin login
npm start                    # API now running on http://localhost:4000

# 3. Frontend — just open frontend/index.html in a browser,
#    or serve it: npx serve frontend
```

On first load, the login screen asks for an **API server URL** — point it at your backend (e.g. `http://localhost:4000/api` locally, or your hosted backend URL in production).

**To actually deploy this for your team (recommended path), see `DEPLOYMENT.md` — it walks through doing this entirely from your Android phone's browser, using free-tier hosting.**

## Default login

After running `npm run seed`, log in with the email/password set in your `.env` (defaults to `admin@degreeverse.com` / `ChangeMe@123`). **Change this password immediately** from inside the app once you're in.

## Security notes

- Passwords are hashed with bcrypt, never stored in plain text.
- All API routes require a JWT session token except `/auth/login`.
- Every write to a lead is role-checked server-side — a counselor cannot fetch or edit another counselor's lead even by guessing the URL, because visibility is enforced in the database query itself, not just hidden in the UI.
- All destructive actions (login, delete, import, export) are written to `audit_logs`.
- Rate limiting is applied to login and the API generally to slow brute-force attempts.

## Support / next steps

This is a working v1 covering every feature in the original brief: leads, statuses, follow-ups, notes/calls, documents, applications, payments, activity timeline, counselor management, role-based access, CSV import/export, reports, notifications, and dashboards. Natural next additions if you want them later: file uploads for documents (currently stores a URL — pair with a service like Cloudinary or S3), WhatsApp Business API integration for two-way messaging instead of the `wa.me` deep link, and email/SMS delivery for reminders.
