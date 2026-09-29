-- ============================================================
-- DEGREEVERSE360 CRM — PostgreSQL Schema
-- ============================================================
-- Run with: psql -U <user> -d <database> -f schema.sql
-- Safe to re-run: drops nothing, uses IF NOT EXISTS everywhere.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- ---------- ROLES ----------
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(30) UNIQUE NOT NULL, -- super_admin | admin | counselor
  description TEXT
);

INSERT INTO roles (name, description) VALUES
  ('super_admin', 'Full access to everything, including user & settings management'),
  ('admin', 'Manage leads, assign counselors, view all reports'),
  ('counselor', 'View and work only assigned leads')
ON CONFLICT (name) DO NOTHING;

-- ---------- USERS ----------
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) UNIQUE NOT NULL,
  mobile VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  avatar_color VARCHAR(7) DEFAULT '#2A3EB1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);

-- ---------- LEAD SOURCES (customizable) ----------
CREATE TABLE IF NOT EXISTS lead_sources (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO lead_sources (name) VALUES
  ('Facebook Ads'), ('Instagram Ads'), ('Google Ads'),
  ('Website'), ('WhatsApp'), ('Referral'), ('Manual'), ('Other')
ON CONFLICT (name) DO NOTHING;

-- ---------- CAMPAIGNS (customizable) ----------
CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  source_id INTEGER REFERENCES lead_sources(id),
  ad_name VARCHAR(160),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- UNIVERSITIES ----------
CREATE TABLE IF NOT EXISTS universities (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  country VARCHAR(80),
  city VARCHAR(80),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- COURSES ----------
CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  university_id INTEGER REFERENCES universities(id) ON DELETE SET NULL,
  name VARCHAR(160) NOT NULL,
  specialization VARCHAR(160),
  fees NUMERIC(12,2),
  duration VARCHAR(60),
  eligibility TEXT,
  mode VARCHAR(30), -- Online / Offline / Hybrid
  admission_status VARCHAR(30) DEFAULT 'Open', -- Open / Closed / Coming Soon
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_courses_university ON courses(university_id);

-- ---------- LEAD STATUSES (customizable, ordered) ----------
CREATE TABLE IF NOT EXISTS lead_statuses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(60) UNIQUE NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color VARCHAR(7) DEFAULT '#6B7280',
  is_won BOOLEAN NOT NULL DEFAULT FALSE,   -- e.g. Enrolled
  is_lost BOOLEAN NOT NULL DEFAULT FALSE,  -- e.g. Lost / Not Interested / Wrong Number / Duplicate
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO lead_statuses (name, sort_order, color, is_won, is_lost) VALUES
  ('New', 1, '#2A3EB1', FALSE, FALSE),
  ('Contacted', 2, '#4C63D2', FALSE, FALSE),
  ('Interested', 3, '#00B8A9', FALSE, FALSE),
  ('Follow-up', 4, '#F5A623', FALSE, FALSE),
  ('Documents Pending', 5, '#F5A623', FALSE, FALSE),
  ('Application Started', 6, '#7C5CFC', FALSE, FALSE),
  ('Application Submitted', 7, '#7C5CFC', FALSE, FALSE),
  ('Payment Pending', 8, '#F5A623', FALSE, FALSE),
  ('Enrolled', 9, '#1FAE6B', TRUE, FALSE),
  ('Not Interested', 10, '#9CA3AF', FALSE, TRUE),
  ('Wrong Number', 11, '#9CA3AF', FALSE, TRUE),
  ('Duplicate', 12, '#9CA3AF', FALSE, TRUE),
  ('Lost', 13, '#E14B4B', FALSE, TRUE)
ON CONFLICT (name) DO NOTHING;

-- ---------- TAGS ----------
CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(60) UNIQUE NOT NULL,
  color VARCHAR(7) DEFAULT '#2A3EB1'
);

-- ---------- LEADS ----------
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  lead_code VARCHAR(20) UNIQUE NOT NULL, -- e.g. DGV-000123

  -- Basic details
  full_name VARCHAR(160) NOT NULL,
  mobile VARCHAR(20) NOT NULL,
  whatsapp_number VARCHAR(20),
  email VARCHAR(160),
  alternate_mobile VARCHAR(20),
  city VARCHAR(80),
  state VARCHAR(80),
  source_id INTEGER REFERENCES lead_sources(id),
  campaign_id INTEGER REFERENCES campaigns(id),
  ad_name VARCHAR(160),
  lead_date TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Education details
  highest_qualification VARCHAR(120),
  passing_year INTEGER,
  percentage NUMERIC(5,2),
  interested_course_id INTEGER REFERENCES courses(id),
  interested_university_id INTEGER REFERENCES universities(id),
  preferred_mode VARCHAR(30),
  budget NUMERIC(12,2),

  -- Lead management
  status_id INTEGER NOT NULL REFERENCES lead_statuses(id),
  priority VARCHAR(10) NOT NULL DEFAULT 'Medium', -- Low / Medium / High
  temperature VARCHAR(10) NOT NULL DEFAULT 'Warm', -- Hot / Warm / Cold
  next_followup_date DATE,
  next_followup_time TIME,
  last_contacted_date TIMESTAMPTZ,
  assigned_counselor_id INTEGER REFERENCES users(id),
  lead_owner_id INTEGER REFERENCES users(id),
  remarks TEXT,

  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status_id);
CREATE INDEX IF NOT EXISTS idx_leads_counselor ON leads(assigned_counselor_id);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source_id);
CREATE INDEX IF NOT EXISTS idx_leads_mobile ON leads(mobile);
CREATE INDEX IF NOT EXISTS idx_leads_next_followup ON leads(next_followup_date);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_university ON leads(interested_university_id);
CREATE INDEX IF NOT EXISTS idx_leads_course ON leads(interested_course_id);

-- Lead <-> Tags (many-to-many)
CREATE TABLE IF NOT EXISTS lead_tags (
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (lead_id, tag_id)
);

-- A lead can be interested in multiple courses/universities
CREATE TABLE IF NOT EXISTS lead_interests (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES courses(id),
  university_id INTEGER REFERENCES universities(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_interests_lead ON lead_interests(lead_id);

-- ---------- FOLLOW-UPS ----------
CREATE TABLE IF NOT EXISTS followups (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  scheduled_time TIME,
  followup_type VARCHAR(20) NOT NULL DEFAULT 'Call', -- Call/WhatsApp/Email/Meeting/Other
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending', -- Pending / Completed / Missed
  reminder_minutes_before INTEGER DEFAULT 30,
  created_by INTEGER REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_followups_lead ON followups(lead_id);
CREATE INDEX IF NOT EXISTS idx_followups_date ON followups(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_followups_status ON followups(status);

-- ---------- NOTES (general notes / call logs / whatsapp logs) ----------
CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  note_type VARCHAR(20) NOT NULL DEFAULT 'Note', -- Note / Call / WhatsApp / Email
  content TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notes_lead ON notes(lead_id);

-- ---------- DOCUMENTS ----------
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  doc_name VARCHAR(160) NOT NULL,
  doc_type VARCHAR(60),
  file_url TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_lead ON documents(lead_id);

-- ---------- APPLICATIONS ----------
CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES courses(id),
  university_id INTEGER REFERENCES universities(id),
  application_status VARCHAR(30) NOT NULL DEFAULT 'Started', -- Started/Submitted/Approved/Rejected
  submitted_date DATE,
  decision_date DATE,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_applications_lead ON applications(lead_id);

-- ---------- PAYMENTS ----------
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  application_id INTEGER REFERENCES applications(id),
  amount NUMERIC(12,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  payment_status VARCHAR(20) NOT NULL DEFAULT 'Pending', -- Pending/Paid/Failed/Refunded
  payment_date DATE,
  payment_method VARCHAR(40),
  reference_no VARCHAR(80),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_lead ON payments(lead_id);

-- ---------- ACTIVITIES (full audit trail per lead, drives Activity Timeline) ----------
CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  action VARCHAR(80) NOT NULL, -- e.g. 'status_changed', 'assigned', 'note_added', 'followup_scheduled'
  field_name VARCHAR(60),
  old_value TEXT,
  new_value TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activities_lead ON activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at);

-- ---------- NOTIFICATIONS ----------
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL, -- lead_assigned / followup_due / followup_overdue / status_changed / application_created / enrollment_completed
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

-- ---------- AUDIT LOGS (system-wide, security-focused) ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  entity_type VARCHAR(40) NOT NULL, -- 'lead' | 'user' | 'course' | 'university' | 'auth' ...
  entity_id INTEGER,
  action VARCHAR(60) NOT NULL, -- 'create' | 'update' | 'delete' | 'login' | 'login_failed' | 'export' | 'import'
  details JSONB,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);

-- ---------- IMPORT BATCHES (for CSV import history / error reports) ----------
CREATE TABLE IF NOT EXISTS import_batches (
  id SERIAL PRIMARY KEY,
  imported_by INTEGER REFERENCES users(id),
  file_name VARCHAR(200),
  total_rows INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  error_report JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Trigger: auto-update updated_at columns
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_applications_updated_at ON applications;
CREATE TRIGGER trg_applications_updated_at BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Sequence-backed helper for human-friendly lead codes (DGV-000001)
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS lead_code_seq START 1;
