CREATE TABLE IF NOT EXISTS servers (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	transport TEXT NOT NULL,
	url TEXT NOT NULL DEFAULT '',
	auth_json TEXT NOT NULL DEFAULT '{}',
	headers_json TEXT NOT NULL DEFAULT '{}',
	rate_limit_json TEXT NOT NULL DEFAULT '{}',
	command TEXT NOT NULL DEFAULT '',
	args_json TEXT NOT NULL DEFAULT '[]',
	env_json TEXT NOT NULL DEFAULT '{}',
	enabled INTEGER NOT NULL DEFAULT 0,
	weight INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_servers_enabled ON servers(enabled);

CREATE TABLE IF NOT EXISTS endpoints (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	server_ids_json TEXT NOT NULL DEFAULT '[]',
	rate_limit_json TEXT NOT NULL DEFAULT '{}',
	enabled INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_endpoints_enabled ON endpoints(enabled);

CREATE TABLE IF NOT EXISTS tool_cache (
	server_id TEXT NOT NULL,
	gateway_name TEXT NOT NULL,
	server_name TEXT NOT NULL,
	native_name TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	input_schema_json TEXT NOT NULL DEFAULT '',
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (server_id, native_name)
);

CREATE INDEX IF NOT EXISTS idx_tool_cache_gateway_name ON tool_cache(gateway_name);

CREATE TABLE IF NOT EXISTS usage_counters (
	usage_key TEXT PRIMARY KEY,
	total_calls INTEGER NOT NULL DEFAULT 0,
	successful_calls INTEGER NOT NULL DEFAULT 0,
	failed_calls INTEGER NOT NULL DEFAULT 0,
	rate_limited_calls INTEGER NOT NULL DEFAULT 0,
	window_start TEXT NOT NULL DEFAULT '',
	window_calls INTEGER NOT NULL DEFAULT 0,
	last_called_at TEXT NOT NULL DEFAULT '',
	last_error TEXT NOT NULL DEFAULT '',
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
