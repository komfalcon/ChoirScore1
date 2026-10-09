ALTER TABLE score_versions ADD COLUMN version_kind TEXT NOT NULL DEFAULT 'explicit' CHECK (version_kind IN ('explicit', 'autosave'));
ALTER TABLE score_versions ADD COLUMN autosave_request_id TEXT;
ALTER TABLE score_versions ADD COLUMN autosave_base_version_id TEXT;
CREATE UNIQUE INDEX score_versions_autosave_request_unique ON score_versions(score_id, created_by, autosave_request_id) WHERE version_kind = 'autosave' AND autosave_request_id IS NOT NULL;
CREATE INDEX score_versions_autosave_order_idx ON score_versions(score_id, version_kind, created_at, id);
