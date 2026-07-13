# Nexora Makefile — convenience targets for local development and ops.

BINARY      := nexora
VERSION     ?= dev
CMD         := ./cmd/nexora
DATA_DIR    := ./data
PKG         := ./...

.PHONY: help build run dev test vet tidy fmt clean docker-build docker-up docker-down lint web-build web-install

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

build: ## Build the server binary into ./bin
	mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X github.com/nexora/nexora/internal/api.Version=$(VERSION)" -o bin/$(BINARY) $(CMD)

run: ## Run the server locally (uses .env if present)
	mkdir -p $(DATA_DIR)
	go run $(CMD)

dev: ## Run the server with hot rebuild disabled (use air separately if desired)
	go run $(CMD)

test: ## Run backend tests
	go test $(PKG) -count=1

vet: ## Run go vet
	go vet $(PKG)

tidy: ## Tidy go modules
	go mod tidy

fmt: ## Format code
	go fmt $(PKG)

lint: tidy vet ## Tidy and vet

clean: ## Remove build artifacts
	rm -rf bin data/nexora.db data/nexora.db-* web/dist

web-install: ## Install frontend dependencies
	cd web && npm install

web-build: ## Build the frontend into web/dist
	cd web && npm run build

docker-build: ## Build the production image
	docker build -t nexora:$(VERSION) --build-arg VERSION=$(VERSION) .

docker-up: ## Start via docker compose
	docker compose up -d --build

docker-down: ## Stop docker compose
	docker compose down
