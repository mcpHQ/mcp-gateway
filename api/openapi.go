package api

import _ "embed"

// Spec is the OpenAPI document served by the embedded API docs UI.
//
//go:embed openapi.yaml
var Spec []byte
