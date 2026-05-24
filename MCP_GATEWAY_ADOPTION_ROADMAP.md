# MCP Gateway Adoption Roadmap

This roadmap turns the gateway research into a practical build plan for a fast and useful open source MCP gateway.

## Product Goal

Build the easiest MCP gateway for developers to run locally and teams to adopt gradually.

The gateway should:

- Start in one command.
- Connect to hosted Streamable HTTP MCP servers.
- Bridge local stdio MCP servers when needed.
- Reduce tool context bloat with meta-tools.
- Make auth and debugging obvious.
- Grow into team profiles and policy without requiring enterprise infrastructure on day one.

## Target Users

### Individual Developers

Needs:

- Add GitHub, filesystem, Linear, Slack, Postgres, or custom MCP servers quickly.
- Use one MCP endpoint from Cursor, Claude Desktop, or other clients.
- Debug why a server is not working.
- Avoid manually editing database records or complex config files.

### AI Tool Builders

Needs:

- Stable HTTP MCP endpoint.
- Tool discovery and invocation APIs.
- Ability to package tool bundles for specific agents.
- Reliable logs and errors.

### Teams

Needs:

- Shared gateway configuration.
- Profiles for different use cases.
- Read-only and write-enabled modes.
- Auth, audit logs, and eventually rate limits.

## MVP Direction

The current MVP has a good base:

- Go single binary.
- Embedded UI.
- Embedded SQLite store.
- HTTP gateway endpoint.
- Local stdio server support.
- Basic HTTP upstream support.

The next MVP should focus on making the gateway useful with real MCP clients and hosted MCP servers.

## P0: Make It Correct And Useful

### 1. Streamable HTTP Upstream Support

Status: partially implemented.

Needed:

- Store `Mcp-Session-Id` from upstream initialize responses.
- Send `Mcp-Session-Id` on later upstream HTTP requests.
- Support JSON response mode over POST.
- Support SSE responses for Streamable HTTP when the upstream returns event streams.
- Add clear errors for 401, 403, 404, and transport mismatch.

Why it matters:

Remote MCP is moving toward Streamable HTTP. Correct support is table stakes for hosted MCP servers.

### 2. Gateway Meta-Tools

Status: implemented.

The gateway exposes these tools on its own MCP endpoint:

```text
gateway_list_servers
gateway_list_tools
gateway_search_tools
gateway_invoke
```

Behavior:

- `gateway_list_servers`: returns configured upstream servers and status.
- `gateway_list_tools`: returns tools for one server or all servers.
- `gateway_search_tools`: keyword search across tool names, descriptions, and server names.
- `gateway_invoke`: calls a tool by server ID and tool name.

Why it matters:

This solves context bloat. Instead of exposing hundreds of tools to the client, the gateway can expose four discovery/invocation tools.

### 3. Better Server Status

Status: partially implemented.

Add:

- Last startup error.
- Last tool-list error.
- Last upstream HTTP status.
- Last successful connection time.
- Stdio stderr tail.
- Restart count.

Why it matters:

If users cannot understand why a server is stopped, they will abandon the gateway.

### 4. Secret Handling

Status: partially implemented.

Add:

- Mask `headers` and `env` values in UI/API responses.
- Preserve existing secret values when editing a server.
- Support `${ENV_VAR}` references in UI examples.
- Add validation that warns when a literal token is stored in config.

Why it matters:

MCP gateways often hold tokens for GitHub, Slack, Linear, and databases. Secret safety is core trust.

## P1: Make It Easy To Adopt

### 1. Install And Run Paths

Add:

- `Dockerfile`
- `docker-compose.yml`
- GitHub Actions build/test workflow
- Release binaries for macOS, Linux, and Windows
- `go install` instructions

Target first-run experience:

```bash
go install github.com/rajdas/mcp-gateway@latest
mcp-gateway
```

or:

```bash
docker run -p 8080:8080 mcp-gateway
```

### 2. Registry Import

Add support for the official MCP Registry:

- Search registry servers from the UI.
- Import a server template.
- Show install/config instructions.
- Pre-fill common fields.

Why it matters:

The registry is the app store. A gateway should make registry servers usable.

### 3. Tool Profiles

Add focused endpoint profiles:

```text
/profiles/default/mcp
/profiles/github-readonly/mcp
/profiles/dev/mcp
```

Each profile should support:

- Server allowlist.
- Tool allowlist.
- Direct tools mode or meta-tools mode.
- Read-only policy flag.

Why it matters:

Agents work better with smaller, purposeful tool surfaces.

### 4. Tool Call UI

Add:

- Tool detail page.
- Input schema renderer.
- Test call form.
- Response viewer.
- Copy curl command.

Why it matters:

The UI becomes a playground and debugging console, not just config CRUD.

## P2: Make It Team-Ready

### 1. Gateway Authentication

Add:

- Local API key mode.
- OIDC/JWT verification.
- Per-profile access control.
- Optional OAuth protected resource metadata.

### 2. Policy Layer

Add:

- Tool allow/deny lists.
- Read-only mode for write-capable tools.
- Timeout limits.
- Rate limits.
- Request body size limits.
- Basic audit logs.

### 3. Persistence

Start with embedded SQLite, then support:

- Import/export config as JSON or YAML.
- Postgres for multi-node team deployment.
- Migration tooling between SQLite and Postgres.

### 4. Observability

Add:

- Request logs.
- Tool call latency.
- Success/error rates.
- OpenTelemetry traces.
- Prometheus metrics.

## Suggested Technical Architecture

### Core Packages

```text
internal/config       SQLite store, validation, secret masking
internal/mcp          upstream transports: stdio, streamable HTTP, SSE
internal/gateway      routing, profiles, tool cache, meta-tools
internal/web          REST API and embedded UI
internal/registry     official registry client
internal/policy       allowlists, read-only mode, limits
internal/observability logs, metrics, traces
```

### Stored Server Shape

Recommended API shape:

```json
{
  "servers": [
    {
      "id": "github",
      "name": "GitHub MCP",
      "transport": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      },
      "enabled": true,
      "weight": 1
    }
  ],
  "profiles": [
    {
      "id": "default",
      "mode": "meta-tools",
      "servers": ["github"],
      "tools": ["github:*"]
    }
  ]
}
```

## Differentiation Strategy

Do not try to be the biggest enterprise gateway first.

Win by being:

- Fastest to run.
- Best local UI.
- Best MCP debugging experience.
- Best tool search and context reduction.
- Best bridge between official registry and real client usage.

## Near-Term Implementation Order

1. Fix Streamable HTTP session handling.
2. Add gateway meta-tools.
3. Add tool cache and search.
4. Add tool call UI.
5. Add profile endpoints.
6. Add Dockerfile and CI.
7. Add registry import.
8. Add gateway API key auth.
9. Add policy controls.
10. Add observability.

## Success Metrics

Track:

- Time from install to first tool call.
- Number of supported upstream transport types.
- Number of registry templates that work out of the box.
- Tool discovery latency.
- Tool call success rate.
- GitHub stars and external issues/PRs.
- Number of examples in `examples/`.

The north-star metric should be:

> A new user can connect one MCP server and call one tool through the gateway in under five minutes.

