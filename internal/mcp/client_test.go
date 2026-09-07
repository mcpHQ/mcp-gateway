package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"
)

// TestMain intercepts a special environment variable so this same test
// binary can be exec'd as a fake stdio MCP server (mirroring the
// os/exec_test.go "helper process" pattern). When the flag is set we run
// the helper loop and exit before the normal go test machinery starts,
// avoiding recursive test execution in the child process.
func TestMain(m *testing.M) {
	if os.Getenv("MCP_TEST_STDIO_HELPER") == "1" {
		runStdioHelperProcess()
		return
	}
	os.Exit(m.Run())
}

// runStdioHelperProcess implements a minimal JSON-RPC stdio MCP server used
// by client_test.go. It supports initialize, notifications/initialized, and
// a paginated tools/list.
func runStdioHelperProcess() {
	reader := bufio.NewReader(os.Stdin)
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			return
		}
		var req map[string]any
		if err := json.Unmarshal(line, &req); err != nil {
			continue
		}
		method, _ := req["method"].(string)
		idVal, hasID := req["id"]

		switch method {
		case "initialize":
			writeMessage(os.Stdout, map[string]any{
				"jsonrpc": "2.0",
				"id":      idVal,
				"result": map[string]any{
					"protocolVersion": protocolVersion,
					"capabilities":    map[string]any{},
					"serverInfo":      map[string]any{"name": "fake", "version": "1"},
				},
			})
		case "notifications/initialized":
			// no response expected
		case "tools/list":
			params, _ := req["params"].(map[string]any)
			cursor, _ := params["cursor"].(string)
			result := map[string]any{}
			if cursor == "" {
				result["tools"] = []map[string]any{{"name": "alpha"}}
				result["nextCursor"] = "page-2"
			} else {
				result["tools"] = []map[string]any{{"name": "beta"}}
			}
			writeMessage(os.Stdout, map[string]any{
				"jsonrpc": "2.0",
				"id":      idVal,
				"result":  result,
			})
		default:
			if hasID {
				writeMessage(os.Stdout, map[string]any{
					"jsonrpc": "2.0",
					"id":      idVal,
					"error":   map[string]any{"code": -32601, "message": "method not found"},
				})
			}
		}
	}
}

func newStdioTestClient(t *testing.T) *Client {
	t.Helper()
	client := NewClient("test", os.Args[0], nil, map[string]string{
		"MCP_TEST_STDIO_HELPER": "1",
	})
	t.Cleanup(client.Stop)
	return client
}

func TestClientProcessSurvivesStartContextCancellation(t *testing.T) {
	client := newStdioTestClient(t)

	startCtx, cancel := context.WithCancel(context.Background())
	if err := client.Start(startCtx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	// Simulate the request context ending right after save/enable/restart
	// completes (e.g. the HTTP handler returning). The stdio process must
	// keep running.
	cancel()
	time.Sleep(50 * time.Millisecond)

	if !client.Status().Running {
		t.Fatalf("expected client to remain running after start ctx cancellation, status=%+v", client.Status())
	}

	tools, err := client.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools after start ctx cancellation: %v", err)
	}
	if len(tools) == 0 {
		t.Fatalf("expected tools from still-running process, got none")
	}
}

func TestClientListToolsPaginates(t *testing.T) {
	client := newStdioTestClient(t)
	if err := client.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}

	tools, err := client.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	if len(tools) != 2 || tools[0].Name != "alpha" || tools[1].Name != "beta" {
		t.Fatalf("unexpected tools: %+v", tools)
	}
}
