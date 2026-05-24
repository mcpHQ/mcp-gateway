package mcp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
)

// parseSSEResponse extracts a JSON-RPC response from an SSE body, preferring the
// event whose id matches wantID when wantID is non-zero.
func parseSSEResponse(body []byte, wantID int64) (response, error) {
	for _, data := range parseSSEDataLines(body) {
		data = bytes.TrimSpace(data)
		if len(data) == 0 {
			continue
		}

		var rpc response
		if err := json.Unmarshal(data, &rpc); err != nil {
			continue
		}
		if rpc.ID == 0 && rpc.Result == nil && rpc.Error == nil {
			continue
		}
		if wantID != 0 && rpc.ID == wantID {
			return rpc, nil
		}
	}

	for _, data := range parseSSEDataLines(body) {
		data = bytes.TrimSpace(data)
		if len(data) == 0 {
			continue
		}
		var rpc response
		if err := json.Unmarshal(data, &rpc); err != nil {
			continue
		}
		if rpc.ID != 0 || rpc.Result != nil || rpc.Error != nil {
			return rpc, nil
		}
	}

	return response{}, errors.New("no JSON-RPC response found in SSE stream")
}

func parseSSEResponseStream(r io.Reader, wantID int64) (response, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var dataLines []string
	var fallback response
	hasFallback := false

	flushEvent := func() (response, bool) {
		if len(dataLines) == 0 {
			return response{}, false
		}
		data := strings.TrimSpace(strings.Join(dataLines, "\n"))
		dataLines = nil
		if data == "" {
			return response{}, false
		}

		var rpc response
		if err := json.Unmarshal([]byte(data), &rpc); err != nil {
			return response{}, false
		}
		if rpc.ID == 0 && rpc.Result == nil && rpc.Error == nil {
			return response{}, false
		}
		if wantID == 0 || rpc.ID == wantID {
			return rpc, true
		}
		if !hasFallback {
			fallback = rpc
			hasFallback = true
		}
		return response{}, false
	}

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			if rpc, ok := flushEvent(); ok {
				return rpc, nil
			}
			continue
		}
		if strings.HasPrefix(line, "data:") {
			dataLines = append(dataLines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	if err := scanner.Err(); err != nil {
		return response{}, err
	}
	if rpc, ok := flushEvent(); ok {
		return rpc, nil
	}
	if hasFallback {
		return fallback, nil
	}
	return response{}, errors.New("no JSON-RPC response found in SSE stream")
}

// parseSSEDataLines returns concatenated data payloads from SSE events in order.
func parseSSEDataLines(body []byte) [][]byte {
	events := splitSSEEvents(body)
	out := make([][]byte, 0, len(events))
	for _, event := range events {
		if data := joinSSEDataLines(event); len(data) > 0 {
			out = append(out, data)
		}
	}
	return out
}

func splitSSEEvents(body []byte) []string {
	normalized := strings.ReplaceAll(string(body), "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	return strings.Split(normalized, "\n\n")
}

func joinSSEDataLines(event string) []byte {
	var parts []string
	for _, line := range strings.Split(event, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "data:") {
			parts = append(parts, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	if len(parts) == 0 {
		return nil
	}
	return []byte(strings.Join(parts, "\n"))
}
