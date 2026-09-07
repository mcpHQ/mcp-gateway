package mcp

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/rajdas/mcp-gateway/internal/config"
)

func TestHTTPClientSessionHandling(t *testing.T) {
	t.Parallel()

	var sessionCounter atomic.Int64
	sessionCounter.Add(100)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodDelete:
			if got := r.Header.Get(mcpSessionHeader); got != "session-101" {
				t.Errorf("DELETE expected session-101, got %q", got)
			}
			w.WriteHeader(http.StatusNoContent)
			return
		case http.MethodPost:
		default:
			t.Fatalf("unexpected method %s", r.Method)
		}

		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		method, _ := req["method"].(string)
		id, _ := req["id"].(float64)

		switch method {
		case "initialize":
			if got := r.Header.Get(mcpSessionHeader); got != "" {
				t.Fatalf("initialize must not include session header, got %q", got)
			}
			next := sessionCounter.Add(1)
			w.Header().Set(mcpSessionHeader, "session-"+itoa(next))
			writeJSONRPC(w, int64(id), map[string]any{
				"protocolVersion": protocolVersion,
				"capabilities":    map[string]any{},
				"serverInfo":      map[string]any{"name": "test", "version": "1.0"},
			})
		case "notifications/initialized":
			if got := r.Header.Get(mcpSessionHeader); got != "session-101" {
				t.Fatalf("initialized expected session-101, got %q", got)
			}
			w.WriteHeader(http.StatusAccepted)
		case "tools/list":
			if got := r.Header.Get(mcpSessionHeader); got != "session-101" {
				t.Fatalf("tools/list expected session-101, got %q", got)
			}
			writeJSONRPC(w, int64(id), map[string]any{
				"tools": []map[string]any{
					{"name": "alpha", "description": "first tool"},
				},
			})
		default:
			t.Fatalf("unexpected method %q", method)
		}
	}))
	defer server.Close()

	client := NewHTTPClient("test", server.URL, config.AuthConfig{}, nil)
	if err := client.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}

	tools, err := client.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	if len(tools) != 1 || tools[0].Name != "alpha" {
		t.Fatalf("unexpected tools: %+v", tools)
	}

	client.Stop()
}

func TestHTTPClientSSEResponse(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		method, _ := req["method"].(string)
		id, _ := req["id"].(float64)

		switch method {
		case "initialize":
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			_, _ = io.WriteString(w, "event: message\n")
			_, _ = io.WriteString(w, `data: {"jsonrpc":"2.0","id":`+itoa(int64(id))+`,"result":{"protocolVersion":"`+protocolVersion+`","capabilities":{},"serverInfo":{"name":"test","version":"1"}}}`+"\n\n")
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/list":
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			_, _ = io.WriteString(w, ": heartbeat\n\n")
			_, _ = io.WriteString(w, "event: message\n")
			_, _ = io.WriteString(w, `data: {"jsonrpc":"2.0","id":`+itoa(int64(id))+`,"result":{"tools":[{"name":"sse_tool"}]}}`+"\n\n")
		}
	}))
	defer server.Close()

	client := NewHTTPClient("test", server.URL, config.AuthConfig{}, nil)
	if err := client.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}

	tools, err := client.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	if len(tools) != 1 || tools[0].Name != "sse_tool" {
		t.Fatalf("unexpected tools: %+v", tools)
	}
}

func TestHTTPClientSessionReinitializeOn404(t *testing.T) {
	t.Parallel()

	var initCount atomic.Int64
	var listCalls atomic.Int64

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		method, _ := req["method"].(string)
		id, _ := req["id"].(float64)
		session := r.Header.Get(mcpSessionHeader)

		switch method {
		case "initialize":
			if session != "" {
				t.Fatalf("initialize must not include session header, got %q", session)
			}
			n := initCount.Add(1)
			w.Header().Set(mcpSessionHeader, "session-"+itoa(n))
			writeJSONRPC(w, int64(id), map[string]any{
				"protocolVersion": protocolVersion,
				"capabilities":    map[string]any{},
				"serverInfo":      map[string]any{"name": "test", "version": "1"},
			})
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/list":
			call := listCalls.Add(1)
			if call == 1 {
				if session != "session-1" {
					t.Fatalf("first tools/list expected session-1, got %q", session)
				}
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if session != "session-2" {
				t.Fatalf("retried tools/list expected session-2, got %q", session)
			}
			writeJSONRPC(w, int64(id), map[string]any{
				"tools": []map[string]any{{"name": "after-reinit"}},
			})
		}
	}))
	defer server.Close()

	client := NewHTTPClient("test", server.URL, config.AuthConfig{}, nil)
	if err := client.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}

	tools, err := client.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	if len(tools) != 1 || tools[0].Name != "after-reinit" {
		t.Fatalf("unexpected tools: %+v", tools)
	}
	if listCalls.Load() != 2 {
		t.Fatalf("expected 2 tools/list calls, got %d", listCalls.Load())
	}
}

func TestParseSSEResponseMatchesID(t *testing.T) {
	t.Parallel()

	body := strings.Join([]string{
		"event: message",
		`data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}`,
		"",
		"event: message",
		`data: {"jsonrpc":"2.0","id":2,"result":{"tools":[]}}`,
		"",
	}, "\n")

	res, err := parseSSEResponse([]byte(body), 2)
	if err != nil {
		t.Fatalf("parseSSEResponse: %v", err)
	}
	if res.ID != 2 {
		t.Fatalf("expected id 2, got %d", res.ID)
	}
}

func TestHTTPClientInitializeFailsOnJSONRPCError(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		method, _ := req["method"].(string)
		id, _ := req["id"].(float64)

		if method != "initialize" {
			t.Fatalf("unexpected method %q after initialize should have failed", method)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"jsonrpc": "2.0",
			"id":      int64(id),
			"error":   map[string]any{"code": -32001, "message": "unsupported protocol version"},
		})
	}))
	defer server.Close()

	client := NewHTTPClient("test", server.URL, config.AuthConfig{}, nil)
	err := client.Start(context.Background())
	if err == nil {
		t.Fatal("expected Start to fail on JSON-RPC error from initialize")
	}
	if !strings.Contains(err.Error(), "unsupported protocol version") {
		t.Fatalf("unexpected error: %v", err)
	}
	if client.Status().Running {
		t.Fatal("client should not be running after initialize JSON-RPC error")
	}
}

func TestHTTPClientListToolsPaginates(t *testing.T) {
	t.Parallel()

	var listCalls atomic.Int64

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		method, _ := req["method"].(string)
		id, _ := req["id"].(float64)

		switch method {
		case "initialize":
			writeJSONRPC(w, int64(id), map[string]any{
				"protocolVersion": protocolVersion,
				"capabilities":    map[string]any{},
				"serverInfo":      map[string]any{"name": "test", "version": "1"},
			})
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/list":
			call := listCalls.Add(1)
			params, _ := req["params"].(map[string]any)
			cursor, _ := params["cursor"].(string)
			switch call {
			case 1:
				if cursor != "" {
					t.Fatalf("expected empty cursor on first page, got %q", cursor)
				}
				writeJSONRPC(w, int64(id), map[string]any{
					"tools":      []map[string]any{{"name": "alpha"}},
					"nextCursor": "page-2",
				})
			case 2:
				if cursor != "page-2" {
					t.Fatalf("expected cursor page-2, got %q", cursor)
				}
				writeJSONRPC(w, int64(id), map[string]any{
					"tools": []map[string]any{{"name": "beta"}},
				})
			default:
				t.Fatalf("unexpected tools/list call %d", call)
			}
		default:
			t.Fatalf("unexpected method %q", method)
		}
	}))
	defer server.Close()

	client := NewHTTPClient("test", server.URL, config.AuthConfig{}, nil)
	if err := client.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}

	tools, err := client.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	if len(tools) != 2 || tools[0].Name != "alpha" || tools[1].Name != "beta" {
		t.Fatalf("unexpected tools: %+v", tools)
	}
	if got := listCalls.Load(); got != 2 {
		t.Fatalf("expected 2 tools/list calls, got %d", got)
	}
}

func TestHTTPClientSendsProtocolVersionHeader(t *testing.T) {
	t.Parallel()

	var sawInitHeader, sawListHeader, sawDeleteHeader string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			sawDeleteHeader = r.Header.Get(mcpProtocolVersionHeader)
			w.WriteHeader(http.StatusNoContent)
			return
		}

		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		method, _ := req["method"].(string)
		id, _ := req["id"].(float64)

		switch method {
		case "initialize":
			sawInitHeader = r.Header.Get(mcpProtocolVersionHeader)
			w.Header().Set(mcpSessionHeader, "session-1")
			writeJSONRPC(w, int64(id), map[string]any{
				"protocolVersion": protocolVersion,
				"capabilities":    map[string]any{},
				"serverInfo":      map[string]any{"name": "test", "version": "1"},
			})
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/list":
			sawListHeader = r.Header.Get(mcpProtocolVersionHeader)
			writeJSONRPC(w, int64(id), map[string]any{"tools": []map[string]any{}})
		}
	}))
	defer server.Close()

	client := NewHTTPClient("test", server.URL, config.AuthConfig{}, nil)
	if err := client.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if _, err := client.ListTools(context.Background()); err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	client.Stop()

	if sawInitHeader != protocolVersion {
		t.Fatalf("initialize expected protocol header %q, got %q", protocolVersion, sawInitHeader)
	}
	if sawListHeader != protocolVersion {
		t.Fatalf("tools/list expected protocol header %q, got %q", protocolVersion, sawListHeader)
	}
	if sawDeleteHeader != protocolVersion {
		t.Fatalf("DELETE expected protocol header %q, got %q", protocolVersion, sawDeleteHeader)
	}
}

func TestApplyAuthDoesNotExpandBareDollarSign(t *testing.T) {
	t.Setenv("GITHUB_TOKEN", "expanded-token-value")

	client := NewHTTPClient("test", "http://example.invalid", config.AuthConfig{
		Type:        "apiKey",
		APIKeyName:  "Authorization",
		APIKeyValue: "pat.$abc",
	}, nil)

	req, err := http.NewRequest(http.MethodGet, "http://example.invalid", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if err := client.applyAuth(req); err != nil {
		t.Fatalf("applyAuth: %v", err)
	}
	if got := req.Header.Get("Authorization"); got != "pat.$abc" {
		t.Fatalf("expected literal api key value, got %q", got)
	}
}

func TestApplyAuthExpandsEnvVarPlaceholder(t *testing.T) {
	t.Setenv("GITHUB_TOKEN", "expanded-token-value")

	client := NewHTTPClient("test", "http://example.invalid", config.AuthConfig{
		Type:  "bearer",
		Token: "${GITHUB_TOKEN}",
	}, nil)

	req, err := http.NewRequest(http.MethodGet, "http://example.invalid", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if err := client.applyAuth(req); err != nil {
		t.Fatalf("applyAuth: %v", err)
	}
	if got := req.Header.Get("Authorization"); got != "Bearer expanded-token-value" {
		t.Fatalf("expected expanded bearer token, got %q", got)
	}
}

func writeJSONRPC(w http.ResponseWriter, id int64, result map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"result":  result,
	})
}

func itoa(v int64) string {
	return strconv.FormatInt(v, 10)
}
