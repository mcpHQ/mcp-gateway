CREATE TABLE IF NOT EXISTS rate_limit_buckets (
	bucket_key TEXT PRIMARY KEY,
	tokens_micros INTEGER NOT NULL,
	capacity_micros INTEGER NOT NULL,
	refill_per_second_micros INTEGER NOT NULL,
	updated_at TEXT NOT NULL
);
