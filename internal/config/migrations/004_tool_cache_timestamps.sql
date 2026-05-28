ALTER TABLE tool_cache ADD COLUMN created_at TEXT NOT NULL DEFAULT '';

UPDATE tool_cache
SET created_at = updated_at
WHERE created_at = '';
