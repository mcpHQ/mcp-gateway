package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/rajdas/mcp-gateway/internal/config"
	"golang.org/x/crypto/bcrypt"
)

const (
	DefaultAdminEmail    = "admin@mcphq.org"
	DefaultAdminPassword = "admin"
	DefaultIssuer        = "mcp-gateway"
	DefaultTTL           = 24 * time.Hour
)

var (
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrInvalidToken       = errors.New("invalid token")
	ErrPasswordRequired   = errors.New("password is required")
)

type Config struct {
	AdminEmail    string
	AdminPassword string
	JWTSecret     string
	Issuer        string
	TTL           time.Duration
}

type Service struct {
	store  *config.Store
	secret []byte
	issuer string
	ttl    time.Duration
}

type Session struct {
	Token string      `json:"token"`
	User  config.User `json:"user"`
}

type claims struct {
	Subject   string `json:"sub"`
	Email     string `json:"email"`
	Issuer    string `json:"iss"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
}

func NewService(store *config.Store, cfg Config) (*Service, error) {
	if store == nil {
		return nil, errors.New("auth store is required")
	}
	if cfg.AdminEmail == "" {
		cfg.AdminEmail = DefaultAdminEmail
	}
	if cfg.AdminPassword == "" {
		cfg.AdminPassword = DefaultAdminPassword
	}
	if cfg.Issuer == "" {
		cfg.Issuer = DefaultIssuer
	}
	if cfg.TTL <= 0 {
		cfg.TTL = DefaultTTL
	}

	secret := []byte(strings.TrimSpace(cfg.JWTSecret))
	if len(secret) == 0 {
		secret = make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			return nil, fmt.Errorf("generate jwt secret: %w", err)
		}
	}

	service := &Service{
		store:  store,
		secret: secret,
		issuer: cfg.Issuer,
		ttl:    cfg.TTL,
	}
	if err := service.seedAdmin(cfg.AdminEmail, cfg.AdminPassword); err != nil {
		return nil, err
	}
	return service, nil
}

func (s *Service) Login(email string, password string) (Session, error) {
	user, ok := s.store.GetUserByEmail(email)
	if !ok {
		return Session{}, ErrInvalidCredentials
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return Session{}, ErrInvalidCredentials
	}
	token, err := s.issueToken(user, time.Now())
	if err != nil {
		return Session{}, err
	}
	user.PasswordHash = ""
	return Session{Token: token, User: user}, nil
}

func (s *Service) UserFromToken(token string) (config.User, error) {
	claims, err := s.parseToken(token, time.Now())
	if err != nil {
		return config.User{}, err
	}
	user, ok := s.store.GetUserByEmail(claims.Email)
	if !ok || user.ID != claims.Subject {
		return config.User{}, ErrInvalidToken
	}
	user.PasswordHash = ""
	return user, nil
}

func (s *Service) ChangePassword(email string, currentPassword string, newPassword string) error {
	if strings.TrimSpace(newPassword) == "" {
		return ErrPasswordRequired
	}
	user, ok := s.store.GetUserByEmail(email)
	if !ok {
		return ErrInvalidCredentials
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(currentPassword)); err != nil {
		return ErrInvalidCredentials
	}
	hash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	updated, err := s.store.UpdateUserPasswordHash(user.ID, hash)
	if err != nil {
		return err
	}
	if !updated {
		return errors.New("user not found")
	}
	return nil
}

func HashPassword(password string) (string, error) {
	if strings.TrimSpace(password) == "" {
		return "", ErrPasswordRequired
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func BearerToken(header string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(header, prefix))
}

func (s *Service) seedAdmin(email string, password string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	return s.store.SeedUser(config.User{
		ID:           "admin",
		Email:        email,
		PasswordHash: hash,
	})
}

func (s *Service) issueToken(user config.User, now time.Time) (string, error) {
	header := map[string]string{"alg": "HS256", "typ": "JWT"}
	payload := claims{
		Subject:   user.ID,
		Email:     user.Email,
		Issuer:    s.issuer,
		IssuedAt:  now.Unix(),
		ExpiresAt: now.Add(s.ttl).Unix(),
	}
	headerJSON, err := json.Marshal(header)
	if err != nil {
		return "", err
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	unsigned := base64.RawURLEncoding.EncodeToString(headerJSON) + "." + base64.RawURLEncoding.EncodeToString(payloadJSON)
	return unsigned + "." + s.sign(unsigned), nil
}

func (s *Service) parseToken(token string, now time.Time) (claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return claims{}, ErrInvalidToken
	}
	unsigned := parts[0] + "." + parts[1]
	if !hmac.Equal([]byte(parts[2]), []byte(s.sign(unsigned))) {
		return claims{}, ErrInvalidToken
	}

	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return claims{}, ErrInvalidToken
	}
	var payload claims
	if err := json.Unmarshal(payloadJSON, &payload); err != nil {
		return claims{}, ErrInvalidToken
	}
	if payload.Issuer != s.issuer || payload.Subject == "" || payload.Email == "" || now.Unix() >= payload.ExpiresAt {
		return claims{}, ErrInvalidToken
	}
	return payload, nil
}

func (s *Service) sign(value string) string {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte(value))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
