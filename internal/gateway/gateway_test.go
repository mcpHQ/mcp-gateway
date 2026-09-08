package gateway

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rajdas/mcp-gateway/internal/config"
	"github.com/rajdas/mcp-gateway/internal/mcp"
)

// TestMain lets this test binary double as a fake stdio MCP server (see
// internal/mcp/client_test.go for the same pattern), used by
// TestUpsertServerKeepsStdioServerRunningAfterRequestContextEnds below to
// exercise the real mcp.Client instead of fakeUpstream.
func TestMain(m *testing.M) {
	if os.Getenv("MCP_GATEWAY_TEST_STDIO_HELPER") == "1" {
		runGatewayStdioHelperProcess()
		return
	}
	os.Exit(m.Run())
}

func runGatewayStdioHelperProcess() {
	reader := bufio.NewReader(os.Stdin)
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			return
		}
		var req map[string]any
		if err := json.Unmarshal(line, &req); err != nil {
			continue
		}
		method, _ := req["method"].(string)
		idVal, hasID := req["id"]

		switch method {
		case "initialize":
			writeGatewayHelperMessage(map[string]any{
				"jsonrpc": "2.0",
				"id":      idVal,
				"result": map[string]any{
					"protocolVersion": "2024-11-05",
					"capabilities":    map[string]any{},
					"serverInfo":      map[string]any{"name": "fake", "version": "1"},
				},
			})
		case "notifications/initialized":
			// no response expected
		case "tools/list":
			writeGatewayHelperMessage(map[string]any{
				"jsonrpc": "2.0",
				"id":      idVal,
				"result":  map[string]any{"tools": []map[string]any{{"name": "alpha"}}},
			})
		default:
			if hasID {
				writeGatewayHelperMessage(map[string]any{
					"jsonrpc": "2.0",
					"id":      idVal,
					"error":   map[string]any{"code": -32601, "message": "method not found"},
				})
			}
		}
	}
}

func writeGatewayHelperMessage(value any) {
	payload, err := json.Marshal(value)
	if err != nil {
		return
	}
	payload = append(payload, '\n')
	_, _ = os.Stdout.Write(payload)
}

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

func TestUpsertServerKeepsStdioServerRunningAfterRequestContextEnds(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	gw := New(store)
	defer gw.Close()

	server := testServer()
	server.Command = os.Args[0]
	server.Args = nil
	server.Env = map[string]string{"MCP_GATEWAY_TEST_STDIO_HELPER": "1"}

	// Simulate an HTTP request context that ends as soon as the handler
	// returns (POST /api/servers passes r.Context()).
	requestCtx, cancel := context.WithCancel(context.Background())
	if err := gw.UpsertServer(requestCtx, server); err != nil {
		t.Fatalf("upsert server: %v", err)
	}
	cancel()

	// UpsertServer now starts the upstream in the background (see
	// startServerAsync), so give it a moment to come up before asserting.
	deadline := time.Now().Add(2 * time.Second)
	var client mcp.Upstream
	for time.Now().Before(deadline) {
		if client = gw.client(server.ID); client != nil && client.Status().Running {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if client == nil {
		t.Fatal("expected upstream client to be registered")
	}
	if !client.Status().Running {
		t.Fatalf("expected stdio server to still be running after request ctx ended, status=%+v", client.Status())
	}

	tools, err := client.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools after request ctx ended: %v", err)
	}
	if len(tools) == 0 {
		t.Fatal("expected tools from still-running stdio process")
	}
}

// fakeNpxBinary returns the path to an executable named like a package
// runner (e.g. "npx") that actually just runs this test binary's stdio
// helper (see TestMain), so real MCP handshake/tool-list traffic can be
// exercised without depending on npx being installed.
func fakeNpxBinary(t testing.TB, name string) string {
	t.Helper()
	dir := t.TempDir()
	link := filepath.Join(dir, name)
	if err := os.Symlink(os.Args[0], link); err != nil {
		t.Fatalf("symlink fake %s binary: %v", name, err)
	}
	return link
}

func TestUpsertServerStartsPackageRunnerServersInBackground(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	gw := New(store)
	defer gw.Close()

	server := testServer()
	server.Command = fakeNpxBinary(t, "npx")
	server.Args = nil
	server.Env = map[string]string{"MCP_GATEWAY_TEST_STDIO_HELPER": "1"}

	start := time.Now()
	if err := gw.UpsertServer(context.Background(), server); err != nil {
		t.Fatalf("upsert server: %v", err)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("expected saving a package-runner (npx) server to return quickly without waiting for it to start, took %v", elapsed)
	}

	deadline := time.Now().Add(2 * time.Second)
	var client mcp.Upstream
	for time.Now().Before(deadline) {
		if client = gw.client(server.ID); client != nil && client.Status().Running {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if client == nil || !client.Status().Running {
		t.Fatal("expected package-runner server to be started in the background")
	}
}

func TestTestServerPrechecksPackageRunnerCommandsWithoutStarting(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	gw := New(store)
	defer gw.Close()

	// This "npx" binary would hang forever (never responds to the MCP
	// initialize handshake) if it were ever actually started, proving that
	// TestServer only prechecks package-runner commands.
	dir := t.TempDir()
	hangingScript := filepath.Join(dir, "npx")
	if err := os.WriteFile(hangingScript, []byte("#!/bin/sh\nsleep 3600\n"), 0o755); err != nil {
		t.Fatalf("write hanging script: %v", err)
	}

	server := testServer()
	server.Command = hangingScript
	server.Args = nil

	start := time.Now()
	result, err := gw.TestServer(context.Background(), server)
	if err != nil {
		t.Fatalf("test server: %v", err)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("expected precheck for package-runner command to return quickly, took %v", elapsed)
	}
	if !result.OK || result.Status != "precheck_ok" {
		t.Fatalf("expected precheck_ok result, got %+v", result)
	}

	if client := gw.client(server.ID); client != nil {
		t.Fatalf("expected precheck not to start (or register) an upstream client, got %+v", client.Status())
	}

	server.Command = filepath.Join(dir, "missing-subdir", "npx")
	result, err = gw.TestServer(context.Background(), server)
	if err == nil {
		t.Fatal("expected precheck to fail for a command that cannot be found")
	}
	if result.OK || result.Status != "command_not_found" {
		t.Fatalf("expected command_not_found result, got %+v", result)
	}
}

func TestUpsertServerPreservesAuthWhenUpdateOmitsSecrets(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	withFakeUpstream(t, &fakeUpstream{})
	gw := New(store)

	server := testServer()
	server.Auth = config.AuthConfig{
		Type:        "apiKey",
		APIKeyName:  "X-Api-Key",
		APIKeyValue: "secret-value",
	}
	if err := gw.UpsertServer(context.Background(), server); err != nil {
		t.Fatalf("upsert server: %v", err)
	}

	// Mirrors the UI flow: GET /api/servers strips secrets via
	// sanitizeServer, then the browser POSTs the form back with
	// { "type": "none" } and empty secret fields.
	update := testServer()
	update.Auth = config.AuthConfig{Type: "none"}
	if err := gw.UpsertServer(context.Background(), update); err != nil {
		t.Fatalf("upsert server update: %v", err)
	}

	stored, ok := gw.cachedServer(update.ID)
	if !ok {
		t.Fatalf("expected server %q to be cached", update.ID)
	}
	if stored.Auth.Type != "apiKey" || stored.Auth.APIKeyName != "X-Api-Key" || stored.Auth.APIKeyValue != "secret-value" {
		t.Fatalf("expected existing apiKey auth to be preserved, got %+v", stored.Auth)
	}
}

func TestUpsertEndpointCreatesDefaultAPIKey(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	withFakeUpstream(t, &fakeUpstream{})
	gw := New(store)
	if err := gw.UpsertServer(context.Background(), testServer()); err != nil {
		t.Fatalf("upsert server: %v", err)
	}

	if err := gw.UpsertEndpoint(config.Endpoint{
		ID:        "dev-tools",
		Name:      "Developer Tools",
		ServerIDs: []string{"test"},
		Enabled:   true,
	}); err != nil {
		t.Fatalf("upsert endpoint: %v", err)
	}

	keys := gw.APIKeys()
	if len(keys) != 1 {
		t.Fatalf("expected one api key after endpoint create, got %#v", keys)
	}
	if keys[0].ID != "dev-tools-client" || keys[0].Name != "Developer Tools API Key" || !keys[0].HasValue {
		t.Fatalf("unexpected default api key metadata: %#v", keys[0])
	}

	stored, ok := store.GetAPIKey("dev-tools-client")
	if !ok {
		t.Fatal("expected default api key in store")
	}
	if stored.Value == "" || !strings.HasPrefix(stored.Value, "sk_") {
		t.Fatalf("expected generated api key value, got %q", stored.Value)
	}
	if len(stored.EndpointIDs) != 1 || stored.EndpointIDs[0] != "dev-tools" {
		t.Fatalf("expected default api key mapped to endpoint, got %#v", stored.EndpointIDs)
	}

	if err := gw.UpsertEndpoint(config.Endpoint{
		ID:        "dev-tools",
		Name:      "Developer Tools Updated",
		ServerIDs: []string{"test"},
		Enabled:   true,
	}); err != nil {
		t.Fatalf("update endpoint: %v", err)
	}
	if len(gw.APIKeys()) != 1 {
		t.Fatalf("expected endpoint update to keep a single api key, got %#v", gw.APIKeys())
	}
}

func TestAPIKeysRedactValuesAndPreserveExistingOnUpdate(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	withFakeUpstream(t, &fakeUpstream{})
	gw := New(store)
	if err := gw.UpsertServer(context.Background(), testServer()); err != nil {
		t.Fatalf("upsert server: %v", err)
	}
	if err := gw.UpsertEndpoint(config.Endpoint{
		ID:        "dev",
		Name:      "Dev Tools",
		ServerIDs: []string{"test"},
		Enabled:   true,
	}); err != nil {
		t.Fatalf("upsert endpoint: %v", err)
	}

	statuses := gw.APIKeys()
	if len(statuses) != 1 {
		t.Fatalf("expected one auto api key status, got %#v", statuses)
	}
	if !statuses[0].HasValue || statuses[0].ID != "dev-client" {
		t.Fatalf("expected auto api key metadata, got %#v", statuses[0])
	}

	if err := gw.UpsertAPIKey(config.APIKey{
		ID:          "dev-client",
		Name:        "Client Updated",
		EndpointIDs: []string{"dev"},
		Enabled:     true,
	}); err != nil {
		t.Fatalf("upsert api key without value: %v", err)
	}
	stored, ok := store.GetAPIKey("dev-client")
	if !ok {
		t.Fatal("expected stored api key")
	}
	if stored.Value == "" {
		t.Fatal("expected stored api key value")
	}
	originalValue := stored.Value

	stored, ok = store.GetAPIKey("dev-client")
	if !ok {
		t.Fatal("expected stored api key")
	}
	if stored.Value != originalValue {
		t.Fatalf("expected existing value to be preserved, got %q", stored.Value)
	}

	if err := gw.UpsertAPIKey(config.APIKey{
		ID:          "dev-client",
		Name:        "Client Updated",
		Value:       "secret-two",
		EndpointIDs: []string{"dev"},
		Enabled:     true,
	}); err != nil {
		t.Fatalf("rotate api key value: %v", err)
	}
	stored, ok = store.GetAPIKey("dev-client")
	if !ok {
		t.Fatal("expected stored api key after rotation")
	}
	if stored.Value != "secret-two" {
		t.Fatalf("expected rotated value, got %q", stored.Value)
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
