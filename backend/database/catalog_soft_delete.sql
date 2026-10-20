-- Separate Trash from Active/Inactive without removing catalog rows or history.
-- Repeatable on existing databases.
ALTER TABLE service_categories ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE services ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE ac_brands ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE ac_models ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
