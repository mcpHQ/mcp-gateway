# Kubernetes manifests

Plain manifests for deploying [MCP Gateway](https://github.com/mcpHQ/mcp-gateway) without Helm. If you use Helm, prefer the chart in [`charts/mcp-gateway`](../../charts/mcp-gateway).

## What you get

- `mcp-gateway` namespace
- Secret with the initial admin password and JWT signing secret
- 1Gi `ReadWriteOnce` PersistentVolumeClaim for the SQLite database (`/data`)
- Single-replica Deployment (SQLite requires exclusive file access) with `/healthz` probes, non-root user, and read-only root filesystem — see [`docs/SCALABILITY.md`](../../docs/SCALABILITY.md) for why this can't be scaled horizontally yet and the plan to change that
- ClusterIP Service on port 8080
- Optional Ingress (disabled by default)

## Deploy

Edit `secret.yaml` first — set a real admin password and a random JWT secret (`openssl rand -hex 32`). Then:

```bash
kubectl apply -k deploy/kubernetes
```

Or without kustomize:

```bash
kubectl apply -f deploy/kubernetes/namespace.yaml
kubectl apply -f deploy/kubernetes/secret.yaml \
              -f deploy/kubernetes/pvc.yaml \
              -f deploy/kubernetes/deployment.yaml \
              -f deploy/kubernetes/service.yaml
```

Access the UI:

```bash
kubectl -n mcp-gateway port-forward svc/mcp-gateway 8080:8080
open http://localhost:8080
```

Sign in with `admin@mcphq.org` and the password from `secret.yaml`, then change it in the UI.

## Upstream secrets

Server configs can reference environment variables such as `${GITHUB_TOKEN}` for upstream auth. Add those variables to the container `env` in `deployment.yaml`, sourced from your own Secrets.

## Notes

- Keep `replicas: 1`. The gateway persists everything in a single SQLite file; multiple replicas need shared storage with reliable SQLite file locking, which most CSI drivers do not guarantee.
- The published image is minimal Alpine, so stdio MCP servers (e.g. `npx ...`) are unavailable in-cluster; use HTTP upstreams or build a custom image.
- Deleting the PVC deletes all gateway state (servers, endpoints, API keys, usage, audit logs).
