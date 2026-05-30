package auth

import (
	"path/filepath"
	"testing"

	"github.com/rajdas/mcp-gateway/internal/config"
)

func TestGeneratedJWTSecretPersistsAcrossRestart(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "gateway.db")
	store, err := config.LoadStore(dbPath)
	if err != nil {
		t.Fatalf("load store: %v", err)
	}

	service, err := NewService(store, Config{
		AdminEmail:    DefaultAdminEmail,
		AdminPassword: DefaultAdminPassword,
	})
	if err != nil {
		t.Fatalf("create auth service: %v", err)
	}
	session, err := service.Login(DefaultAdminEmail, DefaultAdminPassword)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	restartedStore, err := config.LoadStore(dbPath)
	if err != nil {
		t.Fatalf("reload store: %v", err)
	}
	defer restartedStore.Close()

	restartedService, err := NewService(restartedStore, Config{
		AdminEmail:    DefaultAdminEmail,
		AdminPassword: DefaultAdminPassword,
	})
	if err != nil {
		t.Fatalf("recreate auth service: %v", err)
	}
	user, err := restartedService.UserFromToken(session.Token)
	if err != nil {
		t.Fatalf("validate token after restart: %v", err)
	}
	if user.Email != DefaultAdminEmail {
		t.Fatalf("expected user %q, got %q", DefaultAdminEmail, user.Email)
	}
}
