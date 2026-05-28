package web

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
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

func TestOpenAPISpecDocumentsCompatibilityRoutes(t *testing.T) {
	spec, err := os.ReadFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatalf("read OpenAPI spec: %v", err)
	}

	for _, want := range []string{
		"/api/tools/{name}/call:",
		"/mcp/{endpointId}:",
		"APIKeyStatus:",
		"hasValue:",
	} {
		if !strings.Contains(string(spec), want) {
			t.Fatalf("expected OpenAPI spec to include %q", want)
		}
	}
}
