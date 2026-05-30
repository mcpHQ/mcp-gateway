package web

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rajdas/mcp-gateway/internal/auth"
	"github.com/rajdas/mcp-gateway/internal/config"
	"github.com/rajdas/mcp-gateway/internal/gateway"
)

//go:embed static/*
var staticFS embed.FS

type handler struct {
	gw   *gateway.Gateway
	auth *auth.Service
}

type apiError = ErrorResponse

type authContextKey struct{}

type apiKeyContextKey struct{}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

type authUserResponse struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	CreatedAt string `json:"createdAt,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

type authSessionResponse struct {
	Token string           `json:"token"`
	User  authUserResponse `json:"user"`
}

type meResponse struct {
	User authUserResponse `json:"user"`
}

func NewHandler(gw *gateway.Gateway, authServices ...*auth.Service) http.Handler {
	var authService *auth.Service
	if len(authServices) > 0 {
		authService = authServices[0]
	}
	h := &handler{gw: gw, auth: authService}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", h.health)
	mux.HandleFunc("POST /api/auth/login", h.login)
	mux.HandleFunc("GET /api/auth/me", h.me)
	mux.HandleFunc("POST /api/auth/password", h.changePassword)
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
	mux.HandleFunc("GET /api/audit-logs", h.auditLogs)
	mux.HandleFunc("POST /mcp/{endpointId}", h.mcpEndpoint)
	mux.HandleFunc("POST /mcp", h.mcp)

	files, _ := fs.Sub(staticFS, "static")
	mux.Handle("/", withStaticCache(http.FileServer(http.FS(files))))
	return withCORS(withLogging(h.withAuth(mux)))
}

func (h *handler) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func userResponseFromConfig(user config.User) authUserResponse {
	return authUserResponse{
		ID:        user.ID,
		Email:     user.Email,
		CreatedAt: user.CreatedAt,
		UpdatedAt: user.UpdatedAt,
	}
}

func (h *handler) config(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, ConfigResponse{Path: h.gw.ConfigPath()})
}

func (h *handler) login(w http.ResponseWriter, r *http.Request) {
	if h.auth == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("auth is not configured"))
		return
	}

	var body loginRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	session, err := h.auth.Login(body.Email, body.Password)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	writeJSON(w, http.StatusOK, authSessionResponse{
		Token: session.Token,
		User:  userResponseFromConfig(session.User),
	})
}

func (h *handler) me(w http.ResponseWriter, r *http.Request) {
	if h.auth == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("auth is not configured"))
		return
	}
	user, err := h.userFromRequest(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	writeJSON(w, http.StatusOK, meResponse{User: userResponseFromConfig(user)})
}

func (h *handler) changePassword(w http.ResponseWriter, r *http.Request) {
	if h.auth == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("auth is not configured"))
		return
	}
	user, err := h.userFromRequest(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}

	var body changePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := h.auth.ChangePassword(user.Email, body.CurrentPassword, body.NewPassword); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
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
	endpointID := r.PathValue("id")
	r, err := h.requireClientAPIKey(w, r, endpointID)
	if err != nil {
		return
	}

	tools, err := h.gw.EndpointTools(r.Context(), endpointID)
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

func (h *handler) auditLogs(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, errors.New("limit must be a positive integer"))
			return
		}
		limit = parsed
	}

	logs, err := h.gw.AuditLogs(limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"auditLogs": logs})
}

func (h *handler) callEndpointTool(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	endpointID := r.PathValue("id")
	toolName := r.PathValue("name")
	var err error
	r, err = h.requireClientAPIKey(w, r, endpointID)
	if err != nil {
		return
	}
	var body CallToolRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		duration := time.Since(start)
		annotateToolCallAccessLog(r, "rest", endpointID, toolName, err)
		h.recordAuditLog(r, "rest", endpointID, toolName, http.StatusBadRequest, duration, err)
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
		duration := time.Since(start)
		annotateToolCallAccessLog(r, "rest", endpointID, toolName, err)
		h.recordAuditLog(r, "rest", endpointID, toolName, status, duration, err)
		writeError(w, status, err)
		return
	}
	duration := time.Since(start)
	annotateToolCallAccessLog(r, "rest", endpointID, toolName, nil)
	h.recordAuditLog(r, "rest", endpointID, toolName, http.StatusOK, duration, nil)
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
			h.recordAuditLog(r, "mcp", endpointID, "", http.StatusBadRequest, time.Since(start), errors.New("tool calls must use an endpoint route: /mcp/{endpointId}"))
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
			duration := time.Since(start)
			status := statusForToolCallError(err)
			annotateToolCallAccessLog(r, "mcp", endpointID, params.Name, err)
			h.recordAuditLog(r, "mcp", endpointID, params.Name, status, duration, err)
			writeJSON(w, http.StatusOK, rpcError(req.ID, -32000, err.Error()))
			return
		}
		duration := time.Since(start)
		annotateToolCallAccessLog(r, "mcp", endpointID, params.Name, nil)
		h.recordAuditLog(r, "mcp", endpointID, params.Name, http.StatusOK, duration, nil)
		writeJSON(w, http.StatusOK, rpcResult(req.ID, result))
	default:
		writeJSON(w, http.StatusOK, rpcError(req.ID, -32601, "method not found"))
	}
}

func (h *handler) recordAuditLog(r *http.Request, transport, endpointID, toolName string, status int, duration time.Duration, err error) {
	if h.gw == nil {
		return
	}
	message := ""
	if err != nil {
		message = err.Error()
	}
	record := config.AuditLogRecord{
		ID:         newAuditLogID(),
		Timestamp:  time.Now().UTC(),
		Transport:  transport,
		EndpointID: endpointID,
		ToolName:   toolName,
		Status:     status,
		DurationMS: duration.Milliseconds(),
		Caller:     callerForRequest(r),
		Error:      message,
	}
	if auditErr := h.gw.RecordAuditLog(record); auditErr != nil {
		log.Printf("audit_log_enqueue_failed transport=%s endpoint=%s tool=%s error=%q", transport, endpointID, toolName, auditErr.Error())
	}
}

func newAuditLogID() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "audit_" + strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return "audit_" + hex.EncodeToString(bytes[:])
}

func callerForRequest(r *http.Request) string {
	if key, ok := r.Context().Value(apiKeyContextKey{}).(config.APIKey); ok && key.ID != "" {
		if key.Name != "" {
			return "apikey:" + key.Name
		}
		return "apikey:" + key.ID
	}
	if user, ok := r.Context().Value(authContextKey{}).(config.User); ok && user.Email != "" {
		return user.Email
	}
	if r.RemoteAddr != "" {
		return r.RemoteAddr
	}
	return "unknown"
}

func isEndpointClientRoute(r *http.Request) bool {
	if r.Method == http.MethodOptions {
		return false
	}
	path := r.URL.Path
	if !strings.HasPrefix(path, "/api/endpoints/") {
		return false
	}
	if r.Method == http.MethodGet && strings.HasSuffix(path, "/tools") {
		return true
	}
	return r.Method == http.MethodPost && strings.Contains(path, "/tools/") && strings.HasSuffix(path, "/call")
}

func clientAPIKeyFromRequest(r *http.Request) string {
	return strings.TrimSpace(r.Header.Get("X-API-Key"))
}

func (h *handler) requireClientAPIKey(w http.ResponseWriter, r *http.Request, endpointID string) (*http.Request, error) {
	key, err := h.gw.AuthorizeEndpointAPIKey(endpointID, clientAPIKeyFromRequest(r))
	if err != nil {
		status := http.StatusUnauthorized
		if err.Error() == "api key not authorized for endpoint" {
			status = http.StatusForbidden
		}
		writeError(w, status, err)
		return r, err
	}
	return r.WithContext(context.WithValue(r.Context(), apiKeyContextKey{}, key)), nil
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

func (h *handler) withAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h.auth == nil || !requiresAuth(r) {
			next.ServeHTTP(w, r)
			return
		}

		user, err := h.auth.UserFromToken(auth.BearerToken(r.Header.Get("Authorization")))
		if err != nil {
			writeError(w, http.StatusUnauthorized, errors.New("unauthorized"))
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), authContextKey{}, user)))
	})
}

func requiresAuth(r *http.Request) bool {
	if isEndpointClientRoute(r) {
		return false
	}
	if r.Method == http.MethodOptions {
		return false
	}
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		return false
	}
	return r.URL.Path != "/api/auth/login"
}

func (h *handler) userFromRequest(r *http.Request) (config.User, error) {
	if user, ok := r.Context().Value(authContextKey{}).(config.User); ok {
		return user, nil
	}
	return h.auth.UserFromToken(auth.BearerToken(r.Header.Get("Authorization")))
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-API-Key")
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

type accessLogContextKey struct{}

type accessLogExtras struct {
	Transport     string
	EndpointID    string
	ToolName      string
	UpstreamError string
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") && !strings.HasPrefix(r.URL.Path, "/mcp") {
			next.ServeHTTP(w, r)
			return
		}

		start := time.Now()
		extras := &accessLogExtras{}
		r = r.WithContext(context.WithValue(r.Context(), accessLogContextKey{}, extras))
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		logAccess(r, recorder, time.Since(start), extras)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

func annotateToolCallAccessLog(r *http.Request, transport, endpointID, toolName string, err error) {
	extras, ok := r.Context().Value(accessLogContextKey{}).(*accessLogExtras)
	if !ok || extras == nil {
		return
	}
	extras.Transport = transport
	extras.EndpointID = endpointID
	extras.ToolName = toolName
	if err != nil {
		extras.UpstreamError = err.Error()
	}
}

func logAccess(r *http.Request, recorder *statusRecorder, duration time.Duration, extras *accessLogExtras) {
	caller := callerForRequest(r)
	if caller == r.RemoteAddr {
		caller = "-"
	}

	line := fmt.Sprintf(
		`%s - %s [%s] "%s %s %s" %d %d %.3f`,
		clientIP(r.RemoteAddr),
		caller,
		time.Now().Format("02/Jan/2006:15:04:05 -0700"),
		r.Method,
		r.URL.RequestURI(),
		r.Proto,
		recorder.status,
		recorder.bytes,
		duration.Seconds(),
	)

	if extras != nil && extras.Transport != "" {
		line += fmt.Sprintf(
			` transport=%s endpoint=%s tool=%s`,
			extras.Transport,
			extras.EndpointID,
			extras.ToolName,
		)
		if extras.UpstreamError != "" {
			line += fmt.Sprintf(` error=%q`, extras.UpstreamError)
		}
	}

	log.Print(line)
}

func clientIP(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr
	}
	return host
}
