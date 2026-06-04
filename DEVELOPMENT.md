# Development

## Features

- Single Go binary with embedded UI
- Preact, Tailwind CSS, and DaisyUI frontend
- SQLite-backed server registry for upstream HTTP and stdio MCP servers
- REST API for adding, deleting, restarting, and listing servers and endpoints
- Endpoint groups that expose selected MCP servers behind scoped MCP URLs with endpoint-level usage and rate limits
- Persisted tool catalog and usage counters so refreshes or restarts do not reset the dashboard
- Cached tool discovery across enabled upstream servers with manual refresh
- MCP-style HTTP JSON-RPC endpoints for `initialize`, `tools/list`, and `tools/call`

## Run locally

```bash
go run . -addr :8080
```

Or with Make:

```bash
make run
```

Open [http://localhost:8080](http://localhost:8080).

On first run, the app creates `mcp-gateway.db` if it does not already exist. Embedded SQL migrations in `internal/config/migrations` are applied automatically on startup.

### Flags

| Flag   | Default           | Description                    |
|--------|-------------------|--------------------------------|
| `-addr`| `:8080`           | HTTP listen address            |
| `-db`  | `mcp-gateway.db`  | Path to the SQLite database    |

## Docker

### Build

```bash
docker build -t mcp-gateway .
```

### Run

```bash
docker run --rm -p 8080:8080 -v mcp-gateway-data:/data mcp-gateway
```

Stdio upstream servers (for example `npx @modelcontextprotocol/server-filesystem`) are not available in the minimal Alpine image. Use a custom image or run the gateway on the host when you need local stdio MCP processes.

## Frontend

The UI is built with Preact, Vite, Tailwind CSS, and DaisyUI. Built assets are emitted into `internal/web/static` so Go can embed them.

Install dependencies:

```bash
npm install
```

Build embedded assets:

```bash
npm run build
```

For frontend-only development:

```bash
npm run dev
```

## Configure a server

Use the UI or the REST API. The gateway stores servers in SQLite.

UI presets are defined in `ui/src/mcp-presets.json`. Choose a preset to prefill the form, or choose **Custom HTTP MCP** to enter any hosted MCP server URL.

```bash
curl -X POST http://localhost:8080/api/servers \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "github",
    "name": "GitHub MCP",
    "transport": "http",
    "url": "https://api.githubcopilot.com/mcp/",
    "headers": {
      "Authorization": "Bearer ${GITHUB_TOKEN}"
    },
    "enabled": true,
    "weight": 1
  }'
```

Header values support environment variables like `${GITHUB_TOKEN}`.

HTTP servers support these auth modes:

- `none`
- `apiKey`
- `bearer`
- `jwtBearer`
- `basic`

Bearer example:

```json
{
  "auth": {
    "type": "bearer",
    "token": "${GITHUB_TOKEN}"
  }
}
```

API key example:

```json
{
  "auth": {
    "type": "apiKey",
    "apiKeyName": "X-API-Key",
    "apiKeyValue": "${API_KEY}",
    "apiKeyIn": "header"
  }
}
```

Basic auth example:

```json
{
  "auth": {
    "type": "basic",
    "username": "${BASIC_USER}",
    "password": "${BASIC_PASSWORD}"
  }
}
```

Local stdio MCP servers:

```bash
curl -X POST http://localhost:8080/api/servers \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "filesystem",
    "name": "Filesystem MCP",
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    "env": {},
    "enabled": true,
    "weight": 1
  }'
```

## Configure an endpoint

Endpoints group one or more MCP servers into a scoped client-facing MCP URL. Endpoint usage and rate limits are tracked at the endpoint; MCP server records keep usage only for upstream observability.

Endpoint rate limits use a SQLite-backed token bucket keyed by endpoint ID. `requestsPerMinute` controls both the refill rate and the default burst capacity, so a value of `60` allows a burst of up to 60 requests and then refills at about one request per second. Multiple gateway replicas can share the same limit when they point at the same SQLite database file, but Kubernetes deployments must use storage with reliable SQLite file locking; high-throughput multi-replica deployments should prefer a dedicated shared limiter backend such as Redis.

```bash
curl -X POST http://localhost:8080/api/endpoints \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "dev-tools",
    "name": "Developer Tools",
    "description": "GitHub and filesystem tools for agents",
    "serverIds": ["github", "filesystem"],
    "rateLimit": {
      "requestsPerMinute": 60
    },
    "enabled": true
  }'
```

Scoped MCP endpoint:

```bash
curl -X POST http://localhost:8080/mcp/dev-tools \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## API

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/api/servers
curl http://localhost:8080/api/endpoints
curl http://localhost:8080/api/tools
curl -X POST http://localhost:8080/api/tools/refresh
```

Call a tool through an endpoint:

```bash
curl -X POST http://localhost:8080/api/endpoints/dev-tools/tools/github__search_repositories/call \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"query":"mcp gateway","perPage":5}}'
```

## Gateway meta-tools

The gateway exposes five built-in tools in the global catalog to reduce context bloat:

- `gateway_list_servers` — list configured upstream servers and status
- `gateway_list_tools` — list upstream tools, optionally scoped by `serverId`
- `gateway_search_tools` — search tools by keyword
- `gateway_refresh_tools` — refresh the cached upstream tool catalog, optionally scoped by `serverId`
- `gateway_invoke` — invoke an upstream tool by `toolName` or `serverId` plus `nativeName`

Direct tool calls through `/api/tools/{name}/call` are disabled so clients cannot bypass endpoint usage and rate limits.

Global MCP JSON-RPC catalog:

```bash
curl -X POST http://localhost:8080/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Scoped endpoint JSON-RPC:

```bash
curl -X POST http://localhost:8080/mcp/dev-tools \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"github__search_repositories","arguments":{"query":"mcp gateway"}}}'
```

## Implementation notes

- HTTP upstream servers are called with JSON-RPC over POST
- Local upstream servers are launched as child processes using stdio MCP framing
- Gateway tool names are prefixed as `<server_id>__<tool_name>` to avoid collisions
- MCP servers expose usage only; rate limits are configured and enforced on endpoints
- Tool discovery results and usage counters are persisted in SQLite
- `/mcp` can list the global catalog, but tool calls must use `/mcp/{endpointId}` so endpoint usage and rate limits are enforced
- `weight` is stored for routing policies, but the MVP routes explicitly by prefixed tool name

## Tests

```bash
make test
```
