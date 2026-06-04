.PHONY: help run dev build-ui generate check test clean-db k8s-deploy k8s-delete k8s-logs k8s-status k8s-apply

ADDR ?= :8080
DB ?= mcp-gateway.db
KUBE_NAMESPACE ?= default
KUBE_CONTEXT ?= 

help:
	@echo "Available targets:"
	@echo "  make run       Run the Go app locally"
	@echo "  make dev       Run the frontend dev server"
	@echo "  make build-ui  Build embedded frontend assets"
	@echo "  make generate  Generate Go API types from the OpenAPI spec"
	@echo "  make check     Verify generated API types and run tests"
	@echo "  make test      Run Go tests"
	@echo "  make clean-db  Remove the local SQLite database"
	@echo ""
	@echo "Kubernetes targets:"
	@echo "  make k8s-apply    Apply k8s configuration to cluster"
	@echo "  make k8s-deploy   Deploy/update the application"
	@echo "  make k8s-status   Check deployment status"
	@echo "  make k8s-logs     View application logs"
	@echo "  make k8s-delete   Delete the deployment from cluster"
	@echo ""
	@echo "Variables:"
	@echo "  ADDR=$(ADDR)"
	@echo "  DB=$(DB)"
	@echo "  KUBE_NAMESPACE=$(KUBE_NAMESPACE)"
	@echo "  KUBE_CONTEXT=$(KUBE_CONTEXT)"

run:
	go run . -addr "$(ADDR)" -db "$(DB)"

dev:
	npm run dev

build-ui:
	npm run build

generate:
	go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen -config api/oapi-codegen.yaml api/openapi.yaml

check: generate
	git diff --exit-code -- internal/web/openapi.gen.go
	$(MAKE) test

test:
	go test ./...

clean-db:
	rm -f "$(DB)"

k8s-apply:
	@echo "Applying Kubernetes configuration..."
	kubectl apply -f infra/k8s.yaml $(if $(KUBE_NAMESPACE),--namespace $(KUBE_NAMESPACE),) $(if $(KUBE_CONTEXT),--context $(KUBE_CONTEXT),)

k8s-deploy: build-ui k8s-apply
	@echo "Deployment applied successfully!"

k8s-status:
	@echo "Checking deployment status..."
	kubectl get deployments $(if $(KUBE_NAMESPACE),-n $(KUBE_NAMESPACE),) $(if $(KUBE_CONTEXT),--context $(KUBE_CONTEXT),)
	@echo ""
	kubectl get pods $(if $(KUBE_NAMESPACE),-n $(KUBE_NAMESPACE),) $(if $(KUBE_CONTEXT),--context $(KUBE_CONTEXT),)

k8s-logs:
	@echo "Fetching logs from mcp deployment..."
	kubectl logs -f deployment/mcp $(if $(KUBE_NAMESPACE),-n $(KUBE_NAMESPACE),) $(if $(KUBE_CONTEXT),--context $(KUBE_CONTEXT),) --tail=100

k8s-delete:
	@echo "Deleting Kubernetes resources..."
	kubectl delete -f infra/k8s.yaml $(if $(KUBE_NAMESPACE),--namespace $(KUBE_NAMESPACE),) $(if $(KUBE_CONTEXT),--context $(KUBE_CONTEXT),)
	@echo "Resources deleted."
