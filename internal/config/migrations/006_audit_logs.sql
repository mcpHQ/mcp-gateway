CREATE TABLE IF NOT EXISTS audit_logs (
	id TEXT PRIMARY KEY,
	timestamp TEXT NOT NULL,
	transport TEXT NOT NULL,
	endpoint_id TEXT NOT NULL DEFAULT '',
	tool_name TEXT NOT NULL DEFAULT '',
	status INTEGER NOT NULL,
	duration_ms INTEGER NOT NULL,
	caller TEXT NOT NULL DEFAULT '',
	error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_endpoint_id ON audit_logs(endpoint_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tool_name ON audit_logs(tool_name);
