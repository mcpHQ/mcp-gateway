# Scaling MCP Gateway horizontally in Kubernetes

## Current state: single-replica only

MCP Gateway today is explicitly designed to run as **one pod**. Running more
than one replica is unsafe and unsupported:

1. **Embedded SQLite as the only data store** (`internal/config/config.go`).
   Servers, endpoints, API keys, tool records, usage records, audit logs, and
   rate-limit buckets all live in a single SQLite file opened with
   `sql.Open("sqlite", path)`. The Helm chart and raw Kubernetes manifests
   hard-code `replicaCount: 1` / `replicas: 1` and a `ReadWriteOnce` PVC with a
   `Recreate` deployment strategy, because SQLite requires exclusive access to
   its file.
2. **Per-process in-memory state with async flush** (`internal/gateway/gateway.go`).
   `Gateway` keeps `servers`, `endpoints`, `apiKeys`, `apiKeysByValue`,
   `toolCache`, and usage/rate-limit counters as in-memory maps that are
   loaded once at startup (`loadConfigCache`, `loadPersistedTools`,
   `loadPersistedUsage`) and periodically flushed back to SQLite
   (`flushUsageLoop`, `writeAuditLogsLoop`). Multiple pods would each hold a
   divergent copy of this state and would race to write the same SQLite file.
3. **Upstream MCP servers run as subprocesses inside the gateway process**
   (`internal/mcp/client.go` uses `exec.CommandContext` + stdio pipes). These
   connections are pinned to whichever pod spawned them; there is no
   shared/remote upstream connection pool, so replicas cannot share upstream
   sessions.
4. **JWT signing secret**. Token verification itself is stateless (no
   server-side session table), which *is* scale-friendly, but if
   `MCP_GATEWAY_JWT_SECRET` isn't set explicitly, the gateway generates one
   and persists it in the SQLite `settings` table on first boot — another
   implicit dependency on a single writer.

**Net effect:** you can scale the current gateway vertically (more CPU/RAM per
pod), but not horizontally. Running `replicas: 2` today can cause double
writes to SQLite, divergent tool caches, duplicated rate-limit/usage
accounting, and split-brain ownership of stdio upstream subprocesses.

## Redesign for horizontal scalability

### 1. Replace embedded SQLite with a shared, network-accessible database
Introduce a pluggable storage backend so `config.Store` can talk to a
client/server database (e.g. Postgres) reachable from every pod, while
keeping SQLite as the default for single-node/dev deployments. The existing
migration runner (`applyMigrations`, `migrationApplied`) needs to be made
concurrency-safe across pods (e.g. Postgres advisory locks, or a dedicated
migration Job that runs before the Deployment rolls out).

### 2. Externalize shared mutable state
- **Tool cache** (`toolCache`): either drop the long-lived in-memory cache in
  favor of query-through reads with a short TTL, or back it with a shared
  cache (Redis) that is invalidated on refresh.
- **Usage counters / rate-limit buckets** (`usageCounter`,
  `ConsumeRateLimitToken`): move to atomic operations against the shared
  store (Redis `INCR`/Lua, or the row-level `UPDATE ... RETURNING` pattern
  already partially used by `consumeRateLimitTokenOnce`) so limits are
  enforced correctly across all replicas instead of per-pod.
- **Audit logs / usage records**: keep the existing async batched-write
  design — it is already per-pod-safe — and simply point it at the shared
  database.

### 3. Decouple upstream MCP server processes from a single pod's lifecycle
- *Simplest*: let every gateway pod independently supervise the same
  configured upstream servers. This is fine for network/HTTP-based upstreams
  (`internal/mcp/http_client.go`), but stdio/subprocess upstreams would be
  spawned redundantly per pod (N pods × N subprocess copies) — wasteful, and
  incorrect for stateful upstreams.
- *Cleaner*: run stdio-based upstream MCP servers as their own
  Deployments/sidecars, exposed over HTTP/gRPC, so the gateway only ever
  talks to upstreams over the network. This removes the gateway's need to own
  OS processes and is the change most necessary for true horizontal scaling.
- *Alternative*: keep subprocess management, but introduce leader election
  (or a dedicated "worker" pod pool) that owns stdio subprocesses, while
  stateless "front door" replicas handle HTTP/API traffic and route tool
  calls to whichever pod owns the subprocess via internal RPC.

### 4. Externalize the JWT signing secret
Always provision `MCP_GATEWAY_JWT_SECRET` from a Kubernetes `Secret` in any
multi-replica deployment instead of relying on auto-generation. This is
already supported by the gateway (`internal/auth/auth.go` prefers the
configured secret over the DB-persisted one) and by the Helm chart/manifests
via `gateway.jwtSecret` / `existingSecret`.

### 5. Kubernetes/Helm deployment topology
- Make `replicaCount` configurable and add an opt-in
  `HorizontalPodAutoscaler` + `PodDisruptionBudget` for the stateless gateway
  tier (see `charts/mcp-gateway/templates/hpa.yaml` and `pdb.yaml`, gated
  behind `autoscaling.enabled` / `podDisruptionBudget.enabled`). These are
  scaffolded so they're ready to use once the storage backend above is
  externalized — they are **not** safe to enable while the gateway still
  runs on embedded SQLite, and the chart documents this.
- Once an external DB backend lands, replace the `ReadWriteOnce` PVC +
  `Recreate` strategy with either no PVC (fully stateless pods) or a
  `ReadWriteMany` volume only if some pods still need shared file access
  (e.g. locally mounted stdio server binaries).
- Add a separate Deployment/StatefulSet for any stdio-upstream "worker" tier
  from step 3.

### 6. SSE / long-lived connections
Check `internal/mcp/sse.go` and `internal/web/handler.go` for long-lived SSE
connections between client and gateway. Since such streams don't survive pod
restarts anyway, this is lower risk than the storage/subprocess issues above,
but should be verified — either rely on the Service/Ingress supporting sticky
sessions, or ensure clients reconnect and resume cleanly from any pod.

## Suggested incremental rollout

1. Introduce a storage interface abstraction over `config.Store` and add a
   Postgres implementation, keeping SQLite as the default for the existing
   single-node deployment mode.
2. Move rate-limiting/usage counters to atomic DB or Redis operations so
   correctness holds under N concurrent writers.
3. Split the "control plane" (HTTP API/UI + tool routing) from "upstream
   execution" (subprocess-owning workers) into separately deployable
   components communicating over gRPC/HTTP.
4. Update the Helm chart/kustomize manifests to support the multi-replica
   topology end-to-end (external DB connection secret, enabling the HPA/PDB
   scaffolding above, no PVC for the stateless tier).
5. Load-test with multiple replicas to validate rate-limit accuracy,
   tool-cache consistency, and failover behavior before recommending it as a
   production topology.

This document tracks the plan; items 1-4 above are not yet implemented in the
gateway itself and remain future work.
