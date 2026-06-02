FROM golang:latest

WORKDIR /app
COPY . .

EXPOSE 8080

ENV MCP_GATEWAY_ADMIN_EMAIL=admin@example.com
ENV MCP_GATEWAY_ADMIN_PASSWORD=password123
ENV MCP_GATEWAY_JWT_SECRET=mysecret

CMD go run . \
    -addr :8080 \
    -db mcp-gateway.db \
    -admin-email "$MCP_GATEWAY_ADMIN_EMAIL" \
    -admin-password "$MCP_GATEWAY_ADMIN_PASSWORD" \
    -jwt-secret "$MCP_GATEWAY_JWT_SECRET"