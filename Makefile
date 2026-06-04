.PHONY: help run dev build-ui generate check test clean-db

ADDR ?= :8080
DB ?= mcp-gateway.db

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
	@echo "Variables:"
	@echo "  ADDR=$(ADDR)"
	@echo "  DB=$(DB)"

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
