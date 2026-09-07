package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/rajdas/mcp-gateway/internal/config"
)

const mcpSessionHeader = "Mcp-Session-Id"
const mcpProtocolVersionHeader = "MCP-Protocol-Version"

var errSessionExpired = errors.New("mcp session expired")

// envPlaceholderPattern matches the documented ${ENV_VAR} interpolation
// syntax only. Bare '$' bytes (e.g. inside API keys like "pat.$abc") must be
// left untouched, unlike os.ExpandEnv which also expands bare $VAR forms.
var envPlaceholderPattern = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}`)

// expandEnvPlaceholders replaces ${ENV_VAR} placeholders with the named
// environment variable's value, leaving any other '$' characters unchanged.
func expandEnvPlaceholders(value string) string {
	if !strings.Contains(value, "${") {
		return value
	}
	return envPlaceholderPattern.ReplaceAllStringFunc(value, func(match string) string {
		name := match[2 : len(match)-1]
		return os.Getenv(name)
	})
}

type HTTPClient struct {
	id      string
	url     string
	auth    config.AuthConfig
	headers map[string]string
	client  *http.Client
	seq     atomic.Int64

	sessionMu sync.RWMutex
	sessionID string

	statusMu sync.RWMutex
	status   Status
}

func NewHTTPClient(id, url string, auth config.AuthConfig, headers map[string]string) *HTTPClient {
	return &HTTPClient{
		id:      id,
		url:     url,
		auth:    auth,
		headers: cloneEnv(headers),
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *HTTPClient) Start(ctx context.Context) error {
	if err := c.initialize(ctx); err != nil {
		c.setError(err)
		return err
	}
	c.setRunning(true)
	return nil
}

func (c *HTTPClient) Stop() {
	sessionID := c.getSessionID()
	if sessionID != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		c.terminateSession(ctx)
		cancel()
	}
	c.clearSessionID()
	c.setRunning(false)
}

func (c *HTTPClient) Status() Status {
	c.statusMu.RLock()
	defer c.statusMu.RUnlock()
	return c.status
}

func (c *HTTPClient) ListTools(ctx context.Context) ([]Tool, error) {
	return listAllTools(func(cursor string) (json.RawMessage, error) {
		params := map[string]any{}
		if cursor != "" {
			params["cursor"] = cursor
		}
		return c.call(ctx, "tools/list", params)
	})
}

func (c *HTTPClient) CallTool(ctx context.Context, name string, args map[string]any) (CallResult, error) {
	result, err := c.call(ctx, "tools/call", map[string]any{
		"name":      name,
		"arguments": args,
	})
	if err != nil {
		return CallResult{}, err
	}

	var payload CallResult
	if err := json.Unmarshal(result, &payload); err != nil {
		return CallResult{}, err
	}
	return payload, nil
}

func (c *HTTPClient) initialize(ctx context.Context) error {
	c.clearSessionID()

	initParams := map[string]any{
		"protocolVersion": protocolVersion,
		"capabilities":    map[string]any{},
		"clientInfo": map[string]any{
			"name":    "mcp-gateway",
			"version": "0.1.0",
		},
	}
	res, err := c.doRPC(ctx, "initialize", initParams, postOpts{includeSession: false})
	if err != nil {
		return err
	}
	if res.Error != nil {
		err := errors.New(res.Error.Message)
		c.setError(err)
		return err
	}
	return c.notify(ctx, "notifications/initialized", map[string]any{})
}

func (c *HTTPClient) call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	res, err := c.doRPC(ctx, method, params, postOpts{includeSession: true})
	if err != nil {
		return nil, err
	}
	if res.Error != nil {
		err := errors.New(res.Error.Message)
		c.setError(err)
		return nil, err
	}
	return res.Result, nil
}

func (c *HTTPClient) doRPC(ctx context.Context, method string, params any, opts postOpts) (response, error) {
	id := c.seq.Add(1)
	payload := request{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	}

	res, err := c.post(ctx, payload, id, opts)
	if errors.Is(err, errSessionExpired) {
		if initErr := c.initialize(ctx); initErr != nil {
			c.setError(initErr)
			return response{}, initErr
		}
		res, err = c.post(ctx, payload, id, postOpts{includeSession: true})
	}
	if err != nil {
		c.setError(err)
		return response{}, err
	}
	return res, nil
}

func (c *HTTPClient) notify(ctx context.Context, method string, params any) error {
	_, err := c.post(ctx, map[string]any{
		"jsonrpc": "2.0",
		"method":  method,
		"params":  params,
	}, 0, postOpts{includeSession: true})
	return err
}

type postOpts struct {
	includeSession bool
}

func (c *HTTPClient) post(ctx context.Context, payload any, wantID int64, opts postOpts) (response, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return response{}, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return response{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set(mcpProtocolVersionHeader, protocolVersion)
	if opts.includeSession {
		if sessionID := c.getSessionID(); sessionID != "" {
			req.Header.Set(mcpSessionHeader, sessionID)
		}
	}
	if err := c.applyAuth(req); err != nil {
		return response{}, err
	}
	for key, value := range c.headers {
		req.Header.Set(key, expandEnvPlaceholders(value))
	}

	res, err := c.client.Do(req)
	if err != nil {
		return response{}, err
	}
	defer res.Body.Close()

	c.captureSessionID(res.Header.Get(mcpSessionHeader))

	if res.StatusCode == http.StatusAccepted || res.StatusCode == http.StatusNoContent {
		return response{}, nil
	}
	if res.StatusCode == http.StatusNotFound && opts.includeSession && c.getSessionID() != "" {
		c.clearSessionID()
		return response{}, errSessionExpired
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		return response{}, httpStatusError(res.StatusCode, res.Status, strings.TrimSpace(string(data)))
	}

	if strings.Contains(res.Header.Get("Content-Type"), "text/event-stream") {
		return parseSSEResponseStream(res.Body, wantID)
	}

	data, err := io.ReadAll(res.Body)
	if err != nil {
		return response{}, err
	}
	data = bytes.TrimSpace(data)
	if len(data) == 0 {
		return response{}, nil
	}

	var rpc response
	if err := json.Unmarshal(data, &rpc); err != nil {
		return response{}, err
	}
	return rpc, nil
}

func (c *HTTPClient) terminateSession(ctx context.Context) {
	sessionID := c.getSessionID()
	if sessionID == "" {
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.url, nil)
	if err != nil {
		return
	}
	req.Header.Set(mcpSessionHeader, sessionID)
	req.Header.Set(mcpProtocolVersionHeader, protocolVersion)
	if err := c.applyAuth(req); err != nil {
		return
	}
	for key, value := range c.headers {
		req.Header.Set(key, expandEnvPlaceholders(value))
	}

	res, err := c.client.Do(req)
	if err != nil {
		return
	}
	io.Copy(io.Discard, res.Body)
	res.Body.Close()
}

func (c *HTTPClient) getSessionID() string {
	c.sessionMu.RLock()
	defer c.sessionMu.RUnlock()
	return c.sessionID
}

func (c *HTTPClient) captureSessionID(sessionID string) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}
	c.sessionMu.Lock()
	c.sessionID = sessionID
	c.sessionMu.Unlock()
}

func (c *HTTPClient) clearSessionID() {
	c.sessionMu.Lock()
	c.sessionID = ""
	c.sessionMu.Unlock()
}

func httpStatusError(statusCode int, statusLine, body string) error {
	message := body
	if message == "" {
		message = statusLine
	}
	switch statusCode {
	case http.StatusUnauthorized:
		return fmt.Errorf("http upstream unauthorized (401): %s", message)
	case http.StatusForbidden:
		return fmt.Errorf("http upstream forbidden (403): %s", message)
	case http.StatusNotFound:
		return fmt.Errorf("http upstream not found (404): %s", message)
	default:
		return fmt.Errorf("http upstream returned %s: %s", statusLine, message)
	}
}

func (c *HTTPClient) applyAuth(req *http.Request) error {
	switch c.auth.Type {
	case "", "none":
		return nil
	case "apiKey":
		name := strings.TrimSpace(c.auth.APIKeyName)
		value := expandEnvPlaceholders(strings.TrimSpace(c.auth.APIKeyValue))
		if name == "" || value == "" {
			return errors.New("api key auth requires name and value")
		}
		if c.auth.APIKeyIn == "query" {
			query := req.URL.Query()
			query.Set(name, value)
			req.URL.RawQuery = query.Encode()
			return nil
		}
		req.Header.Set(name, value)
	case "bearer", "jwtBearer":
		token := expandEnvPlaceholders(strings.TrimSpace(c.auth.Token))
		if token == "" {
			return errors.New("bearer auth requires token")
		}
		req.Header.Set("Authorization", "Bearer "+token)
	case "basic":
		username := expandEnvPlaceholders(strings.TrimSpace(c.auth.Username))
		password := expandEnvPlaceholders(c.auth.Password)
		if username == "" {
			return errors.New("basic auth requires username")
		}
		req.SetBasicAuth(username, password)
	default:
		return fmt.Errorf("unsupported auth type %q", c.auth.Type)
	}
	return nil
}

func (c *HTTPClient) setRunning(running bool) {
	c.statusMu.Lock()
	defer c.statusMu.Unlock()
	c.status.Running = running
	if running {
		c.status.Error = ""
	}
}

func (c *HTTPClient) setError(err error) {
	c.statusMu.Lock()
	defer c.statusMu.Unlock()
	c.status.Error = err.Error()
}
