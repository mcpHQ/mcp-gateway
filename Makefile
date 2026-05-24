.PHONY: help run dev build-ui test clean-db

ADDR ?= :8080
DB ?= mcp-gateway.db

help:
	@echo "Available targets:"
	@echo "  make run       Run the Go app locally"
	@echo "  make dev       Run the frontend dev server"
	@echo "  make build-ui  Build embedded frontend assets"
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

test:
	go test ./...

clean-db:
	rm -f "$(DB)"
