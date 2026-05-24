package gateway

import (
	"context"
	"errors"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/rajdas/mcp-gateway/internal/config"
	"github.com/rajdas/mcp-gateway/internal/mcp"
)

type fakeUpstream struct {
	tools     []mcp.Tool
	listErr   error
	callErr   error
	listCalls atomic.Int64
	callCalls atomic.Int64
}

func (f *fakeUpstream) Start(context.Context) error {
	return nil
}

func (f *fakeUpstream) Stop() {}

func (f *fakeUpstream) Status() mcp.Status {
	return mcp.Status{Running: true}
}

func (f *fakeUpstream) ListTools(context.Context) ([]mcp.Tool, error) {
	f.listCalls.Add(1)
	if f.listErr != nil {
		return nil, f.listErr
	}
	return append([]mcp.Tool(nil), f.tools...), nil
}

func (f *fakeUpstream) CallTool(context.Context, string, map[string]any) (mcp.CallResult, error) {
	f.callCalls.Add(1)
	if f.callErr != nil {
		return mcp.CallResult{}, f.callErr
	}
	return mcp.CallResult{Content: []map[string]any{{"type": "text", "text": "ok"}}}, nil
}

func TestToolsUsesCachedCatalog(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	upstream := &fakeUpstream{
		tools: []mcp.Tool{{Name: "alpha", Description: "first tool"}},
	}
	withFakeUpstream(t, upstream)

	gw := New(store)
	server := testServer()
	if err := gw.UpsertServer(context.Background(), server); err != nil {
		t.Fatalf("upsert server: %v", err)
	}

	if got := upstream.listCalls.Load(); got != 1 {
		t.Fatalf("expected lifecycle refresh to list tools once, got %d", got)
	}

	tools, err := gw.Tools(context.Background())
	if err != nil {
		t.Fatalf("list tools: %v", err)
	}
	if got := upstream.listCalls.Load(); got != 1 {
		t.Fatalf("expected cached tools without upstream call, got %d calls", got)
	}
	if !hasTool(tools, "test__alpha") {
		t.Fatalf("expected cached gateway tool test__alpha, got %#v", tools)
	}
}

func TestUpstreamToolsExcludesGatewayMetaTools(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	upstream := &fakeUpstream{
		tools: []mcp.Tool{{Name: "alpha"}},
	}
	withFakeUpstream(t, upstream)

	gw := New(store)
	if err := gw.UpsertServer(context.Background(), testServer()); err != nil {
		t.Fatalf("upsert server: %v", err)
	}

	tools, err := gw.UpstreamTools(context.Background())
	if err != nil {
		t.Fatalf("list upstream tools: %v", err)
	}
	if len(tools) != 1 || !hasTool(tools, "test__alpha") {
		t.Fatalf("expected only upstream tools, got %#v", tools)
	}
	if hasTool(tools, toolListServers) {
		t.Fatalf("upstream tools should not include gateway meta-tools: %#v", tools)
	}
}

func TestRefreshToolsUpdatesCachedCatalog(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	upstream := &fakeUpstream{
		tools: []mcp.Tool{{Name: "alpha"}},
	}
	withFakeUpstream(t, upstream)

	gw := New(store)
	if err := gw.UpsertServer(context.Background(), testServer()); err != nil {
		t.Fatalf("upsert server: %v", err)
	}

	upstream.tools = []mcp.Tool{{Name: "beta"}}
	tools, err := gw.RefreshTools(context.Background())
	if err != nil {
		t.Fatalf("refresh tools: %v", err)
	}
	if got := upstream.listCalls.Load(); got != 2 {
		t.Fatalf("expected explicit refresh to call upstream, got %d calls", got)
	}
	if hasTool(tools, "test__alpha") || !hasTool(tools, "test__beta") {
		t.Fatalf("expected refreshed tool catalog, got %#v", tools)
	}
}

func TestRefreshToolsKeepsStaleCatalogOnFailure(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	upstream := &fakeUpstream{
		tools: []mcp.Tool{{Name: "alpha"}},
	}
	withFakeUpstream(t, upstream)

	gw := New(store)
	if err := gw.UpsertServer(context.Background(), testServer()); err != nil {
		t.Fatalf("upsert server: %v", err)
	}

	upstream.tools = []mcp.Tool{{Name: "beta"}}
	upstream.listErr = errors.New("upstream unavailable")
	tools, err := gw.RefreshTools(context.Background())
	if err == nil {
		t.Fatal("expected refresh error")
	}
	if !hasTool(tools, "test__alpha") || hasTool(tools, "test__beta") {
		t.Fatalf("expected stale catalog after failed refresh, got %#v", tools)
	}
}

func TestToolsSurviveGatewayRecreation(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	upstream := &fakeUpstream{
		tools: []mcp.Tool{{Name: "alpha"}},
	}
	withFakeUpstream(t, upstream)

	gw := New(store)
	if err := gw.UpsertServer(context.Background(), testServer()); err != nil {
		t.Fatalf("upsert server: %v", err)
	}

	upstream.listErr = errors.New("upstream unavailable")
	reloaded := New(store)
	tools, err := reloaded.Tools(context.Background())
	if err != nil {
		t.Fatalf("list persisted tools: %v", err)
	}
	if !hasTool(tools, "test__alpha") {
		t.Fatalf("expected persisted tool test__alpha, got %#v", tools)
	}
	if got := upstream.listCalls.Load(); got != 1 {
		t.Fatalf("persisted tools should avoid upstream refresh, got %d list calls", got)
	}
}

func TestCallToolTracksUsage(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	upstream := &fakeUpstream{
		tools: []mcp.Tool{{Name: "alpha"}},
	}
	withFakeUpstream(t, upstream)

	gw := New(store)
	if err := gw.UpsertServer(context.Background(), testServer()); err != nil {
		t.Fatalf("upsert server: %v", err)
	}

	if _, err := gw.CallTool(context.Background(), "test__alpha", map[string]any{}); err != nil {
		t.Fatalf("call tool: %v", err)
	}

	servers := gw.Servers()
	if len(servers) != 1 {
		t.Fatalf("expected one server, got %d", len(servers))
	}
	usage := servers[0].Usage
	if usage.TotalCalls != 1 || usage.SuccessfulCalls != 1 || usage.FailedCalls != 0 || usage.RateLimitedCalls != 0 {
		t.Fatalf("unexpected usage: %#v", usage)
	}
	if got := upstream.callCalls.Load(); got != 1 {
		t.Fatalf("expected one upstream tool call, got %d", got)
	}
}

func TestUsageSurvivesGatewayRecreation(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	upstream := &fakeUpstream{
		tools: []mcp.Tool{{Name: "alpha"}},
	}
	withFakeUpstream(t, upstream)

	gw := New(store)
	if err := gw.UpsertServer(context.Background(), testServer()); err != nil {
		t.Fatalf("upsert server: %v", err)
	}
	if _, err := gw.CallTool(context.Background(), "test__alpha", map[string]any{}); err != nil {
		t.Fatalf("call tool: %v", err)
	}
	gw.Close()

	reloaded := New(store)
	defer reloaded.Close()
	servers := reloaded.Servers()
	if len(servers) != 1 {
		t.Fatalf("expected one server, got %d", len(servers))
	}
	usage := servers[0].Usage
	if usage.TotalCalls != 1 || usage.SuccessfulCalls != 1 {
		t.Fatalf("expected persisted usage, got %#v", usage)
	}
}

func TestCallToolTracksServerUsageWithoutRateLimit(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	upstream := &fakeUpstream{
		tools: []mcp.Tool{{Name: "alpha"}},
	}
	withFakeUpstream(t, upstream)

	gw := New(store)
	server := testServer()
	server.RateLimit = config.RateLimit{RequestsPerMinute: 1}
	if err := gw.UpsertServer(context.Background(), server); err != nil {
		t.Fatalf("upsert server: %v", err)
	}

	if _, err := gw.CallTool(context.Background(), "test__alpha", map[string]any{}); err != nil {
		t.Fatalf("first call should pass: %v", err)
	}
	if _, err := gw.CallTool(context.Background(), "test__alpha", map[string]any{}); err != nil {
		t.Fatalf("second call should pass without server rate limit: %v", err)
	}

	servers := gw.Servers()
	usage := servers[0].Usage
	if usage.TotalCalls != 2 || usage.SuccessfulCalls != 2 || usage.RateLimitedCalls != 0 {
		t.Fatalf("unexpected server usage: %#v", usage)
	}
	if usage.LimitPerMinute != 0 || usage.RemainingThisMinute != 0 {
		t.Fatalf("server usage should not expose rate limit data: %#v", usage)
	}
	if got := upstream.callCalls.Load(); got != 2 {
		t.Fatalf("expected two upstream tool calls, got %d", got)
	}
}

func TestEndpointToolsScopesCatalogToEndpointServers(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	upstream := &fakeUpstream{
		tools: []mcp.Tool{{Name: "alpha"}},
	}
	withFakeUpstream(t, upstream)

	gw := New(store)
	if err := gw.UpsertServer(context.Background(), testServer()); err != nil {
		t.Fatalf("upsert server: %v", err)
	}
	other := testServer()
	other.ID = "other"
	other.Name = "Other MCP"
	if err := gw.UpsertServer(context.Background(), other); err != nil {
		t.Fatalf("upsert other server: %v", err)
	}
	if err := gw.UpsertEndpoint(config.Endpoint{
		ID:        "dev",
		Name:      "Dev Tools",
		ServerIDs: []string{"test"},
		Enabled:   true,
	}); err != nil {
		t.Fatalf("upsert endpoint: %v", err)
	}

	tools, err := gw.EndpointTools(context.Background(), "dev")
	if err != nil {
		t.Fatalf("endpoint tools: %v", err)
	}
	if !hasTool(tools, "test__alpha") || hasTool(tools, "other__alpha") {
		t.Fatalf("expected endpoint-scoped tools, got %#v", tools)
	}
}

func TestCallEndpointToolTracksAndLimitsEndpointUsage(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	upstream := &fakeUpstream{
		tools: []mcp.Tool{{Name: "alpha"}},
	}
	withFakeUpstream(t, upstream)

	gw := New(store)
	server := testServer()
	server.RateLimit = config.RateLimit{RequestsPerMinute: 1}
	if err := gw.UpsertServer(context.Background(), server); err != nil {
		t.Fatalf("upsert server: %v", err)
	}
	if err := gw.UpsertEndpoint(config.Endpoint{
		ID:        "dev",
		Name:      "Dev Tools",
		ServerIDs: []string{"test"},
		RateLimit: config.RateLimit{
			RequestsPerMinute: 1,
		},
		Enabled: true,
	}); err != nil {
		t.Fatalf("upsert endpoint: %v", err)
	}

	if _, err := gw.CallEndpointTool(context.Background(), "dev", "test__alpha", map[string]any{}); err != nil {
		t.Fatalf("first endpoint call should pass: %v", err)
	}
	if _, err := gw.CallEndpointTool(context.Background(), "dev", "test__alpha", map[string]any{}); err == nil {
		t.Fatal("expected second endpoint call to be rate limited")
	} else if !IsRateLimitError(err) {
		t.Fatalf("expected rate limit error, got %v", err)
	}

	endpoints := gw.Endpoints()
	if len(endpoints) != 1 {
		t.Fatalf("expected one endpoint, got %d", len(endpoints))
	}
	usage := endpoints[0].Usage
	if usage.TotalCalls != 1 || usage.SuccessfulCalls != 1 || usage.RateLimitedCalls != 1 {
		t.Fatalf("unexpected endpoint usage: %#v", usage)
	}
	if usage.LimitPerMinute != 1 || usage.RemainingThisMinute != 0 || usage.WindowResetAt == "" {
		t.Fatalf("unexpected token bucket usage: %#v", usage)
	}
	servers := gw.Servers()
	if servers[0].Usage.TotalCalls != 1 || servers[0].Usage.SuccessfulCalls != 1 {
		t.Fatalf("endpoint calls should count against server usage: %#v", servers[0].Usage)
	}
	if got := upstream.callCalls.Load(); got != 1 {
		t.Fatalf("rate-limited endpoint call should not reach upstream, got %d calls", got)
	}
}

func TestCallEndpointToolSharesRateLimitAcrossStores(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gateway.db")
	storeA, err := config.LoadStore(path)
	if err != nil {
		t.Fatalf("load first store: %v", err)
	}
	defer storeA.Close()

	upstream := &fakeUpstream{
		tools: []mcp.Tool{{Name: "alpha"}},
	}
	withFakeUpstream(t, upstream)

	ctx := context.Background()
	gwA := New(storeA)
	defer gwA.Close()
	server := testServer()
	if err := gwA.UpsertServer(ctx, server); err != nil {
		t.Fatalf("upsert server: %v", err)
	}
	if err := gwA.UpsertEndpoint(config.Endpoint{
		ID:        "dev",
		Name:      "Dev Tools",
		ServerIDs: []string{"test"},
		RateLimit: config.RateLimit{
			RequestsPerMinute: 1,
		},
		Enabled: true,
	}); err != nil {
		t.Fatalf("upsert endpoint: %v", err)
	}

	storeB, err := config.LoadStore(path)
	if err != nil {
		t.Fatalf("load second store: %v", err)
	}
	defer storeB.Close()
	gwB := New(storeB)
	defer gwB.Close()
	if err := gwB.Start(ctx); err != nil {
		t.Fatalf("start second gateway: %v", err)
	}

	if _, err := gwA.CallEndpointTool(ctx, "dev", "test__alpha", map[string]any{}); err != nil {
		t.Fatalf("first gateway call should pass: %v", err)
	}
	if _, err := gwB.CallEndpointTool(ctx, "dev", "test__alpha", map[string]any{}); err == nil {
		t.Fatal("expected second gateway call to share rate limit")
	} else if !IsRateLimitError(err) {
		t.Fatalf("expected rate limit error, got %v", err)
	}
	if got := upstream.callCalls.Load(); got != 1 {
		t.Fatalf("rate-limited replica call should not reach upstream, got %d calls", got)
	}
}

func TestCallEndpointToolRejectsToolsOutsideEndpoint(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	upstream := &fakeUpstream{
		tools: []mcp.Tool{{Name: "alpha"}},
	}
	withFakeUpstream(t, upstream)

	gw := New(store)
	if err := gw.UpsertServer(context.Background(), testServer()); err != nil {
		t.Fatalf("upsert server: %v", err)
	}
	other := testServer()
	other.ID = "other"
	other.Name = "Other MCP"
	if err := gw.UpsertServer(context.Background(), other); err != nil {
		t.Fatalf("upsert other server: %v", err)
	}
	if err := gw.UpsertEndpoint(config.Endpoint{
		ID:        "dev",
		Name:      "Dev Tools",
		ServerIDs: []string{"test"},
		Enabled:   true,
	}); err != nil {
		t.Fatalf("upsert endpoint: %v", err)
	}

	if _, err := gw.CallEndpointTool(context.Background(), "dev", "other__alpha", map[string]any{}); err == nil {
		t.Fatal("expected call outside endpoint to fail")
	}
	if got := upstream.callCalls.Load(); got != 0 {
		t.Fatalf("rejected endpoint call should not reach upstream, got %d calls", got)
	}
}

func newTestStore(t testing.TB) *config.Store {
	t.Helper()
	store, err := config.LoadStore(filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatalf("load store: %v", err)
	}
	return store
}

func testServer() config.Server {
	return config.Server{
		ID:        "test",
		Name:      "Test MCP",
		Transport: "stdio",
		Command:   "fake",
		Enabled:   true,
		Weight:    1,
	}
}

func withFakeUpstream(t testing.TB, upstream mcp.Upstream) {
	t.Helper()
	original := newUpstream
	newUpstream = func(config.Server) mcp.Upstream {
		return upstream
	}
	t.Cleanup(func() {
		newUpstream = original
	})
}

func hasTool(tools []Tool, name string) bool {
	for _, tool := range tools {
		if tool.Name == name {
			return true
		}
	}
	return false
}
