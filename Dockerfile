# syntax=docker/dockerfile:1

# Build stages run on the host architecture and cross-compile, so multi-arch
# images (linux/amd64, linux/arm64) build without QEMU emulation.
FROM --platform=$BUILDPLATFORM node:22-alpine AS ui
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY ui ./ui
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=ui /src/internal/web/static ./internal/web/static
ARG TARGETOS TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /mcp-gateway .

FROM alpine:3.21

# org.opencontainers.image.source links the GHCR package to the repository so
# it inherits visibility and shows the repo README on the package page.
LABEL org.opencontainers.image.title="MCP Gateway" \
      org.opencontainers.image.description="An open source control plane for Model Context Protocol (MCP) servers." \
      org.opencontainers.image.source="https://github.com/mcpHQ/mcp-gateway" \
      org.opencontainers.image.url="https://github.com/mcpHQ/mcp-gateway"

RUN apk add --no-cache ca-certificates \
    && addgroup -g 65532 -S mcp-gateway \
    && adduser -u 65532 -S -G mcp-gateway -H -D mcp-gateway \
    && mkdir -p /data \
    && chown mcp-gateway:mcp-gateway /data
WORKDIR /app
COPY --from=build /mcp-gateway /app/mcp-gateway
USER 65532:65532
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["/app/mcp-gateway"]
CMD ["-addr", ":8080", "-db", "/data/mcp-gateway.db"]
