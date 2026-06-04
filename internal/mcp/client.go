package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const protocolVersion = "2024-11-05"

type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	InputSchema json.RawMessage `json:"inputSchema,omitempty"`
}

type CallResult struct {
	Content []map[string]any `json:"content,omitempty"`
	IsError bool             `json:"isError,omitempty"`
}

type Upstream interface {
	Start(ctx context.Context) error
	Stop()
	Status() Status
	ListTools(ctx context.Context) ([]Tool, error)
	CallTool(ctx context.Context, name string, args map[string]any) (CallResult, error)
}

type Client struct {
	id      string
	command string
	args    []string
	env     map[string]string

	mu      sync.Mutex
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	pending map[int64]chan response
	seq     atomic.Int64

	statusMu sync.RWMutex
	status   Status
}

type Status struct {
	Running bool   `json:"running"`
	Error   string `json:"error,omitempty"`
}

type request struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int64  `json:"id,omitempty"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int64           `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func NewClient(id, command string, args []string, env map[string]string) *Client {
	return &Client{
		id:      id,
		command: command,
		args:    append([]string(nil), args...),
		env:     cloneEnv(env),
		pending: map[int64]chan response{},
	}
}

func (c *Client) Start(ctx context.Context) error {
	c.mu.Lock()
	if c.cmd != nil && c.cmd.Process != nil {
		c.mu.Unlock()
		return nil
	}

	cmd := exec.CommandContext(ctx, c.command, c.args...)
	cmd.Env = os.Environ()
	for key, value := range c.env {
		cmd.Env = append(cmd.Env, key+"="+value)
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		c.mu.Unlock()
		c.setError(err)
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		c.mu.Unlock()
		c.setError(err)
		return err
	}
	cmd.Stderr = io.Discard

	if err := cmd.Start(); err != nil {
		c.mu.Unlock()
		c.setError(err)
		return err
	}

	c.cmd = cmd
	c.stdin = stdin
	c.pending = map[int64]chan response{}
	c.setRunning(true)
	c.mu.Unlock()

	go c.readLoop(stdout)
	go c.waitLoop(cmd)

	initParams := map[string]any{
		"protocolVersion": protocolVersion,
		"capabilities":    map[string]any{},
		"clientInfo": map[string]any{
			"name":    "mcp-gateway",
			"version": "0.1.0",
		},
	}
	if _, err := c.call(ctx, "initialize", initParams); err != nil {
		c.Stop()
		return err
	}

	return c.notify("notifications/initialized", map[string]any{})
}

func (c *Client) Stop() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.stdin != nil {
		_ = c.stdin.Close()
	}
	if c.cmd != nil && c.cmd.Process != nil {
		_ = c.cmd.Process.Kill()
	}
	c.cmd = nil
	c.stdin = nil
	c.setRunning(false)
}

func (c *Client) Status() Status {
	c.statusMu.RLock()
	defer c.statusMu.RUnlock()
	return c.status
}

func (c *Client) ListTools(ctx context.Context) ([]Tool, error) {
	result, err := c.call(ctx, "tools/list", map[string]any{})
	if err != nil {
		return nil, err
	}

	var payload struct {
		Tools []Tool `json:"tools"`
	}
	if err := json.Unmarshal(result, &payload); err != nil {
		return nil, err
	}
	return payload.Tools, nil
}

func (c *Client) CallTool(ctx context.Context, name string, args map[string]any) (CallResult, error) {
	result, err := c.call(ctx, "tools/call", map[string]any{
		"name":      name,
		"arguments": args,
	})
	if err != nil {
		return CallResult{}, err
	}

	var payload CallResult
	if err := json.Unmarshal(result, &payload); err != nil {
		return CallResult{}, err
	}
	return payload, nil
}

func (c *Client) call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	id := c.seq.Add(1)
	ch := make(chan response, 1)

	c.mu.Lock()
	if c.stdin == nil {
		c.mu.Unlock()
		return nil, errors.New("server is not running")
	}
	c.pending[id] = ch
	err := writeMessage(c.stdin, request{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	})
	c.mu.Unlock()

	if err != nil {
		c.removePending(id)
		c.setError(err)
		return nil, err
	}

	select {
	case res := <-ch:
		if res.Error != nil {
			return nil, errors.New(res.Error.Message)
		}
		return res.Result, nil
	case <-ctx.Done():
		c.removePending(id)
		return nil, ctx.Err()
	case <-time.After(20 * time.Second):
		c.removePending(id)
		return nil, errors.New("mcp request timed out")
	}
}

func (c *Client) notify(method string, params any) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.stdin == nil {
		return errors.New("server is not running")
	}
	return writeMessage(c.stdin, map[string]any{
		"jsonrpc": "2.0",
		"method":  method,
		"params":  params,
	})
}

func (c *Client) readLoop(stdout io.Reader) {
	reader := bufio.NewReader(stdout)
	for {
		payload, err := readMessage(reader)
		if err != nil {
			if !errors.Is(err, io.EOF) {
				c.setError(err)
			}
			return
		}

		var res response
		if err := json.Unmarshal(payload, &res); err != nil || res.ID == 0 {
			continue
		}

		c.mu.Lock()
		ch := c.pending[res.ID]
		delete(c.pending, res.ID)
		c.mu.Unlock()

		if ch != nil {
			ch <- res
		}
	}
}

func (c *Client) waitLoop(cmd *exec.Cmd) {
	err := cmd.Wait()
	c.mu.Lock()
	if c.cmd == cmd {
		c.cmd = nil
		c.stdin = nil
	}
	for id, ch := range c.pending {
		delete(c.pending, id)
		ch <- response{Error: &rpcError{Code: -32000, Message: "server stopped"}}
	}
	c.mu.Unlock()

	c.setRunning(false)
	if err != nil {
		c.setError(err)
	}
}

func (c *Client) removePending(id int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.pending, id)
}

func (c *Client) setRunning(running bool) {
	c.statusMu.Lock()
	defer c.statusMu.Unlock()
	c.status.Running = running
	if running {
		c.status.Error = ""
	}
}

func (c *Client) setError(err error) {
	c.statusMu.Lock()
	defer c.statusMu.Unlock()
	c.status.Error = err.Error()
}

func writeMessage(w io.Writer, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	_, err = w.Write(payload)
	return err
}

func readMessage(reader *bufio.Reader) ([]byte, error) {
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			return nil, err
		}
		line = []byte(strings.TrimSpace(string(line)))
		if len(line) == 0 {
			continue
		}
		return line, nil
	}
}

func cloneEnv(env map[string]string) map[string]string {
	out := make(map[string]string, len(env))
	for key, value := range env {
		out[key] = value
	}
	return out
}
