# MCP Gateway

An open source control plane for [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) servers. Connect HTTP and stdio MCP servers, discover tools, group them into scoped endpoints, and manage secrets, rate limits, API keys, and usage from one lightweight Go service with a built-in web UI.

![MCP Gateway dashboard overview](docs/dashboard-overview.png)

## Quick start

```bash
docker run --rm -p 8080:8080 -v mcp-gateway-data:/data ghcr.io/mcpHQ/mcp-gateway
```

Open [http://localhost:8080](http://localhost:8080) and sign in with the default admin account (`admin@mcphq.org` / `admin`). Change the password after first login.

Gateway state is stored in the `mcp-gateway-data` volume at `/data/mcp-gateway.db`.

## Documentation

- [DEVELOPMENT.md](DEVELOPMENT.md) — local setup, configuration, API examples, frontend and backend development

## Project status

MCP Gateway is an early OSS project. Core gateway, admin UI, SQLite persistence, OpenAPI workflow, endpoint scoping, API keys, usage metrics, and audit logging are in place; production hardening is ongoing. Contributions are welcome.
