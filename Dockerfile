# syntax=docker/dockerfile:1

FROM node:22-alpine AS ui
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY ui ./ui
RUN npm run build

FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=ui /src/internal/web/static ./internal/web/static
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /mcp-gateway .

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /mcp-gateway /app/mcp-gateway
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["/app/mcp-gateway"]
CMD ["-addr", ":8080", "-db", "/data/mcp-gateway.db"]
