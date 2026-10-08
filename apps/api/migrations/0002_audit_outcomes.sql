ALTER TABLE audit_log ADD COLUMN outcome TEXT NOT NULL DEFAULT 'success';
ALTER TABLE audit_log ADD COLUMN error_code TEXT;
