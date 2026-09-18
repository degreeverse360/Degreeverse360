CREATE SEQUENCE IF NOT EXISTS assignment_lead_code_seq START 1;

CREATE TABLE IF NOT EXISTS assignment_leads (
  id SERIAL PRIMARY KEY,
  lead_code VARCHAR(20) UNIQUE NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  mobile VARCHAR(20) NOT NULL,
  email VARCHAR(160),
  university_name VARCHAR(160),
  semester VARCHAR(40),
  course VARCHAR(120),
  pursuing VARCHAR(120),
  assignment_count INTEGER DEFAULT 0,
  last_submission_date DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'New',
  priority VARCHAR(10) NOT NULL DEFAULT 'Medium',
  assignment_notes TEXT,
  deal_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  assigned_counselor_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asg_leads_status ON assignment_leads(status);
CREATE INDEX IF NOT EXISTS idx_asg_leads_counselor ON assignment_leads(assigned_counselor_id);
CREATE INDEX IF NOT EXISTS idx_asg_leads_mobile ON assignment_leads(mobile);
CREATE INDEX IF NOT EXISTS idx_asg_leads_deadline ON assignment_leads(last_submission_date);

CREATE TABLE IF NOT EXISTS assignment_items (
  id SERIAL PRIMARY KEY,
  assignment_lead_id INTEGER NOT NULL REFERENCES assignment_leads(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  subject VARCHAR(120),
  due_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  file_url TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asg_items_lead ON assignment_items(assignment_lead_id);

CREATE TABLE IF NOT EXISTS assignment_documents (
  id SERIAL PRIMARY KEY,
  assignment_lead_id INTEGER NOT NULL REFERENCES assignment_leads(id) ON DELETE CASCADE,
  doc_name VARCHAR(160) NOT NULL,
  doc_type VARCHAR(60),
  file_url TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asg_docs_lead ON assignment_documents(assignment_lead_id);

CREATE TABLE IF NOT EXISTS assignment_payments (
  id SERIAL PRIMARY KEY,
  assignment_lead_id INTEGER NOT NULL REFERENCES assignment_leads(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method VARCHAR(40),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asg_payments_lead ON assignment_payments(assignment_lead_id);

CREATE TABLE IF NOT EXISTS assignment_followups (
  id SERIAL PRIMARY KEY,
  assignment_lead_id INTEGER NOT NULL REFERENCES assignment_leads(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  scheduled_time TIME,
  followup_type VARCHAR(20) NOT NULL DEFAULT 'Call',
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  created_by INTEGER REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asg_followups_lead ON assignment_followups(assignment_lead_id);
CREATE INDEX IF NOT EXISTS idx_asg_followups_date ON assignment_followups(scheduled_date);

CREATE TABLE IF NOT EXISTS assignment_notes (
  id SERIAL PRIMARY KEY,
  assignment_lead_id INTEGER NOT NULL REFERENCES assignment_leads(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asg_notes_lead ON assignment_notes(assignment_lead_id);

CREATE TABLE IF NOT EXISTS assignment_activities (
  id SERIAL PRIMARY KEY,
  assignment_lead_id INTEGER NOT NULL REFERENCES assignment_leads(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  action VARCHAR(80) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asg_activities_lead ON assignment_activities(assignment_lead_id);

CREATE TABLE IF NOT EXISTS assignment_import_batches (
  id SERIAL PRIMARY KEY,
  imported_by INTEGER REFERENCES users(id),
  file_name VARCHAR(200),
  total_rows INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  error_report JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_asg_leads_updated_at ON assignment_leads;
CREATE TRIGGER trg_asg_leads_updated_at BEFORE UPDATE ON assignment_leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_asg_items_updated_at ON assignment_items;
CREATE TRIGGER trg_asg_items_updated_at BEFORE UPDATE ON assignment_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
