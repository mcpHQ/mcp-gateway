package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rajdas/mcp-gateway/internal/auth"
	"github.com/rajdas/mcp-gateway/internal/config"
	"github.com/rajdas/mcp-gateway/internal/gateway"
	"github.com/rajdas/mcp-gateway/internal/web"
)

const shutdownTimeout = 10 * time.Second

func main() {
	addr := flag.String("addr", ":8080", "HTTP address to listen on")
	dbPath := flag.String("db", "mcp-gateway.db", "path to SQLite gateway database")
	adminEmail := flag.String("admin-email", envOrDefault("MCP_GATEWAY_ADMIN_EMAIL", auth.DefaultAdminEmail), "admin login email")
	adminPassword := flag.String("admin-password", envOrDefault("MCP_GATEWAY_ADMIN_PASSWORD", auth.DefaultAdminPassword), "admin login password used only when seeding the initial user")
	jwtSecret := flag.String("jwt-secret", os.Getenv("MCP_GATEWAY_JWT_SECRET"), "JWT signing secret; generated on startup when empty")
	flag.Parse()

	store, err := config.LoadStore(*dbPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer store.Close()

	authService, err := auth.NewService(store, auth.Config{
		AdminEmail:    *adminEmail,
		AdminPassword: *adminPassword,
		JWTSecret:     *jwtSecret,
	})
	if err != nil {
		log.Fatalf("initialize auth: %v", err)
	}

	gw := gateway.New(store)
	if err := gw.Start(context.Background()); err != nil {
		log.Fatalf("start gateway: %v", err)
	}
	defer gw.Close()

	server := &http.Server{
		Addr:              *addr,
		Handler:           web.NewHandler(gw, authService),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errs := make(chan error, 1)
	go func() {
		log.Printf("mcp gateway listening on http://localhost%s", *addr)
		errs <- server.ListenAndServe()
	}()

	stopCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	select {
	case <-stopCtx.Done():
		log.Printf("shutdown signal received, stopping server")
	case err := <-errs:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
		return
	}

	// Restore default signal handling so a second Ctrl+C can force the process down.
	stop()

	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("shutdown error: %v", err)
		if closeErr := server.Close(); closeErr != nil {
			log.Printf("force close error: %v", closeErr)
		}
	}

	if err := <-errs; err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("server error during shutdown: %v", err)
	}
	log.Printf("shutdown complete")
}

func envOrDefault(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
