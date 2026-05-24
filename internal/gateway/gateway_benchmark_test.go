package gateway

import (
	"context"
	"fmt"
	"testing"

	"github.com/rajdas/mcp-gateway/internal/config"
	"github.com/rajdas/mcp-gateway/internal/mcp"
)

func BenchmarkToolsCached(b *testing.B) {
	gw := newBenchmarkGateway(b, 4, 100)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := gw.Tools(context.Background()); err != nil {
			b.Fatalf("Tools: %v", err)
		}
	}
}

func BenchmarkEndpointToolsCached(b *testing.B) {
	gw := newBenchmarkGateway(b, 4, 100)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := gw.EndpointTools(context.Background(), "bench-endpoint"); err != nil {
			b.Fatalf("EndpointTools: %v", err)
		}
	}
}

func BenchmarkCallEndpointToolParallel(b *testing.B) {
	gw := newBenchmarkGateway(b, 4, 25)
	toolName := "bench-0__tool_0"

	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			if _, err := gw.CallEndpointTool(context.Background(), "bench-endpoint", toolName, map[string]any{}); err != nil {
				b.Fatalf("CallEndpointTool: %v", err)
			}
		}
	})
}

func newBenchmarkGateway(b *testing.B, serverCount, toolsPerServer int) *Gateway {
	b.Helper()

	store := newTestStore(b)
	b.Cleanup(func() {
		store.Close()
	})

	withFakeUpstream(b, nil)
	newUpstream = func(server config.Server) mcp.Upstream {
		return &fakeUpstream{tools: benchmarkTools(toolsPerServer)}
	}

	gw := New(store)
	for i := 0; i < serverCount; i++ {
		server := config.Server{
			ID:        fmt.Sprintf("bench-%d", i),
			Name:      fmt.Sprintf("Bench %d", i),
			Transport: "stdio",
			Command:   "fake",
			Enabled:   true,
			Weight:    1,
		}
		if err := gw.UpsertServer(context.Background(), server); err != nil {
			b.Fatalf("upsert server: %v", err)
		}
	}
	if err := gw.UpsertEndpoint(config.Endpoint{
		ID:        "bench-endpoint",
		Name:      "Bench Endpoint",
		ServerIDs: []string{"bench-0", "bench-1", "bench-2", "bench-3"},
		Enabled:   true,
	}); err != nil {
		b.Fatalf("upsert endpoint: %v", err)
	}
	b.Cleanup(gw.Close)
	return gw
}

func benchmarkTools(count int) []mcp.Tool {
	tools := make([]mcp.Tool, count)
	for i := range tools {
		tools[i] = mcp.Tool{
			Name:        fmt.Sprintf("tool_%d", i),
			Description: "benchmark tool",
		}
	}
	return tools
}
