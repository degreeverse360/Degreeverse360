# Degreeverse360 API Documentation

Base URL: `https://<your-backend>/api`
Authentication: every route except `/auth/login` requires an `Authorization: Bearer <token>` header. Get a token from `/auth/login`.

---

## Auth

### POST /auth/login
```json
{ "email": "admin@degreeverse.com", "password": "ChangeMe@123" }
```
→ `{ "token": "...", "user": { "id": 1, "name": "...", "email": "...", "role": "super_admin" } }`

### GET /auth/me
Returns the logged-in user's profile.

### POST /auth/change-password
```json
{ "currentPassword": "old", "newPassword": "new_min_8_chars" }
```

---

## Users (Super Admin manages the team)

- `GET /users` — list all users with live performance stats (super_admin, admin)
- `GET /users/counselors` — light list for assignment dropdowns (any role)
- `POST /users` — create a user (super_admin only): `{ name, email, mobile, password, role }` where role is `super_admin | admin | counselor`
- `PATCH /users/:id` — update `{ name, mobile, role, is_active, password }` (super_admin only)

---

## Leads

**Visibility rule enforced server-side:** counselors only ever see leads where `assigned_counselor_id` = their own user id. Admins/Super Admins see all leads.

- `GET /leads?search=&status=&counselor=&source=&course=&university=&priority=&temperature=&dateFrom=&dateTo=&followupFrom=&followupTo=&page=&pageSize=&sortBy=&sortDir=`
  → `{ data: [...], pagination: { page, pageSize, total } }`
- `GET /leads/:id` — full profile including followups, notes, activities, documents, applications, payments, tags
- `POST /leads` — create. Required: `full_name`, `mobile`. Returns `409` with `{ warning: "duplicate_mobile", existing }` if the mobile already exists — resend with `force: true` to create anyway.
- `PATCH /leads/:id` — update any editable field. Status changes and reassignments are automatically logged to the activity timeline and trigger notifications.
- `DELETE /leads/:id` — admin/super_admin only
- `POST /leads/:id/notes` — `{ note_type: "Note"|"Call"|"WhatsApp"|"Email", content }`

---

## Follow-ups

- `GET /followups?range=today|upcoming|overdue` — respects the same counselor visibility rule
- `POST /followups/lead/:leadId` — `{ scheduled_date, scheduled_time, followup_type, notes, reminder_minutes_before }`
- `PATCH /followups/:id` — `{ status: "Completed"|"Missed", scheduled_date, scheduled_time, notes }`

---

## Dashboard

- `GET /dashboard` — all stats used on the dashboard page (totals, today's leads, pipeline breakdown, source/course/university breakdowns, counselor performance). Automatically scoped to the counselor's own leads if called by a counselor.

---

## Settings (reference data)

All support `GET` (any authenticated user) and `POST` / `PATCH` (super_admin, admin) / `DELETE` (super_admin only):

- `/settings/statuses` — `{ name, sort_order, color, is_won, is_lost, is_active }`
- `/settings/sources` — `{ name, is_active }`
- `/settings/campaigns` — `{ name, source_id, ad_name, is_active }`
- `/settings/universities` — `{ name, country, city, is_active }`
- `/settings/courses` (write) / `/settings/courses-detailed` (read, joined with university name) — `{ university_id, name, specialization, fees, duration, eligibility, mode, admission_status, is_active }`
- `/settings/tags` — `{ name, color }`

---

## CSV Import / Export

- `POST /csv/preview` — multipart form with `file` (CSV). Returns per-row validation without writing to the database.
- `POST /csv/import` — `{ rows: [...validated row objects from preview...], fileName }`. Commits only the rows you send (client filters to valid rows first). Returns `{ imported, failed, errors }`.
- `GET /csv/export?status=&source=&counselor=` — streams a CSV file matching the given filters.

CSV column headers expected: `Lead ID, Name, Mobile, WhatsApp, Email, City, State, Source, Campaign, Ad Name, Course, University, Status, Priority, Assigned Counselor, Follow-up Date, Follow-up Time, Remarks, Created Date`.

---

## Reports

All under `/reports/...`, restricted to super_admin/admin, accept `?dateFrom=&dateTo=&format=csv`:

- `/reports/leads-over-time?groupBy=day|month`
- `/reports/source-performance`
- `/reports/campaign-performance`
- `/reports/counselor-performance`
- `/reports/course-performance`
- `/reports/enrollment`
- `/reports/lost-leads`
- `/reports/followups`

Add `&format=csv` to any of these to download instead of receiving JSON.

---

## Notifications

- `GET /notifications` → `{ notifications: [...], unreadCount }`
- `PATCH /notifications/:id/read`
- `PATCH /notifications/read-all`

---

## Error format

All errors: `{ "error": "human-readable message" }` with an appropriate HTTP status code (400, 401, 403, 404, 409, 500).
