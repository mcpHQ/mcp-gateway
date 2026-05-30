package config

import (
	"context"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestLoadStoreAppliesMigrationsIdempotently(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gateway.db")

	store, err := LoadStore(path)
	if err != nil {
		t.Fatalf("load store: %v", err)
	}
	store.Close()

	store, err = LoadStore(path)
	if err != nil {
		t.Fatalf("reload store: %v", err)
	}
	defer store.Close()

	var migrationCount int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&migrationCount); err != nil {
		t.Fatalf("query migrations: %v", err)
	}
	if migrationCount == 0 {
		t.Fatal("expected at least one applied migration")
	}

	for _, table := range []string{"servers", "endpoints", "api_keys", "tool_cache", "usage_counters", "rate_limit_buckets", "audit_logs", "app_settings"} {
		var name string
		if err := store.db.QueryRow(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&name); err != nil {
			t.Fatalf("expected table %s: %v", table, err)
		}
	}
}

func TestAuditLogsInsertAndListRecentFirst(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	older := AuditLogRecord{
		ID:         "audit-old",
		Timestamp:  time.Date(2026, 5, 24, 12, 0, 0, 0, time.UTC),
		Transport:  "rest",
		EndpointID: "dev",
		ToolName:   "test__alpha",
		Status:     200,
		DurationMS: 12,
		Caller:     "admin@example.com",
	}
	newer := AuditLogRecord{
		ID:         "audit-new",
		Timestamp:  older.Timestamp.Add(time.Minute),
		Transport:  "mcp",
		EndpointID: "dev",
		ToolName:   "test__beta",
		Status:     502,
		DurationMS: 34,
		Caller:     "127.0.0.1",
		Error:      "upstream failed",
		RawCall:    `{"method":"tools/call"}`,
	}
	if err := store.InsertAuditLog(older); err != nil {
		t.Fatalf("insert older audit log: %v", err)
	}
	if err := store.InsertAuditLog(newer); err != nil {
		t.Fatalf("insert newer audit log: %v", err)
	}

	logs, err := store.ListAuditLogs(10)
	if err != nil {
		t.Fatalf("list audit logs: %v", err)
	}
	if len(logs) != 2 {
		t.Fatalf("expected 2 audit logs, got %d", len(logs))
	}
	if logs[0].ID != newer.ID || logs[1].ID != older.ID {
		t.Fatalf("expected newest first, got %#v", logs)
	}
	if logs[0].Error != newer.Error || logs[0].DurationMS != newer.DurationMS || logs[0].RawCall != newer.RawCall {
		t.Fatalf("newer audit log fields were not preserved: %#v", logs[0])
	}
}

func TestConsumeRateLimitTokenUsesTokenBucket(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	ctx := context.Background()
	now := time.Date(2026, 5, 24, 12, 0, 0, 0, time.UTC)
	first, err := store.ConsumeRateLimitToken(ctx, "endpoint:dev", 2, now)
	if err != nil {
		t.Fatalf("consume first token: %v", err)
	}
	if !first.Allowed || first.Remaining != 1 {
		t.Fatalf("unexpected first decision: %#v", first)
	}

	second, err := store.ConsumeRateLimitToken(ctx, "endpoint:dev", 2, now)
	if err != nil {
		t.Fatalf("consume second token: %v", err)
	}
	if !second.Allowed || second.Remaining != 0 {
		t.Fatalf("unexpected second decision: %#v", second)
	}

	third, err := store.ConsumeRateLimitToken(ctx, "endpoint:dev", 2, now)
	if err != nil {
		t.Fatalf("consume third token: %v", err)
	}
	if third.Allowed || third.Remaining != 0 || !third.ResetAt.Equal(now.Add(30*time.Second)) {
		t.Fatalf("unexpected denied decision: %#v", third)
	}

	refilled, err := store.ConsumeRateLimitToken(ctx, "endpoint:dev", 2, now.Add(30*time.Second))
	if err != nil {
		t.Fatalf("consume refilled token: %v", err)
	}
	if !refilled.Allowed || refilled.Remaining != 0 {
		t.Fatalf("unexpected refilled decision: %#v", refilled)
	}
}

func TestConsumeRateLimitTokenSerializesConcurrentCalls(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	ctx := context.Background()
	now := time.Date(2026, 5, 24, 12, 0, 0, 0, time.UTC)
	var allowed atomic.Int64
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			decision, err := store.ConsumeRateLimitToken(ctx, "endpoint:dev", 5, now)
			if err != nil {
				t.Errorf("consume token: %v", err)
				return
			}
			if decision.Allowed {
				allowed.Add(1)
			}
		}()
	}
	wg.Wait()

	if got := allowed.Load(); got != 5 {
		t.Fatalf("expected exactly 5 allowed calls, got %d", got)
	}
}

func newTestStore(t testing.TB) *Store {
	t.Helper()
	store, err := LoadStore(filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatalf("load store: %v", err)
	}
	return store
}
