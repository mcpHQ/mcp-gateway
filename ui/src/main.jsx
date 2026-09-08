import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import logoUrl from "./assets/logo.png";
import presets from "./mcp-presets.json";
import stringsYaml from "./strings.en.yaml?raw";
import "./style.css";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  ArrowUpDown,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Key,
  LayoutDashboard,
  Link2,
  MoreHorizontal,
  Plus,
  ScrollText,
  Search,
  Server,
  Settings2,
  Wrench,
  X,
} from "lucide-react";

const gatewayToolsCount = 5;
const preferencesStorageKey = "mcp-gateway-preferences";
const authTokenStorageKey = "mcp-gateway-auth-token";
const views = ["overview", "servers", "endpoints", "api-keys", "tools", "audit-log", "settings", "profile"];
const detailViews = new Set(["servers", "endpoints"]);

const initialLoginForm = {
  email: "admin@mcphq.org",
  password: "",
};

const initialPasswordForm = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

const initialForm = {
  presetId: "custom-http",
  id: "",
  name: "",
  transport: "http",
  url: "",
  authType: "none",
  token: "",
  apiKeyName: "",
  apiKeyValue: "",
  apiKeyIn: "header",
  username: "",
  password: "",
  headers: [{ key: "", value: "", enabled: true }],
  command: "",
  args: [],
  env: [{ key: "", value: "", enabled: true }],
  weight: 1,
  enabled: true,
};

const stdioDefaultCommand = "npx";
const stdioDefaultArgs = ["-y", ""];
const commonAPIKeyHeaderNames = ["x-api-key", "x-harness-api-key", "Authorization"];
const secretEnvKeyPattern = /token|key|secret|password/i;
const harnessHostedHostname = "mcp.harness.io";
const serverFormId = "server-form-fields";

const initialEndpointForm = {
  id: "",
  name: "",
  description: "",
  serverIds: [],
  rateLimitPerMinute: 0,
  enabled: true,
};

const initialAPIKeyForm = {
  id: "",
  name: "",
  value: "",
  rotateValue: false,
  endpointIds: [],
  enabled: true,
};

const defaultPreferences = {
  refreshInterval: 0,
  defaultTransport: "http",
  denseTables: true,
  showAdvancedControls: true,
  sortByRecent: {},
  tableColumns: {},
};

const existingConfigPresetId = "existing-config";
const customStdioPresetId = "custom-stdio";

const tableColumns = {
  servers: [
    { id: "name", labelKey: "common.name", width: "minmax(10rem, 1.1fr)" },
    { id: "target", labelKey: "table.target", width: "minmax(16rem, 1.8fr)" },
    { id: "status", labelKey: "common.status", width: "minmax(8rem, 0.75fr)" },
    { id: "usage", labelKey: "common.usage", width: "minmax(10rem, 0.9fr)" },
    { id: "createdAt", labelKey: "table.createdAt", width: "minmax(9rem, 0.75fr)" },
    { id: "updatedAt", labelKey: "table.updatedAt", width: "minmax(9rem, 0.75fr)" },
  ],
  endpoints: [
    { id: "name", labelKey: "common.name", width: "minmax(10rem, 1.1fr)" },
    { id: "url", labelKey: "table.mcpUrl", width: "minmax(16rem, 1.6fr)" },
    { id: "servers", labelKey: "common.servers", width: "minmax(12rem, 1fr)" },
    { id: "usage", labelKey: "common.usage", width: "minmax(10rem, 0.9fr)" },
    { id: "rateLimit", labelKey: "table.rateLimit", width: "minmax(8rem, 0.8fr)" },
    { id: "createdAt", labelKey: "table.createdAt", width: "minmax(9rem, 0.75fr)" },
    { id: "updatedAt", labelKey: "table.updatedAt", width: "minmax(9rem, 0.75fr)" },
  ],
  apiKeys: [
    { id: "name", labelKey: "common.name", width: "minmax(10rem, 1.1fr)" },
    { id: "resources", labelKey: "common.resources", width: "minmax(16rem, 1.5fr)" },
    { id: "status", labelKey: "common.status", width: "minmax(8rem, 0.7fr)" },
    { id: "createdAt", labelKey: "table.createdAt", width: "minmax(9rem, 0.75fr)" },
    { id: "updatedAt", labelKey: "table.updatedAt", width: "minmax(9rem, 0.75fr)" },
  ],
  tools: [
    { id: "name", labelKey: "common.name", width: "minmax(14rem, 1.3fr)" },
    { id: "server", labelKey: "unit.server.one", width: "minmax(10rem, 0.8fr)" },
    { id: "nativeName", labelKey: "table.nativeName", width: "minmax(10rem, 0.8fr)" },
    { id: "description", labelKey: "common.description", width: "minmax(18rem, 1.8fr)" },
    { id: "createdAt", labelKey: "table.createdAt", width: "minmax(9rem, 0.75fr)" },
    { id: "updatedAt", labelKey: "table.updatedAt", width: "minmax(9rem, 0.75fr)" },
  ],
  auditLogs: [
    { id: "timestamp", labelKey: "table.timestamp", width: "minmax(10rem, 0.85fr)" },
    { id: "transport", labelKey: "table.transport", width: "minmax(7rem, 0.55fr)" },
    { id: "endpoint", labelKey: "unit.endpoint.one", width: "minmax(10rem, 0.75fr)" },
    { id: "tool", labelKey: "unit.tool.one", width: "minmax(14rem, 1.2fr)" },
    { id: "status", labelKey: "common.status", width: "minmax(7rem, 0.55fr)" },
    { id: "duration", labelKey: "table.duration", width: "minmax(7rem, 0.55fr)" },
    { id: "caller", labelKey: "table.caller", width: "minmax(12rem, 0.9fr)" },
    { id: "error", labelKey: "table.error", width: "minmax(16rem, 1.3fr)" },
    { id: "rawCall", labelKey: "audit.rawCall", width: "minmax(18rem, 1.4fr)" },
  ],
};

const actionColumnWidth = "minmax(8rem, 0.5fr)";

const tableFilterFields = {
  servers: [
    {
      id: "enabled",
      labelKey: "common.status",
      options: [
        { value: "enabled", labelKey: "common.enabled" },
        { value: "disabled", labelKey: "common.disabled" },
      ],
    },
    {
      id: "running",
      labelKey: "filter.runningState",
      options: [
        { value: "running", labelKey: "common.running" },
        { value: "stopped", labelKey: "common.stopped" },
      ],
    },
    {
      id: "transport",
      labelKey: "server.transport",
      options: [
        { value: "http", labelKey: "settings.httpUrl" },
        { value: "stdio", labelKey: "settings.localStdio" },
      ],
    },
  ],
  endpoints: [
    {
      id: "enabled",
      labelKey: "common.status",
      options: [
        { value: "enabled", labelKey: "common.enabled" },
        { value: "disabled", labelKey: "common.disabled" },
      ],
    },
  ],
  apiKeys: [
    {
      id: "enabled",
      labelKey: "common.status",
      options: [
        { value: "enabled", labelKey: "common.enabled" },
        { value: "disabled", labelKey: "common.disabled" },
      ],
    },
    {
      id: "hasValue",
      labelKey: "filter.secretValue",
      options: [
        { value: "yes", labelKey: "filter.hasSecret" },
        { value: "no", labelKey: "filter.missingSecret" },
      ],
    },
  ],
  tools: [
    {
      id: "serverId",
      labelKey: "unit.server.one",
      dynamicOptions: true,
    },
  ],
  auditLogs: [
    {
      id: "transport",
      labelKey: "table.transport",
      options: [
        { value: "rest", labelKey: "audit.transportRest" },
        { value: "mcp", labelKey: "audit.transportMcp" },
      ],
    },
    {
      id: "status",
      labelKey: "common.status",
      options: [
        { value: "success", labelKey: "common.ok" },
        { value: "failed", labelKey: "common.failed" },
        { value: "limited", labelKey: "common.limited" },
      ],
    },
  ],
};

const emptyTableFilters = {
  servers: [],
  endpoints: [],
  apiKeys: [],
  tools: [],
  auditLogs: [],
};

function parseStrings(source) {
  const entries = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    try {
      entries[key] = JSON.parse(rawValue);
    } catch {
      entries[key] = rawValue;
    }
  }
  return entries;
}

const strings = parseStrings(stringsYaml);

function t(key, values = {}) {
  const template = strings[key] ?? key;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : match
  ));
}

function pluralKey(count, singularKey, pluralKeyValue) {
  return t(count === 1 ? singularKey : pluralKeyValue);
}

function stringValue(key, fallback = "") {
  return strings[key] ?? fallback;
}

function initialPreferences() {
  const savedPreferences = localStorage.getItem(preferencesStorageKey);
  if (!savedPreferences) return defaultPreferences;

  try {
    const parsed = JSON.parse(savedPreferences);
    return {
      refreshInterval: [0, 15, 30, 60, 300].includes(Number(parsed.refreshInterval)) ? Number(parsed.refreshInterval) : 0,
      defaultTransport: parsed.defaultTransport === "stdio" ? "stdio" : "http",
      denseTables: Boolean(parsed.denseTables),
      showAdvancedControls: parsed.showAdvancedControls !== false,
      sortByRecent: typeof parsed.sortByRecent === "object" && parsed.sortByRecent ? parsed.sortByRecent : {},
      tableColumns: typeof parsed.tableColumns === "object" && parsed.tableColumns ? parsed.tableColumns : {},
    };
  } catch {
    return defaultPreferences;
  }
}

async function api(path, options = {}) {
  const token = localStorage.getItem(authTokenStorageKey);
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || t("error.requestFailed", { status: response.status }));
    error.status = response.status;
    throw error;
  }
  return payload;
}

function slugFromName(value) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 63);
  return slug.length >= 2 ? slug : "";
}

function shouldAutofillID(currentId, previousName) {
  return !currentId || currentId === slugFromName(previousName);
}

function headerRowsFromHeaders(headers = {}) {
  const rows = Object.entries(headers)
    .filter(([key]) => key.toLowerCase() !== "authorization")
    .map(([key, value]) => ({ key, value: String(value), enabled: true }));
  return rows.length ? rows : [{ key: "", value: "", enabled: true }];
}

function argsFromServer(server = {}) {
  return Array.isArray(server.args) ? server.args.map((arg) => String(arg)) : [];
}

function cleanArgs(args = []) {
  return args.map((arg) => String(arg).trim()).filter(Boolean);
}

function envRowsFromEnv(env = {}) {
  const rows = Object.entries(env || {}).map(([key, value]) => ({ key, value: String(value), enabled: true }));
  return rows.length ? rows : [{ key: "", value: "", enabled: true }];
}

function isSecretEnvKey(key = "") {
  return secretEnvKeyPattern.test(key);
}

function commandPreviewText(form) {
  const command = form.command.trim();
  if (!command) return "";
  return [command, ...cleanArgs(form.args)].join(" ");
}

function splitCommandLine(value) {
  const matches = String(value || "").match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return matches.map((token) => {
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function isHarnessHostedURL(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    // Exact match covers the documented hosted endpoint; the suffix check also
    // catches regional/hosted subdomains such as eu.mcp.harness.io.
    return hostname === harnessHostedHostname || hostname.endsWith(`.${harnessHostedHostname}`);
  } catch {
    return false;
  }
}

function argsEqual(left = [], right = []) {
  const leftArgs = cleanArgs(left);
  const rightArgs = cleanArgs(right);
  return leftArgs.length === rightArgs.length && leftArgs.every((arg, index) => arg === rightArgs[index]);
}

function presetIdForServer(server = {}) {
  const transport = server.transport || (server.url ? "http" : "stdio");
  const match = presets.find((preset) => {
    const presetServer = preset.server || {};
    const presetTransport = presetServer.transport || (presetServer.url ? "http" : "stdio");
    if (presetTransport !== transport) return false;
    if (transport === "http") {
      return Boolean(presetServer.url) && presetServer.url === server.url;
    }
    return presetServer.command === server.command && argsEqual(presetServer.args, server.args);
  });
  if (match) return match.id;
  return transport === "stdio" ? existingConfigPresetId : "custom-http";
}

function authFromServer(server = {}) {
  if (server.auth && server.auth.type && server.auth.type !== "none") {
    return {
      authType: server.auth.type,
      token: server.auth.token || "",
      apiKeyName: server.auth.apiKeyName || "",
      apiKeyValue: server.auth.apiKeyValue || "",
      apiKeyIn: server.auth.apiKeyIn || "header",
      username: server.auth.username || "",
      password: server.auth.password || "",
    };
  }

  const authorization = server.headers?.Authorization || server.headers?.authorization || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return {
      authType: "bearer",
      token: authorization.slice(7).trim(),
      apiKeyName: "",
      apiKeyValue: "",
      apiKeyIn: "header",
      username: "",
      password: "",
    };
  }
  return {
    authType: "none",
    token: "",
    apiKeyName: "",
    apiKeyValue: "",
    apiKeyIn: "header",
    username: "",
    password: "",
  };
}

function buildHeaders(form) {
  const headers = {};
  for (const row of form.headers) {
    const key = row.key.trim();
    const value = row.value.trim();
    if (!row.enabled || (!key && !value)) continue;
    if (!key) throw new Error(t("error.headerKeyRequired"));
    headers[key] = value;
  }

  return headers;
}

function buildEnv(form) {
  const env = {};
  for (const row of form.env) {
    const key = row.key.trim();
    const value = row.value.trim();
    if (!row.enabled || (!key && !value)) continue;
    if (!key) throw new Error(t("error.envKeyRequired"));
    // A blank value means "inherit from the gateway process environment".
    // Sending an explicit empty string would override (and hide) any real
    // value already present in the process env when the stdio server starts.
    if (!value) continue;
    env[key] = value;
  }

  return env;
}

function buildAuth(form) {
  switch (form.authType) {
    case "none":
      return { type: "none" };
    case "apiKey":
      if (!form.apiKeyName.trim() || !form.apiKeyValue.trim()) {
        throw new Error(t("error.apiKeyNameAndValueRequired"));
      }
      return {
        type: "apiKey",
        apiKeyName: form.apiKeyName.trim(),
        apiKeyValue: form.apiKeyValue.trim(),
        apiKeyIn: form.apiKeyIn || "header",
      };
    case "bearer":
    case "jwtBearer":
      if (!form.token.trim()) {
        throw new Error(t("error.tokenRequired"));
      }
      return {
        type: form.authType,
        token: form.token.trim(),
      };
    case "basic":
      if (!form.username.trim()) {
        throw new Error(t("error.basicUsernameRequired"));
      }
      return {
        type: "basic",
        username: form.username.trim(),
        password: form.password,
      };
    default:
      return { type: "none" };
  }
}

function serverPayloadFromForm(form) {
  const isHTTP = form.transport === "http";
  return {
    id: form.id.trim() || slugFromName(form.name),
    name: form.name.trim(),
    transport: form.transport,
    url: isHTTP ? form.url.trim() : "",
    auth: isHTTP ? buildAuth(form) : { type: "none" },
    headers: isHTTP ? buildHeaders(form) : {},
    command: isHTTP ? "" : form.command.trim(),
    args: isHTTP ? [] : cleanArgs(form.args),
    env: isHTTP ? {} : buildEnv(form),
    enabled: form.enabled,
    weight: Number(form.weight || 1),
  };
}

function endpointPayloadFromForm(form) {
  return {
    id: form.id.trim() || slugFromName(form.name),
    name: form.name.trim(),
    description: form.description.trim(),
    serverIds: form.serverIds,
    rateLimit: {
      requestsPerMinute: Number(form.rateLimitPerMinute || 0),
    },
    enabled: form.enabled,
  };
}

function apiKeyPayloadFromForm(form) {
  return {
    id: form.id.trim() || slugFromName(form.name),
    name: form.name.trim(),
    value: form.value.trim(),
    endpointIds: form.endpointIds,
    enabled: form.enabled,
  };
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function curlForEndpoint(endpoint, apiKey) {
  return [
    `curl -X POST ${shellSingleQuote(endpointUrl(endpoint))} \\`,
    `  -H ${shellSingleQuote(`X-API-Key: ${apiKey.value}`)} \\`,
    `  -H ${shellSingleQuote("Content-Type: application/json")} \\`,
    `  -d ${shellSingleQuote('{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')}`,
  ].join("\n");
}

function restToolCallCurlForEndpoint(endpoint, apiKey, toolName) {
  return [
    `curl -X POST ${shellSingleQuote(`${location.origin}/api/endpoints/${endpoint.id}/tools/${encodeURIComponent(toolName)}/call`)} \\`,
    `  -H ${shellSingleQuote(`X-API-Key: ${apiKey.value}`)} \\`,
    `  -H ${shellSingleQuote("Content-Type: application/json")} \\`,
    `  -d ${shellSingleQuote('{"arguments":{"query":"chaos","perPage":5}}')}`,
  ].join("\n");
}

async function fetchExampleToolName(endpointId, apiKeyValue) {
  try {
    const response = await fetch(`/api/endpoints/${encodeURIComponent(endpointId)}/tools`, {
      headers: { "X-API-Key": apiKeyValue },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return null;
    const tools = payload.tools || [];
    return tools.find((tool) => tool.name?.includes("search_repositories"))?.name || tools[0]?.name || null;
  } catch {
    return null;
  }
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function generateAPIKeyValue() {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return `sk_${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")}`;
}

function pageCount(total, pageSize) {
  return Math.max(1, Math.ceil(total / pageSize));
}

function clampPage(page, total, pageSize) {
  return Math.min(Math.max(1, page), pageCount(total, pageSize));
}

function formatTimestamp(value) {
  if (!value) return t("common.notSet");
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function timestampValue(value) {
  if (!value) return 0;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = new Date(normalized);
  return Number.isNaN(timestamp.getTime()) ? 0 : timestamp.getTime();
}

function sortByUpdatedAt(items, enabled) {
  if (!enabled) return items;
  return [...items].sort((a, b) => timestampValue(b.updatedAt) - timestampValue(a.updatedAt));
}

function sortByTimestamp(items, enabled) {
  if (!enabled) return items;
  return [...items].sort((a, b) => timestampValue(b.timestamp) - timestampValue(a.timestamp));
}

function visibleColumnIds(preferences, tableId) {
  const columns = tableColumns[tableId] || [];
  const saved = preferences.tableColumns?.[tableId];
  if (!Array.isArray(saved)) return columns.map((column) => column.id);
  const known = new Set(columns.map((column) => column.id));
  const visible = saved.filter((id) => known.has(id));
  return visible.length ? visible : columns.map((column) => column.id);
}

function columnVisible(visibleColumns, id) {
  return visibleColumns.includes(id);
}

function tableGridTemplate(tableId, visibleColumns, includeActions = false) {
  const columns = (tableColumns[tableId] || []).filter((column) => columnVisible(visibleColumns, column.id));
  return [...columns.map((column) => column.width), ...(includeActions ? [actionColumnWidth] : [])].join(" ");
}

function filterField(tableId, fieldId) {
  return (tableFilterFields[tableId] || []).find((field) => field.id === fieldId);
}

function filterOptions(tableId, fieldId, context = {}) {
  const field = filterField(tableId, fieldId);
  if (!field) return [];
  if (field.dynamicOptions && fieldId === "serverId") {
    return (context.servers || []).map((server) => ({
      value: server.id,
      label: server.name,
    }));
  }
  return (field.options || []).map((option) => ({
    value: option.value,
    label: t(option.labelKey),
  }));
}

function matchesTableFilter(tableId, item, filter, context = {}) {
  switch (tableId) {
    case "servers":
      if (filter.field === "enabled") {
        return filter.value === "enabled" ? item.enabled : !item.enabled;
      }
      if (filter.field === "running") {
        const running = item.enabled && item.status?.running;
        return filter.value === "running" ? running : item.enabled && !running;
      }
      if (filter.field === "transport") {
        return (item.transport || "stdio") === filter.value;
      }
      return true;
    case "endpoints":
      if (filter.field === "enabled") {
        return filter.value === "enabled" ? item.enabled : !item.enabled;
      }
      return true;
    case "apiKeys":
      if (filter.field === "enabled") {
        return filter.value === "enabled" ? item.enabled : !item.enabled;
      }
      if (filter.field === "hasValue") {
        return filter.value === "yes" ? item.hasValue : !item.hasValue;
      }
      return true;
    case "tools":
      if (filter.field === "serverId") {
        return item.serverId === filter.value;
      }
      return true;
    case "auditLogs":
      if (filter.field === "transport") {
        return item.transport === filter.value;
      }
      if (filter.field === "status") {
        if (filter.value === "success") return item.status >= 200 && item.status < 300;
        if (filter.value === "limited") return item.status === 429;
        return item.status >= 400;
      }
      return true;
    default:
      return true;
  }
}

function applyTableFilters(items, tableId, filters, context = {}) {
  if (!filters?.length) return items;
  return items.filter((item) => filters.every((filter) => matchesTableFilter(tableId, item, filter, context)));
}

function availableFilterFields(tableId, activeFilters) {
  const activeFields = new Set((activeFilters || []).map((filter) => filter.field));
  return (tableFilterFields[tableId] || []).filter((field) => !activeFields.has(field.id));
}

function initialTheme() {
  const savedTheme = localStorage.getItem("mcp-gateway-theme");
  if (savedTheme === "dark" || savedTheme === "mcp") return savedTheme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "mcp";
}

function pathForRoute(view, resourceId = null) {
  const safeView = views.includes(view) ? view : "overview";
  if (safeView === "overview") {
    return "/overview";
  }
  if (resourceId && detailViews.has(safeView)) {
    return `/${safeView}/${encodeURIComponent(resourceId)}`;
  }
  return `/${safeView}`;
}

function routeFromLocation() {
  const pathname = window.location.pathname.replace(/\/$/, "") || "/";
  if (pathname === "/") {
    return { view: "overview", resourceId: null };
  }
  const segments = pathname.split("/").filter(Boolean);
  const view = views.includes(segments[0]) ? segments[0] : "overview";
  const resourceId =
    segments[1] && detailViews.has(view) ? decodeURIComponent(segments[1]) : null;
  return { view, resourceId };
}

function migrateHashRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "").trim();
  if (!hash) {
    return null;
  }
  const segments = hash.split("/").filter(Boolean);
  const view = views.includes(segments[0]) ? segments[0] : "overview";
  const resourceId =
    segments[1] && detailViews.has(view) ? decodeURIComponent(segments[1]) : null;
  return { view, resourceId };
}

function targetFor(server) {
  if (server.transport === "http") return server.url || t("common.notConfigured");
  return `${server.command || ""} ${(server.args || []).join(" ")}`.trim() || t("common.notConfigured");
}

function endpointUrl(endpoint) {
  return `${location.origin}/mcp/${endpoint.id}`;
}

function formFromPreset(preset) {
  const server = preset.server;
  const auth = authFromServer(server);
  return {
    presetId: preset.id,
    id: server.id || "",
    name: stringValue(preset.serverNameKey, server.name || ""),
    transport: server.transport || "http",
    url: server.url || "",
    authType: auth.authType,
    token: auth.token,
    apiKeyName: auth.apiKeyName,
    apiKeyValue: auth.apiKeyValue,
    apiKeyIn: auth.apiKeyIn,
    username: auth.username,
    password: auth.password,
    headers: headerRowsFromHeaders(server.headers),
    command: server.command || "",
    args: argsFromServer(server),
    env: envRowsFromEnv(server.env),
    weight: server.weight || 1,
    enabled: Boolean(server.enabled),
  };
}

function presetLabel(preset) {
  return stringValue(preset.labelKey, preset.label || preset.id);
}

function presetDescription(preset) {
  return stringValue(preset.descriptionKey, preset.description || "");
}

function presetDescriptionForForm(form) {
  if (form.presetId === existingConfigPresetId) {
    return t("server.existingConfigPresetHelp");
  }
  if (form.presetId === customStdioPresetId) {
    return t("server.customStdioPresetHelp");
  }
  const preset = presets.find((item) => item.id === form.presetId);
  return preset ? presetDescription(preset) : t("server.customConfigPresetHelp");
}

function presetLabelForForm(form) {
  if (form.presetId === existingConfigPresetId) {
    return t("server.existingConfigPreset");
  }
  if (form.presetId === customStdioPresetId) {
    return t("server.customStdioPreset");
  }
  return presetLabel(presets.find((preset) => preset.id === form.presetId) || presets[0]);
}

function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [loginForm, setLoginForm] = useState(initialLoginForm);
  const [loggingIn, setLoggingIn] = useState(false);
  const [passwordForm, setPasswordForm] = useState(initialPasswordForm);
  const [savingPassword, setSavingPassword] = useState(false);
  const [configPath, setConfigPath] = useState(t("common.loadingInitial"));
  const [servers, setServers] = useState([]);
  const [endpoints, setEndpoints] = useState([]);
  const [apiKeys, setAPIKeys] = useState([]);
  const [tools, setTools] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [endpointForm, setEndpointForm] = useState(initialEndpointForm);
  const [apiKeyForm, setAPIKeyForm] = useState(initialAPIKeyForm);
  const [serverIdTouched, setServerIdTouched] = useState(false);
  const [endpointIdTouched, setEndpointIdTouched] = useState(false);
  const [apiKeyIdTouched, setAPIKeyIdTouched] = useState(false);
  const [editingServer, setEditingServer] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState(false);
  const [editingAPIKey, setEditingAPIKey] = useState(false);
  const [serverSearch, setServerSearch] = useState("");
  const [endpointSearch, setEndpointSearch] = useState("");
  const [apiKeySearch, setAPIKeySearch] = useState("");
  const [toolSearch, setToolSearch] = useState("");
  const [auditLogSearch, setAuditLogSearch] = useState("");
  const [serverPage, setServerPage] = useState(1);
  const [endpointPage, setEndpointPage] = useState(1);
  const [apiKeyPage, setAPIKeyPage] = useState(1);
  const [toolPage, setToolPage] = useState(1);
  const [auditLogPage, setAuditLogPage] = useState(1);
  const [serverPageSize, setServerPageSize] = useState(5);
  const [endpointPageSize, setEndpointPageSize] = useState(5);
  const [apiKeyPageSize, setAPIKeyPageSize] = useState(5);
  const [toolPageSize, setToolPageSize] = useState(5);
  const [auditLogPageSize, setAuditLogPageSize] = useState(10);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [loadingAPIKeys, setLoadingAPIKeys] = useState(false);
  const [loadingTools, setLoadingTools] = useState(false);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);
  const [toolsLoaded, setToolsLoaded] = useState(false);
  const [auditLogsLoaded, setAuditLogsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingEndpoint, setSavingEndpoint] = useState(false);
  const [savingAPIKey, setSavingAPIKey] = useState(false);
  const [testingServer, setTestingServer] = useState(false);
  const [testingServerId, setTestingServerId] = useState("");
  const [serverTestResult, setServerTestResult] = useState(null);
  const [pendingApiRequests, setPendingApiRequests] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [endpointModalOpen, setEndpointModalOpen] = useState(false);
  const [apiKeyModalOpen, setAPIKeyModalOpen] = useState(false);
  const [curlModal, setCurlModal] = useState({ open: false, endpoint: null, apiKeys: [], exampleTool: null, loading: false });
  const initialRoute = routeFromLocation();
  const [activeView, setActiveView] = useState(initialRoute.view);
  const [resourceId, setResourceId] = useState(initialRoute.resourceId);

  function navigate(view, nextResourceId = null, { replace = false } = {}) {
    const safeView = views.includes(view) ? view : "overview";
    const safeResourceId =
      nextResourceId && detailViews.has(safeView) ? String(nextResourceId) : null;
    setActiveView(safeView);
    setResourceId(safeResourceId);
    const path = pathForRoute(safeView, safeResourceId);
    if (window.location.pathname !== path) {
      window.history[replace ? "replaceState" : "pushState"](null, "", path);
    }
  }
  const [theme, setTheme] = useState(initialTheme);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [tableFilters, setTableFilters] = useState(emptyTableFilters);
  const inflightLoads = useRef({});

  const endpointPattern = `${location.origin}/mcp/{endpointId}`;
  const apiLoading = pendingApiRequests > 0;
  const darkMode = theme === "dark";

  function notify(title, message = "", type = "success") {
    const id = crypto.randomUUID();
    setToasts((items) => [...items, { id, title, message, type }]);
    setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4200);
  }

  function dismissToast(id) {
    setToasts((items) => items.filter((item) => item.id !== id));
  }

  async function request(path, options = {}) {
    setPendingApiRequests((count) => count + 1);
    try {
      return await api(path, options);
    } catch (error) {
      if (error.status === 401 && path !== "/api/auth/login") {
        localStorage.removeItem(authTokenStorageKey);
        setAuthUser(null);
      }
      throw error;
    } finally {
      setPendingApiRequests((count) => Math.max(0, count - 1));
    }
  }

  function storeSession(payload) {
    localStorage.setItem(authTokenStorageKey, payload.token);
    setAuthUser(payload.user);
  }

  function clearSession() {
    localStorage.removeItem(authTokenStorageKey);
    setAuthUser(null);
    setLoginForm(initialLoginForm);
    setToolsLoaded(false);
    setAuditLogsLoaded(false);
    setAuditLogs([]);
  }

  async function login(event) {
    event.preventDefault();
    setLoggingIn(true);
    try {
      const payload = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(loginForm),
      });
      storeSession(payload);
      setLoginForm((current) => ({ ...current, password: "" }));
      notify(t("toast.loginSuccess"), payload.user?.email || "", "success");
    } catch (error) {
      notify(t("toast.loginFailed"), error.message, "error");
    } finally {
      setLoggingIn(false);
    }
  }

  function logout() {
    clearSession();
    navigate("overview", null, { replace: true });
    notify(t("toast.loggedOut"), "", "warning");
  }

  async function changePassword(event) {
    event.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      notify(t("toast.passwordMismatch"), t("toast.passwordMismatchMessage"), "error");
      return;
    }

    setSavingPassword(true);
    try {
      await request("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });
      setPasswordForm(initialPasswordForm);
      notify(t("toast.passwordChanged"), t("toast.passwordChangedMessage"));
    } catch (error) {
      notify(t("toast.passwordChangeFailed"), error.message, "error");
    } finally {
      setSavingPassword(false);
    }
  }

  async function loadConfig() {
    const payload = await request("/api/config");
    setConfigPath(payload.path);
  }

  async function loadServers(showToast = false) {
    if (inflightLoads.current.servers) return inflightLoads.current.servers;

    setLoadingServers(true);
    inflightLoads.current.servers = (async () => {
      const payload = await request("/api/servers");
      setServers(payload.servers || []);
      if (showToast) notify(t("toast.serversRefreshed"), t("toast.loadedCount.servers", { count: payload.servers?.length || 0 }));
      return payload;
    })();

    try {
      return await inflightLoads.current.servers;
    } catch (error) {
      notify(t("toast.serverLoadFailed"), error.message, "error");
    } finally {
      delete inflightLoads.current.servers;
      setLoadingServers(false);
    }
  }

  async function loadEndpoints(showToast = false) {
    if (inflightLoads.current.endpoints) return inflightLoads.current.endpoints;

    setLoadingEndpoints(true);
    inflightLoads.current.endpoints = (async () => {
      const payload = await request("/api/endpoints");
      setEndpoints(payload.endpoints || []);
      if (showToast) notify(t("toast.endpointsRefreshed"), t("toast.loadedCount.endpoints", { count: payload.endpoints?.length || 0 }));
      return payload;
    })();

    try {
      return await inflightLoads.current.endpoints;
    } catch (error) {
      notify(t("toast.endpointLoadFailed"), error.message, "error");
    } finally {
      delete inflightLoads.current.endpoints;
      setLoadingEndpoints(false);
    }
  }

  async function loadAPIKeys(showToast = false) {
    if (inflightLoads.current.apiKeys) return inflightLoads.current.apiKeys;

    setLoadingAPIKeys(true);
    inflightLoads.current.apiKeys = (async () => {
      const payload = await request("/api/api-keys");
      setAPIKeys(payload.apiKeys || []);
      if (showToast) notify(t("toast.apiKeysRefreshed"), t("toast.loadedCount.apiKeys", { count: payload.apiKeys?.length || 0 }));
      return payload;
    })();

    try {
      return await inflightLoads.current.apiKeys;
    } catch (error) {
      notify(t("toast.apiKeyLoadFailed"), error.message, "error");
    } finally {
      delete inflightLoads.current.apiKeys;
      setLoadingAPIKeys(false);
    }
  }

  async function openCurlModal(endpoint) {
    setCurlModal({ open: true, endpoint, apiKeys: [], exampleTool: null, loading: true });
    try {
      const payload = await request(`/api/endpoints/${encodeURIComponent(endpoint.id)}/curl`);
      const apiKeys = payload.apiKeys || [];
      const exampleTool = apiKeys.length ? await fetchExampleToolName(endpoint.id, apiKeys[0].value) : null;
      setCurlModal({ open: true, endpoint, apiKeys, exampleTool, loading: false });
    } catch (error) {
      setCurlModal({ open: false, endpoint: null, apiKeys: [], exampleTool: null, loading: false });
      notify(t("toast.curlOptionsLoadFailed"), error.message, "error");
    }
  }

  async function copyEndpointCurl(command, apiKeyValue) {
    try {
      await writeClipboard(command);
      notify(t("toast.curlCopied"), apiKeyValue);
    } catch (error) {
      notify(t("toast.copyFailed"), error.message, "error");
    }
  }

  async function loadTools(refresh = false, showToast = true) {
    const key = refresh ? "toolsRefresh" : "tools";
    if (inflightLoads.current[key]) return inflightLoads.current[key];

    setLoadingTools(true);
    inflightLoads.current[key] = (async () => {
      const payload = await request(refresh ? "/api/tools/refresh" : "/api/tools", refresh ? { method: "POST" } : {});
      setTools(payload.tools || []);
      setToolsLoaded(true);
      setToolPage(1);
      if (showToast) notify(refresh ? t("toast.toolsRefreshed") : t("toast.toolsLoaded"), t("toast.loadedCount.tools", { count: payload.tools?.length || 0 }));
      return payload;
    })();

    try {
      return await inflightLoads.current[key];
    } catch (error) {
      if (!refresh) setToolsLoaded(true);
      notify(refresh ? t("toast.refreshToolsFailed") : t("toast.loadToolsFailed"), error.message, "error");
    } finally {
      delete inflightLoads.current[key];
      setLoadingTools(false);
    }
  }

  async function loadAuditLogs(showToast = false) {
    if (inflightLoads.current.auditLogs) return inflightLoads.current.auditLogs;

    setLoadingAuditLogs(true);
    inflightLoads.current.auditLogs = (async () => {
      const payload = await request("/api/audit-logs?limit=500");
      setAuditLogs(payload.auditLogs || []);
      setAuditLogsLoaded(true);
      setAuditLogPage(1);
      if (showToast) notify(t("toast.auditLogsRefreshed"), t("toast.loadedCount.auditLogs", { count: payload.auditLogs?.length || 0 }));
      return payload;
    })();

    try {
      return await inflightLoads.current.auditLogs;
    } catch (error) {
      setAuditLogsLoaded(true);
      notify(t("toast.auditLogLoadFailed"), error.message, "error");
    } finally {
      delete inflightLoads.current.auditLogs;
      setLoadingAuditLogs(false);
    }
  }

  useEffect(() => {
    async function bootstrapAuth() {
      if (!localStorage.getItem(authTokenStorageKey)) {
        setAuthChecked(true);
        return;
      }
      try {
        const payload = await request("/api/auth/me");
        setAuthUser(payload.user);
      } catch {
        clearSession();
      } finally {
        setAuthChecked(true);
      }
    }

    bootstrapAuth();
  }, []);

  useEffect(() => {
    if (!authUser) return;
    loadConfig().catch((error) => notify(t("toast.configLoadFailed"), error.message, "error"));
    loadServers();
    loadEndpoints();
    loadAPIKeys();
  }, [authUser?.email]);

  useEffect(() => {
    if (authUser && activeView === "tools" && !toolsLoaded && !loadingTools) {
      loadTools(false, false);
    }
  }, [authUser, activeView, toolsLoaded, loadingTools]);

  useEffect(() => {
    if (authUser && activeView === "audit-log") {
      loadAuditLogs(false);
    }
  }, [authUser, activeView]);

  useEffect(() => {
    const migrated = migrateHashRoute();
    if (migrated) {
      navigate(migrated.view, migrated.resourceId, { replace: true });
      return;
    }
    const path = pathForRoute(activeView, resourceId);
    if (window.location.pathname !== path) {
      window.history.replaceState(null, "", path);
    }
  }, []);

  useEffect(() => {
    function syncRouteFromHistory() {
      const nextRoute = routeFromLocation();
      setActiveView(nextRoute.view);
      setResourceId(nextRoute.resourceId);
    }

    window.addEventListener("popstate", syncRouteFromHistory);
    return () => window.removeEventListener("popstate", syncRouteFromHistory);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("mcp-gateway-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(preferencesStorageKey, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    if (!authUser || !preferences.refreshInterval) return undefined;

    const interval = window.setInterval(() => {
      switch (activeView) {
        case "servers":
          loadServers();
          break;
        case "endpoints":
          loadEndpoints();
          break;
        case "api-keys":
          loadAPIKeys();
          break;
        case "tools":
          if (toolsLoaded) loadTools(false, false);
          break;
        case "audit-log":
          if (auditLogsLoaded) loadAuditLogs(false);
          break;
        case "overview":
        default:
          loadServers();
          loadEndpoints();
          loadAPIKeys();
          break;
      }
    }, preferences.refreshInterval * 1000);

    return () => window.clearInterval(interval);
  }, [authUser, preferences.refreshInterval, toolsLoaded, auditLogsLoaded, activeView]);

  const filteredServers = useMemo(() => {
    const query = serverSearch.trim().toLowerCase();
    let items = servers;
    if (query) {
      items = items.filter((server) =>
        [server.id, server.name, server.transport, server.url, server.command].join(" ").toLowerCase().includes(query),
      );
    }
    return applyTableFilters(items, "servers", tableFilters.servers);
  }, [servers, serverSearch, tableFilters.servers]);

  const filteredEndpoints = useMemo(() => {
    const query = endpointSearch.trim().toLowerCase();
    let items = endpoints;
    if (query) {
      items = items.filter((endpoint) =>
        [endpoint.id, endpoint.name, endpoint.description, ...(endpoint.serverIds || [])].join(" ").toLowerCase().includes(query),
      );
    }
    return applyTableFilters(items, "endpoints", tableFilters.endpoints);
  }, [endpoints, endpointSearch, tableFilters.endpoints]);

  const filteredAPIKeys = useMemo(() => {
    const query = apiKeySearch.trim().toLowerCase();
    let items = apiKeys;
    if (query) {
      items = items.filter((key) =>
        [key.id, key.name, ...(key.endpointIds || [])].join(" ").toLowerCase().includes(query),
      );
    }
    return applyTableFilters(items, "apiKeys", tableFilters.apiKeys);
  }, [apiKeys, apiKeySearch, tableFilters.apiKeys]);

  const filteredTools = useMemo(() => {
    const query = toolSearch.trim().toLowerCase();
    let items = tools;
    if (query) {
      items = items.filter((tool) =>
        [tool.name, tool.serverName, tool.serverId, tool.nativeName, tool.description].join(" ").toLowerCase().includes(query),
      );
    }
    return applyTableFilters(items, "tools", tableFilters.tools, { servers });
  }, [tools, toolSearch, tableFilters.tools, servers]);

  const filteredAuditLogs = useMemo(() => {
    const query = auditLogSearch.trim().toLowerCase();
    let items = auditLogs;
    if (query) {
      items = items.filter((entry) =>
        [entry.timestamp, entry.transport, entry.endpointId, entry.toolName, entry.status, entry.durationMs, entry.caller, entry.error, entry.rawCall].join(" ").toLowerCase().includes(query),
      );
    }
    return applyTableFilters(items, "auditLogs", tableFilters.auditLogs);
  }, [auditLogs, auditLogSearch, tableFilters.auditLogs]);

  const sortedServers = useMemo(() => sortByUpdatedAt(filteredServers, preferences.sortByRecent.servers), [filteredServers, preferences.sortByRecent.servers]);
  const sortedEndpoints = useMemo(() => sortByUpdatedAt(filteredEndpoints, preferences.sortByRecent.endpoints), [filteredEndpoints, preferences.sortByRecent.endpoints]);
  const sortedAPIKeys = useMemo(() => sortByUpdatedAt(filteredAPIKeys, preferences.sortByRecent.apiKeys), [filteredAPIKeys, preferences.sortByRecent.apiKeys]);
  const sortedTools = useMemo(() => sortByUpdatedAt(filteredTools, preferences.sortByRecent.tools), [filteredTools, preferences.sortByRecent.tools]);
  const sortedAuditLogs = useMemo(() => sortByTimestamp(filteredAuditLogs, preferences.sortByRecent.auditLogs), [filteredAuditLogs, preferences.sortByRecent.auditLogs]);
  const serverColumns = visibleColumnIds(preferences, "servers");
  const endpointColumns = visibleColumnIds(preferences, "endpoints");
  const apiKeyColumns = visibleColumnIds(preferences, "apiKeys");
  const toolColumns = visibleColumnIds(preferences, "tools");
  const auditLogColumns = visibleColumnIds(preferences, "auditLogs");
  const serverPages = pageCount(filteredServers.length, serverPageSize);
  const endpointPages = pageCount(filteredEndpoints.length, endpointPageSize);
  const apiKeyPages = pageCount(filteredAPIKeys.length, apiKeyPageSize);
  const toolPages = pageCount(filteredTools.length, toolPageSize);
  const auditLogPages = pageCount(filteredAuditLogs.length, auditLogPageSize);
  const visibleServers = sortedServers.slice((clampPage(serverPage, sortedServers.length, serverPageSize) - 1) * serverPageSize, clampPage(serverPage, sortedServers.length, serverPageSize) * serverPageSize);
  const visibleEndpoints = sortedEndpoints.slice((clampPage(endpointPage, sortedEndpoints.length, endpointPageSize) - 1) * endpointPageSize, clampPage(endpointPage, sortedEndpoints.length, endpointPageSize) * endpointPageSize);
  const visibleAPIKeys = sortedAPIKeys.slice((clampPage(apiKeyPage, sortedAPIKeys.length, apiKeyPageSize) - 1) * apiKeyPageSize, clampPage(apiKeyPage, sortedAPIKeys.length, apiKeyPageSize) * apiKeyPageSize);
  const visibleTools = sortedTools.slice((clampPage(toolPage, sortedTools.length, toolPageSize) - 1) * toolPageSize, clampPage(toolPage, sortedTools.length, toolPageSize) * toolPageSize);
  const visibleAuditLogs = sortedAuditLogs.slice((clampPage(auditLogPage, sortedAuditLogs.length, auditLogPageSize) - 1) * auditLogPageSize, clampPage(auditLogPage, sortedAuditLogs.length, auditLogPageSize) * auditLogPageSize);

  function updateForm(name, value) {
    setForm((current) => {
      if (name === "name" && !serverIdTouched && shouldAutofillID(current.id, current.name)) {
        return { ...current, name: value, id: slugFromName(value) };
      }
      if (name === "transport") {
        let nextPresetId = current.presetId;
        if (value === "stdio" && current.presetId === "custom-http") nextPresetId = customStdioPresetId;
        if (value === "http" && (current.presetId === customStdioPresetId || current.presetId === existingConfigPresetId)) nextPresetId = "custom-http";
        if (value === "stdio" && !current.command.trim()) {
          return {
            ...current,
            presetId: nextPresetId,
            transport: value,
            command: stdioDefaultCommand,
            args: current.args.length ? current.args : [...stdioDefaultArgs],
          };
        }
        return { ...current, presetId: nextPresetId, [name]: value };
      }
      return { ...current, [name]: value };
    });
    setServerTestResult(null);
  }

  function updateEndpointForm(name, value) {
    setEndpointForm((current) => {
      if (name === "name" && !endpointIdTouched && shouldAutofillID(current.id, current.name)) {
        return { ...current, name: value, id: slugFromName(value) };
      }
      return { ...current, [name]: value };
    });
  }

  function updateAPIKeyForm(name, value) {
    setAPIKeyForm((current) => {
      if (name === "name" && !apiKeyIdTouched && shouldAutofillID(current.id, current.name)) {
        return { ...current, name: value, id: slugFromName(value) };
      }
      return { ...current, [name]: value };
    });
  }

  function toggleEndpointServer(serverId, enabled) {
    setEndpointForm((current) => {
      const serverIds = enabled
        ? [...current.serverIds, serverId]
        : current.serverIds.filter((id) => id !== serverId);
      return { ...current, serverIds: Array.from(new Set(serverIds)) };
    });
  }

  function toggleAPIKeyEndpoint(endpointId, enabled) {
    setAPIKeyForm((current) => {
      const endpointIds = enabled
        ? [...current.endpointIds, endpointId]
        : current.endpointIds.filter((id) => id !== endpointId);
      return { ...current, endpointIds: Array.from(new Set(endpointIds)) };
    });
  }

  function updateHeader(index, key, value) {
    setForm((current) => ({
      ...current,
      headers: current.headers.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    }));
  }

  function updateArg(index, value) {
    setForm((current) => ({
      ...current,
      args: current.args.length ? current.args.map((arg, i) => (i === index ? value : arg)) : [value],
    }));
  }

  function addArg() {
    setForm((current) => ({
      ...current,
      args: [...current.args, ""],
    }));
  }

  function removeArg(index) {
    setForm((current) => ({
      ...current,
      args: current.args.filter((_, i) => i !== index),
    }));
  }

  function addHeader() {
    setForm((current) => ({
      ...current,
      headers: [...current.headers, { key: "", value: "", enabled: true }],
    }));
  }

  function removeHeader(index) {
    setForm((current) => ({
      ...current,
      headers: current.headers.length === 1 ? [{ key: "", value: "", enabled: true }] : current.headers.filter((_, i) => i !== index),
    }));
  }

  function updateEnv(index, key, value) {
    setForm((current) => ({
      ...current,
      env: current.env.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    }));
  }

  function addEnv() {
    setForm((current) => ({
      ...current,
      env: [...current.env, { key: "", value: "", enabled: true }],
    }));
  }

  function removeEnv(index) {
    setForm((current) => ({
      ...current,
      env: current.env.length === 1 ? [{ key: "", value: "", enabled: true }] : current.env.filter((_, i) => i !== index),
    }));
  }

  function applyPastedCommand(value) {
    const tokens = splitCommandLine(value);
    if (!tokens.length) return;
    const envTokenPattern = /^[A-Za-z_][A-Za-z0-9_]*=.*$/;
    let splitIndex = 0;
    while (splitIndex < tokens.length && envTokenPattern.test(tokens[splitIndex])) {
      splitIndex += 1;
    }
    const envTokens = tokens.slice(0, splitIndex);
    const remaining = tokens.slice(splitIndex);
    if (!remaining.length) return;

    setForm((current) => {
      let env = current.env;
      for (const token of envTokens) {
        const eqIndex = token.indexOf("=");
        const key = token.slice(0, eqIndex);
        const value = token.slice(eqIndex + 1);
        const existingIndex = env.findIndex((row) => row.key === key);
        env = existingIndex >= 0
          ? env.map((row, i) => (i === existingIndex ? { ...row, value, enabled: true } : row))
          : [...env, { key, value, enabled: true }];
      }
      if (envTokens.length) {
        // Drop unused blank placeholder rows once real env rows exist.
        const withoutBlanks = env.filter((row) => row.key.trim() || row.value.trim());
        env = withoutBlanks.length ? withoutBlanks : env;
      }
      return { ...current, command: remaining[0], args: remaining.slice(1), env };
    });
    setServerTestResult(null);
  }

  function selectPreset(presetId) {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) return;
    setServerIdTouched(true);
    setForm(formFromPreset(preset));
    setServerTestResult(null);
    notify(t("toast.presetLoaded"), presetDescription(preset), "warning");
  }

  function openCreateServer() {
    const transport = preferences.defaultTransport;
    setServerIdTouched(false);
    setEditingServer(false);
    setServerTestResult(null);
    setForm({
      ...initialForm,
      presetId: transport === "stdio" ? customStdioPresetId : "custom-http",
      transport,
      command: transport === "stdio" ? stdioDefaultCommand : "",
      args: transport === "stdio" ? [...stdioDefaultArgs] : [],
    });
    navigate("servers");
    setServerModalOpen(true);
  }

  function openCreateEndpoint() {
    setEndpointIdTouched(false);
    setEditingEndpoint(false);
    setEndpointForm(initialEndpointForm);
    navigate("endpoints");
    setEndpointModalOpen(true);
  }

  function openCreateAPIKey() {
    setAPIKeyIdTouched(false);
    setEditingAPIKey(false);
    setAPIKeyForm(initialAPIKeyForm);
    navigate("api-keys");
    setAPIKeyModalOpen(true);
  }

  function updatePreference(name, value) {
    setPreferences((current) => ({ ...current, [name]: value }));
  }

  function toggleRecentSort(tableId) {
    setPreferences((current) => ({
      ...current,
      sortByRecent: {
        ...(current.sortByRecent || {}),
        [tableId]: !current.sortByRecent?.[tableId],
      },
    }));
  }

  function toggleTableColumn(tableId, columnId) {
    setPreferences((current) => {
      const currentColumns = visibleColumnIds(current, tableId);
      const nextColumns = currentColumns.includes(columnId)
        ? currentColumns.filter((id) => id !== columnId)
        : [...currentColumns, columnId];
      if (!nextColumns.length) return current;
      return {
        ...current,
        tableColumns: {
          ...(current.tableColumns || {}),
          [tableId]: nextColumns,
        },
      };
    });
  }

  function resetTablePage(tableId) {
    if (tableId === "servers") setServerPage(1);
    if (tableId === "endpoints") setEndpointPage(1);
    if (tableId === "apiKeys") setAPIKeyPage(1);
    if (tableId === "tools") setToolPage(1);
    if (tableId === "auditLogs") setAuditLogPage(1);
  }

  function addTableFilter(tableId, fieldId, context = {}) {
    const options = filterOptions(tableId, fieldId, context);
    if (!options.length) return;
    setTableFilters((current) => ({
      ...current,
      [tableId]: [
        ...(current[tableId] || []),
        {
          id: crypto.randomUUID(),
          field: fieldId,
          value: options[0].value,
        },
      ],
    }));
    resetTablePage(tableId);
  }

  function updateTableFilter(tableId, filterId, value) {
    setTableFilters((current) => ({
      ...current,
      [tableId]: (current[tableId] || []).map((filter) => (filter.id === filterId ? { ...filter, value } : filter)),
    }));
    resetTablePage(tableId);
  }

  function removeTableFilter(tableId, filterId) {
    setTableFilters((current) => ({
      ...current,
      [tableId]: (current[tableId] || []).filter((filter) => filter.id !== filterId),
    }));
    resetTablePage(tableId);
  }

  function clearTableFilters(tableId) {
    setTableFilters((current) => ({
      ...current,
      [tableId]: [],
    }));
    resetTablePage(tableId);
  }

  function resetPreferences() {
    setPreferences(defaultPreferences);
    setTableFilters(emptyTableFilters);
    setTheme("mcp");
    notify(t("toast.preferencesReset"), t("toast.preferencesResetMessage"), "warning");
  }

  function editServer(server) {
    const auth = authFromServer(server);
    setServerIdTouched(true);
    setEditingServer(true);
    setServerTestResult(null);
    setForm({
      presetId: presetIdForServer(server),
      id: server.id || "",
      name: server.name || "",
      transport: server.transport || "stdio",
      url: server.url || "",
      authType: auth.authType,
      token: auth.token,
      apiKeyName: auth.apiKeyName,
      apiKeyValue: auth.apiKeyValue,
      apiKeyIn: auth.apiKeyIn,
      username: auth.username,
      password: auth.password,
      headers: headerRowsFromHeaders(server.headers),
      command: server.command || "",
      args: argsFromServer(server),
      env: envRowsFromEnv(server.env),
      weight: server.weight || 1,
      enabled: Boolean(server.enabled),
    });
    navigate("servers", server.id);
    setServerModalOpen(true);
    notify(t("toast.editingServer"), t("toast.editingLoaded", { name: server.name }), "warning");
  }

  function openServer(server) {
    navigate("servers", server.id);
  }

  function editEndpoint(endpoint) {
    setEndpointIdTouched(true);
    setEditingEndpoint(true);
    setEndpointForm({
      id: endpoint.id || "",
      name: endpoint.name || "",
      description: endpoint.description || "",
      serverIds: endpoint.serverIds || [],
      rateLimitPerMinute: endpoint.rateLimit?.requestsPerMinute || 0,
      enabled: Boolean(endpoint.enabled),
    });
    navigate("endpoints", endpoint.id);
    setEndpointModalOpen(true);
    notify(t("toast.editingEndpoint"), t("toast.editingLoaded", { name: endpoint.name }), "warning");
  }

  function openEndpoint(endpoint) {
    navigate("endpoints", endpoint.id);
  }

  function editAPIKey(key) {
    setAPIKeyIdTouched(true);
    setEditingAPIKey(true);
    setAPIKeyForm({
      id: key.id || "",
      name: key.name || "",
      value: "",
      rotateValue: false,
      endpointIds: key.endpointIds || [],
      enabled: Boolean(key.enabled),
    });
    navigate("api-keys");
    setAPIKeyModalOpen(true);
    notify(t("toast.editingAPIKey"), t("toast.editingLoaded", { name: key.name }), "warning");
  }

  function testSuccessMessage(result) {
    if (result?.status === "precheck_ok") {
      return t("toast.serverPrecheckPassed");
    }
    const toolCount = result?.toolCount || 0;
    return t("toast.toolsDiscovered", { count: toolCount, unit: pluralKey(toolCount, "unit.tool.one", "unit.tool.other") });
  }

  async function testServerForm() {
    setTestingServer(true);
    setServerTestResult(null);
    try {
      const payload = serverPayloadFromForm(form);
      const response = await request("/api/servers/test", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const message = testSuccessMessage(response.result);
      setServerTestResult({ status: "success", message });
      notify(t("toast.serverTestPassed"), message);
    } catch (error) {
      setServerTestResult({ status: "error", message: error.message });
      notify(t("toast.serverTestFailed"), error.message, "error");
    } finally {
      setTestingServer(false);
    }
  }

  async function saveServer(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = serverPayloadFromForm(form);
      const response = await request("/api/servers", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setServers(response.servers || []);
      setToolsLoaded(false);
      setServerIdTouched(false);
      setEditingServer(false);
      setServerTestResult(null);
      setForm(initialForm);
      notify(t("toast.serverSaved"), t("toast.savedMessage", { name: payload.name }));
      setServerModalOpen(false);
    } catch (error) {
      notify(t("toast.saveFailed"), error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function saveEndpoint(event) {
    event.preventDefault();
    setSavingEndpoint(true);
    const isNew = !editingEndpoint;
    try {
      const payload = endpointPayloadFromForm(endpointForm);
      const response = await request("/api/endpoints", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setEndpoints(response.endpoints || []);
      setEndpointIdTouched(false);
      setEditingEndpoint(false);
      setEndpointForm(initialEndpointForm);
      setEndpointModalOpen(false);

      const savedEndpoint = (response.endpoints || []).find((item) => item.id === payload.id);
      if (isNew && savedEndpoint) {
        await loadAPIKeys();
        openCurlModal(savedEndpoint);
        notify(t("toast.endpointSavedWithKey"), t("toast.endpointSavedWithKeyMessage", { name: payload.name }));
      } else {
        notify(t("toast.endpointSaved"), t("toast.savedMessage", { name: payload.name }));
      }
    } catch (error) {
      notify(t("toast.saveEndpointFailed"), error.message, "error");
    } finally {
      setSavingEndpoint(false);
    }
  }

  async function saveAPIKey(event) {
    event.preventDefault();
    setSavingAPIKey(true);
    try {
      const payload = apiKeyPayloadFromForm(apiKeyForm);
      const response = await request("/api/api-keys", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setAPIKeys(response.apiKeys || []);
      setAPIKeyIdTouched(false);
      setEditingAPIKey(false);
      setAPIKeyForm(initialAPIKeyForm);
      notify(t("toast.apiKeySaved"), t("toast.savedMessage", { name: payload.name }));
      setAPIKeyModalOpen(false);
    } catch (error) {
      notify(t("toast.saveAPIKeyFailed"), error.message, "error");
    } finally {
      setSavingAPIKey(false);
    }
  }

  async function testSavedServer(id) {
    setTestingServerId(id);
    try {
      const response = await request(`/api/servers/${encodeURIComponent(id)}/test`, { method: "POST" });
      notify(t("toast.serverTestPassed"), testSuccessMessage(response.result));
      await loadServers();
    } catch (error) {
      notify(t("toast.serverTestFailed"), error.message, "error");
    } finally {
      setTestingServerId("");
    }
  }

  async function restartServer(id) {
    try {
      const response = await request(`/api/servers/${encodeURIComponent(id)}/restart`, { method: "POST" });
      setServers(response.servers || []);
      setToolsLoaded(false);
      notify(t("toast.serverRestarted"), id);
    } catch (error) {
      notify(t("toast.restartFailed"), error.message, "error");
    }
  }

  async function toggleServerEnabled(server) {
    const action = server.enabled ? "disable" : "enable";
    try {
      const response = await request(`/api/servers/${encodeURIComponent(server.id)}/${action}`, { method: "POST" });
      setServers(response.servers || []);
      setToolsLoaded(false);
      notify(server.enabled ? t("toast.serverDisabled") : t("toast.serverEnabled"), server.id, server.enabled ? "warning" : "success");
    } catch (error) {
      notify(server.enabled ? t("toast.disableFailed") : t("toast.enableFailed"), error.message, "error");
    }
  }

  async function deleteServer(id) {
    try {
      const response = await request(`/api/servers/${encodeURIComponent(id)}`, { method: "DELETE" });
      setServers(response.servers || []);
      setTools((items) => items.filter((tool) => tool.serverId !== id));
      setToolsLoaded(false);
      if (resourceId === id) {
        navigate("servers");
      }
      notify(t("toast.serverDeleted"), id, "warning");
    } catch (error) {
      notify(t("toast.deleteFailed"), error.message, "error");
    }
  }

  async function toggleEndpointEnabled(endpoint) {
    const action = endpoint.enabled ? "disable" : "enable";
    try {
      const response = await request(`/api/endpoints/${encodeURIComponent(endpoint.id)}/${action}`, { method: "POST" });
      setEndpoints(response.endpoints || []);
      notify(endpoint.enabled ? t("toast.endpointDisabled") : t("toast.endpointEnabled"), endpoint.id, endpoint.enabled ? "warning" : "success");
    } catch (error) {
      notify(endpoint.enabled ? t("toast.disableFailed") : t("toast.enableFailed"), error.message, "error");
    }
  }

  async function deleteEndpoint(id) {
    try {
      const response = await request(`/api/endpoints/${encodeURIComponent(id)}`, { method: "DELETE" });
      setEndpoints(response.endpoints || []);
      if (resourceId === id) {
        navigate("endpoints");
      }
      notify(t("toast.endpointDeleted"), id, "warning");
    } catch (error) {
      notify(t("toast.deleteEndpointFailed"), error.message, "error");
    }
  }

  async function deleteAPIKey(id) {
    try {
      const response = await request(`/api/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
      setAPIKeys(response.apiKeys || []);
      notify(t("toast.apiKeyDeleted"), id, "warning");
    } catch (error) {
      notify(t("toast.deleteAPIKeyFailed"), error.message, "error");
    }
  }

  const selectedServer = useMemo(
    () => (resourceId ? servers.find((server) => server.id === resourceId) : null),
    [servers, resourceId],
  );
  const selectedEndpoint = useMemo(
    () => (resourceId ? endpoints.find((endpoint) => endpoint.id === resourceId) : null),
    [endpoints, resourceId],
  );
  const runningServers = servers.filter((server) => server.status?.running).length;
  const enabledEndpoints = endpoints.filter((endpoint) => endpoint.enabled).length;
  const enabledAPIKeys = apiKeys.filter((key) => key.enabled).length;
  const failedAuditLogs = auditLogs.filter((entry) => entry.status >= 400).length;
  const limitedAuditLogs = auditLogs.filter((entry) => entry.status === 429).length;
  const viewTitle =
    activeView === "servers" && selectedServer
      ? selectedServer.name
      : activeView === "endpoints" && selectedEndpoint
        ? selectedEndpoint.name
        : activeView === "servers"
          ? t("view.servers.title")
          : activeView === "endpoints"
            ? t("view.endpoints.title")
            : activeView === "api-keys"
              ? t("view.apiKeys.title")
              : activeView === "tools"
                ? t("view.tools.title")
                : activeView === "audit-log"
                  ? t("view.auditLog.title")
                  : activeView === "settings"
                    ? t("view.settings.title")
                    : activeView === "profile"
                      ? t("view.profile.title")
                      : t("view.home.title");
  const viewDescription =
    activeView === "servers" && selectedServer
      ? t("view.serverDetail.description")
      : activeView === "endpoints" && selectedEndpoint
        ? t("view.endpointDetail.description")
        : activeView === "servers"
          ? t("view.servers.description")
          : activeView === "endpoints"
            ? t("view.endpoints.description")
            : activeView === "api-keys"
              ? t("view.apiKeys.description")
              : activeView === "tools"
                ? t("view.tools.description")
                : activeView === "audit-log"
                  ? t("view.auditLog.description")
                  : activeView === "settings"
                    ? t("view.settings.description")
                    : activeView === "profile"
                      ? t("view.profile.description")
                      : t("view.home.description");

  if (!authChecked) {
    return (
      <>
        <ApiLoadingBar active />
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  if (!authUser) {
    return (
      <>
        <ApiLoadingBar active={apiLoading} />
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        <LoginPage form={loginForm} loading={loggingIn} onSubmit={login} onUpdate={(name, value) => setLoginForm((current) => ({ ...current, [name]: value }))} />
      </>
    );
  }

  return (
    <>
      <ApiLoadingBar active={apiLoading} />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <div class={cn("flex min-h-screen bg-background", preferences.denseTables && "density-compact")}>
        <Sidebar
          activeView={activeView}
          darkMode={darkMode}
          user={authUser}
          onLogout={logout}
          onNavigate={(view) => navigate(view)}
          onToggleTheme={() => setTheme(darkMode ? "mcp" : "dark")}
        />
        <main class="flex min-w-0 flex-1 flex-col">
          <div class="flex-1 space-y-6 p-6">
          <TopBar title={viewTitle} description={viewDescription}>
            {activeView === "servers" && resourceId ? (
              <div class="flex flex-wrap gap-2">
                <button class={cn(buttonVariants({ variant: "outline", size: "sm" }))} type="button" onClick={() => navigate("servers")}>
                  {t("common.back")}
                </button>
                {selectedServer ? (
                  <button class={cn(buttonVariants({ variant: "default", size: "sm" }))} type="button" onClick={() => editServer(selectedServer)}>
                    {t("common.edit")}
                  </button>
                ) : null}
              </div>
            ) : activeView === "servers" ? (
              <>
                <button class={cn(buttonVariants({ variant: "outline", size: "sm" }))} onClick={() => loadServers(true)} disabled={loadingServers}>{loadingServers ? t("common.refreshing") : t("common.refresh")}</button>
                <button class={cn(buttonVariants({ variant: "default", size: "sm" }))} onClick={openCreateServer}>{t("action.createServer")}</button>
              </>
            ) : activeView === "endpoints" && resourceId ? (
              <div class="flex flex-wrap gap-2">
                <button class={cn(buttonVariants({ variant: "outline", size: "sm" }))} type="button" onClick={() => navigate("endpoints")}>
                  {t("common.back")}
                </button>
                {selectedEndpoint ? (
                  <button class={cn(buttonVariants({ variant: "default", size: "sm" }))} type="button" onClick={() => editEndpoint(selectedEndpoint)}>
                    {t("common.edit")}
                  </button>
                ) : null}
              </div>
            ) : activeView === "endpoints" ? (
              <>
                <button class={cn(buttonVariants({ variant: "outline", size: "sm" }))} onClick={() => loadEndpoints(true)} disabled={loadingEndpoints}>{loadingEndpoints ? t("common.refreshing") : t("common.refresh")}</button>
                <button class={cn(buttonVariants({ variant: "default", size: "sm" }))} onClick={openCreateEndpoint} disabled={!servers.length}>{t("action.createEndpoint")}</button>
              </>
            ) : activeView === "api-keys" ? (
              <>
                <button class={cn(buttonVariants({ variant: "outline", size: "sm" }))} onClick={() => loadAPIKeys(true)} disabled={loadingAPIKeys}>{loadingAPIKeys ? t("common.refreshing") : t("common.refresh")}</button>
                <button class={cn(buttonVariants({ variant: "default", size: "sm" }))} onClick={openCreateAPIKey} disabled={!endpoints.length}>{t("action.createAPIKey")}</button>
              </>
            ) : activeView === "tools" ? (
              <LoadingButton className={cn(buttonVariants({ variant: "default", size: "sm" }))} loading={loadingTools} onClick={() => loadTools(true)}>
                {t("action.refreshTools")}
              </LoadingButton>
            ) : activeView === "audit-log" ? (
              <button class={cn(buttonVariants({ variant: "outline", size: "sm" }))} onClick={() => loadAuditLogs(true)} disabled={loadingAuditLogs}>{loadingAuditLogs ? t("common.refreshing") : t("common.refresh")}</button>
            ) : activeView === "settings" ? (
              <button class={cn(buttonVariants({ variant: "outline", size: "sm" }))} onClick={resetPreferences}>{t("action.resetPreferences")}</button>
            ) : activeView === "profile" ? null : (
              <button class={cn(buttonVariants({ variant: "outline", size: "sm" }))} onClick={() => { loadServers(true); loadEndpoints(true); loadAPIKeys(true); }} disabled={loadingServers || loadingEndpoints || loadingAPIKeys}>{loadingServers || loadingEndpoints || loadingAPIKeys ? t("common.refreshing") : t("common.refresh")}</button>
            )}
          </TopBar>
          {activeView === "overview" ? (
            <div class="workspace-stack">
              <Card className="hero-card shadow-sm">
                <CardContent className="pt-6">
                <div class="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-center">
                  <div class="space-y-2">
                    <h1 class="text-3xl font-bold tracking-tight md:text-4xl">{t("brand.name")}</h1>
                    <p class="max-w-2xl text-muted-foreground">
                      {t("overview.hero")}
                    </p>
                  </div>
                  <div class="grid gap-3">
                    <InfoTile label={t("overview.endpointPattern")} value={endpointPattern} code copyable onCopy={() => notify(t("toast.copied"))} />
                    <InfoTile label={t("overview.sqliteDatabase")} value={configPath} copyable onCopy={() => notify(t("toast.copied"))} />
                  </div>
                </div>
                </CardContent>
              </Card>

              <GettingStartedFlow
                endpointPattern={endpointPattern}
                hasServers={servers.length > 0}
                hasEndpoints={endpoints.length > 0}
                hasAPIKeys={apiKeys.length > 0}
                onCreateServer={openCreateServer}
                onCreateEndpoint={openCreateEndpoint}
                onCreateAPIKey={openCreateAPIKey}
                onViewTools={() => navigate("tools")}
                onCopyEndpoint={() => notify(t("toast.copied"))}
              />

              <section class="grid gap-4 xl:grid-cols-[1fr_24rem]">
                <div class="workspace-panel">
                  <div class="section-title">{t("overview.gatewayOverview")}</div>
                  <div class="mt-4 grid gap-3 md:grid-cols-3">
                    <OverviewCard label={t("common.servers")} value={servers.length} detail={t("overview.runningDetail", { count: runningServers })} status={runningServers > 0 ? "success" : servers.length ? "warning" : "neutral"} />
                    <OverviewCard label={t("common.endpoints")} value={endpoints.length} detail={t("overview.enabledEndpointDetail", { count: enabledEndpoints })} status={enabledEndpoints > 0 ? "success" : "neutral"} />
                    <OverviewCard label={t("common.apiKeys")} value={apiKeys.length} detail={t("overview.enabledAPIKeyDetail", { count: enabledAPIKeys })} status={enabledAPIKeys > 0 ? "success" : "neutral"} />
                  </div>
                </div>
                <NotificationsPanel
                  servers={servers}
                  apiKeys={apiKeys}
                  endpoints={endpoints}
                  runningServers={runningServers}
                  onCreateServer={openCreateServer}
                  onRestart={restartServer}
                  onEditAPIKey={editAPIKey}
                />
              </section>
            </div>
          ) : null}

          {activeView === "servers" && resourceId ? (
            selectedServer ? (
              <ServerDetailPage
                server={selectedServer}
                testing={testingServerId === selectedServer.id}
                onEdit={editServer}
                onRestart={restartServer}
                onTest={testSavedServer}
                onToggleEnabled={toggleServerEnabled}
                onDelete={deleteServer}
              />
            ) : (
              <ResourceNotFound message={t("detail.serverNotFound")} onBack={() => navigate("servers")} />
            )
          ) : null}

          {activeView === "servers" && !resourceId ? (
            <div class="workspace-stack">
              <section class="metric-grid">
                <Stat title={t("overview.totalServers")} value={servers.length} />
                <Stat title={t("metric.running")} value={runningServers} tone="text-emerald-600 dark:text-emerald-400" />
                <Stat title={t("metric.disabled")} value={servers.filter((server) => !server.enabled).length} />
                <Stat title={t("metric.gatewayTools")} value={gatewayToolsCount} tone="text-muted-foreground" />
              </section>
              <ListPanel
                subtitle={t("list.serversSubtitle", { shown: filteredServers.length, total: servers.length })}
                searchValue={serverSearch}
                onSearch={(value) => {
                  setServerSearch(value);
                  setServerPage(1);
                }}
                pageSize={serverPageSize}
                onPageSize={(value) => {
                  setServerPageSize(Number(value));
                  setServerPage(1);
                }}
                showAdvancedControls={preferences.showAdvancedControls}
                pageSizes={[3, 5, 10]}
                page={clampPage(serverPage, filteredServers.length, serverPageSize)}
                pages={serverPages}
                prev={() => setServerPage((page) => clampPage(page - 1, filteredServers.length, serverPageSize))}
                next={() => setServerPage((page) => clampPage(page + 1, filteredServers.length, serverPageSize))}
                tableId="servers"
                visibleColumns={serverColumns}
                sortActive={Boolean(preferences.sortByRecent.servers)}
                onToggleSort={() => toggleRecentSort("servers")}
                onToggleColumn={(columnId) => toggleTableColumn("servers", columnId)}
                filters={tableFilters.servers}
                onAddFilter={(fieldId) => addTableFilter("servers", fieldId)}
                onUpdateFilter={(filterId, value) => updateTableFilter("servers", filterId, value)}
                onRemoveFilter={(filterId) => removeTableFilter("servers", filterId)}
                onClearFilters={() => clearTableFilters("servers")}
              >
                <div class="data-table server-table">
                  <div class="data-row data-head" style={{ gridTemplateColumns: tableGridTemplate("servers", serverColumns, true) }}>
                    <TableHeader tableId="servers" visibleColumns={serverColumns} />
                    <span></span>
                  </div>
                  {loadingServers ? (
                    <SkeletonList />
                  ) : visibleServers.length ? (
                    visibleServers.map((server) => (
                      <ServerCard
                        key={server.id}
                        server={server}
                        testing={testingServerId === server.id}
                        onOpen={openServer}
                        onEdit={editServer}
                        onRestart={restartServer}
                        onTest={testSavedServer}
                        onToggleEnabled={toggleServerEnabled}
                        onDelete={deleteServer}
                        visibleColumns={serverColumns}
                      />
                    ))
                  ) : (
                    <EmptyState message={t("empty.noServers")} actionLabel={t("action.createServer")} onAction={openCreateServer} />
                  )}
                </div>
              </ListPanel>
            </div>
          ) : null}

          {activeView === "endpoints" && resourceId ? (
            selectedEndpoint ? (
              <EndpointDetailPage
                endpoint={selectedEndpoint}
                servers={servers}
                onEdit={editEndpoint}
                onCopyCurl={openCurlModal}
                onToggleEnabled={toggleEndpointEnabled}
                onDelete={deleteEndpoint}
              />
            ) : (
              <ResourceNotFound message={t("detail.endpointNotFound")} onBack={() => navigate("endpoints")} />
            )
          ) : null}

          {activeView === "endpoints" && !resourceId ? (
            <div class="workspace-stack">
              <section class="metric-grid">
                <Stat title={t("metric.totalEndpoints")} value={endpoints.length} />
                <Stat title={t("common.enabled")} value={enabledEndpoints} tone="text-emerald-600 dark:text-emerald-400" />
                <Stat title={t("metric.attachedServers")} value={new Set(endpoints.flatMap((endpoint) => endpoint.serverIds || [])).size}  />
                <Stat title={t("metric.limitedCalls")} value={endpoints.reduce((sum, endpoint) => sum + (endpoint.usage?.rateLimitedCalls || 0), 0)} tone="text-muted-foreground" />
              </section>
              <ListPanel
                subtitle={t("list.endpointsSubtitle", { shown: filteredEndpoints.length, total: endpoints.length })}
                searchValue={endpointSearch}
                onSearch={(value) => {
                  setEndpointSearch(value);
                  setEndpointPage(1);
                }}
                pageSize={endpointPageSize}
                onPageSize={(value) => {
                  setEndpointPageSize(Number(value));
                  setEndpointPage(1);
                }}
                showAdvancedControls={preferences.showAdvancedControls}
                pageSizes={[3, 5, 10]}
                page={clampPage(endpointPage, filteredEndpoints.length, endpointPageSize)}
                pages={endpointPages}
                prev={() => setEndpointPage((page) => clampPage(page - 1, filteredEndpoints.length, endpointPageSize))}
                next={() => setEndpointPage((page) => clampPage(page + 1, filteredEndpoints.length, endpointPageSize))}
                tableId="endpoints"
                visibleColumns={endpointColumns}
                sortActive={Boolean(preferences.sortByRecent.endpoints)}
                onToggleSort={() => toggleRecentSort("endpoints")}
                onToggleColumn={(columnId) => toggleTableColumn("endpoints", columnId)}
                filters={tableFilters.endpoints}
                onAddFilter={(fieldId) => addTableFilter("endpoints", fieldId)}
                onUpdateFilter={(filterId, value) => updateTableFilter("endpoints", filterId, value)}
                onRemoveFilter={(filterId) => removeTableFilter("endpoints", filterId)}
                onClearFilters={() => clearTableFilters("endpoints")}
              >
                <div class="data-table endpoint-table">
                  <div class="data-row data-head" style={{ gridTemplateColumns: tableGridTemplate("endpoints", endpointColumns, true) }}>
                    <TableHeader tableId="endpoints" visibleColumns={endpointColumns} />
                    <span></span>
                  </div>
                  {loadingEndpoints ? (
                    <SkeletonList />
                  ) : visibleEndpoints.length ? (
                    visibleEndpoints.map((endpoint) => (
                      <EndpointCard
                        key={endpoint.id}
                        endpoint={endpoint}
                        servers={servers}
                        onOpen={openEndpoint}
                        onEdit={editEndpoint}
                        onCopyCurl={openCurlModal}
                        onToggleEnabled={toggleEndpointEnabled}
                        onDelete={deleteEndpoint}
                        visibleColumns={endpointColumns}
                        onCopyUrl={() => notify(t("toast.copied"))}
                      />
                    ))
                  ) : (
                    <EmptyState
                      message={servers.length ? t("empty.noEndpoints") : t("empty.needServerForEndpoint")}
                      actionLabel={servers.length ? t("action.createEndpoint") : t("action.createServer")}
                      onAction={servers.length ? openCreateEndpoint : openCreateServer}
                    />
                  )}
                </div>
              </ListPanel>
            </div>
          ) : null}

          {activeView === "api-keys" ? (
            <div class="workspace-stack">
              <section class="metric-grid">
                <Stat title={t("metric.totalAPIKeys")} value={apiKeys.length} />
                <Stat title={t("common.enabled")} value={enabledAPIKeys} tone="text-emerald-600 dark:text-emerald-400" />
                <Stat title={t("metric.endpointResources")} value={new Set(apiKeys.flatMap((key) => key.endpointIds || [])).size}  />
                <Stat title={t("common.endpoints")} value={endpoints.length} tone="text-muted-foreground" />
              </section>
              <ListPanel
                subtitle={t("list.apiKeysSubtitle", { shown: filteredAPIKeys.length, total: apiKeys.length })}
                searchValue={apiKeySearch}
                onSearch={(value) => {
                  setAPIKeySearch(value);
                  setAPIKeyPage(1);
                }}
                pageSize={apiKeyPageSize}
                onPageSize={(value) => {
                  setAPIKeyPageSize(Number(value));
                  setAPIKeyPage(1);
                }}
                showAdvancedControls={preferences.showAdvancedControls}
                pageSizes={[3, 5, 10]}
                page={clampPage(apiKeyPage, filteredAPIKeys.length, apiKeyPageSize)}
                pages={apiKeyPages}
                prev={() => setAPIKeyPage((page) => clampPage(page - 1, filteredAPIKeys.length, apiKeyPageSize))}
                next={() => setAPIKeyPage((page) => clampPage(page + 1, filteredAPIKeys.length, apiKeyPageSize))}
                tableId="apiKeys"
                visibleColumns={apiKeyColumns}
                sortActive={Boolean(preferences.sortByRecent.apiKeys)}
                onToggleSort={() => toggleRecentSort("apiKeys")}
                onToggleColumn={(columnId) => toggleTableColumn("apiKeys", columnId)}
                filters={tableFilters.apiKeys}
                onAddFilter={(fieldId) => addTableFilter("apiKeys", fieldId)}
                onUpdateFilter={(filterId, value) => updateTableFilter("apiKeys", filterId, value)}
                onRemoveFilter={(filterId) => removeTableFilter("apiKeys", filterId)}
                onClearFilters={() => clearTableFilters("apiKeys")}
              >
                <div class="data-table api-key-table">
                  <div class="data-row data-head" style={{ gridTemplateColumns: tableGridTemplate("apiKeys", apiKeyColumns, true) }}>
                    <TableHeader tableId="apiKeys" visibleColumns={apiKeyColumns} />
                    <span></span>
                  </div>
                  {loadingAPIKeys ? (
                    <SkeletonList />
                  ) : visibleAPIKeys.length ? (
                    visibleAPIKeys.map((key) => (
                      <APIKeyCard
                        key={key.id}
                        apiKey={key}
                        endpoints={endpoints}
                        onEdit={editAPIKey}
                        onDelete={deleteAPIKey}
                        visibleColumns={apiKeyColumns}
                      />
                    ))
                  ) : (
                    <EmptyState
                      message={endpoints.length ? t("empty.noAPIKeys") : t("empty.needEndpointForAPIKey")}
                      actionLabel={endpoints.length ? t("action.createAPIKey") : t("action.createEndpoint")}
                      onAction={endpoints.length ? openCreateAPIKey : openCreateEndpoint}
                    />
                  )}
                </div>
              </ListPanel>
            </div>
          ) : null}

          {activeView === "tools" ? (
            <div class="workspace-stack">
              <section class="metric-grid">
                <Stat title={t("overview.loadedTools")} value={tools.length}  />
                <Stat title={t("common.servers")} value={servers.length} />
                <Stat title={t("metric.runningServers")} value={runningServers} tone="text-emerald-600 dark:text-emerald-400" />
                <Stat title={t("metric.gatewayTools")} value={gatewayToolsCount} tone="text-muted-foreground" />
              </section>
              <ListPanel
                subtitle={t("list.toolsSubtitle", { shown: filteredTools.length, total: tools.length })}
                searchValue={toolSearch}
                onSearch={(value) => {
                  setToolSearch(value);
                  setToolPage(1);
                }}
                pageSize={toolPageSize}
                onPageSize={(value) => {
                  setToolPageSize(Number(value));
                  setToolPage(1);
                }}
                showAdvancedControls={preferences.showAdvancedControls}
                pageSizes={[5, 10, 20]}
                page={clampPage(toolPage, filteredTools.length, toolPageSize)}
                pages={toolPages}
                prev={() => setToolPage((page) => clampPage(page - 1, filteredTools.length, toolPageSize))}
                next={() => setToolPage((page) => clampPage(page + 1, filteredTools.length, toolPageSize))}
                tableId="tools"
                visibleColumns={toolColumns}
                sortActive={Boolean(preferences.sortByRecent.tools)}
                onToggleSort={() => toggleRecentSort("tools")}
                onToggleColumn={(columnId) => toggleTableColumn("tools", columnId)}
                filters={tableFilters.tools}
                filterContext={{ servers }}
                onAddFilter={(fieldId) => addTableFilter("tools", fieldId, { servers })}
                onUpdateFilter={(filterId, value) => updateTableFilter("tools", filterId, value)}
                onRemoveFilter={(filterId) => removeTableFilter("tools", filterId)}
                onClearFilters={() => clearTableFilters("tools")}
              >
                <div class="data-table tool-table">
                  <div class="data-row data-head" style={{ gridTemplateColumns: tableGridTemplate("tools", toolColumns) }}>
                    <TableHeader tableId="tools" visibleColumns={toolColumns} />
                  </div>
                  {loadingTools ? (
                    <SkeletonList />
                  ) : visibleTools.length ? (
                    visibleTools.map((tool) => <ToolCard key={tool.name} tool={tool} visibleColumns={toolColumns} />)
                  ) : (
                    <EmptyState message={t("empty.noTools")} actionLabel={t("action.refreshTools")} onAction={() => loadTools(true)} />
                  )}
                </div>
              </ListPanel>
            </div>
          ) : null}

          {activeView === "audit-log" ? (
            <div class="workspace-stack">
              <section class="metric-grid">
                <Stat title={t("metric.auditEvents")} value={auditLogs.length}  />
                <Stat title={t("metric.failedEvents")} value={failedAuditLogs} tone={failedAuditLogs ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"} />
                <Stat title={t("metric.limitedCalls")} value={limitedAuditLogs} tone="text-muted-foreground" />
                <Stat title={t("metric.mcpEvents")} value={auditLogs.filter((entry) => entry.transport === "mcp").length} />
              </section>
              <ListPanel
                subtitle={t("list.auditLogsSubtitle", { shown: filteredAuditLogs.length, total: auditLogs.length })}
                searchValue={auditLogSearch}
                onSearch={(value) => {
                  setAuditLogSearch(value);
                  setAuditLogPage(1);
                }}
                pageSize={auditLogPageSize}
                onPageSize={(value) => {
                  setAuditLogPageSize(Number(value));
                  setAuditLogPage(1);
                }}
                showAdvancedControls={preferences.showAdvancedControls}
                pageSizes={[10, 25, 50]}
                page={clampPage(auditLogPage, filteredAuditLogs.length, auditLogPageSize)}
                pages={auditLogPages}
                prev={() => setAuditLogPage((page) => clampPage(page - 1, filteredAuditLogs.length, auditLogPageSize))}
                next={() => setAuditLogPage((page) => clampPage(page + 1, filteredAuditLogs.length, auditLogPageSize))}
                tableId="auditLogs"
                visibleColumns={auditLogColumns}
                sortActive={Boolean(preferences.sortByRecent.auditLogs)}
                onToggleSort={() => toggleRecentSort("auditLogs")}
                onToggleColumn={(columnId) => toggleTableColumn("auditLogs", columnId)}
                filters={tableFilters.auditLogs}
                onAddFilter={(fieldId) => addTableFilter("auditLogs", fieldId)}
                onUpdateFilter={(filterId, value) => updateTableFilter("auditLogs", filterId, value)}
                onRemoveFilter={(filterId) => removeTableFilter("auditLogs", filterId)}
                onClearFilters={() => clearTableFilters("auditLogs")}
              >
                <div class="data-table audit-log-table">
                  <div class="data-row data-head" style={{ gridTemplateColumns: tableGridTemplate("auditLogs", auditLogColumns) }}>
                    <TableHeader tableId="auditLogs" visibleColumns={auditLogColumns} />
                  </div>
                  {loadingAuditLogs ? (
                    <SkeletonList />
                  ) : visibleAuditLogs.length ? (
                    visibleAuditLogs.map((entry) => <AuditLogCard key={entry.id} entry={entry} visibleColumns={auditLogColumns} />)
                  ) : (
                    <EmptyState message={t("empty.noAuditLogs")} />
                  )}
                </div>
              </ListPanel>
            </div>
          ) : null}

          {activeView === "settings" ? (
            <div class="workspace-stack">
              <section class="grid items-stretch gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <div class="workspace-panel flex h-full flex-col">
                  <div class="flex flex-col gap-1">
                    <h2 class="text-lg font-bold text-foreground">{t("settings.preferences")}</h2>
                    <p class="text-sm text-muted-foreground">{t("settings.preferencesDescription")}</p>
                  </div>

                  <div class="mt-5 grid flex-1 gap-4 md:grid-cols-2">
                    <Field label={t("settings.theme")}>
                      <NativeSelect className={cn("w-full")} value={theme} onChange={(event) => setTheme(event.currentTarget.value)}>
                        <option value="mcp">{t("common.light")}</option>
                        <option value="dark">{t("common.dark")}</option>
                      </NativeSelect>
                    </Field>
                    <Field label={t("settings.refreshInterval")}>
                      <NativeSelect className={cn("w-full")} value={preferences.refreshInterval} onChange={(event) => updatePreference("refreshInterval", Number(event.currentTarget.value))}>
                        <option value="0">{t("common.off")}</option>
                        <option value="15">{t("settings.every15Seconds")}</option>
                        <option value="30">{t("settings.every30Seconds")}</option>
                        <option value="60">{t("settings.everyMinute")}</option>
                        <option value="300">{t("settings.every5Minutes")}</option>
                      </NativeSelect>
                    </Field>
                    <Field label={t("settings.defaultTransport")}>
                      <NativeSelect className={cn("w-full")} value={preferences.defaultTransport} onChange={(event) => updatePreference("defaultTransport", event.currentTarget.value)}>
                        <option value="http">{t("settings.httpUrl")}</option>
                        <option value="stdio">{t("settings.localStdio")}</option>
                      </NativeSelect>
                      <p class="mt-2 text-xs text-muted-foreground">{t("settings.defaultTransportHelp")}</p>
                    </Field>
                    <div class="grid gap-3 rounded-2xl border border-border bg-muted/50 p-4">
                      <div class="flex items-center justify-between gap-4">
                        <span>
                          <span class="block font-bold text-foreground">{t("settings.compactTables")}</span>
                          <span class="text-xs text-muted-foreground">{t("settings.compactTablesHelp")}</span>
                        </span>
                        <Switch checked={preferences.denseTables} onCheckedChange={(checked) => updatePreference("denseTables", checked)} />
                      </div>
                      <div class="flex items-center justify-between gap-4">
                        <span>
                          <span class="block font-bold text-foreground">{t("settings.advancedTableControls")}</span>
                          <span class="text-xs text-muted-foreground">{t("settings.advancedTableControlsHelp")}</span>
                        </span>
                        <Switch checked={preferences.showAdvancedControls} onCheckedChange={(checked) => updatePreference("showAdvancedControls", checked)} />
                      </div>
                    </div>
                  </div>
                </div>

                <GatewayPathsPanel
                  endpointPattern={endpointPattern}
                  configPath={configPath}
                  onCopy={() => notify(t("toast.copied"))}
                />
              </section>
            </div>
          ) : null}

          {activeView === "profile" ? (
            <ProfileView
              form={passwordForm}
              saving={savingPassword}
              user={authUser}
              onSubmit={changePassword}
              onUpdate={(name, value) => setPasswordForm((current) => ({ ...current, [name]: value }))}
            />
          ) : null}
          </div>
      </main>
      </div>
      <ServerModal
        open={serverModalOpen}
        title={editingServer ? t("modal.updateServer") : t("modal.createServer")}
        description={t("modal.serverDescription")}
        onClose={() => {
          setServerModalOpen(false);
          setServerTestResult(null);
        }}
        footer={
          <ServerFormFooter
            form={form}
            saving={saving}
            testing={testingServer}
            testResult={serverTestResult}
            onTest={testServerForm}
            onUpdate={updateForm}
          />
        }
      >
        <ServerForm
          form={form}
          onSubmit={saveServer}
          onClear={() => {
            setServerIdTouched(false);
            setEditingServer(false);
            setServerTestResult(null);
            setForm(initialForm);
          }}
          onPreset={selectPreset}
          onUpdate={updateForm}
          onArgChange={updateArg}
          onAddArg={addArg}
          onRemoveArg={removeArg}
          onApplyPasteCommand={applyPastedCommand}
          onHeaderChange={updateHeader}
          onAddHeader={addHeader}
          onRemoveHeader={removeHeader}
          onEnvChange={updateEnv}
          onAddEnv={addEnv}
          onRemoveEnv={removeEnv}
        />
      </ServerModal>
      <ServerModal
        open={endpointModalOpen}
        title={editingEndpoint ? t("modal.updateEndpoint") : t("modal.createEndpoint")}
        description={t("modal.endpointDescription")}
        onClose={() => setEndpointModalOpen(false)}
      >
        <EndpointForm
          form={endpointForm}
          servers={servers}
          saving={savingEndpoint}
          onSubmit={saveEndpoint}
          onClear={() => {
            setEndpointIdTouched(false);
            setEditingEndpoint(false);
            setEndpointForm(initialEndpointForm);
          }}
          onUpdate={updateEndpointForm}
          onToggleServer={toggleEndpointServer}
        />
      </ServerModal>
      <ServerModal
        open={apiKeyModalOpen}
        title={editingAPIKey ? t("modal.updateAPIKey") : t("modal.createAPIKey")}
        description={t("modal.apiKeyDescription")}
        onClose={() => setAPIKeyModalOpen(false)}
      >
        <APIKeyForm
          form={apiKeyForm}
          endpoints={endpoints}
          editing={editingAPIKey}
          saving={savingAPIKey}
          onSubmit={saveAPIKey}
          onClear={() => {
            setAPIKeyIdTouched(false);
            setEditingAPIKey(false);
            setAPIKeyForm(initialAPIKeyForm);
          }}
          onUpdate={updateAPIKeyForm}
          onToggleEndpoint={toggleAPIKeyEndpoint}
        />
      </ServerModal>
      <ServerModal
        open={curlModal.open}
        title={t("modal.copyCurl")}
        description={t("curl.description")}
        onClose={() => setCurlModal({ open: false, endpoint: null, apiKeys: [], exampleTool: null, loading: false })}
      >
        <CurlCopyModal
          endpoint={curlModal.endpoint}
          apiKeys={curlModal.apiKeys}
          exampleTool={curlModal.exampleTool}
          loading={curlModal.loading}
          onCopy={copyEndpointCurl}
        />
      </ServerModal>
    </>
  );
}

function LoadingButton({ className, loading, onClick, type = "button", children, variant = "default", size = "default" }) {
  return (
    <Button className={className} variant={variant} size={size} type={type} onClick={onClick} disabled={loading}>
      {loading ? <Spinner size="sm" /> : null}
      {loading ? t("common.loading") : children}
    </Button>
  );
}

function ApiLoadingBar({ active }) {
  if (!active) return null;

  return (
    <div class="api-loading-overlay" role="status" aria-live="polite" aria-label={t("aria.apiRequestInProgress")}>
      <div class="api-loading-card">
        <Spinner size="lg" />
        <span>{t("common.loading")}</span>
      </div>
    </div>
  );
}

function BrandLogo() {
  return <img class="brand-logo" src={logoUrl} alt="" aria-hidden="true" />;
}

function LoginPage({ form, loading, onSubmit, onUpdate }) {
  return (
    <main class="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4">
          <div class="flex items-center gap-3">
            <BrandLogo />
            <div>
              <CardTitle className="text-base">{t("brand.name")}</CardTitle>
              <CardDescription>{t("auth.platformLogin")}</CardDescription>
            </div>
          </div>
          <div class="space-y-1">
            <CardTitle className="text-2xl">{t("auth.signInTitle")}</CardTitle>
            <CardDescription>{t("auth.signInDescription")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form class="grid gap-4" onSubmit={onSubmit}>
            <Field label={t("auth.email")}>
              <Input className={cn("w-full")} type="email" autocomplete="username" value={form.email} onInput={(event) => onUpdate("email", event.currentTarget.value)} required />
            </Field>
            <Field label={t("auth.password")}>
              <Input className={cn("w-full")} type="password" autocomplete="current-password" value={form.password} onInput={(event) => onUpdate("password", event.currentTarget.value)} required />
            </Field>
            <LoadingButton className={cn("w-full")} type="submit" loading={loading}>
              {t("auth.signIn")}
            </LoadingButton>
          </form>
          <p class="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">{t("auth.defaultCredentialHint")}</p>
        </CardContent>
      </Card>
    </main>
  );
}

function ProfileView({ form, saving, user, onSubmit, onUpdate }) {
  return (
    <div class="workspace-stack">
      <section class="workspace-panel">
        <div class="flex flex-col gap-1">
          <h2 class="text-lg font-bold text-foreground">{t("profile.account")}</h2>
          <p class="text-sm text-muted-foreground">{user?.email}</p>
        </div>
      </section>
      <section class="workspace-panel max-w-2xl">
        <div class="flex flex-col gap-1">
          <h2 class="text-lg font-bold text-foreground">{t("profile.changePassword")}</h2>
          <p class="text-sm text-muted-foreground">{t("profile.changePasswordDescription")}</p>
        </div>
        <form class="mt-5 grid gap-4" onSubmit={onSubmit}>
          <Field label={t("profile.currentPassword")}>
            <Input className={cn("w-full")} type="password" autocomplete="current-password" value={form.currentPassword} onInput={(event) => onUpdate("currentPassword", event.currentTarget.value)} required />
          </Field>
          <Field label={t("profile.newPassword")}>
            <Input className={cn("w-full")} type="password" autocomplete="new-password" value={form.newPassword} onInput={(event) => onUpdate("newPassword", event.currentTarget.value)} required />
          </Field>
          <Field label={t("profile.confirmPassword")}>
            <Input className={cn("w-full")} type="password" autocomplete="new-password" value={form.confirmPassword} onInput={(event) => onUpdate("confirmPassword", event.currentTarget.value)} required />
          </Field>
          <LoadingButton className={cn(buttonVariants({ variant: "default" }), "justify-self-start")} type="submit" loading={saving}>
            {t("profile.savePassword")}
          </LoadingButton>
        </form>
      </section>
    </div>
  );
}

function Sidebar({ activeView, darkMode, user, onLogout, onNavigate, onToggleTheme }) {
  const links = [
    { id: "overview", label: t("nav.overview"), icon: LayoutDashboard },
    { id: "servers", label: t("nav.mcpServers"), icon: Server },
    { id: "endpoints", label: t("nav.endpoints"), icon: Link2 },
    { id: "api-keys", label: t("nav.apiKeys"), icon: Key },
    { id: "tools", label: t("nav.tools"), icon: Wrench },
    { id: "audit-log", label: t("nav.auditLog"), icon: ScrollText },
    { id: "settings", label: t("nav.settings"), icon: Settings2 },
  ];

  return (
    <aside class="flex w-full shrink-0 flex-col border-b border-border bg-card lg:sticky lg:top-0 lg:h-screen lg:w-56 lg:border-b-0 lg:border-r">
      <div class="flex items-start gap-3 border-b border-border p-4">
        <BrandLogo />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold leading-snug">{t("brand.name")}</div>
          <div class="text-xs text-muted-foreground">{t("nav.project")}</div>
        </div>
      </div>
      <nav class="flex flex-1 flex-col gap-0.5 p-2">
        {links.map((link) => {
          const Icon = link.icon;
          const active = activeView === link.id;
          return (
            <Button
              key={link.id}
              variant="ghost"
              className={cn(
                "h-9 w-full justify-start gap-2.5 rounded-md pl-3 font-medium",
                active && "nav-link-active",
              )}
              type="button"
              onClick={() => onNavigate(link.id)}
            >
              <Icon className="h-4 w-4 shrink-0 opacity-70" />
              {link.label}
            </Button>
          );
        })}
      </nav>
      <div class="flex flex-col gap-0.5 border-t border-border p-2">
        <Button variant="ghost" className="h-8 w-full justify-start gap-2.5 px-3 text-sm font-normal" asChild>
          <a href="/docs" target="_blank" rel="noreferrer"><BookOpen className="h-3.5 w-3.5 opacity-70" />{t("nav.apiDocs")}</a>
        </Button>
        <Button variant="ghost" className="h-8 w-full justify-start gap-2.5 px-3 text-sm font-normal" asChild>
          <a href="https://github.com/mcpHQ/mcp-gateway" target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5 opacity-70" />{t("nav.github")}</a>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="mt-2 h-auto w-full justify-start gap-3 px-3 py-2">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {initialsForEmail(user?.email)}
              </span>
              <span class="min-w-0 text-left">
                <span class="block truncate text-sm font-medium">{user?.email}</span>
                <span class="block text-xs text-muted-foreground">{t("auth.signedIn")}</span>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={() => onNavigate("profile")}>{t("auth.profile")}</DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleTheme}>{darkMode ? t("auth.lightMode") : t("auth.darkMode")}</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onLogout}>{t("auth.logout")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

function initialsForEmail(email = "") {
  return email.trim().slice(0, 1).toUpperCase() || "A";
}

function TopBar({ title, description, children }) {
  return (
    <header class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p class="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div class="flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}

function ServerModal({ open, title, description, onClose, footer, children }) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-6xl gap-0 overflow-hidden p-0" onInteractOutside={(event) => event.preventDefault()}>
        <div class="flex shrink-0 items-start justify-between gap-4 border-b bg-background/95 px-6 py-5">
          <DialogHeader className="text-left">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <Button variant="ghost" size="icon" type="button" onClick={onClose} aria-label={t("modal.closeServer")}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer ? <div class="flex shrink-0 flex-col gap-3 border-t border-border bg-background px-6 py-4">{footer}</div> : null}
      </DialogContent>
    </Dialog>
  );
}

function CurlCopyModal({ endpoint, apiKeys, exampleTool, loading, onCopy }) {
  if (!endpoint) return null;

  return (
    <div class="grid gap-4 p-6">
      <div class="rounded-2xl border border-border bg-muted/50 p-4">
        <div class="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("table.mcpUrl")}</div>
        <code class="mt-2 block break-all text-sm text-primary">{endpointUrl(endpoint)}</code>
      </div>
      {loading ? (
        <div class="flex items-center gap-3 rounded-2xl border border-border p-4 text-sm text-muted-foreground">
          <Spinner size="sm" />
          {t("common.loading")}
        </div>
      ) : apiKeys.length ? (
        <div class="grid gap-3">
          {apiKeys.map((apiKey) => {
            const listCommand = curlForEndpoint(endpoint, apiKey);
            const callCommand = exampleTool ? restToolCallCurlForEndpoint(endpoint, apiKey, exampleTool) : null;
            return (
              <div key={apiKey.id} class="rounded-2xl border border-border bg-card p-4">
                <div class="min-w-0">
                  <div class="font-bold text-foreground">{apiKey.name}</div>
                  <div class="mt-1 font-mono text-xs text-muted-foreground">{apiKey.id}</div>
                  <div class="mt-3">
                    <div class="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("apiKey.value")}</div>
                    <code class="mt-1 block break-all rounded-lg bg-primary/10 px-2 py-1 text-xs text-primary">{apiKey.value}</code>
                  </div>
                </div>
                <div class="mt-4 grid gap-4">
                  <div>
                    <div class="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <div class="text-sm font-bold text-foreground">{t("curl.listTools")}</div>
                        <p class="text-xs text-muted-foreground">{t("curl.listToolsHelp")}</p>
                      </div>
                      <button class={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")} type="button" onClick={() => onCopy(listCommand, apiKey.value)}>
                        {t("action.copyCurl")}
                      </button>
                    </div>
                    <Textarea className={cn("h-28 w-full font-mono text-xs")} readOnly value={listCommand}></Textarea>
                  </div>
                  {callCommand ? (
                    <div>
                      <div class="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <div class="text-sm font-bold text-foreground">{t("curl.callTool")}</div>
                          <p class="text-xs text-muted-foreground">{t("curl.callToolHelp", { tool: exampleTool })}</p>
                        </div>
                        <button class={cn(buttonVariants({ variant: "default", size: "sm" }), "shrink-0")} type="button" onClick={() => onCopy(callCommand, apiKey.value)}>
                          {t("action.copyCurl")}
                        </button>
                      </div>
                      <Textarea className={cn("h-36 w-full font-mono text-xs")} readOnly value={callCommand}></Textarea>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState message={t("empty.noEndpointAPIKeys")} />
      )}
    </div>
  );
}

function ArgList({ args, command, onChange, onAdd, onRemove }) {
  const rows = args.length ? args : [""];
  const isNpx = (command || "").trim() === "npx";

  function placeholderFor(index) {
    if (isNpx) {
      if (index === 0) return "-y";
      if (index === 1) return t("server.placeholderArgPackage");
    }
    return index === 0 ? t("server.placeholderArg") : "";
  }

  return (
    <div class="grid gap-2">
      {rows.map((arg, index) => (
        <div class="flex w-full gap-0" key={index}>
          <Input
            className={cn("rounded-r-none w-full")}
            value={arg}
            placeholder={placeholderFor(index)}
            onInput={(event) => onChange(index, event.currentTarget.value)}
          />
          <button class={cn(buttonVariants({ variant: "outline" }), "rounded-l-none")} type="button" onClick={() => onRemove(index)} disabled={!args.length}>
            {t("common.remove")}
          </button>
        </div>
      ))}
      <button class={cn(buttonVariants({ variant: "outline", size: "sm" }), "justify-self-start")} type="button" onClick={onAdd}>
        {t("server.addArg")}
      </button>
    </div>
  );
}

function EnvList({ env, onChange, onAdd, onRemove }) {
  return (
    <div class="grid gap-2">
      <div class="hidden grid-cols-[auto_1fr_1fr_auto] gap-2 px-2 text-xs font-bold uppercase tracking-wide text-muted-foreground md:grid">
        <span>{t("common.on")}</span>
        <span>{t("common.key")}</span>
        <span>{t("common.value")}</span>
        <span></span>
      </div>
      {env.map((row, index) => (
        <div key={index} class="grid gap-2 rounded-2xl border border-border bg-muted/50 p-2 md:grid-cols-[auto_1fr_1fr_auto] md:items-center md:border-0 md:bg-transparent md:p-0">
          <label class="flex cursor-pointer items-center gap-2 md:justify-center">
            <Checkbox checked={row.enabled} onCheckedChange={(checked) => onChange(index, "enabled", checked)} />
            <span class="md:hidden">{t("common.enabled")}</span>
          </label>
          <Input className={cn("h-8 w-full font-mono text-xs")} value={row.key} placeholder={t("server.placeholderEnvKey")} onInput={(event) => onChange(index, "key", event.currentTarget.value)} />
          <Input
            className={cn("h-8 w-full font-mono text-xs")}
            type={isSecretEnvKey(row.key) ? "password" : "text"}
            value={row.value}
            placeholder={t("server.placeholderEnvValue")}
            onInput={(event) => onChange(index, "value", event.currentTarget.value)}
          />
          <button class={cn(buttonVariants({ variant: "ghost", size: "sm" }))} type="button" onClick={() => onRemove(index)}>
            {t("common.remove")}
          </button>
        </div>
      ))}
      <button class={cn(buttonVariants({ variant: "outline", size: "sm" }), "justify-self-start")} type="button" onClick={onAdd}>
        {t("server.addEnv")}
      </button>
    </div>
  );
}

function ServerForm({
  form,
  onSubmit,
  onClear,
  onPreset,
  onUpdate,
  onArgChange,
  onAddArg,
  onRemoveArg,
  onApplyPasteCommand,
  onHeaderChange,
  onAddHeader,
  onRemoveHeader,
  onEnvChange,
  onAddEnv,
  onRemoveEnv,
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pasteCommand, setPasteCommand] = useState("");
  const showSyntheticPresetOption = form.presetId === existingConfigPresetId || form.presetId === customStdioPresetId;
  const isHTTP = form.transport === "http";
  const showHarnessWarning = isHTTP && isHarnessHostedURL(form.url);

  function applyPasteCommand() {
    onApplyPasteCommand(pasteCommand);
    setPasteCommand("");
  }

  return (
    <form id={serverFormId} class="grid gap-6 p-6" onSubmit={onSubmit}>
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 class="text-lg font-black">{t("server.details")}</h3>
            <p class="text-sm text-muted-foreground">{t("server.detailsHelp")}</p>
          </div>
          <button class={cn(buttonVariants({ variant: "ghost" }))} type="button" onClick={onClear}>
            {t("common.clearForm")}
          </button>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <Field label={t("common.name")}>
            <Input className={cn("w-full")} required value={form.name} placeholder={t("server.placeholderName")} onInput={(event) => onUpdate("name", event.currentTarget.value)} />
          </Field>
          <Field label={t("server.preset")}>
            <NativeSelect className={cn("w-full")} value={form.presetId} onChange={(event) => onPreset(event.currentTarget.value)}>
              {showSyntheticPresetOption ? (
                <option value={form.presetId}>{presetLabelForForm(form)}</option>
              ) : null}
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {presetLabel(preset)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div class="md:col-span-2 rounded-2xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
            <div class="font-bold">{presetLabelForForm(form)}</div>
            <p class="mt-1 text-xs leading-relaxed text-blue-700 dark:text-blue-300">{presetDescriptionForForm(form)}</p>
          </div>
        </div>

        <Field label={t("server.transport")}>
          <div class="inline-flex w-full max-w-md rounded-lg border border-border bg-muted/50 p-1">
            <button
              class={cn(buttonVariants({ variant: isHTTP ? "default" : "ghost", size: "sm" }), "flex-1")}
              type="button"
              onClick={() => onUpdate("transport", "http")}
            >
              {t("server.transportRemote")}
            </button>
            <button
              class={cn(buttonVariants({ variant: !isHTTP ? "default" : "ghost", size: "sm" }), "flex-1")}
              type="button"
              onClick={() => onUpdate("transport", "stdio")}
            >
              {t("server.transportLocal")}
            </button>
          </div>
          <p class="mt-2 text-xs text-muted-foreground">{isHTTP ? t("server.transportRemoteHelp") : t("server.transportLocalHelp")}</p>
        </Field>

        {isHTTP ? (
          <div class="grid gap-4">
            <Field label={t("server.mcpServerUrl")}>
              <Input className={cn("w-full")} required value={form.url} placeholder={t("server.placeholderUrl")} onInput={(event) => onUpdate("url", event.currentTarget.value)} />
              <p class="mt-2 text-xs text-muted-foreground">{t("server.urlHelp")}</p>
            </Field>
            {showHarnessWarning ? (
              <div class="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">{t("server.harnessHostedWarning")}</div>
            ) : null}
            <AuthAndHeaders
              authType={form.authType}
              token={form.token}
              apiKeyName={form.apiKeyName}
              apiKeyValue={form.apiKeyValue}
              apiKeyIn={form.apiKeyIn}
              username={form.username}
              password={form.password}
              headers={form.headers}
              onAuthType={(value) => onUpdate("authType", value)}
              onToken={(value) => onUpdate("token", value)}
              onAPIKeyName={(value) => onUpdate("apiKeyName", value)}
              onAPIKeyValue={(value) => onUpdate("apiKeyValue", value)}
              onAPIKeyIn={(value) => onUpdate("apiKeyIn", value)}
              onUsername={(value) => onUpdate("username", value)}
              onPassword={(value) => onUpdate("password", value)}
              onHeaderChange={onHeaderChange}
              onAddHeader={onAddHeader}
              onRemoveHeader={onRemoveHeader}
            />
          </div>
        ) : (
          <div class="grid gap-4">
            <Field label={t("server.pasteCommand")}>
              <div class="flex w-full gap-2">
                <Input
                  className={cn("w-full font-mono")}
                  value={pasteCommand}
                  placeholder={t("server.placeholderPasteCommand")}
                  onInput={(event) => setPasteCommand(event.currentTarget.value)}
                />
                <button class={cn(buttonVariants({ variant: "outline" }))} type="button" onClick={applyPasteCommand} disabled={!pasteCommand.trim()}>
                  {t("common.apply")}
                </button>
              </div>
              <p class="mt-2 text-xs text-muted-foreground">{t("server.pasteCommandHelp")}</p>
            </Field>
            <Field label={t("server.command")}>
              <Input className={cn("w-full font-mono")} required value={form.command} placeholder={t("server.placeholderCommand")} onInput={(event) => onUpdate("command", event.currentTarget.value)} />
              <p class="mt-2 text-xs text-muted-foreground">{t("server.commandHelp")}</p>
            </Field>
            <Field label={t("server.args")}>
              <ArgList args={form.args} command={form.command} onChange={onArgChange} onAdd={onAddArg} onRemove={onRemoveArg} />
              <p class="mt-2 text-xs text-muted-foreground">{t("server.argsHelp")}</p>
            </Field>
            {commandPreviewText(form) ? (
              <div class="rounded-2xl border border-border bg-muted/50 p-3">
                <div class="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("server.commandPreview")}</div>
                <code class="mt-1 block break-all font-mono text-sm text-foreground">{commandPreviewText(form)}</code>
              </div>
            ) : null}
            <div class="rounded-2xl border border-border bg-card p-4">
              <div class="mb-3">
                <h3 class="font-black">{t("server.env")}</h3>
                <p class="text-sm text-muted-foreground">{t("server.envHelp")}</p>
              </div>
              <EnvList env={form.env} onChange={onEnvChange} onAdd={onAddEnv} onRemove={onRemoveEnv} />
            </div>
            <div class="rounded-2xl border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
              <span class="font-bold text-foreground">{t("auth.title")}:</span> {t("server.stdioAuthHelp")}
            </div>
            <div class="rounded-2xl border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
              <span class="font-bold text-foreground">{t("server.dockerHintTitle")}:</span> {t("server.dockerStdioHint")}
            </div>
          </div>
        )}

        <div class="border-t border-border pt-4">
          <button class={cn(buttonVariants({ variant: "ghost", size: "sm" }))} type="button" onClick={() => setAdvancedOpen((current) => !current)}>
            {advancedOpen ? t("server.hideAdvanced") : t("server.showAdvanced")}
          </button>
          {advancedOpen ? (
            <div class="mt-3 grid gap-4 md:grid-cols-2">
              <Field label={t("server.weight")}>
                <Input className={cn("w-full")} min="1" type="number" value={form.weight} onInput={(event) => onUpdate("weight", event.currentTarget.value)} />
              </Field>
            </div>
          ) : null}
        </div>
    </form>
  );
}

function ServerFormFooter({ form, saving, testing, testResult, onTest, onUpdate }) {
  return (
    <>
      {testResult ? (
        <div
          class={cn(
            "rounded-2xl border p-3 text-sm",
            testResult.status === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
          )}
        >
          {testResult.message}
        </div>
      ) : null}
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label class="flex cursor-pointer items-center gap-3">
          <Checkbox checked={form.enabled} onCheckedChange={(checked) => onUpdate("enabled", checked)} />
          <span class="font-semibold">{t("common.enabled")}</span>
        </label>
        <div class="flex flex-col gap-2 sm:flex-row">
          <Button className="min-w-40" variant="outline" type="button" disabled={testing || saving} onClick={onTest}>
            {testing ? <Spinner size="sm" /> : null}
            {testing ? t("common.testing") : t("action.testConnection")}
          </Button>
          <Button className="min-w-40" type="submit" form={serverFormId} disabled={saving || testing}>
            {saving ? <Spinner size="sm" /> : null}
            {saving ? t("common.saving") : t("action.saveServer")}
          </Button>
        </div>
      </div>
    </>
  );
}

function EndpointForm({ form, servers, saving, onSubmit, onClear, onUpdate, onToggleServer }) {
  return (
    <form class="grid gap-6 p-6" onSubmit={onSubmit}>
      <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 class="text-lg font-black">{t("endpoint.details")}</h3>
          <p class="text-sm text-muted-foreground">{t("endpoint.detailsHelp")}</p>
        </div>
        <button class={cn(buttonVariants({ variant: "ghost" }))} type="button" onClick={onClear}>
          {t("common.clearForm")}
        </button>
      </div>

      <div class="grid items-start gap-4 md:grid-cols-2">
        <Field label={t("common.name")}>
          <Input className={cn("w-full")} required value={form.name} placeholder={t("endpoint.placeholderName")} onInput={(event) => onUpdate("name", event.currentTarget.value)} />
        </Field>
        <Field label={t("endpoint.rateLimitPerMin")}>
          <Input className={cn("w-full")} min="0" type="number" value={form.rateLimitPerMinute} onInput={(event) => onUpdate("rateLimitPerMinute", event.currentTarget.value)} />
          <p class="mt-2 text-xs text-muted-foreground">{t("endpoint.rateLimitHelp")}</p>
        </Field>
        <Field label={t("common.description")}>
          <Input className={cn("w-full")} value={form.description} placeholder={t("endpoint.placeholderDescription")} onInput={(event) => onUpdate("description", event.currentTarget.value)} />
        </Field>
      </div>

      <div class="rounded-3xl border border-border bg-card p-4">
        <div class="mb-4 flex flex-col gap-1">
          <h3 class="font-black">{t("endpoint.mcpServers")}</h3>
          <p class="text-sm text-muted-foreground">{t("endpoint.mcpServersHelp")}</p>
        </div>
        {servers.length ? (
          <div class="grid gap-2 md:grid-cols-2">
            {servers.map((server) => (
              <label key={server.id} class="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-muted/50 p-3">
                <Checkbox
                  className="mt-1"
                  checked={form.serverIds.includes(server.id)}
                  onCheckedChange={(checked) => onToggleServer(server.id, checked)}
                />
                <span class="min-w-0">
                  <span class="block truncate font-bold text-foreground">{server.name}</span>
                  <span class="block truncate text-xs text-muted-foreground">{server.transport || "stdio"} - {server.enabled ? t("common.enabled") : t("common.disabled")}</span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <EmptyState message={t("empty.needServerBeforeEndpoint")} />
        )}
      </div>

      <div class="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <label class="flex cursor-pointer items-center gap-3">
          <Checkbox checked={form.enabled} onCheckedChange={(checked) => onUpdate("enabled", checked)} />
          <span class="font-semibold">{t("common.enabled")}</span>
        </label>
        <Button className="min-w-40" type="submit" disabled={saving || !servers.length}>
            {saving ? <Spinner size="sm" /> : null}
            {saving ? t("common.saving") : t("action.saveEndpoint")}
          </Button>
      </div>
    </form>
  );
}

function APIKeyForm({ form, endpoints, editing, saving, onSubmit, onClear, onUpdate, onToggleEndpoint }) {
  const showValueInput = !editing || form.rotateValue;

  return (
    <form class="grid gap-6 p-6" onSubmit={onSubmit}>
      <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 class="text-lg font-black">{t("apiKey.details")}</h3>
          <p class="text-sm text-muted-foreground">{t("apiKey.detailsHelp")}</p>
        </div>
        <button class={cn(buttonVariants({ variant: "ghost" }))} type="button" onClick={onClear}>
          {t("common.clearForm")}
        </button>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <Field label={t("common.name")}>
          <Input className={cn("w-full")} required value={form.name} placeholder={t("apiKey.placeholderName")} onInput={(event) => onUpdate("name", event.currentTarget.value)} />
        </Field>
        <Field label={showValueInput && editing ? t("apiKey.newValue") : t("apiKey.value")}>
          {showValueInput ? (
            <>
              <div class="flex w-full gap-0">
                <Input
                  className={cn("rounded-r-none w-full font-mono")}
                  type="text"
                  required={!editing || form.rotateValue}
                  value={form.value}
                  placeholder={t("apiKey.placeholderValue")}
                  onInput={(event) => onUpdate("value", event.currentTarget.value)}
                />
                <button class={cn(buttonVariants({ variant: "outline" }), "rounded-l-none")} type="button" onClick={() => onUpdate("value", generateAPIKeyValue())}>
                  {t("common.generate")}
                </button>
              </div>
              <p class="mt-2 text-xs text-muted-foreground">{editing ? t("apiKey.rotateHelp") : t("apiKey.valueHelp")}</p>
              {editing ? (
                <button
                  class={cn(buttonVariants({ variant: "ghost", size: "xs" }), "mt-2")}
                  type="button"
                  onClick={() => {
                    onUpdate("value", "");
                    onUpdate("rotateValue", false);
                  }}
                >
                  {t("action.cancelRotation")}
                </button>
              ) : null}
            </>
          ) : (
            <>
              <div class="flex items-center justify-between gap-3 rounded-2xl border border-border bg-muted/50 p-3">
                <div class="min-w-0">
                  <div class="font-semibold text-foreground">{t("apiKey.currentValue")}</div>
                  <p class="mt-1 text-xs text-muted-foreground">{t("apiKey.currentValueHelp")}</p>
                </div>
                <button
                  class={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}
                  type="button"
                  onClick={() => {
                    onUpdate("rotateValue", true);
                    onUpdate("value", generateAPIKeyValue());
                  }}
                >
                  {t("action.rotateAPIKey")}
                </button>
              </div>
            </>
          )}
        </Field>
      </div>

      <div class="rounded-3xl border border-border bg-card p-4">
        <div class="mb-4 flex flex-col gap-1">
          <h3 class="font-black">{t("apiKey.endpointResources")}</h3>
          <p class="text-sm text-muted-foreground">{t("apiKey.endpointResourcesHelp")}</p>
        </div>
        {endpoints.length ? (
          <div class="grid gap-2 md:grid-cols-2">
            {endpoints.map((endpoint) => (
              <label key={endpoint.id} class="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-muted/50 p-3">
                <Checkbox
                  className="mt-1"
                  checked={form.endpointIds.includes(endpoint.id)}
                  onCheckedChange={(checked) => onToggleEndpoint(endpoint.id, checked)}
                />
                <span class="min-w-0">
                  <span class="block truncate font-bold text-foreground">{endpoint.name}</span>
                  <span class="block truncate text-xs text-muted-foreground">/mcp/{endpoint.id} - {endpoint.enabled ? t("common.enabled") : t("common.disabled")}</span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <EmptyState message={t("empty.needEndpointBeforeAPIKey")} />
        )}
      </div>

      <div class="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <label class="flex cursor-pointer items-center gap-3">
          <Checkbox checked={form.enabled} onCheckedChange={(checked) => onUpdate("enabled", checked)} />
          <span class="font-semibold">{t("common.enabled")}</span>
        </label>
        <Button className="min-w-40" type="submit" disabled={saving || !endpoints.length}>
            {saving ? <Spinner size="sm" /> : null}
            {saving ? t("common.saving") : t("action.saveAPIKey")}
          </Button>
      </div>
    </form>
  );
}

function statusBadgeVariant(statusClass) {
  if (statusClass === "status-success") return "success";
  if (statusClass === "status-error") return "destructive";
  if (statusClass === "status-warning") return "warning";
  return "neutral";
}

const statusDotClass = {
  success: "bg-emerald-500",
  destructive: "bg-red-500",
  warning: "bg-amber-500",
  neutral: "bg-muted-foreground",
  default: "bg-primary",
  secondary: "bg-muted-foreground",
};

function StatusBadge({ variant, children, className }) {
  return (
    <Badge variant={variant} className={cn("gap-1.5", className)}>
      <span class={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass[variant] || statusDotClass.neutral)} />
      {children}
    </Badge>
  );
}

function CopyButton({ text, onCopied, size = "icon" }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(event) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await writeClipboard(text);
      setCopied(true);
      onCopied?.();
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onCopied?.(true);
    }
  }

  if (size === "icon") {
    return (
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" type="button" onClick={handleCopy} aria-label={copied ? t("action.copied") : t("action.copy")}>
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" type="button" onClick={handleCopy}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? t("action.copied") : t("action.copy")}
    </Button>
  );
}

function CopyField({ value, onCopy }) {
  return (
    <div class="copy-field">
      <code title={value}>{value}</code>
      <CopyButton text={value} onCopied={onCopy} />
    </div>
  );
}

function InfoTile({ label, value, code = false, copyable = false, onCopy }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <CardDescription className="text-xs font-medium uppercase tracking-wide">{label}</CardDescription>
        {copyable ? (
          <div class="mt-2">
            <CopyField value={value} onCopy={onCopy} />
          </div>
        ) : code ? (
          <code class="mt-2 block overflow-hidden text-ellipsis whitespace-nowrap rounded-md bg-muted px-2 py-1 font-mono text-xs">{value}</code>
        ) : (
          <p class="mt-2 truncate text-sm font-medium">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ title, value, tone = "" }) {
  return (
    <Card>
      <CardHeader className="gap-1 p-4 pb-3">
        <CardDescription className="text-xs">{title}</CardDescription>
        <CardTitle className={cn("text-2xl font-bold tabular-nums leading-none", tone)}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function OverviewCard({ label, value, detail, status = "neutral" }) {
  const dotClass = {
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    neutral: "bg-muted-foreground",
  }[status] || "bg-muted-foreground";

  return (
    <Card className="bg-muted/30">
      <CardContent className="pt-4">
        <div class="flex items-center gap-2">
          <span class={cn("inline-block h-2 w-2 shrink-0 rounded-full", dotClass)} />
          <CardDescription className="text-xs font-medium uppercase tracking-wide">{label}</CardDescription>
        </div>
        <p class="mt-2 text-2xl font-bold tabular-nums">{value}</p>
        <p class="mt-1 text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function GatewayPathsPanel({ endpointPattern, configPath, onCopy }) {
  const paths = [
    { label: t("overview.endpointPattern"), value: endpointPattern },
    { label: t("overview.sqliteDatabase"), value: configPath },
    { label: t("settings.apiBase"), value: `${location.origin}/api` },
    { label: t("settings.browserSettings"), value: preferencesStorageKey },
  ];

  return (
    <div class="workspace-panel flex h-full flex-col">
      <div class="section-title">{t("settings.gatewayPaths")}</div>
      <p class="mt-1 text-sm text-muted-foreground">{t("settings.gatewayPathsDescription")}</p>
      <div class="mt-4 grid flex-1 gap-4">
        {paths.map((path) => (
          <div key={path.label}>
            <div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{path.label}</div>
            <div class="mt-1.5">
              <CopyField value={path.value} onCopy={onCopy} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NotificationsPanel({ servers, apiKeys, endpoints, runningServers, onCreateServer, onRestart, onEditAPIKey }) {
  const items = [];

  if (!servers.length) {
    items.push({
      type: "info",
      message: t("notify.noServers"),
      action: t("action.createServer"),
      onClick: onCreateServer,
    });
  }

  servers.filter((server) => server.enabled && !server.status?.running).forEach((server) => {
    items.push({
      type: "warning",
      message: t("notify.serverStopped", { name: server.name }),
      action: t("action.restart"),
      onClick: () => onRestart(server.id),
    });
  });

  apiKeys.forEach((key) => {
    const selectedEndpoints = endpoints.filter((endpoint) => (key.endpointIds || []).includes(endpoint.id));
    const missingEndpointCount = Math.max((key.endpointIds || []).length - selectedEndpoints.length, 0);
    if (!selectedEndpoints.length || missingEndpointCount) {
      items.push({
        type: "warning",
        message: t("notify.apiKeyMissingEndpoints", { name: key.name }),
        action: t("common.edit"),
        onClick: () => onEditAPIKey(key),
      });
    }
  });

  if (runningServers > 0) {
    items.push({
      type: "success",
      message: t("overview.runningServersAvailable", {
        count: runningServers,
        unit: pluralKey(runningServers, "unit.server.one", "unit.server.other"),
      }),
    });
  }

  return (
    <div class="workspace-panel flex h-full flex-col">
      <div class="section-title">{t("overview.notifications")}</div>
      <div class="mt-4 grid flex-1 gap-2">
        {items.length ? items.map((item, index) => (
          <div key={index} class={cn("notification-item", item.type === "success" && "notification-item-success", item.type === "warning" && "notification-item-warning", item.type === "info" && "notification-item-info")}>
            <span class="text-sm leading-snug">{item.message}</span>
            {item.action ? (
              <Button variant="outline" size="sm" className="h-7 shrink-0 text-xs" type="button" onClick={item.onClick}>
                {item.action}
              </Button>
            ) : null}
          </div>
        )) : (
          <p class="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">{t("overview.notificationsEmpty")}</p>
        )}
      </div>
    </div>
  );
}

function GettingStartedFlow({ endpointPattern, hasServers, hasEndpoints, hasAPIKeys, onCreateServer, onCreateEndpoint, onCreateAPIKey, onViewTools, onCopyEndpoint }) {
  const steps = [
    {
      number: "01",
      title: t("overview.flowConnectTitle"),
      description: t("overview.flowConnectDescription"),
      action: t("action.createServer"),
      onClick: onCreateServer,
      complete: hasServers,
    },
    {
      number: "02",
      title: t("overview.flowEndpointTitle"),
      description: t("overview.flowEndpointDescription"),
      action: t("action.createEndpoint"),
      onClick: onCreateEndpoint,
      disabled: !hasServers,
      complete: hasEndpoints,
    },
    {
      number: "03",
      title: t("overview.flowKeyTitle"),
      description: t("overview.flowKeyDescription"),
      action: t("action.createAPIKey"),
      onClick: onCreateAPIKey,
      disabled: !hasEndpoints,
      complete: hasAPIKeys,
    },
    {
      number: "04",
      title: t("overview.flowUseTitle"),
      description: t("overview.flowUseDescription"),
      action: t("overview.flowUseAction"),
      onClick: onViewTools,
      code: endpointPattern,
      complete: hasAPIKeys && hasEndpoints,
    },
  ];

  return (
    <section class="workspace-panel">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div class="section-title">{t("overview.gettingStarted")}</div>
          <p class="mt-2 max-w-3xl text-sm text-muted-foreground">{t("overview.gettingStartedDescription")}</p>
        </div>
        <Badge variant="secondary">{t("overview.flowsLabel")}</Badge>
      </div>
      <div class="mt-5 grid gap-4 lg:grid-cols-4">
        {steps.map((step) => (
          <Card className={cn("flex h-full flex-col", step.complete && "border-emerald-200 dark:border-emerald-900")} key={step.number}>
            <CardContent className="flex flex-1 flex-col pt-4">
              <div class="flex items-center justify-between gap-3">
                <Badge variant={step.complete ? "success" : "outline"}>{step.complete ? t("overview.stepComplete") : step.number}</Badge>
                {step.disabled ? <span class="text-xs text-muted-foreground">{t("common.notConfigured")}</span> : null}
              </div>
              <h3 class="mt-4 text-sm font-semibold">{step.title}</h3>
              <p class="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{step.description}</p>
              {step.code ? (
                <div class="mt-4">
                  <CopyField value={step.code} onCopy={onCopyEndpoint} />
                </div>
              ) : null}
              <Button className="mt-4" variant={step.complete ? "secondary" : "outline"} size="sm" onClick={step.onClick} disabled={step.disabled}>{step.action}</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function RowActionMenu({ label, children }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={label}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Field({ label, children, wide = false }) {
  return (
    <div class={cn("grid gap-2", wide && "md:col-span-2 xl:col-span-4")}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function AuthAndHeaders({
  authType,
  token,
  apiKeyName,
  apiKeyValue,
  apiKeyIn,
  username,
  password,
  headers,
  onAuthType,
  onToken,
  onAPIKeyName,
  onAPIKeyValue,
  onAPIKeyIn,
  onUsername,
  onPassword,
  onHeaderChange,
  onAddHeader,
  onRemoveHeader,
}) {
  return (
    <div class="rounded-3xl border border-border bg-card p-4">
      <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 class="font-black">{t("auth.title")}</h3>
          <p class="text-sm text-muted-foreground">{t("auth.description")}</p>
        </div>
        <button class={cn(buttonVariants({ variant: "outline", size: "sm" }))} type="button" onClick={onAddHeader}>
          {t("action.addHeader")}
        </button>
      </div>

      <div class="grid gap-4 lg:grid-cols-3">
        <Field label={t("auth.type")}>
          <NativeSelect className={cn("w-full")} value={authType} onChange={(event) => onAuthType(event.currentTarget.value)}>
            <option value="none">{t("auth.none")}</option>
            <option value="apiKey">{t("auth.apiKey")}</option>
            <option value="bearer">{t("auth.bearer")}</option>
            <option value="jwtBearer">{t("auth.jwtBearer")}</option>
            <option value="basic">{t("auth.basic")}</option>
          </NativeSelect>
        </Field>
        {authType === "apiKey" ? (
          <>
            <Field label={t("auth.keyName")}>
              <Input
                className={cn("w-full")}
                value={apiKeyName}
                placeholder={t("auth.placeholderKeyName")}
                list="auth-key-name-options"
                onInput={(event) => onAPIKeyName(event.currentTarget.value)}
              />
              <datalist id="auth-key-name-options">
                {commonAPIKeyHeaderNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <p class="mt-2 text-xs text-muted-foreground">{t("auth.keyNameHelp")}</p>
            </Field>
            <Field label={t("auth.addTo")}>
              <NativeSelect className={cn("w-full")} value={apiKeyIn} onChange={(event) => onAPIKeyIn(event.currentTarget.value)}>
                <option value="header">{t("auth.header")}</option>
                <option value="query">{t("auth.queryParam")}</option>
              </NativeSelect>
            </Field>
            <Field label={t("auth.apiKeyValue")} wide>
              <Input className={cn("w-full font-mono")} value={apiKeyValue} placeholder={t("auth.placeholderAPIKeyValue")} onInput={(event) => onAPIKeyValue(event.currentTarget.value)} />
              <p class="mt-2 text-xs text-muted-foreground">{t("auth.apiKeyHelp")}</p>
            </Field>
          </>
        ) : null}
        {authType === "bearer" || authType === "jwtBearer" ? (
          <Field label={authType === "jwtBearer" ? t("auth.jwtTokenEnv") : t("auth.bearerTokenEnv")} wide>
            <Input className={cn("w-full font-mono")} value={token} placeholder={t("auth.placeholderBearerToken")} onInput={(event) => onToken(event.currentTarget.value)} />
            <p class="mt-2 text-xs text-muted-foreground">{t("auth.bearerHelp")}</p>
          </Field>
        ) : null}
        {authType === "basic" ? (
          <>
            <Field label={t("auth.username")}>
              <Input className={cn("w-full")} value={username} placeholder={t("auth.placeholderBasicUser")} onInput={(event) => onUsername(event.currentTarget.value)} />
            </Field>
            <Field label={t("auth.password")}>
              <Input className={cn("w-full")} type="password" value={password} placeholder={t("auth.placeholderBasicPassword")} onInput={(event) => onPassword(event.currentTarget.value)} />
            </Field>
          </>
        ) : null}
        {authType === "none" ? <div class="hidden lg:block lg:col-span-2"></div> : null}
      </div>

      <div class="my-4 border-t border-border pt-4 text-sm font-semibold text-muted-foreground">{t("auth.headers")}</div>
      <div class="hidden grid-cols-[auto_1fr_1fr_auto] gap-2 px-2 text-xs font-bold uppercase tracking-wide text-muted-foreground md:grid">
        <span>{t("common.on")}</span>
        <span>{t("common.key")}</span>
        <span>{t("common.value")}</span>
        <span></span>
      </div>
      <div class="grid gap-2">
        {headers.map((row, index) => (
          <div key={index} class="grid gap-2 rounded-2xl border border-border bg-muted/50 p-2 md:grid-cols-[auto_1fr_1fr_auto] md:items-center md:border-0 md:bg-transparent md:p-0">
            <label class="flex cursor-pointer items-center gap-2 md:justify-center">
              <Checkbox checked={row.enabled} onCheckedChange={(checked) => onHeaderChange(index, "enabled", checked)} />
              <span class="md:hidden">{t("common.enabled")}</span>
            </label>
            <Input className={cn("h-8 w-full text-xs")} value={row.key} placeholder={t("auth.placeholderHeaderName")} onInput={(event) => onHeaderChange(index, "key", event.currentTarget.value)} />
            <Input className={cn("h-8 w-full font-mono text-xs")} value={row.value} placeholder={t("auth.placeholderHeaderValue")} onInput={(event) => onHeaderChange(index, "value", event.currentTarget.value)} />
            <button class={cn(buttonVariants({ variant: "ghost", size: "sm" }))} type="button" onClick={() => onRemoveHeader(index)}>
              {t("common.remove")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ListPanel({
  subtitle,
  searchValue,
  onSearch,
  pageSize,
  onPageSize,
  pageSizes,
  page,
  pages,
  prev,
  next,
  showAdvancedControls = true,
  tableId,
  visibleColumns = [],
  sortActive = false,
  onToggleSort,
  onToggleColumn,
  filters = [],
  filterContext = {},
  onAddFilter,
  onUpdateFilter,
  onRemoveFilter,
  onClearFilters,
  children,
}) {
  const columns = tableColumns[tableId] || [];
  const addableFilters = availableFilterFields(tableId, filters);
  return (
    <div class="workspace-panel">
      <div class="grid gap-3">
        {subtitle ? <p class="text-sm text-muted-foreground">{subtitle}</p> : null}
        <div class="table-toolbar">
          <div class="toolbar-left">
            <label class="search-control">
              <Search className="h-4 w-4 shrink-0 opacity-60" />
              <input placeholder={t("common.search")} value={searchValue} onInput={(event) => onSearch(event.currentTarget.value)} />
            </label>
            {showAdvancedControls ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button class="filter-button" type="button" disabled={!addableFilters.length}>
                    <Plus className="h-4 w-4" />
                    {t("action.addFilter")}
                  </button>
                </DropdownMenuTrigger>
                {addableFilters.length ? (
                  <DropdownMenuContent align="end" className="w-56">
                    <div class="mb-2 px-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("action.filtersTitle")}</div>
                    {addableFilters.map((field) => (
                      <DropdownMenuItem key={field.id} onClick={() => onAddFilter?.(field.id)}>
                        {t(field.labelKey)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                ) : null}
              </DropdownMenu>
            ) : null}
          </div>
          {showAdvancedControls ? (
            <div class="toolbar-right">
              <button class={`control-button ${sortActive ? "control-button-active" : ""}`} type="button" onClick={onToggleSort}>
                <ArrowUpDown className="h-3.5 w-3.5" />
                {t("action.lastExecuted")}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button class="control-button" type="button">
                    {t("action.columns", { shown: visibleColumns.length, total: columns.length })}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 p-3">
                  <div class="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("action.columnsTitle")}</div>
                  <div class="grid gap-2">
                    {columns.map((column) => (
                      <label key={column.id} class="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                        <Checkbox checked={columnVisible(visibleColumns, column.id)} disabled={visibleColumns.length === 1 && columnVisible(visibleColumns, column.id)} onCheckedChange={() => onToggleColumn?.(column.id)} />
                        <span>{t(column.labelKey)}</span>
                      </label>
                    ))}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
        {filters.length ? (
          <div class="filter-bar">
            {filters.map((filter) => {
              const field = filterField(tableId, filter.field);
              const options = filterOptions(tableId, filter.field, filterContext);
              return (
                <div key={filter.id} class="filter-chip">
                  <span class="filter-chip-label">{t(field?.labelKey || filter.field)}</span>
                  <select
                    class="filter-chip-select"
                    value={filter.value}
                    onChange={(event) => onUpdateFilter?.(filter.id, event.currentTarget.value)}
                  >
                    {options.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <button class="filter-chip-remove" type="button" aria-label={t("action.removeFilter")} onClick={() => onRemoveFilter?.(filter.id)}>
                    ×
                  </button>
                </div>
              );
            })}
            <button class="filter-clear" type="button" onClick={() => onClearFilters?.()}>
              {t("action.clearFilters")}
            </button>
          </div>
        ) : null}
        <div class="min-h-80 overflow-x-auto rounded-lg border border-border">{children}</div>
        <div class="pagination-bar">
          <div class="pagination-size">
            <select value={pageSize} onChange={(event) => onPageSize(event.currentTarget.value)}>
              {pageSizes.map((size) => (
                <option value={size}>{size}</option>
              ))}
            </select>
            <span>{t("list.itemsPerPage")}</span>
          </div>
          <span class="pagination-page">{t("list.pageOf", { page, pages })}</span>
          <div class="pagination-actions">
            <button type="button" onClick={prev} disabled={page <= 1} aria-label={t("action.previousPage")}><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={next} disabled={page >= pages} aria-label={t("action.nextPage")}><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TableHeader({ tableId, visibleColumns }) {
  return (
    <>
      {(tableColumns[tableId] || [])
        .filter((column) => columnVisible(visibleColumns, column.id))
        .map((column) => <span key={column.id}>{t(column.labelKey)}</span>)}
    </>
  );
}

function ResourceNotFound({ message, onBack }) {
  return (
    <section class="workspace-panel">
      <p class="text-sm text-muted-foreground">{message}</p>
      <button class={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4")} type="button" onClick={onBack}>
        {t("common.back")}
      </button>
    </section>
  );
}

function ServerDetailPage({ server, testing, onEdit, onRestart, onTest, onToggleEnabled, onDelete }) {
  const disabled = !server.enabled;
  const running = !disabled && server.status?.running;
  const statusLabel = disabled ? t("common.disabled") : running ? t("common.running") : t("common.stopped");
  const statusClass = disabled ? "status-neutral" : running ? "status-success" : "status-error";
  const usage = server.usage || {};

  return (
    <section class="workspace-panel workspace-stack">
      <div class="flex flex-wrap items-center gap-3">
        <Badge variant={statusBadgeVariant(statusClass)}>{statusLabel}</Badge>
        <span class="text-sm text-muted-foreground">{server.id}</span>
      </div>
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <InfoTile label={t("common.name")} value={server.name} />
        <InfoTile label={t("common.status")} value={statusLabel} />
        <InfoTile label={t("table.target")} value={`${server.transport || "stdio"} - ${targetFor(server)}`} code />
        <InfoTile
          label={t("common.usage")}
          value={`${usage.totalCalls || 0} ${pluralKey(usage.totalCalls || 0, "unit.call.one", "unit.call.other")}`}
        />
        <InfoTile label={t("table.createdAt")} value={formatTimestamp(server.createdAt)} />
        <InfoTile label={t("table.updatedAt")} value={formatTimestamp(server.updatedAt)} />
      </div>
      {server.status?.error ? <div class="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{server.status.error}</div> : null}
      <div class="flex flex-wrap gap-2">
        <button class={cn(buttonVariants({ variant: "outline", size: "sm" }))} type="button" onClick={() => onEdit(server)}>
          {t("common.edit")}
        </button>
        <button class={cn(buttonVariants({ variant: "outline", size: "sm" }))} type="button" onClick={() => onTest(server.id)} disabled={testing}>
          {testing ? t("common.testing") : t("common.test")}
        </button>
        <button class={cn(buttonVariants({ variant: "outline", size: "sm" }))} type="button" onClick={() => onRestart(server.id)} disabled={disabled}>
          {t("action.restart")}
        </button>
        <button class={cn(buttonVariants({ variant: "outline", size: "sm" }))} type="button" onClick={() => onToggleEnabled(server)}>
          {disabled ? t("common.enable") : t("common.disable")}
        </button>
        <button class={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-destructive")} type="button" onClick={() => onDelete(server.id)}>
          {t("common.delete")}
        </button>
      </div>
    </section>
  );
}

function EndpointDetailPage({ endpoint, servers, onEdit, onCopyCurl, onToggleEnabled, onDelete }) {
  const disabled = !endpoint.enabled;
  const usage = endpoint.usage || {};
  const limit = usage.limitPerMinute || endpoint.rateLimit?.requestsPerMinute || 0;
  const limitLabel = limit ? t("endpoint.limitLeft", { remaining: usage.remainingThisMinute ?? limit, limit }) : t("common.unlimited");
  const selectedServers = servers.filter((server) => (endpoint.serverIds || []).includes(server.id));

  return (
    <section class="workspace-panel workspace-stack">
      <div class="flex flex-wrap items-center gap-3">
        <Badge variant={disabled ? "neutral" : "success"}>{disabled ? t("common.disabled") : t("common.enabled")}</Badge>
        <span class="text-sm text-muted-foreground">{endpoint.id}</span>
      </div>
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <InfoTile label={t("common.name")} value={endpoint.name} />
        <InfoTile label={t("table.mcpUrl")} value={endpointUrl(endpoint)} code />
        <InfoTile label={t("common.description")} value={endpoint.description || t("common.notSet")} />
        <InfoTile label={t("table.rateLimit")} value={limitLabel} />
        <InfoTile
          label={t("common.usage")}
          value={`${usage.totalCalls || 0} ${pluralKey(usage.totalCalls || 0, "unit.call.one", "unit.call.other")}`}
        />
        <InfoTile label={t("table.createdAt")} value={formatTimestamp(endpoint.createdAt)} />
        <InfoTile label={t("table.updatedAt")} value={formatTimestamp(endpoint.updatedAt)} />
      </div>
      <div>
        <div class="section-title">{t("endpoint.mcpServers")}</div>
        <div class="mt-3 flex flex-wrap gap-2">
          {selectedServers.length ? (
            selectedServers.map((server) => (
              <a key={server.id} class={cn(buttonVariants({ variant: "outline", size: "sm" }))} href={pathForRoute("servers", server.id)}>
                {server.name}
              </a>
            ))
          ) : (
            <p class="text-sm text-muted-foreground">{t("card.noActiveServerRecords")}</p>
          )}
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class={cn(buttonVariants({ variant: "outline", size: "sm" }))} type="button" onClick={() => onEdit(endpoint)}>
          {t("common.edit")}
        </button>
        <button class={cn(buttonVariants({ variant: "outline", size: "sm" }))} type="button" onClick={() => onCopyCurl(endpoint)}>
          {t("action.copyCurl")}
        </button>
        <button class={cn(buttonVariants({ variant: "outline", size: "sm" }))} type="button" onClick={() => onToggleEnabled(endpoint)}>
          {disabled ? t("common.enable") : t("common.disable")}
        </button>
        <button class={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-destructive")} type="button" onClick={() => onDelete(endpoint.id)}>
          {t("common.delete")}
        </button>
      </div>
    </section>
  );
}

function ServerCard({ server, testing, onOpen, onEdit, onRestart, onTest, onToggleEnabled, onDelete, visibleColumns }) {
  const disabled = !server.enabled;
  const running = !disabled && server.status?.running;
  const statusLabel = disabled ? t("common.disabled") : running ? t("common.running") : t("common.stopped");
  const statusClass = disabled ? "status-neutral" : running ? "status-success" : "status-error";
  const usage = server.usage || {};
  const usageLabel = `${usage.totalCalls || 0} ${pluralKey(usage.totalCalls || 0, "unit.call.one", "unit.call.other")}`;

  return (
    <div class="data-row data-row-interactive" style={{ gridTemplateColumns: tableGridTemplate("servers", visibleColumns, true) }}>
      {columnVisible(visibleColumns, "name") ? (
        <div class="min-w-0">
          <a class="truncate font-semibold text-foreground hover:text-foreground" href={pathForRoute("servers", server.id)} onClick={(event) => { event.preventDefault(); onOpen(server); }}>
            {server.name}
          </a>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "target") ? <div class="truncate text-sm text-muted-foreground">{server.transport || "stdio"} - {targetFor(server)}</div> : null}
      {columnVisible(visibleColumns, "status") ? (
        <div>
          <StatusBadge variant={statusBadgeVariant(statusClass)}>{statusLabel}</StatusBadge>
          {server.status?.error ? <div class="mt-1 truncate text-xs text-destructive">{server.status.error}</div> : null}
        </div>
      ) : null}
      {columnVisible(visibleColumns, "usage") ? (
        <div class="text-sm text-muted-foreground">
          <div class="font-semibold text-foreground">{usageLabel}</div>
          <div class="mt-1 text-xs">{usage.successfulCalls || 0} {t("common.ok")} / {usage.failedCalls || 0} {t("common.failed")}</div>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "createdAt") ? <TimestampCell value={server.createdAt} /> : null}
      {columnVisible(visibleColumns, "updatedAt") ? <TimestampCell value={server.updatedAt} /> : null}
      <div class="flex justify-end">
        <RowActionMenu label={t("card.openActions", { name: server.name })}>
        <DropdownMenuItem onClick={() => onEdit(server)}>{t("common.edit")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onTest(server.id)} disabled={testing}>{testing ? t("common.testing") : t("common.test")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onRestart(server.id)} disabled={disabled}>{t("action.restart")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onToggleEnabled(server)}>{disabled ? t("common.enable") : t("common.disable")}</DropdownMenuItem>
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(server.id)}>{t("common.delete")}</DropdownMenuItem>
      </RowActionMenu>
      </div>
    </div>
  );
}

function EndpointCard({ endpoint, servers, onOpen, onEdit, onCopyCurl, onToggleEnabled, onDelete, visibleColumns, onCopyUrl }) {
  const disabled = !endpoint.enabled;
  const usage = endpoint.usage || {};
  const limit = usage.limitPerMinute || endpoint.rateLimit?.requestsPerMinute || 0;
  const usageLabel = `${usage.totalCalls || 0} ${pluralKey(usage.totalCalls || 0, "unit.call.one", "unit.call.other")}`;
  const limitLabel = limit ? t("endpoint.limitLeft", { remaining: usage.remainingThisMinute ?? limit, limit }) : t("common.unlimited");
  const selectedServers = servers.filter((server) => (endpoint.serverIds || []).includes(server.id));
  const missingServerCount = Math.max((endpoint.serverIds || []).length - selectedServers.length, 0);
  const url = endpointUrl(endpoint);

  return (
    <div class="data-row data-row-interactive" style={{ gridTemplateColumns: tableGridTemplate("endpoints", visibleColumns, true) }}>
      {columnVisible(visibleColumns, "name") ? (
        <div class="min-w-0">
          <a class="truncate font-semibold text-foreground hover:text-foreground" href={pathForRoute("endpoints", endpoint.id)} onClick={(event) => { event.preventDefault(); onOpen(endpoint); }}>
            {endpoint.name}
          </a>
          <div class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge variant={disabled ? "neutral" : "success"}>{disabled ? t("common.disabled") : t("common.enabled")}</StatusBadge>
          </div>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "url") ? <CopyField value={url} onCopy={onCopyUrl} /> : null}
      {columnVisible(visibleColumns, "servers") ? (
        <div class="text-sm text-muted-foreground">
          <div class="font-semibold text-foreground">{selectedServers.length} {pluralKey(selectedServers.length, "unit.server.one", "unit.server.other")}</div>
          <div class="mt-1 line-clamp-2 text-xs">
            {selectedServers.map((server) => server.name).join(", ") || t("card.noActiveServerRecords")}
            {missingServerCount ? `, ${missingServerCount} ${t("common.missing")}` : ""}
          </div>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "usage") ? (
        <div class="text-sm text-muted-foreground">
          <div class="font-semibold text-foreground">{usageLabel}</div>
          <div class="mt-1 text-xs">{usage.successfulCalls || 0} {t("common.ok")} / {usage.failedCalls || 0} {t("common.failed")} / {usage.rateLimitedCalls || 0} {t("common.limited")}</div>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "rateLimit") ? (
        <div class="text-sm text-muted-foreground">
          <div class="font-semibold text-foreground">{limitLabel}</div>
          <div class="mt-1 text-xs">{t("endpoint.quota")}</div>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "createdAt") ? <TimestampCell value={endpoint.createdAt} /> : null}
      {columnVisible(visibleColumns, "updatedAt") ? <TimestampCell value={endpoint.updatedAt} /> : null}
      <div class="flex justify-end">
        <RowActionMenu label={t("card.openActions", { name: endpoint.name })}>
        <DropdownMenuItem onClick={() => onEdit(endpoint)}>{t("common.edit")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onCopyCurl(endpoint)}>{t("action.copyCurl")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onToggleEnabled(endpoint)}>{disabled ? t("common.enable") : t("common.disable")}</DropdownMenuItem>
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(endpoint.id)}>{t("common.delete")}</DropdownMenuItem>
      </RowActionMenu>
      </div>
    </div>
  );
}

function APIKeyCard({ apiKey, endpoints, onEdit, onDelete, visibleColumns }) {
  const disabled = !apiKey.enabled;
  const selectedEndpoints = endpoints.filter((endpoint) => (apiKey.endpointIds || []).includes(endpoint.id));
  const missingEndpointCount = Math.max((apiKey.endpointIds || []).length - selectedEndpoints.length, 0);

  return (
    <div class="data-row data-row-interactive" style={{ gridTemplateColumns: tableGridTemplate("apiKeys", visibleColumns, true) }}>
      {columnVisible(visibleColumns, "name") ? (
        <div class="min-w-0">
          <div class="truncate font-semibold text-foreground">{apiKey.name}</div>
          <div class="mt-1 truncate font-mono text-xs text-muted-foreground">{apiKey.id}</div>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "resources") ? (
        <div class="text-sm text-muted-foreground">
          <div class="font-semibold text-foreground">{selectedEndpoints.length} {pluralKey(selectedEndpoints.length, "unit.endpoint.one", "unit.endpoint.other")}</div>
          <div class="mt-1 line-clamp-2 text-xs">
            {selectedEndpoints.map((endpoint) => endpoint.name).join(", ") || t("card.noActiveEndpointRecords")}
            {missingEndpointCount ? `, ${missingEndpointCount} ${t("common.missing")}` : ""}
          </div>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "status") ? (
        <div>
          <StatusBadge variant={disabled ? "neutral" : "success"}>{disabled ? t("common.disabled") : t("common.enabled")}</StatusBadge>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "createdAt") ? <TimestampCell value={apiKey.createdAt} /> : null}
      {columnVisible(visibleColumns, "updatedAt") ? <TimestampCell value={apiKey.updatedAt} /> : null}
      <div class="flex justify-end">
        <RowActionMenu label={t("card.openActions", { name: apiKey.name })}>
        <DropdownMenuItem onClick={() => onEdit(apiKey)}>{t("common.edit")}</DropdownMenuItem>
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(apiKey.id)}>{t("common.delete")}</DropdownMenuItem>
      </RowActionMenu>
      </div>
    </div>
  );
}

function ToolCard({ tool, visibleColumns }) {
  const description = tool.description || t("card.noDescription");
  return (
    <div class="data-row data-row-interactive" style={{ gridTemplateColumns: tableGridTemplate("tools", visibleColumns) }}>
      {columnVisible(visibleColumns, "name") ? (
        <div title={tool.name}>
          <div class="truncate font-mono text-sm font-semibold text-primary">{tool.name}</div>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "server") ? <div class="truncate text-sm text-muted-foreground">{tool.serverName}</div> : null}
      {columnVisible(visibleColumns, "nativeName") ? (
        <div title={tool.nativeName}>
          <div class="truncate font-mono text-xs text-muted-foreground">{tool.nativeName}</div>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "description") ? (
        description.length > 120 ? (
          <details class="text-sm text-muted-foreground">
            <summary class="cursor-pointer line-clamp-2 hover:text-foreground">{description}</summary>
            <p class="mt-2 leading-relaxed">{description}</p>
          </details>
        ) : (
          <div class="text-sm text-muted-foreground" title={description}>{description}</div>
        )
      ) : null}
      {columnVisible(visibleColumns, "createdAt") ? <TimestampCell value={tool.createdAt} /> : null}
      {columnVisible(visibleColumns, "updatedAt") ? <TimestampCell value={tool.updatedAt} /> : null}
    </div>
  );
}

function AuditLogCard({ entry, visibleColumns }) {
  const statusClass = entry.status === 429 ? "status-warning" : entry.status >= 400 ? "status-error" : "status-success";
  const error = entry.error || t("common.ok");
  const rawCall = entry.rawCall || "";
  const transportVariant = entry.transport === "mcp" ? "default" : "secondary";
  return (
    <div class="data-row data-row-interactive" style={{ gridTemplateColumns: tableGridTemplate("auditLogs", visibleColumns) }}>
      {columnVisible(visibleColumns, "timestamp") ? <TimestampCell value={entry.timestamp} /> : null}
      {columnVisible(visibleColumns, "transport") ? (
        <StatusBadge variant={transportVariant} className="w-fit uppercase">{entry.transport || t("common.notSet")}</StatusBadge>
      ) : null}
      {columnVisible(visibleColumns, "endpoint") ? <div class="truncate font-mono text-xs text-muted-foreground">{entry.endpointId || t("common.notSet")}</div> : null}
      {columnVisible(visibleColumns, "tool") ? <div class="truncate font-mono text-xs text-primary" title={entry.toolName}>{entry.toolName || t("common.notSet")}</div> : null}
      {columnVisible(visibleColumns, "status") ? <StatusBadge variant={statusBadgeVariant(statusClass)}>{entry.status}</StatusBadge> : null}
      {columnVisible(visibleColumns, "duration") ? <span class="text-sm text-muted-foreground">{formatDuration(entry.durationMs)}</span> : null}
      {columnVisible(visibleColumns, "caller") ? <div class="truncate text-sm text-muted-foreground" title={entry.caller}>{entry.caller || t("common.notSet")}</div> : null}
      {columnVisible(visibleColumns, "error") ? (
        <div class={`line-clamp-2 text-sm ${entry.error ? "text-destructive" : "text-muted-foreground"}`} title={error}>{error}</div>
      ) : null}
      {columnVisible(visibleColumns, "rawCall") ? (
        rawCall ? (
          <details class="group text-xs text-muted-foreground">
            <summary class="cursor-pointer font-semibold text-primary">{t("audit.showRawCall")}</summary>
            <pre class="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-3 font-mono text-[0.7rem] leading-relaxed text-foreground">{rawCall}</pre>
          </details>
        ) : (
          <span class="text-sm text-muted-foreground">{t("common.notSet")}</span>
        )
      ) : null}
    </div>
  );
}

function TimestampCell({ value }) {
  return (
    <div class="text-xs text-muted-foreground" title={value || t("common.notSet")}>
      {formatTimestamp(value)}
    </div>
  );
}

function EmptyState({ message, actionLabel, onAction }) {
  return (
    <div class="grid min-h-48 place-items-center gap-4 bg-muted/40 p-8 text-center">
      <p class="max-w-md text-sm text-muted-foreground">{message}</p>
      {actionLabel && onAction ? (
        <Button variant="default" size="sm" type="button" onClick={onAction}>{actionLabel}</Button>
      ) : null}
    </div>
  );
}

function SkeletonList() {
  return (
    <>
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </>
  );
}

function ToastStack({ toasts, onDismiss }) {
  return (
    <div class="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((item) => (
        <div
          key={item.id}
          class={cn(
            "flex max-w-sm items-start gap-3 rounded-lg border bg-card p-4 shadow-lg",
            item.type === "error" && "border-destructive/30 bg-destructive/10 text-destructive",
            item.type === "warning" && "border-amber-300 bg-amber-50 text-amber-900",
            item.type === "success" && "border-emerald-300 bg-emerald-50 text-emerald-900",
          )}
        >
          <div class="min-w-0">
            <h3 class="font-bold">{item.title}</h3>
            {item.message ? <div class="text-sm">{item.message}</div> : null}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" type="button" onClick={() => onDismiss(item.id)} aria-label={t("aria.dismissNotification")}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

render(<App />, document.getElementById("app"));
