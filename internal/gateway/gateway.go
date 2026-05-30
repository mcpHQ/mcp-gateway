package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/rajdas/mcp-gateway/internal/config"
	"github.com/rajdas/mcp-gateway/internal/mcp"
)

type Gateway struct {
	store *config.Store

	mu        sync.RWMutex
	clients   map[string]mcp.Upstream
	toolsMu   sync.RWMutex
	toolCache map[string][]Tool

	configMu       sync.RWMutex
	servers        map[string]config.Server
	endpoints      map[string]config.Endpoint
	apiKeys        map[string]config.APIKey
	apiKeysByValue map[string]config.APIKey

	usageMu            sync.Mutex
	usage              map[string]*usageCounter
	usageDirty         map[string]struct{}
	usageFlushStop     chan struct{}
	usageFlushDone     chan struct{}
	usageFlushStopOnce sync.Once

	auditLogQueue    chan auditLogWork
	auditLogDone     chan struct{}
	auditLogStopOnce sync.Once
}

type ServerStatus struct {
	config.Server
	Status mcp.Status    `json:"status"`
	Usage  UsageSnapshot `json:"usage"`
}

type EndpointStatus struct {
	config.Endpoint
	Usage UsageSnapshot `json:"usage"`
}

type APIKeyStatus struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	EndpointIDs []string `json:"endpointIds"`
	Enabled     bool     `json:"enabled"`
	HasValue    bool     `json:"hasValue"`
	CreatedAt   string   `json:"createdAt,omitempty"`
	UpdatedAt   string   `json:"updatedAt,omitempty"`
}

type AuditLog struct {
	ID         string `json:"id"`
	Timestamp  string `json:"timestamp"`
	Transport  string `json:"transport"`
	EndpointID string `json:"endpointId,omitempty"`
	ToolName   string `json:"toolName,omitempty"`
	Status     int    `json:"status"`
	DurationMS int64  `json:"durationMs"`
	Caller     string `json:"caller,omitempty"`
	Error      string `json:"error,omitempty"`
}

type Tool struct {
	Name        string          `json:"name"`
	ServerID    string          `json:"serverId"`
	ServerName  string          `json:"serverName"`
	NativeName  string          `json:"nativeName"`
	Description string          `json:"description,omitempty"`
	InputSchema json.RawMessage `json:"inputSchema,omitempty"`
	CreatedAt   string          `json:"createdAt,omitempty"`
	UpdatedAt   string          `json:"updatedAt,omitempty"`
}

type TestResult struct {
	OK        bool     `json:"ok"`
	Status    string   `json:"status"`
	ToolCount int      `json:"toolCount"`
	Tools     []string `json:"tools,omitempty"`
}

type UsageSnapshot struct {
	TotalCalls          int64  `json:"totalCalls"`
	SuccessfulCalls     int64  `json:"successfulCalls"`
	FailedCalls         int64  `json:"failedCalls"`
	RateLimitedCalls    int64  `json:"rateLimitedCalls"`
	CurrentWindowCalls  int    `json:"currentWindowCalls"`
	LimitPerMinute      int    `json:"limitPerMinute"`
	RemainingThisMinute int    `json:"remainingThisMinute"`
	WindowResetAt       string `json:"windowResetAt,omitempty"`
	LastCalledAt        string `json:"lastCalledAt,omitempty"`
	LastError           string `json:"lastError,omitempty"`
}

type RateLimitError struct {
	ServerID   string
	EndpointID string
	Limit      int
	ResetAt    time.Time
}

func (e *RateLimitError) Error() string {
	if e.EndpointID != "" {
		return fmt.Sprintf("endpoint %q exceeded rate limit of %d requests per minute", e.EndpointID, e.Limit)
	}
	return fmt.Sprintf("server %q exceeded rate limit of %d requests per minute", e.ServerID, e.Limit)
}

func IsRateLimitError(err error) bool {
	var limitErr *RateLimitError
	return errors.As(err, &limitErr)
}

type usageCounter struct {
	totalCalls       int64
	successfulCalls  int64
	failedCalls      int64
	rateLimitedCalls int64
	windowStart      time.Time
	windowCalls      int
	lastCalledAt     time.Time
	lastError        string
}

type auditLogWork struct {
	record config.AuditLogRecord
	flush  chan struct{}
}

const (
	toolListServers  = "gateway_list_servers"
	toolListTools    = "gateway_list_tools"
	toolSearchTools  = "gateway_search_tools"
	toolRefreshTools = "gateway_refresh_tools"
	toolInvoke       = "gateway_invoke"

	toolRefreshTimeout = 30 * time.Second
	toolRefreshWorkers = 4
	usageFlushInterval = 500 * time.Millisecond
	auditLogQueueSize  = 256
	auditLogAttempts   = 8
)

func New(store *config.Store) *Gateway {
	g := &Gateway{
		store:          store,
		clients:        map[string]mcp.Upstream{},
		toolCache:      map[string][]Tool{},
		servers:        map[string]config.Server{},
		endpoints:      map[string]config.Endpoint{},
		apiKeys:        map[string]config.APIKey{},
		apiKeysByValue: map[string]config.APIKey{},
		usage:          map[string]*usageCounter{},
		usageDirty:     map[string]struct{}{},
		usageFlushStop: make(chan struct{}),
		usageFlushDone: make(chan struct{}),
		auditLogQueue:  make(chan auditLogWork, auditLogQueueSize),
		auditLogDone:   make(chan struct{}),
	}
	g.loadConfigCache()
	g.loadPersistedTools()
	g.loadPersistedUsage()
	go g.flushUsageLoop()
	go g.writeAuditLogsLoop()
	return g
}

func (g *Gateway) Start(ctx context.Context) error {
	for _, server := range g.store.List() {
		if !server.Enabled {
			continue
		}
		if err := g.startServer(ctx, server); err != nil {
			// Keep the gateway available even if one upstream MCP server is down.
			continue
		}
		g.refreshServerToolsBestEffort(ctx, server)
	}
	return nil
}

func (g *Gateway) loadConfigCache() {
	servers := map[string]config.Server{}
	for _, server := range g.store.List() {
		servers[server.ID] = cloneServerConfig(server)
	}

	endpoints := map[string]config.Endpoint{}
	for _, endpoint := range g.store.ListEndpoints() {
		endpoints[endpoint.ID] = cloneEndpointConfig(endpoint)
	}

	apiKeys := map[string]config.APIKey{}
	apiKeysByValue := map[string]config.APIKey{}
	for _, key := range g.store.ListAPIKeys() {
		cloned := cloneAPIKeyConfig(key)
		apiKeys[key.ID] = cloned
		if key.Value != "" {
			apiKeysByValue[key.Value] = cloned
		}
	}

	g.configMu.Lock()
	defer g.configMu.Unlock()
	g.servers = servers
	g.endpoints = endpoints
	g.apiKeys = apiKeys
	g.apiKeysByValue = apiKeysByValue
}

func (g *Gateway) loadPersistedTools() {
	records, err := g.store.ListToolRecords()
	if err != nil {
		return
	}

	grouped := map[string][]Tool{}
	for _, record := range records {
		grouped[record.ServerID] = append(grouped[record.ServerID], Tool{
			Name:        record.Name,
			ServerID:    record.ServerID,
			ServerName:  record.ServerName,
			NativeName:  record.NativeName,
			Description: record.Description,
			InputSchema: cloneRawMessage(record.InputSchema),
			CreatedAt:   record.CreatedAt,
			UpdatedAt:   record.UpdatedAt,
		})
	}

	g.toolsMu.Lock()
	defer g.toolsMu.Unlock()
	for serverID, tools := range grouped {
		sort.Slice(tools, func(i, j int) bool {
			return tools[i].Name < tools[j].Name
		})
		g.toolCache[serverID] = cloneTools(tools)
	}
}

func (g *Gateway) loadPersistedUsage() {
	records, err := g.store.ListUsageRecords()
	if err != nil {
		return
	}

	g.usageMu.Lock()
	defer g.usageMu.Unlock()
	for _, record := range records {
		g.usage[record.Key] = &usageCounter{
			totalCalls:       record.TotalCalls,
			successfulCalls:  record.SuccessfulCalls,
			failedCalls:      record.FailedCalls,
			rateLimitedCalls: record.RateLimitedCalls,
			windowStart:      record.WindowStart,
			windowCalls:      record.WindowCalls,
			lastCalledAt:     record.LastCalledAt,
			lastError:        record.LastError,
		}
	}
}

func (g *Gateway) Close() {
	g.stopUsageFlusher()
	g.stopAuditLogWriter()

	g.mu.Lock()
	defer g.mu.Unlock()

	for _, client := range g.clients {
		client.Stop()
	}
	g.clients = map[string]mcp.Upstream{}

	g.toolsMu.Lock()
	defer g.toolsMu.Unlock()
	g.toolCache = map[string][]Tool{}

	g.configMu.Lock()
	defer g.configMu.Unlock()
	g.servers = map[string]config.Server{}
	g.endpoints = map[string]config.Endpoint{}
	g.apiKeys = map[string]config.APIKey{}
	g.apiKeysByValue = map[string]config.APIKey{}
}

func (g *Gateway) ConfigPath() string {
	return g.store.Path()
}

func (g *Gateway) Servers() []ServerStatus {
	servers := g.store.List()
	out := make([]ServerStatus, 0, len(servers))

	g.mu.RLock()
	defer g.mu.RUnlock()

	for _, server := range servers {
		item := ServerStatus{Server: sanitizeServer(server)}
		if client := g.clients[server.ID]; client != nil {
			item.Status = client.Status()
		}
		item.Usage = g.usageSnapshot(server)
		out = append(out, item)
	}
	return out
}

func (g *Gateway) Endpoints() []EndpointStatus {
	endpoints := g.store.ListEndpoints()
	out := make([]EndpointStatus, 0, len(endpoints))

	for _, endpoint := range endpoints {
		out = append(out, EndpointStatus{
			Endpoint: endpoint,
			Usage:    g.endpointUsageSnapshot(endpoint),
		})
	}
	return out
}

func (g *Gateway) APIKeys() []APIKeyStatus {
	keys := g.store.ListAPIKeys()
	out := make([]APIKeyStatus, 0, len(keys))
	for _, key := range keys {
		out = append(out, APIKeyStatus{
			ID:          key.ID,
			Name:        key.Name,
			EndpointIDs: key.EndpointIDs,
			Enabled:     key.Enabled,
			HasValue:    key.Value != "",
			CreatedAt:   key.CreatedAt,
			UpdatedAt:   key.UpdatedAt,
		})
	}
	return out
}

func (g *Gateway) AuditLogs(limit int) ([]AuditLog, error) {
	g.flushAuditLogs()

	records, err := g.store.ListAuditLogs(limit)
	if err != nil {
		return nil, err
	}
	out := make([]AuditLog, 0, len(records))
	for _, record := range records {
		out = append(out, auditLogFromRecord(record))
	}
	return out, nil
}

func (g *Gateway) RecordAuditLog(record config.AuditLogRecord) error {
	select {
	case g.auditLogQueue <- auditLogWork{record: record}:
		return nil
	default:
		return errors.New("audit log queue is full")
	}
}

func (g *Gateway) AuthorizeEndpointAPIKey(endpointID, value string) (config.APIKey, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return config.APIKey{}, errors.New("api key required")
	}

	key, ok := g.cachedAPIKeyByValue(value)
	if !ok || !key.Enabled {
		return config.APIKey{}, errors.New("invalid api key")
	}

	endpointID = strings.TrimSpace(endpointID)
	for _, allowed := range key.EndpointIDs {
		if allowed == endpointID {
			return key, nil
		}
	}
	return config.APIKey{}, errors.New("api key not authorized for endpoint")
}

func (g *Gateway) cachedServer(id string) (config.Server, bool) {
	g.configMu.RLock()
	defer g.configMu.RUnlock()
	server, ok := g.servers[strings.TrimSpace(id)]
	return cloneServerConfig(server), ok
}

func (g *Gateway) cacheServer(server config.Server) {
	server = cloneServerConfig(server)
	g.configMu.Lock()
	defer g.configMu.Unlock()
	g.servers[server.ID] = server
}

func (g *Gateway) removeCachedServer(id string) {
	g.configMu.Lock()
	defer g.configMu.Unlock()
	delete(g.servers, strings.TrimSpace(id))
}

func (g *Gateway) cachedEndpoint(id string) (config.Endpoint, bool) {
	g.configMu.RLock()
	defer g.configMu.RUnlock()
	endpoint, ok := g.endpoints[strings.TrimSpace(id)]
	return cloneEndpointConfig(endpoint), ok
}

func (g *Gateway) cacheEndpoint(endpoint config.Endpoint) {
	endpoint = cloneEndpointConfig(endpoint)
	g.configMu.Lock()
	defer g.configMu.Unlock()
	g.endpoints[endpoint.ID] = endpoint
}

func (g *Gateway) removeCachedEndpoint(id string) {
	g.configMu.Lock()
	defer g.configMu.Unlock()
	delete(g.endpoints, strings.TrimSpace(id))
}

func (g *Gateway) cachedAPIKey(id string) (config.APIKey, bool) {
	g.configMu.RLock()
	defer g.configMu.RUnlock()
	key, ok := g.apiKeys[strings.TrimSpace(id)]
	return cloneAPIKeyConfig(key), ok
}

func (g *Gateway) cachedAPIKeyByValue(value string) (config.APIKey, bool) {
	g.configMu.RLock()
	defer g.configMu.RUnlock()
	key, ok := g.apiKeysByValue[strings.TrimSpace(value)]
	return cloneAPIKeyConfig(key), ok
}

func (g *Gateway) cacheAPIKey(key config.APIKey) {
	key = cloneAPIKeyConfig(key)
	g.configMu.Lock()
	defer g.configMu.Unlock()
	if existing, ok := g.apiKeys[key.ID]; ok && existing.Value != key.Value {
		delete(g.apiKeysByValue, existing.Value)
	}
	g.apiKeys[key.ID] = key
	if key.Value != "" {
		g.apiKeysByValue[key.Value] = key
	}
}

func (g *Gateway) removeCachedAPIKey(id string) {
	g.configMu.Lock()
	defer g.configMu.Unlock()
	if existing, ok := g.apiKeys[strings.TrimSpace(id)]; ok {
		delete(g.apiKeysByValue, existing.Value)
	}
	delete(g.apiKeys, strings.TrimSpace(id))
}

func (g *Gateway) UpsertServer(ctx context.Context, server config.Server) error {
	if existing, ok := g.cachedServer(server.ID); ok {
		if isAuthEmpty(server.Auth) {
			server.Auth = existing.Auth
		}
		if len(server.Headers) == 0 {
			server.Headers = existing.Headers
		}
		if len(server.Env) == 0 {
			server.Env = existing.Env
		}
	}
	if err := g.store.Upsert(server); err != nil {
		return err
	}
	if stored, ok := g.store.Get(strings.TrimSpace(server.ID)); ok {
		server = stored
	}
	g.cacheServer(server)
	g.stopServer(server.ID)
	if server.Enabled {
		if err := g.startServer(ctx, server); err != nil {
			return err
		}
		g.refreshServerToolsBestEffort(ctx, server)
	}
	return nil
}

func (g *Gateway) DeleteServer(id string) bool {
	g.stopServer(id)
	g.deleteUsage(serverUsageKey(id))
	deleted := g.store.Delete(id)
	if deleted {
		g.removeCachedServer(id)
	}
	return deleted
}

func (g *Gateway) UpsertEndpoint(endpoint config.Endpoint) error {
	seen := map[string]bool{}
	for _, serverID := range endpoint.ServerIDs {
		serverID = strings.TrimSpace(serverID)
		if serverID == "" || seen[serverID] {
			continue
		}
		seen[serverID] = true
		if _, ok := g.cachedServer(serverID); !ok {
			return fmt.Errorf("server %q not found", serverID)
		}
	}
	if err := g.store.UpsertEndpoint(endpoint); err != nil {
		return err
	}
	if stored, ok := g.store.GetEndpoint(strings.TrimSpace(endpoint.ID)); ok {
		endpoint = stored
	}
	g.cacheEndpoint(endpoint)
	return nil
}

func (g *Gateway) UpsertAPIKey(key config.APIKey) error {
	if strings.TrimSpace(key.Value) == "" {
		if existing, ok := g.cachedAPIKey(strings.TrimSpace(key.ID)); ok {
			key.Value = existing.Value
		}
	}

	seen := map[string]bool{}
	for _, endpointID := range key.EndpointIDs {
		endpointID = strings.TrimSpace(endpointID)
		if endpointID == "" || seen[endpointID] {
			continue
		}
		seen[endpointID] = true
		if _, ok := g.cachedEndpoint(endpointID); !ok {
			return fmt.Errorf("endpoint %q not found", endpointID)
		}
	}
	if err := g.store.UpsertAPIKey(key); err != nil {
		return err
	}
	if stored, ok := g.store.GetAPIKey(strings.TrimSpace(key.ID)); ok {
		key = stored
	}
	g.cacheAPIKey(key)
	return nil
}

func (g *Gateway) DeleteEndpoint(id string) bool {
	g.deleteUsage(endpointUsageKey(id))
	deleted := g.store.DeleteEndpoint(id)
	if deleted {
		g.removeCachedEndpoint(id)
	}
	return deleted
}

func (g *Gateway) DeleteAPIKey(id string) bool {
	deleted := g.store.DeleteAPIKey(id)
	if deleted {
		g.removeCachedAPIKey(id)
	}
	return deleted
}

func (g *Gateway) SetEndpointEnabled(id string, enabled bool) error {
	endpoint, ok := g.cachedEndpoint(id)
	if !ok {
		return errors.New("endpoint not found")
	}
	if endpoint.Enabled == enabled {
		return nil
	}
	if ok, err := g.store.SetEndpointEnabled(id, enabled); err != nil {
		return err
	} else if !ok {
		return errors.New("endpoint not found")
	}
	endpoint.Enabled = enabled
	g.cacheEndpoint(endpoint)
	return nil
}

func (g *Gateway) SetServerEnabled(ctx context.Context, id string, enabled bool) error {
	server, ok := g.cachedServer(id)
	if !ok {
		return errors.New("server not found")
	}
	if server.Enabled == enabled {
		return nil
	}

	if ok, err := g.store.SetEnabled(id, enabled); err != nil {
		return err
	} else if !ok {
		return errors.New("server not found")
	}

	server.Enabled = enabled
	g.cacheServer(server)
	if !enabled {
		g.stopServer(id)
		return nil
	}
	if err := g.startServer(ctx, server); err != nil {
		return err
	}
	g.refreshServerToolsBestEffort(ctx, server)
	return nil
}

func (g *Gateway) RestartServer(ctx context.Context, id string) error {
	server, ok := g.cachedServer(id)
	if !ok {
		return errors.New("server not found")
	}
	if !server.Enabled {
		return errors.New("server is disabled")
	}

	g.stopServer(id)
	if err := g.startServer(ctx, server); err != nil {
		return err
	}
	g.refreshServerToolsBestEffort(ctx, server)
	return nil
}

func (g *Gateway) TestServer(ctx context.Context, server config.Server) (TestResult, error) {
	if existing, ok := g.cachedServer(server.ID); ok {
		if isAuthEmpty(server.Auth) {
			server.Auth = existing.Auth
		}
		if len(server.Headers) == 0 {
			server.Headers = existing.Headers
		}
		if len(server.Env) == 0 {
			server.Env = existing.Env
		}
	}
	if err := config.Validate(server); err != nil {
		return TestResult{OK: false, Status: "invalid"}, err
	}

	client := newUpstream(server)
	defer client.Stop()

	if err := client.Start(ctx); err != nil {
		return TestResult{OK: false, Status: "start_failed"}, err
	}
	tools, err := client.ListTools(ctx)
	if err != nil {
		return TestResult{OK: false, Status: "tool_discovery_failed"}, err
	}

	names := make([]string, 0, len(tools))
	for _, tool := range tools {
		names = append(names, tool.Name)
	}
	sort.Strings(names)
	return TestResult{
		OK:        true,
		Status:    "ok",
		ToolCount: len(tools),
		Tools:     names,
	}, nil
}

func (g *Gateway) TestStoredServer(ctx context.Context, id string) (TestResult, error) {
	server, ok := g.cachedServer(id)
	if !ok {
		return TestResult{OK: false, Status: "not_found"}, errors.New("server not found")
	}
	return g.TestServer(ctx, server)
}

func (g *Gateway) Tools(ctx context.Context) ([]Tool, error) {
	tools := append([]Tool(nil), gatewayMetaTools()...)
	tools = append(tools, g.cachedUpstreamTools()...)

	sort.Slice(tools, func(i, j int) bool {
		return tools[i].Name < tools[j].Name
	})
	return tools, nil
}

func (g *Gateway) UpstreamTools(ctx context.Context) ([]Tool, error) {
	return g.cachedUpstreamTools(), nil
}

func (g *Gateway) RefreshTools(ctx context.Context) ([]Tool, error) {
	servers := g.store.List()
	errCh := make(chan error, len(servers))
	var wg sync.WaitGroup
	sem := make(chan struct{}, toolRefreshWorkers)

	for _, server := range servers {
		if !server.Enabled {
			g.clearServerTools(server.ID)
			continue
		}
		wg.Add(1)
		go func(server config.Server) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				errCh <- ctx.Err()
				return
			}
			if _, err := g.refreshServerTools(ctx, server); err != nil {
				errCh <- err
			}
		}(server)
	}

	wg.Wait()
	close(errCh)

	errs := []error{}
	for err := range errCh {
		errs = append(errs, err)
	}
	tools := g.cachedUpstreamTools()
	if len(errs) > 0 {
		return tools, errors.Join(errs...)
	}
	return tools, nil
}

func (g *Gateway) RefreshServerTools(ctx context.Context, id string) ([]Tool, error) {
	server, ok := g.cachedServer(id)
	if !ok {
		return nil, errors.New("server not found")
	}
	if !server.Enabled {
		g.clearServerTools(id)
		return nil, errors.New("server is disabled")
	}
	return g.refreshServerTools(ctx, server)
}

func (g *Gateway) EndpointTools(ctx context.Context, id string) ([]Tool, error) {
	endpoint, ok := g.cachedEndpoint(id)
	if !ok {
		return nil, errors.New("endpoint not found")
	}
	if !endpoint.Enabled {
		return nil, errors.New("endpoint is disabled")
	}

	return g.cachedEndpointTools(endpoint), nil
}

func (g *Gateway) CallTool(ctx context.Context, gatewayName string, args map[string]any) (mcp.CallResult, error) {
	if strings.HasPrefix(gatewayName, "gateway_") {
		return g.callMetaTool(ctx, gatewayName, args)
	}

	serverID, nativeName, ok := parseGatewayToolName(gatewayName)
	if !ok {
		return mcp.CallResult{}, errors.New("tool name must be formatted as <server_id>__<tool_name>")
	}

	client := g.client(serverID)
	if client == nil {
		return mcp.CallResult{}, fmt.Errorf("server %q is not running", serverID)
	}

	return g.callUpstreamTool(ctx, serverID, nativeName, args)
}

func (g *Gateway) CallEndpointTool(ctx context.Context, endpointID, gatewayName string, args map[string]any) (mcp.CallResult, error) {
	endpoint, ok := g.cachedEndpoint(endpointID)
	if !ok {
		return mcp.CallResult{}, errors.New("endpoint not found")
	}
	if !endpoint.Enabled {
		return mcp.CallResult{}, errors.New("endpoint is disabled")
	}

	serverID, nativeName, ok := parseGatewayToolName(gatewayName)
	if !ok {
		return mcp.CallResult{}, errors.New("tool name must be formatted as <server_id>__<tool_name>")
	}
	if !endpointIncludesServer(endpoint, serverID) {
		return mcp.CallResult{}, fmt.Errorf("tool %q is not available on endpoint %q", gatewayName, endpoint.ID)
	}

	server, ok := g.cachedServer(serverID)
	if !ok {
		return mcp.CallResult{}, fmt.Errorf("server %q not found", serverID)
	}
	if !server.Enabled {
		return mcp.CallResult{}, fmt.Errorf("server %q is disabled", serverID)
	}
	client := g.client(serverID)
	if client == nil {
		return mcp.CallResult{}, fmt.Errorf("server %q is not running", serverID)
	}
	if err := g.reserveEndpointUsage(ctx, endpoint); err != nil {
		return mcp.CallResult{}, err
	}
	g.reserveUsage(server.ID)

	result, err := client.CallTool(ctx, nativeName, args)
	g.finishUsage(endpointUsageKey(endpoint.ID), err)
	g.finishUsage(serverUsageKey(serverID), err)
	return result, err
}

func (g *Gateway) callMetaTool(ctx context.Context, name string, args map[string]any) (mcp.CallResult, error) {
	switch name {
	case toolListServers:
		return jsonTextResult(map[string]any{"servers": g.Servers()})
	case toolListTools:
		return g.callListTools(ctx, args)
	case toolSearchTools:
		return g.callSearchTools(ctx, args)
	case toolRefreshTools:
		return g.callRefreshTools(ctx, args)
	case toolInvoke:
		return g.callInvoke(ctx, args)
	default:
		return mcp.CallResult{}, fmt.Errorf("unknown gateway tool %q", name)
	}
}

func (g *Gateway) callListTools(ctx context.Context, args map[string]any) (mcp.CallResult, error) {
	serverID := strings.TrimSpace(stringArg(args, "serverId"))
	includeGateway := boolArg(args, "includeGateway")

	var tools []Tool
	if includeGateway {
		tools = append(tools, gatewayMetaTools()...)
	}

	if serverID == "" {
		tools = append(tools, g.cachedUpstreamTools()...)
		return jsonTextResult(map[string]any{"tools": tools})
	}

	if _, ok := g.cachedServer(serverID); !ok {
		return mcp.CallResult{}, fmt.Errorf("server %q not found", serverID)
	}
	tools = append(tools, g.cachedServerTools(serverID)...)
	return jsonTextResult(map[string]any{"tools": tools})
}

func (g *Gateway) callSearchTools(ctx context.Context, args map[string]any) (mcp.CallResult, error) {
	query := strings.ToLower(strings.TrimSpace(stringArg(args, "query")))
	serverID := strings.TrimSpace(stringArg(args, "serverId"))
	limit := intArg(args, "limit", 20)
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if query == "" {
		return mcp.CallResult{}, errors.New("query is required")
	}

	tools := g.cachedUpstreamTools()

	matches := []Tool{}
	for _, tool := range tools {
		if serverID != "" && tool.ServerID != serverID {
			continue
		}
		haystack := strings.ToLower(strings.Join([]string{
			tool.Name,
			tool.ServerID,
			tool.ServerName,
			tool.NativeName,
			tool.Description,
		}, " "))
		if strings.Contains(haystack, query) {
			matches = append(matches, tool)
			if len(matches) >= limit {
				break
			}
		}
	}

	return jsonTextResult(map[string]any{
		"query": query,
		"tools": matches,
	})
}

func (g *Gateway) callRefreshTools(ctx context.Context, args map[string]any) (mcp.CallResult, error) {
	serverID := strings.TrimSpace(stringArg(args, "serverId"))
	if serverID != "" {
		tools, err := g.RefreshServerTools(ctx, serverID)
		if err != nil {
			return mcp.CallResult{}, err
		}
		return jsonTextResult(map[string]any{"tools": tools})
	}

	tools, err := g.RefreshTools(ctx)
	if err != nil {
		return mcp.CallResult{}, err
	}
	return jsonTextResult(map[string]any{"tools": tools})
}

func (g *Gateway) callInvoke(ctx context.Context, args map[string]any) (mcp.CallResult, error) {
	toolName := strings.TrimSpace(stringArg(args, "toolName"))
	serverID := strings.TrimSpace(stringArg(args, "serverId"))
	nativeName := strings.TrimSpace(stringArg(args, "nativeName"))
	if nativeName == "" {
		nativeName = strings.TrimSpace(stringArg(args, "name"))
	}

	if toolName != "" {
		if strings.HasPrefix(toolName, "gateway_") {
			return mcp.CallResult{}, errors.New("gateway_invoke can only invoke upstream tools")
		}
		parsedServerID, parsedNativeName, ok := parseGatewayToolName(toolName)
		if !ok {
			return mcp.CallResult{}, errors.New("toolName must be formatted as <server_id>__<tool_name>")
		}
		serverID = parsedServerID
		nativeName = parsedNativeName
	}
	if serverID == "" || nativeName == "" {
		return mcp.CallResult{}, errors.New("provide toolName or both serverId and nativeName")
	}

	arguments, ok := args["arguments"].(map[string]any)
	if !ok || arguments == nil {
		arguments = map[string]any{}
	}

	client := g.client(serverID)
	if client == nil {
		return mcp.CallResult{}, fmt.Errorf("server %q is not running", serverID)
	}
	return g.callUpstreamTool(ctx, serverID, nativeName, arguments)
}

func (g *Gateway) callUpstreamTool(ctx context.Context, serverID, nativeName string, args map[string]any) (mcp.CallResult, error) {
	server, ok := g.cachedServer(serverID)
	if !ok {
		return mcp.CallResult{}, fmt.Errorf("server %q not found", serverID)
	}
	client := g.client(serverID)
	if client == nil {
		return mcp.CallResult{}, fmt.Errorf("server %q is not running", serverID)
	}
	g.reserveUsage(server.ID)

	result, err := client.CallTool(ctx, nativeName, args)
	g.finishUsage(serverUsageKey(serverID), err)
	return result, err
}

func (g *Gateway) startServer(ctx context.Context, server config.Server) error {
	client := newUpstream(server)
	if err := client.Start(ctx); err != nil {
		return err
	}

	g.mu.Lock()
	defer g.mu.Unlock()
	g.clients[server.ID] = client
	return nil
}

var newUpstream = func(server config.Server) mcp.Upstream {
	switch server.Transport {
	case "http":
		return mcp.NewHTTPClient(server.ID, server.URL, server.Auth, server.Headers)
	default:
		return mcp.NewClient(server.ID, server.Command, server.Args, server.Env)
	}
}

func (g *Gateway) stopServer(id string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if client := g.clients[id]; client != nil {
		client.Stop()
		delete(g.clients, id)
	}
	g.clearServerTools(id)
}

func (g *Gateway) client(id string) mcp.Upstream {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.clients[id]
}

func gatewayToolName(serverID, nativeName string) string {
	return serverID + "__" + nativeName
}

func parseGatewayToolName(name string) (string, string, bool) {
	serverID, nativeName, ok := strings.Cut(name, "__")
	return serverID, nativeName, ok && serverID != "" && nativeName != ""
}

func (g *Gateway) refreshServerToolsBestEffort(ctx context.Context, server config.Server) {
	refreshCtx, cancel := context.WithTimeout(ctx, toolRefreshTimeout)
	defer cancel()
	_, _ = g.refreshServerTools(refreshCtx, server)
}

func (g *Gateway) refreshServerTools(ctx context.Context, server config.Server) ([]Tool, error) {
	client := g.client(server.ID)
	if client == nil {
		return nil, fmt.Errorf("server %q is not running", server.ID)
	}

	serverTools, err := client.ListTools(ctx)
	if err != nil {
		return nil, fmt.Errorf("refresh tools for server %q: %w", server.ID, err)
	}
	return g.setCachedServerTools(server, serverTools)
}

func (g *Gateway) setCachedServerTools(server config.Server, serverTools []mcp.Tool) ([]Tool, error) {
	tools := make([]Tool, 0, len(serverTools))
	now := time.Now().UTC().Format(time.RFC3339)
	for _, tool := range serverTools {
		tools = append(tools, Tool{
			Name:        gatewayToolName(server.ID, tool.Name),
			ServerID:    server.ID,
			ServerName:  server.Name,
			NativeName:  tool.Name,
			Description: tool.Description,
			InputSchema: cloneRawMessage(tool.InputSchema),
			CreatedAt:   now,
			UpdatedAt:   now,
		})
	}
	sort.Slice(tools, func(i, j int) bool {
		return tools[i].Name < tools[j].Name
	})
	records := toolRecordsFromTools(tools)

	g.toolsMu.Lock()
	g.toolCache[server.ID] = cloneTools(tools)
	g.toolsMu.Unlock()

	if err := g.store.ReplaceToolRecords(server.ID, records); err != nil {
		return tools, err
	}
	return tools, nil
}

func (g *Gateway) cachedUpstreamTools() []Tool {
	servers := g.store.List()
	tools := []Tool{}

	g.toolsMu.RLock()
	defer g.toolsMu.RUnlock()
	for _, server := range servers {
		if !server.Enabled {
			continue
		}
		tools = append(tools, cloneTools(g.toolCache[server.ID])...)
	}

	sort.Slice(tools, func(i, j int) bool {
		return tools[i].Name < tools[j].Name
	})
	return tools
}

func (g *Gateway) cachedEndpointTools(endpoint config.Endpoint) []Tool {
	tools := []Tool{}

	g.toolsMu.RLock()
	defer g.toolsMu.RUnlock()
	for _, serverID := range endpoint.ServerIDs {
		server, ok := g.cachedServer(serverID)
		if !ok || !server.Enabled {
			continue
		}
		tools = append(tools, cloneTools(g.toolCache[serverID])...)
	}

	sort.Slice(tools, func(i, j int) bool {
		return tools[i].Name < tools[j].Name
	})
	return tools
}

func (g *Gateway) cachedServerTools(id string) []Tool {
	g.toolsMu.RLock()
	defer g.toolsMu.RUnlock()
	return cloneTools(g.toolCache[id])
}

func (g *Gateway) clearServerTools(id string) {
	g.toolsMu.Lock()
	delete(g.toolCache, id)
	g.toolsMu.Unlock()
	_ = g.store.DeleteToolRecords(id)
}

func endpointIncludesServer(endpoint config.Endpoint, serverID string) bool {
	for _, endpointServerID := range endpoint.ServerIDs {
		if endpointServerID == serverID {
			return true
		}
	}
	return false
}

func (g *Gateway) reserveUsage(serverID string) {
	now := time.Now().UTC()

	g.usageMu.Lock()
	defer g.usageMu.Unlock()

	usage := g.usageForLocked(serverUsageKey(serverID))
	resetUsageWindow(usage, now)

	usage.totalCalls++
	usage.windowCalls++
	usage.lastCalledAt = now
	g.markUsageDirtyLocked(serverUsageKey(serverID))
}

func (g *Gateway) reserveEndpointUsage(ctx context.Context, endpoint config.Endpoint) error {
	now := time.Now().UTC()

	g.usageMu.Lock()
	defer g.usageMu.Unlock()

	usage := g.usageForLocked(endpointUsageKey(endpoint.ID))

	limit := endpoint.RateLimit.RequestsPerMinute
	decision, err := g.store.ConsumeRateLimitToken(ctx, endpointUsageKey(endpoint.ID), limit, now)
	if err != nil {
		return err
	}
	if limit > 0 && !decision.Allowed {
		usage.rateLimitedCalls++
		usage.lastCalledAt = now
		usage.lastError = "rate limit exceeded"
		g.markUsageDirtyLocked(endpointUsageKey(endpoint.ID))
		return &RateLimitError{
			EndpointID: endpoint.ID,
			Limit:      limit,
			ResetAt:    decision.ResetAt,
		}
	}

	usage.totalCalls++
	usage.windowCalls++
	usage.lastCalledAt = now
	g.markUsageDirtyLocked(endpointUsageKey(endpoint.ID))
	return nil
}

func (g *Gateway) finishUsage(usageKey string, err error) {
	g.usageMu.Lock()
	defer g.usageMu.Unlock()

	usage := g.usageForLocked(usageKey)
	if err != nil {
		usage.failedCalls++
		usage.lastError = err.Error()
		g.markUsageDirtyLocked(usageKey)
		return
	}
	usage.successfulCalls++
	usage.lastError = ""
	g.markUsageDirtyLocked(usageKey)
}

func (g *Gateway) usageSnapshot(server config.Server) UsageSnapshot {
	now := time.Now().UTC()

	g.usageMu.Lock()
	defer g.usageMu.Unlock()

	usage := g.usageForLocked(serverUsageKey(server.ID))
	resetUsageWindow(usage, now)

	return UsageSnapshot{
		TotalCalls:         usage.totalCalls,
		SuccessfulCalls:    usage.successfulCalls,
		FailedCalls:        usage.failedCalls,
		RateLimitedCalls:   usage.rateLimitedCalls,
		CurrentWindowCalls: usage.windowCalls,
		LastCalledAt:       formatOptionalTime(usage.lastCalledAt),
		LastError:          usage.lastError,
	}
}

func (g *Gateway) endpointUsageSnapshot(endpoint config.Endpoint) UsageSnapshot {
	now := time.Now().UTC()

	g.usageMu.Lock()
	defer g.usageMu.Unlock()

	usage := g.usageForLocked(endpointUsageKey(endpoint.ID))
	resetUsageWindow(usage, now)

	limit := endpoint.RateLimit.RequestsPerMinute
	remaining := 0
	resetAt := ""
	currentWindowCalls := usage.windowCalls
	if limit > 0 {
		if decision, err := g.store.RateLimitBucketSnapshot(context.Background(), endpointUsageKey(endpoint.ID), limit, now); err == nil {
			remaining = decision.Remaining
			currentWindowCalls = max(limit-remaining, 0)
			if !decision.ResetAt.IsZero() {
				resetAt = decision.ResetAt.Format(time.RFC3339)
			}
		} else {
			remaining = max(limit-usage.windowCalls, 0)
			resetAt = usage.windowStart.Add(time.Minute).Format(time.RFC3339)
		}
	}

	return UsageSnapshot{
		TotalCalls:          usage.totalCalls,
		SuccessfulCalls:     usage.successfulCalls,
		FailedCalls:         usage.failedCalls,
		RateLimitedCalls:    usage.rateLimitedCalls,
		CurrentWindowCalls:  currentWindowCalls,
		LimitPerMinute:      limit,
		RemainingThisMinute: remaining,
		WindowResetAt:       resetAt,
		LastCalledAt:        formatOptionalTime(usage.lastCalledAt),
		LastError:           usage.lastError,
	}
}

func (g *Gateway) deleteUsage(id string) {
	g.usageMu.Lock()
	delete(g.usage, id)
	delete(g.usageDirty, id)
	g.usageMu.Unlock()
	_ = g.store.DeleteUsageRecord(id)
	_ = g.store.DeleteRateLimitBucket(id)
}

func (g *Gateway) usageForLocked(usageKey string) *usageCounter {
	usage := g.usage[usageKey]
	if usage == nil {
		usage = &usageCounter{windowStart: time.Now().UTC().Truncate(time.Minute)}
		g.usage[usageKey] = usage
	}
	return usage
}

func (g *Gateway) markUsageDirtyLocked(key string) {
	g.usageDirty[key] = struct{}{}
}

func usageRecordFromCounter(key string, usage *usageCounter) config.UsageRecord {
	return config.UsageRecord{
		Key:              key,
		TotalCalls:       usage.totalCalls,
		SuccessfulCalls:  usage.successfulCalls,
		FailedCalls:      usage.failedCalls,
		RateLimitedCalls: usage.rateLimitedCalls,
		WindowStart:      usage.windowStart,
		WindowCalls:      usage.windowCalls,
		LastCalledAt:     usage.lastCalledAt,
		LastError:        usage.lastError,
	}
}

func (g *Gateway) flushUsageLoop() {
	ticker := time.NewTicker(usageFlushInterval)
	defer ticker.Stop()
	defer close(g.usageFlushDone)

	for {
		select {
		case <-ticker.C:
			g.flushUsage()
		case <-g.usageFlushStop:
			g.flushUsage()
			return
		}
	}
}

func (g *Gateway) stopUsageFlusher() {
	g.usageFlushStopOnce.Do(func() {
		close(g.usageFlushStop)
		<-g.usageFlushDone
	})
}

func (g *Gateway) writeAuditLogsLoop() {
	defer close(g.auditLogDone)

	for work := range g.auditLogQueue {
		if work.flush != nil {
			close(work.flush)
			continue
		}
		if err := g.insertAuditLog(work.record); err != nil {
			log.Printf("audit_log_insert_failed transport=%s endpoint=%s tool=%s error=%q", work.record.Transport, work.record.EndpointID, work.record.ToolName, err.Error())
		}
	}
}

func (g *Gateway) insertAuditLog(record config.AuditLogRecord) error {
	var lastErr error
	for attempt := 0; attempt < auditLogAttempts; attempt++ {
		err := g.store.InsertAuditLog(record)
		if err == nil {
			return nil
		}
		if !isSQLiteBusy(err) {
			return err
		}
		lastErr = err
		time.Sleep(time.Duration(attempt+1) * 5 * time.Millisecond)
	}
	return lastErr
}

func (g *Gateway) stopAuditLogWriter() {
	g.auditLogStopOnce.Do(func() {
		close(g.auditLogQueue)
		<-g.auditLogDone
	})
}

func (g *Gateway) flushAuditLogs() {
	done := make(chan struct{})
	g.auditLogQueue <- auditLogWork{flush: done}
	<-done
}

func isSQLiteBusy(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "SQLITE_BUSY") || strings.Contains(message, "database is locked")
}

func (g *Gateway) flushUsage() {
	records := map[string]config.UsageRecord{}

	g.usageMu.Lock()
	for key := range g.usageDirty {
		if usage := g.usage[key]; usage != nil {
			records[key] = usageRecordFromCounter(key, usage)
		}
		delete(g.usageDirty, key)
	}
	g.usageMu.Unlock()

	for key, record := range records {
		if err := g.store.UpsertUsageRecord(record); err != nil {
			g.usageMu.Lock()
			if g.usage[key] != nil {
				g.usageDirty[key] = struct{}{}
			}
			g.usageMu.Unlock()
		}
	}
}

func auditLogFromRecord(record config.AuditLogRecord) AuditLog {
	timestamp := ""
	if !record.Timestamp.IsZero() {
		timestamp = record.Timestamp.UTC().Format(time.RFC3339Nano)
	}
	return AuditLog{
		ID:         record.ID,
		Timestamp:  timestamp,
		Transport:  record.Transport,
		EndpointID: record.EndpointID,
		ToolName:   record.ToolName,
		Status:     record.Status,
		DurationMS: record.DurationMS,
		Caller:     record.Caller,
		Error:      record.Error,
	}
}

func serverUsageKey(id string) string {
	return "server:" + id
}

func endpointUsageKey(id string) string {
	return "endpoint:" + id
}

func resetUsageWindow(usage *usageCounter, now time.Time) {
	if usage.windowStart.IsZero() {
		usage.windowStart = now.Truncate(time.Minute)
		return
	}
	if now.Sub(usage.windowStart) >= time.Minute {
		usage.windowStart = now.Truncate(time.Minute)
		usage.windowCalls = 0
	}
}

func formatOptionalTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.Format(time.RFC3339)
}

func cloneTools(tools []Tool) []Tool {
	out := make([]Tool, len(tools))
	for i, tool := range tools {
		out[i] = tool
		out[i].InputSchema = cloneRawMessage(tool.InputSchema)
	}
	return out
}

func toolRecordsFromTools(tools []Tool) []config.ToolRecord {
	records := make([]config.ToolRecord, 0, len(tools))
	for _, tool := range tools {
		records = append(records, config.ToolRecord{
			Name:        tool.Name,
			ServerID:    tool.ServerID,
			ServerName:  tool.ServerName,
			NativeName:  tool.NativeName,
			Description: tool.Description,
			InputSchema: cloneRawMessage(tool.InputSchema),
			CreatedAt:   tool.CreatedAt,
			UpdatedAt:   tool.UpdatedAt,
		})
	}
	return records
}

func cloneRawMessage(value json.RawMessage) json.RawMessage {
	if value == nil {
		return nil
	}
	return append(json.RawMessage(nil), value...)
}

func cloneServerConfig(server config.Server) config.Server {
	server.Args = append([]string(nil), server.Args...)
	server.Env = cloneStringMap(server.Env)
	server.Headers = cloneStringMap(server.Headers)
	return server
}

func cloneEndpointConfig(endpoint config.Endpoint) config.Endpoint {
	endpoint.ServerIDs = append([]string(nil), endpoint.ServerIDs...)
	return endpoint
}

func cloneAPIKeyConfig(key config.APIKey) config.APIKey {
	key.EndpointIDs = append([]string(nil), key.EndpointIDs...)
	return key
}

func cloneStringMap(values map[string]string) map[string]string {
	if values == nil {
		return nil
	}
	out := make(map[string]string, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}

func sanitizeServer(server config.Server) config.Server {
	server.Auth = config.AuthConfig{}
	server.Env = map[string]string{}
	server.Headers = map[string]string{}
	server.RateLimit = config.RateLimit{}
	return server
}

func isAuthEmpty(auth config.AuthConfig) bool {
	return auth.Type == "" &&
		auth.APIKeyName == "" &&
		auth.APIKeyValue == "" &&
		auth.APIKeyIn == "" &&
		auth.Token == "" &&
		auth.Username == "" &&
		auth.Password == ""
}

func gatewayMetaTools() []Tool {
	return []Tool{
		{
			Name:        toolListServers,
			ServerID:    "gateway",
			ServerName:  "MCP Gateway",
			NativeName:  toolListServers,
			Description: "List configured upstream MCP servers and their runtime status.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`),
		},
		{
			Name:        toolListTools,
			ServerID:    "gateway",
			ServerName:  "MCP Gateway",
			NativeName:  toolListTools,
			Description: "List available tools across upstream servers, optionally scoped to one server.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"serverId":{"type":"string","description":"Optional upstream server ID to list tools for."},"includeGateway":{"type":"boolean","description":"Include gateway meta-tools in the response."}},"additionalProperties":false}`),
		},
		{
			Name:        toolSearchTools,
			ServerID:    "gateway",
			ServerName:  "MCP Gateway",
			NativeName:  toolSearchTools,
			Description: "Search upstream tools by keyword across name, description, and server metadata.",
			InputSchema: json.RawMessage(`{"type":"object","required":["query"],"properties":{"query":{"type":"string","description":"Keyword to search for."},"serverId":{"type":"string","description":"Optional upstream server ID to restrict the search."},"limit":{"type":"integer","minimum":1,"maximum":100,"default":20}},"additionalProperties":false}`),
		},
		{
			Name:        toolRefreshTools,
			ServerID:    "gateway",
			ServerName:  "MCP Gateway",
			NativeName:  toolRefreshTools,
			Description: "Refresh the cached upstream tool catalog, optionally scoped to one server.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"serverId":{"type":"string","description":"Optional upstream server ID to refresh."}},"additionalProperties":false}`),
		},
		{
			Name:        toolInvoke,
			ServerID:    "gateway",
			ServerName:  "MCP Gateway",
			NativeName:  toolInvoke,
			Description: "Invoke an upstream tool by prefixed toolName or by serverId plus nativeName.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"toolName":{"type":"string","description":"Prefixed tool name like github__search_repositories."},"serverId":{"type":"string","description":"Upstream server ID. Required when toolName is omitted."},"nativeName":{"type":"string","description":"Native upstream tool name. Required when toolName is omitted."},"arguments":{"type":"object","description":"Arguments to pass to the upstream tool.","additionalProperties":true}},"additionalProperties":false}`),
		},
	}
}

func jsonTextResult(value any) (mcp.CallResult, error) {
	payload, err := json.Marshal(value)
	if err != nil {
		return mcp.CallResult{}, err
	}
	return mcp.CallResult{
		Content: []map[string]any{
			{
				"type": "text",
				"text": string(payload),
			},
		},
	}, nil
}

func stringArg(args map[string]any, name string) string {
	if args == nil {
		return ""
	}
	value, ok := args[name]
	if !ok || value == nil {
		return ""
	}
	if s, ok := value.(string); ok {
		return s
	}
	return fmt.Sprint(value)
}

func boolArg(args map[string]any, name string) bool {
	if args == nil {
		return false
	}
	value, ok := args[name].(bool)
	return ok && value
}

func intArg(args map[string]any, name string, fallback int) int {
	if args == nil {
		return fallback
	}
	switch value := args[name].(type) {
	case int:
		return value
	case int64:
		return int(value)
	case float64:
		return int(value)
	case json.Number:
		n, err := value.Int64()
		if err == nil {
			return int(n)
		}
	}
	return fallback
}
