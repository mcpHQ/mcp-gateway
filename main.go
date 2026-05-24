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

	"github.com/rajdas/mcp-gateway/internal/config"
	"github.com/rajdas/mcp-gateway/internal/gateway"
	"github.com/rajdas/mcp-gateway/internal/web"
)

func main() {
	addr := flag.String("addr", ":8080", "HTTP address to listen on")
	dbPath := flag.String("db", "mcp-gateway.db", "path to SQLite gateway database")
	flag.Parse()

	store, err := config.LoadStore(*dbPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer store.Close()

	gw := gateway.New(store)
	if err := gw.Start(context.Background()); err != nil {
		log.Fatalf("start gateway: %v", err)
	}
	defer gw.Close()

	server := &http.Server{
		Addr:              *addr,
		Handler:           web.NewHandler(gw),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errs := make(chan error, 1)
	go func() {
		log.Printf("mcp gateway listening on http://localhost%s", *addr)
		errs <- server.ListenAndServe()
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	select {
	case sig := <-stop:
		log.Printf("received %s, shutting down", sig)
	case err := <-errs:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("shutdown error: %v", err)
	}
}
