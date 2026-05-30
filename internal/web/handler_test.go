package web

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	openapi "github.com/rajdas/mcp-gateway/api"
	"github.com/rajdas/mcp-gateway/internal/auth"
	"github.com/rajdas/mcp-gateway/internal/config"
	"github.com/rajdas/mcp-gateway/internal/gateway"
)

func TestDirectRESTToolCallRequiresEndpoint(t *testing.T) {
	handler := NewHandler(nil)
	req := httptest.NewRequest(http.MethodPost, "/api/tools/github__search_repositories/call", strings.NewReader(`{"arguments":{}}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("expected status %d, got %d", http.StatusGone, rec.Code)
	}
	var payload apiError
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !strings.Contains(payload.Error, "/api/endpoints/{id}/tools/{name}/call") {
		t.Fatalf("expected endpoint route guidance, got %q", payload.Error)
	}
}

func TestGlobalMCPToolCallRequiresEndpoint(t *testing.T) {
	handler := NewHandler(nil)
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"github__search_repositories","arguments":{}}}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, rec.Code)
	}
	var payload struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !strings.Contains(payload.Error.Message, "/mcp/{endpointId}") {
		t.Fatalf("expected endpoint route guidance, got %q", payload.Error.Message)
	}
}

func TestGeneratedOpenAPIResponseTypesKeepJSONShape(t *testing.T) {
	tests := []struct {
		name string
		in   any
		want string
	}{
		{
			name: "config response",
			in:   ConfigResponse{Path: "mcp-gateway.db"},
			want: `{"path":"mcp-gateway.db"}`,
		},
		{
			name: "rest error response",
			in:   ErrorResponse{Error: "server not found"},
			want: `{"error":"server not found"}`,
		},
		{
			name: "api key list redacts value",
			in: APIKeysResponse{ApiKeys: []APIKeyStatus{{
				Id:          "default",
				Name:        "Default",
				EndpointIds: []string{"dev-tools"},
				Enabled:     true,
				HasValue:    true,
			}}},
			want: `{"apiKeys":[{"enabled":true,"endpointIds":["dev-tools"],"hasValue":true,"id":"default","name":"Default"}]}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := json.Marshal(tt.in)
			if err != nil {
				t.Fatalf("marshal generated type: %v", err)
			}
			if !bytes.Equal(got, []byte(tt.want)) {
				t.Fatalf("expected %s, got %s", tt.want, got)
			}
		})
	}
}

func TestLoginProtectedRouteAndPasswordChange(t *testing.T) {
	store, authService := newAuthTestStore(t)
	gw := gateway.New(store)
	defer gw.Close()
	handler := NewHandler(gw, authService)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected protected config status %d, got %d", http.StatusUnauthorized, rec.Code)
	}

	token := loginForToken(t, handler, auth.DefaultAdminEmail, auth.DefaultAdminPassword)

	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected authenticated config status %d, got %d body %s", http.StatusOK, rec.Code, rec.Body.String())
	}

	body := `{"currentPassword":"admin","newPassword":"changed-password"}`
	req = httptest.NewRequest(http.MethodPost, "/api/auth/password", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected password change status %d, got %d body %s", http.StatusOK, rec.Code, rec.Body.String())
	}

	assertLoginStatus(t, handler, auth.DefaultAdminEmail, auth.DefaultAdminPassword, http.StatusUnauthorized)
	assertLoginStatus(t, handler, auth.DefaultAdminEmail, "changed-password", http.StatusOK)
}

func TestLoginRejectsInvalidCredentials(t *testing.T) {
	_, authService := newAuthTestStore(t)
	handler := NewHandler(nil, authService)

	assertLoginStatus(t, handler, auth.DefaultAdminEmail, "wrong", http.StatusUnauthorized)
}

func TestCallEndpointToolRequiresClientAPIKey(t *testing.T) {
	store, authService := newAuthTestStore(t)
	upstream := newTestMCPServer(t, "")
	gw := gateway.New(store)
	defer gw.Close()
	if err := gw.UpsertServer(t.Context(), config.Server{
		ID:        "github",
		Name:      "GitHub MCP",
		Transport: "http",
		URL:       upstream.URL,
		Enabled:   true,
		Weight:    1,
	}); err != nil {
		t.Fatalf("upsert server: %v", err)
	}
	if err := gw.UpsertEndpoint(config.Endpoint{
		ID:        "123",
		Name:      "Client Endpoint",
		ServerIDs: []string{"github"},
		Enabled:   true,
	}); err != nil {
		t.Fatalf("upsert endpoint: %v", err)
	}
	if err := gw.UpsertAPIKey(config.APIKey{
		ID:          "client",
		Name:        "Client",
		Value:       "sk_test_client_key",
		EndpointIDs: []string{"123"},
		Enabled:     true,
	}); err != nil {
		t.Fatalf("upsert api key: %v", err)
	}

	handler := NewHandler(gw, authService)
	token := loginForToken(t, handler, auth.DefaultAdminEmail, auth.DefaultAdminPassword)

	req := httptest.NewRequest(http.MethodPost, "/api/endpoints/123/tools/github__alpha/call", strings.NewReader(`{"arguments":{}}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected jwt rejected on client route, got %d body %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/api/endpoints/123/tools/github__alpha/call", strings.NewReader(`{"arguments":{}}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", "sk_test_client_key")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected api key auth status %d, got %d body %s", http.StatusOK, rec.Code, rec.Body.String())
	}

	if err := gw.UpsertEndpoint(config.Endpoint{
		ID:        "456",
		Name:      "Other Endpoint",
		ServerIDs: []string{"github"},
		Enabled:   true,
	}); err != nil {
		t.Fatalf("upsert other endpoint: %v", err)
	}
	if err := gw.UpsertAPIKey(config.APIKey{
		ID:          "other",
		Name:        "Other",
		Value:       "sk_other_endpoint",
		EndpointIDs: []string{"456"},
		Enabled:     true,
	}); err != nil {
		t.Fatalf("upsert other api key: %v", err)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/endpoints/123/tools/github__alpha/call", strings.NewReader(`{"arguments":{}}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", "sk_other_endpoint")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected forbidden for wrong endpoint mapping, got %d body %s", rec.Code, rec.Body.String())
	}
}

func TestEndpointToolCallsCreateAuditLogs(t *testing.T) {
	store, authService := newAuthTestStore(t)
	upstream := newTestMCPServer(t, "")
	gw := gateway.New(store)
	defer gw.Close()
	if err := gw.UpsertServer(t.Context(), config.Server{
		ID:        "test",
		Name:      "Test MCP",
		Transport: "http",
		URL:       upstream.URL,
		Enabled:   true,
		Weight:    1,
	}); err != nil {
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
	if err := gw.UpsertAPIKey(config.APIKey{
		ID:          "audit-client",
		Name:        "Audit Client",
		Value:       "sk_audit_client",
		EndpointIDs: []string{"dev"},
		Enabled:     true,
	}); err != nil {
		t.Fatalf("upsert api key: %v", err)
	}
	handler := NewHandler(gw, authService)
	token := loginForToken(t, handler, auth.DefaultAdminEmail, auth.DefaultAdminPassword)

	req := httptest.NewRequest(http.MethodPost, "/api/endpoints/dev/tools/test__alpha/call", strings.NewReader(`{"arguments":{}}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", "sk_audit_client")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected tool call status %d, got %d body %s", http.StatusOK, rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/api/audit-logs", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected unsupported method status %d, got %d", http.StatusNotFound, rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/audit-logs", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected audit log status %d, got %d body %s", http.StatusOK, rec.Code, rec.Body.String())
	}
	var payload struct {
		AuditLogs []gateway.AuditLog `json:"auditLogs"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode audit logs: %v", err)
	}
	if len(payload.AuditLogs) != 1 {
		t.Fatalf("expected one audit log, got %#v", payload.AuditLogs)
	}
	log := payload.AuditLogs[0]
	if log.Transport != "rest" || log.EndpointID != "dev" || log.ToolName != "test__alpha" || log.Status != http.StatusOK {
		t.Fatalf("unexpected audit log: %#v", log)
	}
	if log.Caller != "apikey:Audit Client" {
		t.Fatalf("expected api key caller, got %q", log.Caller)
	}
	if !strings.Contains(log.RawCall, `"name": "alpha"`) {
		t.Fatalf("expected raw upstream MCP call in audit log, got %q", log.RawCall)
	}
}

func TestMCPToolCallFailureCreatesAuditLog(t *testing.T) {
	store, authService := newAuthTestStore(t)
	upstream := newTestMCPServer(t, "upstream exploded")
	gw := gateway.New(store)
	defer gw.Close()
	if err := gw.UpsertServer(t.Context(), config.Server{
		ID:        "test",
		Name:      "Test MCP",
		Transport: "http",
		URL:       upstream.URL,
		Enabled:   true,
		Weight:    1,
	}); err != nil {
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
	handler := NewHandler(gw, authService)

	req := httptest.NewRequest(http.MethodPost, "/mcp/dev", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test__alpha","arguments":{}}}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected mcp status %d, got %d body %s", http.StatusOK, rec.Code, rec.Body.String())
	}

	token := loginForToken(t, handler, auth.DefaultAdminEmail, auth.DefaultAdminPassword)
	req = httptest.NewRequest(http.MethodGet, "/api/audit-logs", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected audit log status %d, got %d body %s", http.StatusOK, rec.Code, rec.Body.String())
	}
	var payload struct {
		AuditLogs []gateway.AuditLog `json:"auditLogs"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode audit logs: %v", err)
	}
	if len(payload.AuditLogs) != 1 {
		t.Fatalf("expected one audit log, got %#v", payload.AuditLogs)
	}
	log := payload.AuditLogs[0]
	if log.Transport != "mcp" || log.EndpointID != "dev" || log.ToolName != "test__alpha" || log.Status != http.StatusBadGateway {
		t.Fatalf("unexpected audit log: %#v", log)
	}
	if !strings.Contains(log.Error, "upstream exploded") {
		t.Fatalf("expected upstream error in audit log, got %#v", log)
	}
	if !strings.Contains(log.RawCall, `"name": "alpha"`) {
		t.Fatalf("expected raw upstream MCP call in audit log, got %q", log.RawCall)
	}
}

func TestOpenAPISpecDocumentsCompatibilityRoutes(t *testing.T) {
	spec, err := os.ReadFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatalf("read OpenAPI spec: %v", err)
	}

	for _, want := range []string{
		"/api/tools/{name}/call:",
		"/api/audit-logs:",
		"/mcp/{endpointId}:",
		"APIKeyStatus:",
		"AuditLogsResponse:",
		"hasValue:",
	} {
		if !strings.Contains(string(spec), want) {
			t.Fatalf("expected OpenAPI spec to include %q", want)
		}
	}
}

func TestEmbeddedOpenAPISpecMatchesSource(t *testing.T) {
	spec, err := os.ReadFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatalf("read OpenAPI spec: %v", err)
	}
	if !bytes.Equal(openapi.Spec, spec) {
		t.Fatal("embedded OpenAPI spec does not match api/openapi.yaml")
	}
}

func TestScalarDocsRoutes(t *testing.T) {
	handler := NewHandler(nil)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/openapi.yaml", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected OpenAPI spec status %d, got %d", http.StatusOK, rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); !strings.Contains(got, "application/yaml") {
		t.Fatalf("expected yaml content type, got %q", got)
	}
	if !strings.Contains(rec.Body.String(), "title: MCP Gateway API") {
		t.Fatalf("expected OpenAPI spec response, got %q", rec.Body.String())
	}

	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/docs", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected docs status %d, got %d", http.StatusOK, rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{"@scalar/api-reference", `data-url="/openapi.yaml"`} {
		if !strings.Contains(body, want) {
			t.Fatalf("expected docs page to include %q", want)
		}
	}
}

func newTestMCPServer(t *testing.T, callError string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		var req struct {
			ID     any             `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode upstream request: %v", err)
		}
		switch req.Method {
		case "initialize":
			writeTestRPCResult(w, req.ID, map[string]any{
				"protocolVersion": "2024-11-05",
				"capabilities":    map[string]any{"tools": map[string]any{}},
				"serverInfo":      map[string]any{"name": "test", "version": "0.1.0"},
			})
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/list":
			writeTestRPCResult(w, req.ID, map[string]any{
				"tools": []map[string]any{{"name": "alpha", "description": "Alpha tool"}},
			})
		case "tools/call":
			if callError != "" {
				writeTestRPCError(w, req.ID, -32000, callError)
				return
			}
			writeTestRPCResult(w, req.ID, map[string]any{
				"content": []map[string]any{{"type": "text", "text": "ok"}},
			})
		default:
			writeTestRPCError(w, req.ID, -32601, "method not found")
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func writeTestRPCResult(w http.ResponseWriter, id any, result any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"result":  result,
	})
}

func writeTestRPCError(w http.ResponseWriter, id any, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"error": map[string]any{
			"code":    code,
			"message": message,
		},
	})
}

func newAuthTestStore(t *testing.T) (*config.Store, *auth.Service) {
	t.Helper()
	store, err := config.LoadStore(filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatalf("open test store: %v", err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Fatalf("close test store: %v", err)
		}
	})

	authService, err := auth.NewService(store, auth.Config{
		AdminEmail:    auth.DefaultAdminEmail,
		AdminPassword: auth.DefaultAdminPassword,
		JWTSecret:     "test-secret",
	})
	if err != nil {
		t.Fatalf("create auth service: %v", err)
	}
	return store, authService
}

func loginForToken(t *testing.T, handler http.Handler, email string, password string) string {
	t.Helper()
	rec := httptest.NewRecorder()
	body := `{"email":"` + email + `","password":"` + password + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected login status %d, got %d body %s", http.StatusOK, rec.Code, rec.Body.String())
	}
	var payload struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode login response: %v", err)
	}
	if payload.Token == "" {
		t.Fatal("expected login token")
	}
	return payload.Token
}

func assertLoginStatus(t *testing.T, handler http.Handler, email string, password string, want int) {
	t.Helper()
	rec := httptest.NewRecorder()
	body := `{"email":"` + email + `","password":"` + password + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(rec, req)
	if rec.Code != want {
		t.Fatalf("expected login status %d, got %d body %s", want, rec.Code, rec.Body.String())
	}
}
