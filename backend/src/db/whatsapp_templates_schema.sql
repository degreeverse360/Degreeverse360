CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(60),
  content TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_wa_templates_updated_at ON whatsapp_templates;
CREATE TRIGGER trg_wa_templates_updated_at BEFORE UPDATE ON whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO whatsapp_templates (name, category, content) VALUES
  ('Welcome Message', 'Welcome',
   'Hi {name} 👋

This is the Degreeverse team.

We understand that you are pursuing {course} from {university}, currently in {semester}.

If you need any help with your assignments, requirements, or submission process, feel free to connect with us. We''ll be happy to assist you.

Regards,
Team Degreeverse'),
  ('Payment Reminder', 'Payments',
   'Hi {name} 👋

Your assignment work for {course} at {university} is currently in progress.

There is a pending amount of ₹{pending_amount}.

Please let us know if you need any assistance.

Regards,
Team Degreeverse'),
  ('Assignment Deadline Reminder', 'Deadlines',
   'Hi {name} 👋

This is a reminder that your {assignment_count} assignment(s) for {course} are due on {deadline}.

Please share any pending requirements so we can complete them on time.

Regards,
Team Degreeverse'),
  ('Assignment Completed', 'Delivery',
   'Hi {name} 👋

Great news — your assignments for {course} at {university} have been completed and are ready for review.

Please check and let us know if everything looks good.

Regards,
Team Degreeverse')
ON CONFLICT DO NOTHING;
