package config

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

var serverIDPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{1,62}$`)

type Server struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Transport string            `json:"transport,omitempty"`
	URL       string            `json:"url,omitempty"`
	Auth      AuthConfig        `json:"auth,omitempty"`
	Headers   map[string]string `json:"headers,omitempty"`
	RateLimit RateLimit         `json:"-"`
	Command   string            `json:"command,omitempty"`
	Args      []string          `json:"args,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	Enabled   bool              `json:"enabled"`
	Weight    int               `json:"weight"`
	CreatedAt string            `json:"createdAt,omitempty"`
	UpdatedAt string            `json:"updatedAt,omitempty"`
}

type Endpoint struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	ServerIDs   []string  `json:"serverIds"`
	RateLimit   RateLimit `json:"rateLimit,omitempty"`
	Enabled     bool      `json:"enabled"`
	CreatedAt   string    `json:"createdAt,omitempty"`
	UpdatedAt   string    `json:"updatedAt,omitempty"`
}

type APIKey struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Value       string   `json:"value"`
	EndpointIDs []string `json:"endpointIds"`
	Enabled     bool     `json:"enabled"`
	CreatedAt   string   `json:"createdAt,omitempty"`
	UpdatedAt   string   `json:"updatedAt,omitempty"`
}

type User struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	PasswordHash string `json:"-"`
	CreatedAt    string `json:"createdAt,omitempty"`
	UpdatedAt    string `json:"updatedAt,omitempty"`
}

type RateLimit struct {
	RequestsPerMinute int `json:"requestsPerMinute,omitempty"`
}

type AuthConfig struct {
	Type        string `json:"type,omitempty"`
	APIKeyName  string `json:"apiKeyName,omitempty"`
	APIKeyValue string `json:"apiKeyValue,omitempty"`
	APIKeyIn    string `json:"apiKeyIn,omitempty"`
	Token       string `json:"token,omitempty"`
	Username    string `json:"username,omitempty"`
	Password    string `json:"password,omitempty"`
}

type ToolRecord struct {
	Name        string
	ServerID    string
	ServerName  string
	NativeName  string
	Description string
	InputSchema json.RawMessage
	CreatedAt   string
	UpdatedAt   string
}

type UsageRecord struct {
	Key              string
	TotalCalls       int64
	SuccessfulCalls  int64
	FailedCalls      int64
	RateLimitedCalls int64
	WindowStart      time.Time
	WindowCalls      int
	LastCalledAt     time.Time
	LastError        string
}

type AuditLogRecord struct {
	ID         string
	Timestamp  time.Time
	Transport  string
	EndpointID string
	ToolName   string
	Status     int
	DurationMS int64
	Caller     string
	Error      string
}

type RateLimitBucketResult struct {
	Allowed   bool
	Remaining int
	ResetAt   time.Time
}

type Store struct {
	path string
	db   *sql.DB
}

func LoadStore(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)

	store := &Store{path: path, db: db}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}

	return store, nil
}

func (s *Store) Path() string {
	return s.path
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) GetSetting(key string) (string, bool, error) {
	var value string
	err := s.db.QueryRow(`
		SELECT value
		FROM app_settings
		WHERE key = ?
	`, strings.TrimSpace(key)).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

func (s *Store) UpsertSetting(key string, value string) error {
	_, err := s.db.Exec(`
		INSERT INTO app_settings (key, value, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = CURRENT_TIMESTAMP
	`, strings.TrimSpace(key), value)
	return err
}

func (s *Store) List() []Server {
	rows, err := s.db.Query(`
		SELECT id, name, transport, url, auth_json, headers_json, rate_limit_json, command, args_json, env_json, enabled, weight, created_at, updated_at
		FROM servers
		ORDER BY id
	`)
	if err != nil {
		return []Server{}
	}
	defer rows.Close()

	var servers []Server
	for rows.Next() {
		server, err := scanServer(rows)
		if err == nil {
			servers = append(servers, server)
		}
	}
	return servers
}

func (s *Store) Get(id string) (Server, bool) {
	row := s.db.QueryRow(`
		SELECT id, name, transport, url, auth_json, headers_json, rate_limit_json, command, args_json, env_json, enabled, weight, created_at, updated_at
		FROM servers
		WHERE id = ?
	`, id)
	server, err := scanServer(row)
	if err != nil {
		return Server{}, false
	}
	return server, true
}

func (s *Store) ListEndpoints() []Endpoint {
	rows, err := s.db.Query(`
		SELECT id, name, description, server_ids_json, rate_limit_json, enabled, created_at, updated_at
		FROM endpoints
		ORDER BY id
	`)
	if err != nil {
		return []Endpoint{}
	}
	defer rows.Close()

	var endpoints []Endpoint
	for rows.Next() {
		endpoint, err := scanEndpoint(rows)
		if err == nil {
			endpoints = append(endpoints, endpoint)
		}
	}
	return endpoints
}

func (s *Store) GetEndpoint(id string) (Endpoint, bool) {
	row := s.db.QueryRow(`
		SELECT id, name, description, server_ids_json, rate_limit_json, enabled, created_at, updated_at
		FROM endpoints
		WHERE id = ?
	`, id)
	endpoint, err := scanEndpoint(row)
	if err != nil {
		return Endpoint{}, false
	}
	return endpoint, true
}

func (s *Store) ListAPIKeys() []APIKey {
	rows, err := s.db.Query(`
		SELECT id, name, value, endpoint_ids_json, enabled, created_at, updated_at
		FROM api_keys
		ORDER BY id
	`)
	if err != nil {
		return []APIKey{}
	}
	defer rows.Close()

	var keys []APIKey
	for rows.Next() {
		key, err := scanAPIKey(rows)
		if err == nil {
			keys = append(keys, key)
		}
	}
	return keys
}

func (s *Store) GetAPIKey(id string) (APIKey, bool) {
	row := s.db.QueryRow(`
		SELECT id, name, value, endpoint_ids_json, enabled, created_at, updated_at
		FROM api_keys
		WHERE id = ?
	`, id)
	key, err := scanAPIKey(row)
	if err != nil {
		return APIKey{}, false
	}
	return key, true
}

func (s *Store) GetAPIKeyByValue(value string) (APIKey, bool) {
	row := s.db.QueryRow(`
		SELECT id, name, value, endpoint_ids_json, enabled, created_at, updated_at
		FROM api_keys
		WHERE value = ?
	`, strings.TrimSpace(value))
	key, err := scanAPIKey(row)
	if err != nil {
		return APIKey{}, false
	}
	return key, true
}

func (s *Store) GetUserByEmail(email string) (User, bool) {
	row := s.db.QueryRow(`
		SELECT id, email, password_hash, created_at, updated_at
		FROM users
		WHERE lower(email) = lower(?)
	`, strings.TrimSpace(email))
	user, err := scanUser(row)
	if err != nil {
		return User{}, false
	}
	return user, true
}

func (s *Store) SeedUser(user User) error {
	user.ID = strings.TrimSpace(user.ID)
	user.Email = strings.ToLower(strings.TrimSpace(user.Email))
	if user.ID == "" {
		return errors.New("user id is required")
	}
	if user.Email == "" {
		return errors.New("user email is required")
	}
	if strings.TrimSpace(user.PasswordHash) == "" {
		return errors.New("user password hash is required")
	}

	_, err := s.db.Exec(`
		INSERT INTO users (id, email, password_hash, updated_at)
		VALUES (?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO NOTHING
	`, user.ID, user.Email, user.PasswordHash)
	return err
}

func (s *Store) UpdateUserPasswordHash(id string, passwordHash string) (bool, error) {
	result, err := s.db.Exec(`
		UPDATE users
		SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, passwordHash, strings.TrimSpace(id))
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return rows > 0, nil
}

func (s *Store) Upsert(server Server) error {
	normalize(&server)
	if err := Validate(server); err != nil {
		return err
	}

	auth, err := json.Marshal(server.Auth)
	if err != nil {
		return err
	}
	headers, err := json.Marshal(server.Headers)
	if err != nil {
		return err
	}
	rateLimit, err := json.Marshal(server.RateLimit)
	if err != nil {
		return err
	}
	args, err := json.Marshal(server.Args)
	if err != nil {
		return err
	}
	env, err := json.Marshal(server.Env)
	if err != nil {
		return err
	}
	enabled := 0
	if server.Enabled {
		enabled = 1
	}

	_, err = s.db.Exec(`
		INSERT INTO servers (
			id, name, transport, url, auth_json, headers_json, rate_limit_json, command, args_json, env_json, enabled, weight, updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			transport = excluded.transport,
			url = excluded.url,
			auth_json = excluded.auth_json,
			headers_json = excluded.headers_json,
			rate_limit_json = excluded.rate_limit_json,
			command = excluded.command,
			args_json = excluded.args_json,
			env_json = excluded.env_json,
			enabled = excluded.enabled,
			weight = excluded.weight,
			updated_at = CURRENT_TIMESTAMP
	`, server.ID, server.Name, server.Transport, server.URL, string(auth), string(headers), string(rateLimit), server.Command, string(args), string(env), enabled, server.Weight)
	return err
}

func (s *Store) UpsertEndpoint(endpoint Endpoint) error {
	normalizeEndpoint(&endpoint)
	if err := ValidateEndpoint(endpoint); err != nil {
		return err
	}

	serverIDs, err := json.Marshal(endpoint.ServerIDs)
	if err != nil {
		return err
	}
	rateLimit, err := json.Marshal(endpoint.RateLimit)
	if err != nil {
		return err
	}
	enabled := 0
	if endpoint.Enabled {
		enabled = 1
	}

	_, err = s.db.Exec(`
		INSERT INTO endpoints (
			id, name, description, server_ids_json, rate_limit_json, enabled, updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			description = excluded.description,
			server_ids_json = excluded.server_ids_json,
			rate_limit_json = excluded.rate_limit_json,
			enabled = excluded.enabled,
			updated_at = CURRENT_TIMESTAMP
	`, endpoint.ID, endpoint.Name, endpoint.Description, string(serverIDs), string(rateLimit), enabled)
	return err
}

func (s *Store) UpsertAPIKey(key APIKey) error {
	normalizeAPIKey(&key)
	if err := ValidateAPIKey(key); err != nil {
		return err
	}

	endpointIDs, err := json.Marshal(key.EndpointIDs)
	if err != nil {
		return err
	}
	enabled := 0
	if key.Enabled {
		enabled = 1
	}

	_, err = s.db.Exec(`
		INSERT INTO api_keys (
			id, name, value, endpoint_ids_json, enabled, updated_at
		)
		VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			value = excluded.value,
			endpoint_ids_json = excluded.endpoint_ids_json,
			enabled = excluded.enabled,
			updated_at = CURRENT_TIMESTAMP
	`, key.ID, key.Name, key.Value, string(endpointIDs), enabled)
	return err
}

func (s *Store) SetEnabled(id string, enabled bool) (bool, error) {
	value := 0
	if enabled {
		value = 1
	}

	result, err := s.db.Exec(`
		UPDATE servers
		SET enabled = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, value, id)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return rows > 0, nil
}

func (s *Store) SetEndpointEnabled(id string, enabled bool) (bool, error) {
	value := 0
	if enabled {
		value = 1
	}

	result, err := s.db.Exec(`
		UPDATE endpoints
		SET enabled = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, value, id)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return rows > 0, nil
}

func (s *Store) Delete(id string) bool {
	result, err := s.db.Exec(`DELETE FROM servers WHERE id = ?`, id)
	if err != nil {
		return false
	}
	rows, err := result.RowsAffected()
	return err == nil && rows > 0
}

func (s *Store) DeleteEndpoint(id string) bool {
	result, err := s.db.Exec(`DELETE FROM endpoints WHERE id = ?`, id)
	if err != nil {
		return false
	}
	rows, err := result.RowsAffected()
	return err == nil && rows > 0
}

func (s *Store) DeleteAPIKey(id string) bool {
	result, err := s.db.Exec(`DELETE FROM api_keys WHERE id = ?`, id)
	if err != nil {
		return false
	}
	rows, err := result.RowsAffected()
	return err == nil && rows > 0
}

func (s *Store) ListToolRecords() ([]ToolRecord, error) {
	rows, err := s.db.Query(`
		SELECT gateway_name, server_id, server_name, native_name, description, input_schema_json, created_at, updated_at
		FROM tool_cache
		ORDER BY server_id, native_name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tools []ToolRecord
	for rows.Next() {
		var tool ToolRecord
		var inputSchema string
		if err := rows.Scan(&tool.Name, &tool.ServerID, &tool.ServerName, &tool.NativeName, &tool.Description, &inputSchema, &tool.CreatedAt, &tool.UpdatedAt); err != nil {
			return nil, err
		}
		if inputSchema != "" {
			tool.InputSchema = json.RawMessage(inputSchema)
		}
		tools = append(tools, tool)
	}
	return tools, rows.Err()
}

func (s *Store) ReplaceToolRecords(serverID string, tools []ToolRecord) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM tool_cache WHERE server_id = ?`, serverID); err != nil {
		return err
	}
	for _, tool := range tools {
		inputSchema := ""
		if tool.InputSchema != nil {
			inputSchema = string(tool.InputSchema)
		}
		if _, err := tx.Exec(`
			INSERT INTO tool_cache (
				server_id, gateway_name, server_name, native_name, description, input_schema_json, created_at, updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		`, tool.ServerID, tool.Name, tool.ServerName, tool.NativeName, tool.Description, inputSchema); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) DeleteToolRecords(serverID string) error {
	_, err := s.db.Exec(`DELETE FROM tool_cache WHERE server_id = ?`, serverID)
	return err
}

func (s *Store) ListUsageRecords() ([]UsageRecord, error) {
	rows, err := s.db.Query(`
		SELECT usage_key, total_calls, successful_calls, failed_calls, rate_limited_calls, window_start, window_calls, last_called_at, last_error
		FROM usage_counters
		ORDER BY usage_key
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []UsageRecord
	for rows.Next() {
		var record UsageRecord
		var windowStart string
		var lastCalledAt string
		if err := rows.Scan(
			&record.Key,
			&record.TotalCalls,
			&record.SuccessfulCalls,
			&record.FailedCalls,
			&record.RateLimitedCalls,
			&windowStart,
			&record.WindowCalls,
			&lastCalledAt,
			&record.LastError,
		); err != nil {
			return nil, err
		}
		record.WindowStart = parseDBTime(windowStart)
		record.LastCalledAt = parseDBTime(lastCalledAt)
		records = append(records, record)
	}
	return records, rows.Err()
}

func (s *Store) UpsertUsageRecord(record UsageRecord) error {
	_, err := s.db.Exec(`
		INSERT INTO usage_counters (
			usage_key, total_calls, successful_calls, failed_calls, rate_limited_calls, window_start, window_calls, last_called_at, last_error, updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(usage_key) DO UPDATE SET
			total_calls = excluded.total_calls,
			successful_calls = excluded.successful_calls,
			failed_calls = excluded.failed_calls,
			rate_limited_calls = excluded.rate_limited_calls,
			window_start = excluded.window_start,
			window_calls = excluded.window_calls,
			last_called_at = excluded.last_called_at,
			last_error = excluded.last_error,
			updated_at = CURRENT_TIMESTAMP
	`, record.Key, record.TotalCalls, record.SuccessfulCalls, record.FailedCalls, record.RateLimitedCalls, formatDBTime(record.WindowStart), record.WindowCalls, formatDBTime(record.LastCalledAt), record.LastError)
	return err
}

func (s *Store) DeleteUsageRecord(key string) error {
	_, err := s.db.Exec(`DELETE FROM usage_counters WHERE usage_key = ?`, key)
	return err
}

func (s *Store) InsertAuditLog(record AuditLogRecord) error {
	if record.ID == "" {
		return errors.New("audit log id is required")
	}
	if record.Timestamp.IsZero() {
		record.Timestamp = time.Now().UTC()
	}
	record.Transport = strings.TrimSpace(record.Transport)
	record.EndpointID = strings.TrimSpace(record.EndpointID)
	record.ToolName = strings.TrimSpace(record.ToolName)
	record.Caller = strings.TrimSpace(record.Caller)
	record.Error = strings.TrimSpace(record.Error)

	_, err := s.db.Exec(`
		INSERT INTO audit_logs (
			id, timestamp, transport, endpoint_id, tool_name, status, duration_ms, caller, error
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, record.ID, formatDBTime(record.Timestamp), record.Transport, record.EndpointID, record.ToolName, record.Status, record.DurationMS, record.Caller, record.Error)
	return err
}

func (s *Store) ListAuditLogs(limit int) ([]AuditLogRecord, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}

	rows, err := s.db.Query(`
		SELECT id, timestamp, transport, endpoint_id, tool_name, status, duration_ms, caller, error
		FROM audit_logs
		ORDER BY timestamp DESC, id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []AuditLogRecord
	for rows.Next() {
		var record AuditLogRecord
		var timestamp string
		if err := rows.Scan(
			&record.ID,
			&timestamp,
			&record.Transport,
			&record.EndpointID,
			&record.ToolName,
			&record.Status,
			&record.DurationMS,
			&record.Caller,
			&record.Error,
		); err != nil {
			return nil, err
		}
		record.Timestamp = parseDBTime(timestamp)
		records = append(records, record)
	}
	return records, rows.Err()
}

const tokenMicros int64 = 1_000_000

func (s *Store) ConsumeRateLimitToken(ctx context.Context, bucketKey string, requestsPerMinute int, now time.Time) (RateLimitBucketResult, error) {
	if requestsPerMinute <= 0 {
		return RateLimitBucketResult{Allowed: true}, nil
	}

	var lastErr error
	for attempt := 0; attempt < 8; attempt++ {
		decision, err := s.consumeRateLimitTokenOnce(ctx, bucketKey, requestsPerMinute, now)
		if err == nil {
			return decision, nil
		}
		if !isSQLiteBusy(err) {
			return RateLimitBucketResult{}, err
		}
		lastErr = err
		wait := time.Duration(attempt+1) * 5 * time.Millisecond
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return RateLimitBucketResult{}, ctx.Err()
		case <-timer.C:
		}
	}
	return RateLimitBucketResult{}, lastErr
}

func (s *Store) consumeRateLimitTokenOnce(ctx context.Context, bucketKey string, requestsPerMinute int, now time.Time) (RateLimitBucketResult, error) {
	now = now.UTC()
	capacity := int64(requestsPerMinute) * tokenMicros
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return RateLimitBucketResult{}, err
	}
	defer conn.Close()

	if _, err := conn.ExecContext(ctx, `PRAGMA busy_timeout = 5000`); err != nil {
		return RateLimitBucketResult{}, err
	}
	if _, err := conn.ExecContext(ctx, `BEGIN IMMEDIATE`); err != nil {
		return RateLimitBucketResult{}, err
	}
	committed := false
	defer func() {
		if !committed {
			_, _ = conn.ExecContext(context.Background(), `ROLLBACK`)
		}
	}()

	tokens, updatedAt, err := s.rateLimitBucketState(ctx, conn, bucketKey, capacity, now)
	if err != nil {
		return RateLimitBucketResult{}, err
	}
	if now.Before(updatedAt) {
		now = updatedAt
	}
	tokens = refillTokens(tokens, capacity, updatedAt, now)

	allowed := tokens >= tokenMicros
	if allowed {
		tokens -= tokenMicros
	}
	resetAt := nextTokenAt(tokens, capacity, now)
	if _, err := conn.ExecContext(ctx, `
		INSERT INTO rate_limit_buckets (
			bucket_key, tokens_micros, capacity_micros, refill_per_second_micros, updated_at
		)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(bucket_key) DO UPDATE SET
			tokens_micros = excluded.tokens_micros,
			capacity_micros = excluded.capacity_micros,
			refill_per_second_micros = excluded.refill_per_second_micros,
			updated_at = excluded.updated_at
	`, bucketKey, tokens, capacity, refillPerSecondMicros(capacity), formatDBTime(now)); err != nil {
		return RateLimitBucketResult{}, err
	}
	if _, err := conn.ExecContext(ctx, `COMMIT`); err != nil {
		return RateLimitBucketResult{}, err
	}
	committed = true

	return RateLimitBucketResult{
		Allowed:   allowed,
		Remaining: int(tokens / tokenMicros),
		ResetAt:   resetAt,
	}, nil
}

func isSQLiteBusy(err error) bool {
	message := err.Error()
	return strings.Contains(message, "SQLITE_BUSY") || strings.Contains(message, "database is locked")
}

func (s *Store) RateLimitBucketSnapshot(ctx context.Context, bucketKey string, requestsPerMinute int, now time.Time) (RateLimitBucketResult, error) {
	if requestsPerMinute <= 0 {
		return RateLimitBucketResult{Allowed: true}, nil
	}

	now = now.UTC()
	capacity := int64(requestsPerMinute) * tokenMicros
	tokens := capacity
	updatedAt := now
	var tokensMicros int64
	var updatedAtText string
	err := s.db.QueryRowContext(ctx, `
		SELECT tokens_micros, updated_at
		FROM rate_limit_buckets
		WHERE bucket_key = ?
	`, bucketKey).Scan(&tokensMicros, &updatedAtText)
	switch {
	case errors.Is(err, sql.ErrNoRows):
	case err != nil:
		return RateLimitBucketResult{}, err
	default:
		tokens = tokensMicros
		if tokens > capacity {
			tokens = capacity
		}
		updatedAt = parseDBTime(updatedAtText)
		if updatedAt.IsZero() {
			updatedAt = now
		}
		if now.Before(updatedAt) {
			now = updatedAt
		}
		tokens = refillTokens(tokens, capacity, updatedAt, now)
	}

	return RateLimitBucketResult{
		Allowed:   tokens >= tokenMicros,
		Remaining: int(tokens / tokenMicros),
		ResetAt:   nextTokenAt(tokens, capacity, now),
	}, nil
}

func (s *Store) DeleteRateLimitBucket(key string) error {
	_, err := s.db.Exec(`DELETE FROM rate_limit_buckets WHERE bucket_key = ?`, key)
	return err
}

type queryExecer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (s *Store) rateLimitBucketState(ctx context.Context, queryer queryExecer, bucketKey string, capacity int64, now time.Time) (int64, time.Time, error) {
	var tokens int64
	var updatedAtText string
	err := queryer.QueryRowContext(ctx, `
		SELECT tokens_micros, updated_at
		FROM rate_limit_buckets
		WHERE bucket_key = ?
	`, bucketKey).Scan(&tokens, &updatedAtText)
	if errors.Is(err, sql.ErrNoRows) {
		return capacity, now, nil
	}
	if err != nil {
		return 0, time.Time{}, err
	}
	if tokens > capacity {
		tokens = capacity
	}
	updatedAt := parseDBTime(updatedAtText)
	if updatedAt.IsZero() {
		updatedAt = now
	}
	return tokens, updatedAt, nil
}

func refillPerSecondMicros(capacity int64) int64 {
	return capacity / int64(time.Minute/time.Second)
}

func refillTokens(tokens int64, capacity int64, updatedAt time.Time, now time.Time) int64 {
	if tokens >= capacity {
		return capacity
	}
	elapsed := now.Sub(updatedAt)
	if elapsed <= 0 {
		return tokens
	}
	if elapsed >= time.Minute {
		return capacity
	}
	refill := elapsed.Nanoseconds() * capacity / int64(time.Minute)
	if refill <= 0 {
		return tokens
	}
	tokens += refill
	if tokens > capacity {
		return capacity
	}
	return tokens
}

func nextTokenAt(tokens int64, capacity int64, now time.Time) time.Time {
	if tokens >= capacity {
		return time.Time{}
	}
	if tokens >= tokenMicros {
		return now
	}
	missing := tokenMicros - tokens
	waitNanos := missing * int64(time.Minute) / capacity
	if waitNanos <= 0 {
		waitNanos = 1
	}
	return now.Add(time.Duration(waitNanos))
}

func (s *Store) migrate() error {
	if _, err := s.db.Exec(`
		PRAGMA busy_timeout = 5000;
		PRAGMA foreign_keys = ON;

		CREATE TABLE IF NOT EXISTS schema_migrations (
			name TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`); err != nil {
		return err
	}

	if err := s.applyMigrations(); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("servers", "auth_json", "TEXT NOT NULL DEFAULT '{}'"); err != nil {
		return err
	}
	if err := s.addColumnIfMissing("servers", "rate_limit_json", "TEXT NOT NULL DEFAULT '{}'"); err != nil {
		return err
	}
	if err := s.ensureTimestampColumns(); err != nil {
		return err
	}
	return nil
}

func (s *Store) ensureTimestampColumns() error {
	for _, table := range []string{"servers", "endpoints", "api_keys", "tool_cache"} {
		if err := s.addColumnIfMissing(table, "created_at", "TEXT NOT NULL DEFAULT ''"); err != nil {
			return err
		}
		if err := s.addColumnIfMissing(table, "updated_at", "TEXT NOT NULL DEFAULT ''"); err != nil {
			return err
		}
		if _, err := s.db.Exec(`UPDATE ` + table + ` SET created_at = CURRENT_TIMESTAMP WHERE created_at = ''`); err != nil {
			return err
		}
		if _, err := s.db.Exec(`UPDATE ` + table + ` SET updated_at = created_at WHERE updated_at = ''`); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) applyMigrations() error {
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		name := entry.Name()
		applied, err := s.migrationApplied(name)
		if err != nil {
			return err
		}
		if applied {
			continue
		}

		sqlBytes, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(sqlBytes)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations (name) VALUES (?)`, name); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) migrationApplied(name string) (bool, error) {
	var existing string
	err := s.db.QueryRow(`SELECT name FROM schema_migrations WHERE name = ?`, name).Scan(&existing)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (s *Store) addColumnIfMissing(table string, column string, definition string) error {
	rows, err := s.db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var typ string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			return err
		}
		if name == column {
			return nil
		}
	}
	_, err = s.db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + column + ` ` + definition)
	return err
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanServer(scanner rowScanner) (Server, error) {
	var server Server
	var authJSON string
	var headersJSON string
	var rateLimitJSON string
	var argsJSON string
	var envJSON string
	var enabled int

	err := scanner.Scan(
		&server.ID,
		&server.Name,
		&server.Transport,
		&server.URL,
		&authJSON,
		&headersJSON,
		&rateLimitJSON,
		&server.Command,
		&argsJSON,
		&envJSON,
		&enabled,
		&server.Weight,
		&server.CreatedAt,
		&server.UpdatedAt,
	)
	if err != nil {
		return Server{}, err
	}

	server.Enabled = enabled == 1
	if err := json.Unmarshal([]byte(authJSON), &server.Auth); err != nil {
		return Server{}, fmt.Errorf("decode auth for %q: %w", server.ID, err)
	}
	if err := json.Unmarshal([]byte(headersJSON), &server.Headers); err != nil {
		return Server{}, fmt.Errorf("decode headers for %q: %w", server.ID, err)
	}
	if err := json.Unmarshal([]byte(rateLimitJSON), &server.RateLimit); err != nil {
		return Server{}, fmt.Errorf("decode rate limit for %q: %w", server.ID, err)
	}
	if err := json.Unmarshal([]byte(argsJSON), &server.Args); err != nil {
		return Server{}, fmt.Errorf("decode args for %q: %w", server.ID, err)
	}
	if err := json.Unmarshal([]byte(envJSON), &server.Env); err != nil {
		return Server{}, fmt.Errorf("decode env for %q: %w", server.ID, err)
	}
	normalize(&server)
	return server, nil
}

func scanEndpoint(scanner rowScanner) (Endpoint, error) {
	var endpoint Endpoint
	var serverIDsJSON string
	var rateLimitJSON string
	var enabled int

	err := scanner.Scan(
		&endpoint.ID,
		&endpoint.Name,
		&endpoint.Description,
		&serverIDsJSON,
		&rateLimitJSON,
		&enabled,
		&endpoint.CreatedAt,
		&endpoint.UpdatedAt,
	)
	if err != nil {
		return Endpoint{}, err
	}

	endpoint.Enabled = enabled == 1
	if err := json.Unmarshal([]byte(serverIDsJSON), &endpoint.ServerIDs); err != nil {
		return Endpoint{}, fmt.Errorf("decode server ids for endpoint %q: %w", endpoint.ID, err)
	}
	if err := json.Unmarshal([]byte(rateLimitJSON), &endpoint.RateLimit); err != nil {
		return Endpoint{}, fmt.Errorf("decode rate limit for endpoint %q: %w", endpoint.ID, err)
	}
	normalizeEndpoint(&endpoint)
	return endpoint, nil
}

func scanAPIKey(scanner rowScanner) (APIKey, error) {
	var key APIKey
	var endpointIDsJSON string
	var enabled int

	err := scanner.Scan(
		&key.ID,
		&key.Name,
		&key.Value,
		&endpointIDsJSON,
		&enabled,
		&key.CreatedAt,
		&key.UpdatedAt,
	)
	if err != nil {
		return APIKey{}, err
	}

	key.Enabled = enabled == 1
	if err := json.Unmarshal([]byte(endpointIDsJSON), &key.EndpointIDs); err != nil {
		return APIKey{}, fmt.Errorf("decode endpoint ids for api key %q: %w", key.ID, err)
	}
	normalizeAPIKey(&key)
	return key, nil
}

func scanUser(scanner rowScanner) (User, error) {
	var user User
	err := scanner.Scan(
		&user.ID,
		&user.Email,
		&user.PasswordHash,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		return User{}, err
	}
	user.Email = strings.ToLower(strings.TrimSpace(user.Email))
	return user, nil
}

func Validate(server Server) error {
	if !serverIDPattern.MatchString(server.ID) {
		return errors.New("id must be 2-63 chars and contain only letters, numbers, dashes, or underscores")
	}
	if strings.TrimSpace(server.Name) == "" {
		return errors.New("name is required")
	}
	switch server.Transport {
	case "stdio":
		if strings.TrimSpace(server.Command) == "" {
			return errors.New("command is required for stdio transport")
		}
	case "http":
		parsed, err := url.Parse(server.URL)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return errors.New("url must be a valid http or https URL")
		}
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return errors.New("url must use http or https")
		}
	default:
		return errors.New("transport must be stdio or http")
	}
	if server.Weight <= 0 {
		return errors.New("weight must be greater than zero")
	}
	if err := validateAuth(server.Auth); err != nil {
		return err
	}
	if server.RateLimit.RequestsPerMinute < 0 {
		return errors.New("rate limit requests per minute must be zero or greater")
	}
	return nil
}

func ValidateEndpoint(endpoint Endpoint) error {
	if !serverIDPattern.MatchString(endpoint.ID) {
		return errors.New("id must be 2-63 chars and contain only letters, numbers, dashes, or underscores")
	}
	if strings.TrimSpace(endpoint.Name) == "" {
		return errors.New("name is required")
	}
	if len(endpoint.ServerIDs) == 0 {
		return errors.New("at least one server is required")
	}
	seen := map[string]bool{}
	for _, serverID := range endpoint.ServerIDs {
		if !serverIDPattern.MatchString(serverID) {
			return errors.New("server ids must be 2-63 chars and contain only letters, numbers, dashes, or underscores")
		}
		if seen[serverID] {
			return errors.New("server ids must be unique")
		}
		seen[serverID] = true
	}
	if endpoint.RateLimit.RequestsPerMinute < 0 {
		return errors.New("rate limit requests per minute must be zero or greater")
	}
	return nil
}

func ValidateAPIKey(key APIKey) error {
	if !serverIDPattern.MatchString(key.ID) {
		return errors.New("id must be 2-63 chars and contain only letters, numbers, dashes, or underscores")
	}
	if strings.TrimSpace(key.Name) == "" {
		return errors.New("name is required")
	}
	if strings.TrimSpace(key.Value) == "" {
		return errors.New("api key value is required")
	}
	if len(key.EndpointIDs) == 0 {
		return errors.New("at least one endpoint resource is required")
	}
	seen := map[string]bool{}
	for _, endpointID := range key.EndpointIDs {
		if !serverIDPattern.MatchString(endpointID) {
			return errors.New("endpoint ids must be 2-63 chars and contain only letters, numbers, dashes, or underscores")
		}
		if seen[endpointID] {
			return errors.New("endpoint ids must be unique")
		}
		seen[endpointID] = true
	}
	return nil
}

func validateAuth(auth AuthConfig) error {
	switch auth.Type {
	case "", "none":
		return nil
	case "apiKey":
		if strings.TrimSpace(auth.APIKeyName) == "" {
			return errors.New("api key name is required")
		}
		if strings.TrimSpace(auth.APIKeyValue) == "" {
			return errors.New("api key value is required")
		}
		if auth.APIKeyIn != "" && auth.APIKeyIn != "header" && auth.APIKeyIn != "query" {
			return errors.New("api key location must be header or query")
		}
	case "bearer", "jwtBearer":
		if strings.TrimSpace(auth.Token) == "" {
			return errors.New("auth token is required")
		}
	case "basic":
		if strings.TrimSpace(auth.Username) == "" {
			return errors.New("basic auth username is required")
		}
	default:
		return errors.New("auth type must be none, apiKey, bearer, jwtBearer, or basic")
	}
	return nil
}

func normalize(server *Server) {
	server.ID = strings.TrimSpace(server.ID)
	server.Name = strings.TrimSpace(server.Name)
	server.Transport = strings.ToLower(strings.TrimSpace(server.Transport))
	server.Command = strings.TrimSpace(server.Command)
	server.URL = strings.TrimSpace(server.URL)
	server.Auth = normalizeAuth(server.Auth)
	if server.Transport == "" {
		if server.URL != "" {
			server.Transport = "http"
		} else {
			server.Transport = "stdio"
		}
	}
	if server.Weight == 0 {
		server.Weight = 1
	}
	if server.Env == nil {
		server.Env = map[string]string{}
	}
	if server.Headers == nil {
		server.Headers = map[string]string{}
	}
}

func normalizeEndpoint(endpoint *Endpoint) {
	endpoint.ID = strings.TrimSpace(endpoint.ID)
	endpoint.Name = strings.TrimSpace(endpoint.Name)
	endpoint.Description = strings.TrimSpace(endpoint.Description)

	serverIDs := make([]string, 0, len(endpoint.ServerIDs))
	seen := map[string]bool{}
	for _, serverID := range endpoint.ServerIDs {
		serverID = strings.TrimSpace(serverID)
		if serverID == "" || seen[serverID] {
			continue
		}
		seen[serverID] = true
		serverIDs = append(serverIDs, serverID)
	}
	endpoint.ServerIDs = serverIDs
}

func normalizeAPIKey(key *APIKey) {
	key.ID = strings.TrimSpace(key.ID)
	key.Name = strings.TrimSpace(key.Name)
	key.Value = strings.TrimSpace(key.Value)

	endpointIDs := make([]string, 0, len(key.EndpointIDs))
	seen := map[string]bool{}
	for _, endpointID := range key.EndpointIDs {
		endpointID = strings.TrimSpace(endpointID)
		if endpointID == "" || seen[endpointID] {
			continue
		}
		seen[endpointID] = true
		endpointIDs = append(endpointIDs, endpointID)
	}
	key.EndpointIDs = endpointIDs
}

func normalizeAuth(auth AuthConfig) AuthConfig {
	auth.Type = strings.TrimSpace(auth.Type)
	if auth.Type == "" {
		auth.Type = "none"
	}
	auth.APIKeyName = strings.TrimSpace(auth.APIKeyName)
	auth.APIKeyValue = strings.TrimSpace(auth.APIKeyValue)
	auth.APIKeyIn = strings.TrimSpace(auth.APIKeyIn)
	if auth.APIKeyIn == "" {
		auth.APIKeyIn = "header"
	}
	auth.Token = strings.TrimSpace(auth.Token)
	auth.Username = strings.TrimSpace(auth.Username)
	auth.Password = strings.TrimSpace(auth.Password)
	return auth
}

func formatDBTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func parseDBTime(value string) time.Time {
	if strings.TrimSpace(value) == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}
	}
	return parsed.UTC()
}
