package auth

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/rajdas/mcp-gateway/internal/config"
	"golang.org/x/crypto/bcrypt"
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

func TestBearerToken(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   string
	}{
		{name: "valid", header: "Bearer " + "token-value", want: "token-value"},
		{name: "trims token", header: "Bearer " + "token-value  ", want: "token-value"},
		{name: "wrong scheme", header: "Basic token-value"},
		{name: "missing token", header: "Bearer "},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := BearerToken(test.header); got != test.want {
				t.Fatalf("BearerToken(%q) = %q, want %q", test.header, got, test.want)
			}
		})
	}
}

func TestHashPassword(t *testing.T) {
	if _, err := HashPassword(" "); !errors.Is(err, ErrPasswordRequired) {
		t.Fatalf("HashPassword blank error = %v, want %v", err, ErrPasswordRequired)
	}

	hash, err := HashPassword("secret")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte("secret")); err != nil {
		t.Fatalf("hashed password does not validate: %v", err)
	}
}

func TestLoginAndChangePassword(t *testing.T) {
	store := newAuthTestStore(t)
	defer store.Close()

	service, err := NewService(store, Config{
		AdminEmail:    "Admin@Example.com",
		AdminPassword: "old-password",
		JWTSecret:     "test-secret",
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}

	if _, err := service.Login("admin@example.com", "wrong-password"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("invalid login error = %v, want %v", err, ErrInvalidCredentials)
	}
	session, err := service.Login("admin@example.com", "old-password")
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if session.User.PasswordHash != "" || session.User.Email != "admin@example.com" {
		t.Fatalf("login returned unsafe user: %#v", session.User)
	}

	if err := service.ChangePassword("admin@example.com", "old-password", "new-password"); err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}
	if _, err := service.Login("admin@example.com", "old-password"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("old password login error = %v, want %v", err, ErrInvalidCredentials)
	}
	if _, err := service.Login("admin@example.com", "new-password"); err != nil {
		t.Fatalf("new password login: %v", err)
	}
	if err := service.ChangePassword("admin@example.com", "new-password", " "); !errors.Is(err, ErrPasswordRequired) {
		t.Fatalf("blank new password error = %v, want %v", err, ErrPasswordRequired)
	}
}

func TestUserFromTokenRejectsTamperedAndExpiredTokens(t *testing.T) {
	store := newAuthTestStore(t)
	defer store.Close()

	service, err := NewService(store, Config{JWTSecret: "test-secret", TTL: time.Minute})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	session, err := service.Login(DefaultAdminEmail, DefaultAdminPassword)
	if err != nil {
		t.Fatalf("Login: %v", err)
	}

	tampered := session.Token[:len(session.Token)-1] + "x"
	if _, err := service.UserFromToken(tampered); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("tampered token error = %v, want %v", err, ErrInvalidToken)
	}
	user := config.User{ID: "admin", Email: DefaultAdminEmail}
	expired, err := service.issueToken(user, time.Now().Add(-2*time.Minute))
	if err != nil {
		t.Fatalf("issue expired token: %v", err)
	}
	if _, err := service.UserFromToken(expired); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("expired token error = %v, want %v", err, ErrInvalidToken)
	}
}

func newAuthTestStore(t testing.TB) *config.Store {
	t.Helper()
	store, err := config.LoadStore(filepath.Join(t.TempDir(), "gateway.db"))
	if err != nil {
		t.Fatalf("load store: %v", err)
	}
	return store
}
