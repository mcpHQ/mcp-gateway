package web

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/rajdas/mcp-gateway/internal/config"
	"github.com/rajdas/mcp-gateway/internal/gateway"
)

//go:embed static/*
var staticFS embed.FS

type handler struct {
	gw *gateway.Gateway
}

type apiError = ErrorResponse

func NewHandler(gw *gateway.Gateway) http.Handler {
	h := &handler{gw: gw}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", h.health)
	mux.HandleFunc("GET /api/config", h.config)
	mux.HandleFunc("GET /api/servers", h.servers)
	mux.HandleFunc("POST /api/servers", h.upsertServer)
	mux.HandleFunc("POST /api/servers/test", h.testServer)
	mux.HandleFunc("DELETE /api/servers/{id}", h.deleteServer)
	mux.HandleFunc("POST /api/servers/{id}/enable", h.enableServer)
	mux.HandleFunc("POST /api/servers/{id}/disable", h.disableServer)
	mux.HandleFunc("POST /api/servers/{id}/restart", h.restartServer)
	mux.HandleFunc("POST /api/servers/{id}/test", h.testStoredServer)
	mux.HandleFunc("POST /api/servers/{id}/tools/refresh", h.refreshServerTools)
	mux.HandleFunc("GET /api/endpoints", h.endpoints)
	mux.HandleFunc("POST /api/endpoints", h.upsertEndpoint)
	mux.HandleFunc("DELETE /api/endpoints/{id}", h.deleteEndpoint)
	mux.HandleFunc("POST /api/endpoints/{id}/enable", h.enableEndpoint)
	mux.HandleFunc("POST /api/endpoints/{id}/disable", h.disableEndpoint)
	mux.HandleFunc("GET /api/endpoints/{id}/tools", h.endpointTools)
	mux.HandleFunc("POST /api/endpoints/{id}/tools/{name}/call", h.callEndpointTool)
	mux.HandleFunc("GET /api/api-keys", h.apiKeys)
	mux.HandleFunc("POST /api/api-keys", h.upsertAPIKey)
	mux.HandleFunc("DELETE /api/api-keys/{id}", h.deleteAPIKey)
	mux.HandleFunc("GET /api/tools", h.tools)
	mux.HandleFunc("POST /api/tools/refresh", h.refreshTools)
	mux.HandleFunc("POST /api/tools/{name}/call", h.callTool)
	mux.HandleFunc("POST /mcp/{endpointId}", h.mcpEndpoint)
	mux.HandleFunc("POST /mcp", h.mcp)

	files, _ := fs.Sub(staticFS, "static")
	mux.Handle("/", withStaticCache(http.FileServer(http.FS(files))))
	return withCORS(withLogging(mux))
}

func (h *handler) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *handler) config(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, ConfigResponse{Path: h.gw.ConfigPath()})
}

func (h *handler) servers(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"servers": h.gw.Servers()})
}

func (h *handler) upsertServer(w http.ResponseWriter, r *http.Request) {
	var server config.Server
	if err := json.NewDecoder(r.Body).Decode(&server); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	if err := h.gw.UpsertServer(r.Context(), server); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"servers": h.gw.Servers()})
}

func (h *handler) testServer(w http.ResponseWriter, r *http.Request) {
	var server config.Server
	if err := json.NewDecoder(r.Body).Decode(&server); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	result, err := h.gw.TestServer(ctx, server)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"result": result,
			"error":  err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}

func (h *handler) testStoredServer(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	result, err := h.gw.TestStoredServer(ctx, r.PathValue("id"))
	if err != nil {
		writeJSON(w, statusForGatewayError(err), map[string]any{
			"result": result,
			"error":  err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}

func (h *handler) deleteServer(w http.ResponseWriter, r *http.Request) {
	if ok := h.gw.DeleteServer(r.PathValue("id")); !ok {
		writeError(w, http.StatusNotFound, errors.New("server not found"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"servers": h.gw.Servers()})
}

func (h *handler) enableServer(w http.ResponseWriter, r *http.Request) {
	if err := h.gw.SetServerEnabled(r.Context(), r.PathValue("id"), true); err != nil {
		writeError(w, statusForGatewayError(err), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"servers": h.gw.Servers()})
}

func (h *handler) disableServer(w http.ResponseWriter, r *http.Request) {
	if err := h.gw.SetServerEnabled(r.Context(), r.PathValue("id"), false); err != nil {
		writeError(w, statusForGatewayError(err), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"servers": h.gw.Servers()})
}

func (h *handler) restartServer(w http.ResponseWriter, r *http.Request) {
	if err := h.gw.RestartServer(r.Context(), r.PathValue("id")); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"servers": h.gw.Servers()})
}

func (h *handler) tools(w http.ResponseWriter, r *http.Request) {
	tools, err := h.gw.UpstreamTools(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tools": tools})
}

func (h *handler) refreshTools(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	tools, err := h.gw.RefreshTools(ctx)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"tools": tools,
			"error": err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tools": tools})
}

func (h *handler) refreshServerTools(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	tools, err := h.gw.RefreshServerTools(ctx, r.PathValue("id"))
	if err != nil {
		writeError(w, statusForGatewayError(err), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tools": tools})
}

func (h *handler) endpoints(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"endpoints": h.gw.Endpoints()})
}

func (h *handler) upsertEndpoint(w http.ResponseWriter, r *http.Request) {
	var endpoint config.Endpoint
	if err := json.NewDecoder(r.Body).Decode(&endpoint); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	if err := h.gw.UpsertEndpoint(endpoint); err != nil {
		writeError(w, statusForGatewayError(err), err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"endpoints": h.gw.Endpoints()})
}

func (h *handler) deleteEndpoint(w http.ResponseWriter, r *http.Request) {
	if ok := h.gw.DeleteEndpoint(r.PathValue("id")); !ok {
		writeError(w, http.StatusNotFound, errors.New("endpoint not found"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"endpoints": h.gw.Endpoints()})
}

func (h *handler) enableEndpoint(w http.ResponseWriter, r *http.Request) {
	if err := h.gw.SetEndpointEnabled(r.PathValue("id"), true); err != nil {
		writeError(w, statusForGatewayError(err), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"endpoints": h.gw.Endpoints()})
}

func (h *handler) disableEndpoint(w http.ResponseWriter, r *http.Request) {
	if err := h.gw.SetEndpointEnabled(r.PathValue("id"), false); err != nil {
		writeError(w, statusForGatewayError(err), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"endpoints": h.gw.Endpoints()})
}

func (h *handler) endpointTools(w http.ResponseWriter, r *http.Request) {
	tools, err := h.gw.EndpointTools(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, statusForGatewayError(err), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tools": tools})
}

func (h *handler) apiKeys(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"apiKeys": h.gw.APIKeys()})
}

func (h *handler) upsertAPIKey(w http.ResponseWriter, r *http.Request) {
	var key config.APIKey
	if err := json.NewDecoder(r.Body).Decode(&key); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	if err := h.gw.UpsertAPIKey(key); err != nil {
		writeError(w, statusForGatewayError(err), err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"apiKeys": h.gw.APIKeys()})
}

func (h *handler) deleteAPIKey(w http.ResponseWriter, r *http.Request) {
	if ok := h.gw.DeleteAPIKey(r.PathValue("id")); !ok {
		writeError(w, http.StatusNotFound, errors.New("api key not found"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apiKeys": h.gw.APIKeys()})
}

func (h *handler) callTool(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusGone, errors.New("tool calls must use an endpoint route: /api/endpoints/{id}/tools/{name}/call"))
}

func (h *handler) callEndpointTool(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	endpointID := r.PathValue("id")
	toolName := r.PathValue("name")
	var body CallToolRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		logToolCall("rest", endpointID, toolName, http.StatusBadRequest, time.Since(start), err)
		writeError(w, http.StatusBadRequest, err)
		return
	}
	arguments := map[string]any{}
	if body.Arguments != nil {
		arguments = *body.Arguments
	}

	result, err := h.gw.CallEndpointTool(r.Context(), endpointID, toolName, arguments)
	if err != nil {
		status := statusForToolCallError(err)
		logToolCall("rest", endpointID, toolName, status, time.Since(start), err)
		writeError(w, status, err)
		return
	}
	logToolCall("rest", endpointID, toolName, http.StatusOK, time.Since(start), nil)
	writeJSON(w, http.StatusOK, result)
}

func (h *handler) mcp(w http.ResponseWriter, r *http.Request) {
	h.mcpRPC(w, r, "")
}

func (h *handler) mcpEndpoint(w http.ResponseWriter, r *http.Request) {
	h.mcpRPC(w, r, r.PathValue("endpointId"))
}

func (h *handler) mcpRPC(w http.ResponseWriter, r *http.Request, endpointID string) {
	var req rpcRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, rpcError(req.ID, -32700, "parse error"))
		return
	}

	switch req.Method {
	case "initialize":
		writeJSON(w, http.StatusOK, rpcResult(req.ID, map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities": map[string]any{
				"tools": map[string]any{},
			},
			"serverInfo": map[string]any{
				"name":    "mcp-gateway",
				"version": "0.1.0",
			},
		}))
	case "notifications/initialized":
		w.WriteHeader(http.StatusAccepted)
	case "tools/list":
		var tools []gateway.Tool
		var err error
		if endpointID == "" {
			tools, err = h.gw.Tools(r.Context())
		} else {
			tools, err = h.gw.EndpointTools(r.Context(), endpointID)
		}
		if err != nil {
			writeJSON(w, http.StatusOK, rpcError(req.ID, -32000, err.Error()))
			return
		}
		writeJSON(w, http.StatusOK, rpcResult(req.ID, map[string]any{"tools": tools}))
	case "tools/call":
		start := time.Now()
		if endpointID == "" {
			writeJSON(w, http.StatusOK, rpcError(req.ID, -32000, "tool calls must use an endpoint route: /mcp/{endpointId}"))
			return
		}
		params := struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}{}
		if len(req.Params) > 0 {
			_ = json.Unmarshal(req.Params, &params)
		}
		result, err := h.gw.CallEndpointTool(r.Context(), endpointID, params.Name, params.Arguments)
		if err != nil {
			logToolCall("mcp", endpointID, params.Name, http.StatusOK, time.Since(start), err)
			writeJSON(w, http.StatusOK, rpcError(req.ID, -32000, err.Error()))
			return
		}
		logToolCall("mcp", endpointID, params.Name, http.StatusOK, time.Since(start), nil)
		writeJSON(w, http.StatusOK, rpcResult(req.ID, result))
	default:
		writeJSON(w, http.StatusOK, rpcError(req.ID, -32601, "method not found"))
	}
}

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

func rpcResult(id any, result any) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "result": result}
}

func rpcError(id any, code int, message string) map[string]any {
	return map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"error": map[string]any{
			"code":    code,
			"message": message,
		},
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, apiError{Error: err.Error()})
}

func statusForGatewayError(err error) int {
	if gateway.IsRateLimitError(err) {
		return http.StatusTooManyRequests
	}
	if err.Error() == "server not found" {
		return http.StatusNotFound
	}
	if err.Error() == "endpoint not found" {
		return http.StatusNotFound
	}
	if err.Error() == "api key not found" {
		return http.StatusNotFound
	}
	return http.StatusBadRequest
}

func statusForToolCallError(err error) int {
	if gateway.IsRateLimitError(err) {
		return http.StatusTooManyRequests
	}
	if err.Error() == "server not found" {
		return http.StatusNotFound
	}
	if err.Error() == "endpoint not found" {
		return http.StatusNotFound
	}
	return http.StatusBadGateway
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func withStaticCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else if r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html") {
			w.Header().Set("Cache-Control", "no-cache")
		}
		next.ServeHTTP(w, r)
	})
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") && !strings.HasPrefix(r.URL.Path, "/mcp") {
			next.ServeHTTP(w, r)
			return
		}

		start := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		log.Printf(
			"request method=%s path=%s status=%d duration=%s remote=%s",
			r.Method,
			r.URL.Path,
			recorder.status,
			time.Since(start).Round(time.Microsecond),
			r.RemoteAddr,
		)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func logToolCall(transport, endpointID, toolName string, status int, duration time.Duration, err error) {
	if err != nil {
		log.Printf(
			"tool_call transport=%s endpoint=%s tool=%s status=%d duration=%s error=%q",
			transport,
			endpointID,
			toolName,
			status,
			duration.Round(time.Microsecond),
			err.Error(),
		)
		return
	}
	log.Printf(
		"tool_call transport=%s endpoint=%s tool=%s status=%d duration=%s",
		transport,
		endpointID,
		toolName,
		status,
		duration.Round(time.Microsecond),
	)
}
