# MCP Gateway Research

Research date: May 23, 2026

## Executive Summary

The MCP gateway space is already forming around two broad product shapes:

1. Enterprise gateways that look like API gateways or Kubernetes control planes.
2. Developer-first gateways that reduce MCP setup friction and tool-context bloat.

For high open source adoption, this project should not start by competing with heavy enterprise gateways. The fastest path is a small, reliable developer gateway that:

- Runs locally in one command.
- Connects to hosted Streamable HTTP MCP servers.
- Can still bridge local stdio MCP servers when needed.
- Exposes a small set of meta-tools instead of flooding clients with every upstream tool.
- Makes auth, secrets, debugging, and tool discovery simple.

## Existing Projects

### theognis1002/mcp-gateway

Positioning: production MCP API gateway and registry.

Observed features:

- Go backend with TypeScript UI components.
- Multi-transport support: stdio, SSE, Streamable HTTP, WebSocket, JSON-RPC over HTTP.
- Authentication with JWT, OAuth2/OIDC, and RBAC.
- Rate limiting, logging, discovery, and failover.
- REST API to MCP virtualization.

Takeaway:

This is a useful feature benchmark, but it is broad. A new OSS gateway can differentiate by being easier to run, easier to understand, and faster to adopt.

### microsoft/mcp-gateway

Positioning: Kubernetes-native reverse proxy and management layer.

Observed features:

- Data plane for routing traffic to MCP servers.
- Control plane for managing MCP server lifecycle.
- Session-aware routing.
- Tool gateway router that routes calls to registered tools.
- Enterprise integration points for telemetry, access control, and observability.

Takeaway:

Strong enterprise/Kubernetes architecture. For this project, avoid starting with Kubernetes complexity. Borrow the tool-router concept, but keep local-first setup.

### Kuadrant/mcp-gateway

Positioning: Envoy/Istio based MCP gateway.

Observed features:

- Gateway API and HTTPRoute integration.
- AuthN, authZ, and rate limiting.
- OAuth protected resource discovery.
- OpenShift/Kubernetes deployment focus.

Takeaway:

Great for platform teams, but too infra-heavy for a developer MVP. This project should stay simple and framework-light.

### IBM mcp-context-forge

Positioning: broader AI gateway, registry, proxy, and governance layer.

Observed features:

- MCP, A2A, REST, and gRPC federation.
- Plugin architecture.
- Guardrails, governance, and observability.
- Tool optimization and centralized discovery.

Takeaway:

This validates demand for federation and governance, but the product surface is large. A focused gateway can win by solving fewer problems extremely well.

### MikkoParkkola/mcp-gateway

Positioning: universal MCP gateway focused on context savings.

Observed features:

- Replaces many upstream tools with a small number of gateway meta-tools.
- Example meta-tools:
  - `gateway_list_servers`
  - `gateway_list_tools`
  - `gateway_search_tools`
  - `gateway_invoke`
- Supports stdio, HTTP, and SSE style backends.
- Emphasizes reducing context-window usage.

Takeaway:

This is the most important adoption lesson. Developers do not only need aggregation; they need a smaller and searchable tool surface.

### Official MCP Registry

Positioning: community registry of MCP servers.

Observed features:

- App-store style MCP server discovery.
- Publishing flow using `mcp-publisher`.
- Registry API for server metadata.
- GitHub-based publishing and namespace verification.

Takeaway:

Do not compete with the registry. Integrate with it. A gateway that can import servers from the official registry will feel native to the MCP ecosystem.

## MCP Transport Direction

The modern remote transport is Streamable HTTP.

Important points from the MCP transport direction:

- New remote servers should prefer Streamable HTTP.
- Streamable HTTP uses a single MCP endpoint, commonly `/mcp`.
- POST handles client-to-server JSON-RPC requests.
- GET can optionally establish SSE streams for server-to-client events.
- DELETE can terminate sessions.
- Servers may return `Mcp-Session-Id` during initialization.
- Clients must include `Mcp-Session-Id` on subsequent requests when provided.
- Legacy HTTP+SSE exists, but is no longer the recommended path.

Implication for this project:

The gateway should support:

- JSON response mode over POST for simple remote servers.
- Streamable HTTP session headers.
- SSE fallback for older servers.
- Auth headers on every request.

## Adoption Lessons

### 1. One-command local install matters

Developers should be able to run:

```bash
go install github.com/rajdas/mcp-gateway@latest
mcp-gateway
```

or:

```bash
docker run -p 8080:8080 mcp-gateway
```

without needing Kubernetes, Postgres, or a complex control plane.

### 2. Remote HTTP MCP should be the default

The ecosystem is moving from local stdio-only setups toward hosted MCP services. The UI should default to:

- Server URL
- Auth type
- Headers or token reference

Local `stdio` should remain available as an advanced/dev bridge.

### 3. Meta-tools are more useful than exposing everything

If a user connects GitHub, Slack, Linear, Postgres, and filesystem MCP servers, exposing every tool directly can overload the client context.

The gateway should expose a compact default surface:

- `gateway_search_tools`
- `gateway_list_servers`
- `gateway_list_tools`
- `gateway_invoke`

Direct prefixed tools can still be available as an optional mode.

### 4. Secrets must be handled carefully

The current MVP supports headers, but high-adoption OSS needs safer secret handling:

- Never return secrets from API responses.
- Mask secrets in UI.
- Prefer environment variable references.
- Store local state in SQLite.
- Add `.gitignore` for local database files.
- Support a local encrypted secrets store later.

### 5. Debugging is a product feature

MCP setup often fails because of auth, transport mismatch, wrong URL, stale sessions, or server startup errors.

The gateway should show:

- Last startup error.
- Last HTTP status from upstream.
- Last tool-list error.
- Stdio stderr tail.
- Request latency and timeout reason.

### 6. Profiles make the gateway useful for teams

Instead of one giant gateway, users should create focused endpoints:

```text
/profiles/dev/mcp
/profiles/github-readonly/mcp
/profiles/ops/mcp
```

Each profile should have its own:

- Server allowlist.
- Tool allowlist.
- Auth policy.
- Read-only/write permission mode.

## Recommended Positioning

Suggested positioning:

> A fast, local-first MCP gateway that connects remote and local MCP servers, compresses tool surfaces with searchable meta-tools, and gives teams one safe endpoint for agents.

Avoid leading with:

- Kubernetes
- Enterprise governance
- Complex policy engines
- Multi-protocol AI platform language

Lead with:

- Works in 60 seconds.
- One endpoint for all MCP servers.
- Search tools instead of loading hundreds.
- Remote HTTP MCP first.
- Debuggable by default.

