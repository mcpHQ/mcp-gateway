# Development

## The problem we solve

MCP makes tools portable, but real deployments quickly become hard to manage:

- Teams end up with many MCP servers spread across local processes, hosted APIs, and vendor endpoints.
- Every client needs separate configuration for server URLs, commands, headers, tokens, and environment variables.
- Tool catalogs get noisy, duplicated, or stale as servers are added and restarted.
- There is no simple place to group tools by use case, apply endpoint-level limits, issue client keys, or inspect usage.
- Operators need audit logs, health checks, and a UI without turning a small tool gateway into a large platform project.

MCP Gateway puts a small, inspectable layer in front of your MCP servers. It centralizes server registration, tool discovery, endpoint scoping, usage tracking, and administration while still speaking MCP-compatible JSON-RPC to clients.

## Features

- Single Go binary with embedded Preact, Tailwind CSS, and DaisyUI admin UI.
- SQLite-backed configuration, migrations, tool catalog, usage counters, rate-limit buckets, users, API keys, and audit logs.
- Support for remote HTTP MCP servers and local stdio MCP servers.
- HTTP upstream authentication with `none`, `apiKey`, `bearer`, `jwtBearer`, and `basic` modes.
- Environment variable interpolation for sensitive upstream values such as `${GITHUB_TOKEN}`.
- Server lifecycle management: create, test, enable, disable, restart, delete, and refresh tools.
- Endpoint groups that expose selected MCP servers behind scoped URLs such as `/mcp/dev-tools`.
- Endpoint-level usage counters and SQLite-backed requests-per-minute rate limits.
- API keys that can be mapped to endpoint resources for client access control.
- Persisted tool discovery so dashboards and tool lists survive restarts.
- MCP JSON-RPC routes for `initialize`, `tools/list`, and endpoint-scoped `tools/call`.
- Built-in gateway meta-tools for listing servers, searching tools, refreshing the catalog, and invoking upstream tools.
- Admin login, password change, JWT sessions, and configurable initial admin credentials.
- Audit log for recent REST and MCP tool calls.
- REST admin API with OpenAPI docs served through Scalar at `/docs`.
- Spec-first backend workflow using `api/openapi.yaml` and generated Go API types.

## How it works

1. Register upstream MCP servers in the UI or REST API.
2. The gateway starts enabled servers and discovers their tools.
3. Tools are stored with gateway-safe names like `<server_id>__<tool_name>` to avoid collisions.
4. Create endpoints that group one or more servers for a specific agent, app, team, or workflow.
5. MCP clients call `/mcp/{endpointId}` to list and invoke only the tools attached to that endpoint.
6. The gateway records usage, enforces endpoint rate limits, and writes audit events.

## Run locally

```bash
go run . -addr :8080
```

Or with Make:

```bash
make run
```

Open [http://localhost:8080](http://localhost:8080) and sign in with the default admin account:

```text
Email: admin@mcphq.org
Password: admin
```

On first run, the app creates `mcp-gateway.db` and applies embedded SQL migrations from `internal/config/migrations`.

### Flags and environment variables

| Flag / env | Default | Description |
|------------|---------|-------------|
| `-addr` | `:8080` | HTTP listen address |
| `-db` | `mcp-gateway.db` | Path to the SQLite database |
| `-admin-email` / `MCP_GATEWAY_ADMIN_EMAIL` | `admin@mcphq.org` | Admin login email (used when seeding the initial user) |
| `-admin-password` / `MCP_GATEWAY_ADMIN_PASSWORD` | `admin` | Admin password (used when seeding the initial user) |
| `-jwt-secret` / `MCP_GATEWAY_JWT_SECRET` | _(generated on startup)_ | JWT signing secret |

Example with overrides:

```bash
go run . \
  -addr :8080 \
  -db mcp-gateway.db \
  -admin-email "$MCP_GATEWAY_ADMIN_EMAIL" \
  -admin-password "$MCP_GATEWAY_ADMIN_PASSWORD" \
  -jwt-secret "$MCP_GATEWAY_JWT_SECRET"
```

Change the admin password from the UI after first login.

## Docker

### Published images

Images are built and pushed to GitHub Container Registry by the [`docker` workflow](.github/workflows/docker.yml):

- Pushes to `main` publish `ghcr.io/mcphq/mcp-gateway:latest` (plus `main` and `sha-<commit>` tags).
- Version tags like `v1.2.3` publish `1.2.3`, `1.2`, and `1` tags.
- Pull requests build the image (both `linux/amd64` and `linux/arm64`) without pushing.

### Build

```bash
docker build -t mcp-gateway .
```

### Run

Published image:

```bash
docker run --rm -p 8080:8080 -v mcp-gateway-data:/data ghcr.io/mcphq/mcp-gateway
```

Local build:

```bash
docker run --rm -p 8080:8080 -v mcp-gateway-data:/data mcp-gateway
```

Override admin credentials at runtime:

```bash
docker run --rm -p 8080:8080 \
  -v mcp-gateway-data:/data \
  -e MCP_GATEWAY_ADMIN_EMAIL=admin@example.com \
  -e MCP_GATEWAY_ADMIN_PASSWORD=change-me \
  -e MCP_GATEWAY_JWT_SECRET=your-secret \
  mcp-gateway
```

Stdio upstream servers (for example `npx @modelcontextprotocol/server-filesystem`) are not available in the minimal Alpine image. Use a custom image or run the gateway on the host when you need local stdio MCP processes.

## Kubernetes

Two deployment options ship with the repository:

- **Helm chart** in [`charts/mcp-gateway`](charts/mcp-gateway/README.md) — configurable image, persistence, ingress, secrets, probes, and upstream env interpolation.
- **Plain manifests** in [`deploy/kubernetes`](deploy/kubernetes/README.md) — `kubectl apply -k deploy/kubernetes` with a namespace, Secret, PVC, Deployment, Service, and optional Ingress.

Both run a single replica with a `ReadWriteOnce` volume because state lives in an embedded SQLite database (see [Operational notes](#operational-notes)).

## Configure a server

Use the UI for the fastest setup. Presets are defined in `ui/src/mcp-presets.json` and include custom HTTP MCP, GitHub Remote MCP, filesystem stdio, and memory stdio examples.

You can also use the REST API. Admin API routes require a bearer token from `/api/auth/login`.

```bash
curl -X POST http://localhost:8080/api/servers \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "github",
    "name": "GitHub MCP",
    "transport": "http",
    "url": "https://api.githubcopilot.com/mcp/",
    "auth": {
      "type": "bearer",
      "token": "${GITHUB_TOKEN}"
    },
    "enabled": true,
    "weight": 1
  }'
```

Local stdio MCP servers:

```bash
curl -X POST http://localhost:8080/api/servers \
  -H 'Authorization: Bearer <admin-token>' \
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

Endpoints group one or more MCP servers into a scoped client-facing MCP URL. Endpoint usage and rate limits are tracked at the endpoint; server records keep usage for upstream observability.

`requestsPerMinute` controls both the refill rate and default burst capacity. For example, `60` allows a burst of up to 60 requests and then refills at about one request per second.

```bash
curl -X POST http://localhost:8080/api/endpoints \
  -H 'Authorization: Bearer <admin-token>' \
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

List tools through the scoped MCP endpoint:

```bash
curl -X POST http://localhost:8080/mcp/dev-tools \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Call a tool through the scoped MCP endpoint:

```bash
curl -X POST http://localhost:8080/mcp/dev-tools \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"github__search_repositories","arguments":{"query":"mcp gateway"}}}'
```

## API keys

API keys can be created in the UI or REST API and mapped to endpoint IDs. Client REST routes for endpoint tools use the `X-API-Key` header.

```bash
curl -X POST http://localhost:8080/api/api-keys \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "dev-agent",
    "name": "Dev Agent",
    "value": "replace-with-a-generated-secret",
    "endpointIds": ["dev-tools"],
    "enabled": true
  }'
```

Call a tool through the REST endpoint route:

```bash
curl -X POST http://localhost:8080/api/endpoints/dev-tools/tools/github__search_repositories/call \
  -H 'X-API-Key: replace-with-a-generated-secret' \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"query":"mcp gateway","perPage":5}}'
```

## Gateway meta-tools

The global MCP catalog exposes built-in meta-tools that help clients inspect and use the gateway without loading every upstream tool into context:

- `gateway_list_servers` — list configured upstream servers and status
- `gateway_list_tools` — list upstream tools, optionally scoped by `serverId`
- `gateway_search_tools` — search tools by keyword
- `gateway_refresh_tools` — refresh the cached upstream tool catalog, optionally scoped by `serverId`
- `gateway_invoke` — invoke an upstream tool by `toolName` or `serverId` plus `nativeName`

Use `/mcp` to inspect the global catalog:

```bash
curl -X POST http://localhost:8080/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Tool calls must use `/mcp/{endpointId}` so endpoint usage and rate limits are enforced.

## Admin API and docs

Open the API documentation at [http://localhost:8080/docs](http://localhost:8080/docs). The raw OpenAPI document is served at [http://localhost:8080/openapi.yaml](http://localhost:8080/openapi.yaml).

Useful routes:

```bash
curl http://localhost:8080/healthz
curl -H 'Authorization: Bearer <admin-token>' http://localhost:8080/api/servers
curl -H 'Authorization: Bearer <admin-token>' http://localhost:8080/api/endpoints
curl -H 'Authorization: Bearer <admin-token>' http://localhost:8080/api/api-keys
curl -H 'Authorization: Bearer <admin-token>' http://localhost:8080/api/tools
curl -H 'Authorization: Bearer <admin-token>' http://localhost:8080/api/audit-logs
curl -X POST -H 'Authorization: Bearer <admin-token>' http://localhost:8080/api/tools/refresh
```

## Frontend development

The UI is built with Preact, Vite, Tailwind CSS, and DaisyUI. Built assets are emitted into `internal/web/static` so Go can embed them.

```bash
npm install
npm run dev
```

Build embedded frontend assets:

```bash
npm run build
```

## Backend development

Common commands:

```bash
make run
make test
make check
```

The backend API contract is defined in `api/openapi.yaml`. Update the spec first when adding or changing REST admin routes or MCP JSON-RPC HTTP shapes, then regenerate Go API types:

```bash
make generate
```

Generated Go types are written to `internal/web/openapi.gen.go`. The current implementation keeps the existing `net/http` route behavior in `internal/web/handler.go` while using generated types at low-risk HTTP boundaries.

## Operational notes

- HTTP upstream servers are called with JSON-RPC over POST.
- Local upstream servers are launched as child processes using stdio MCP framing.
- Tool discovery results, usage counters, and audit logs are persisted in SQLite.
- Endpoint rate limits use a SQLite-backed token bucket keyed by endpoint ID.
- Multiple gateway replicas can share limits only when they point at the same SQLite database file and the storage layer provides reliable SQLite file locking.
- High-throughput multi-replica deployments should prefer a dedicated shared limiter backend in the future.
- `weight` is stored for future routing policies; the current gateway routes explicitly by prefixed tool name.

## Tests

```bash
make test
```
