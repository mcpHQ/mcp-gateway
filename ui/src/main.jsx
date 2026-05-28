import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import presets from "./mcp-presets.json";
import stringsYaml from "./strings.en.yaml?raw";
import "./style.css";

const gatewayToolsCount = 5;
const preferencesStorageKey = "mcp-gateway-preferences";
const views = ["overview", "servers", "endpoints", "api-keys", "tools", "settings"];

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
  args: "",
  weight: 1,
  enabled: true,
};

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
  denseTables: false,
  showAdvancedControls: true,
  sortByRecent: {},
  tableColumns: {},
};

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
};

const emptyTableFilters = {
  servers: [],
  endpoints: [],
  apiKeys: [],
  tools: [],
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
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || t("error.requestFailed", { status: response.status }));
  }
  return payload;
}

function splitArgs(value) {
  return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) || [];
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
  return {
    id: form.id.trim() || slugFromName(form.name),
    name: form.name.trim(),
    transport: form.transport,
    url: form.url.trim(),
    auth: buildAuth(form),
    headers: buildHeaders(form),
    command: form.command.trim(),
    args: splitArgs(form.args.trim()),
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

function viewFromHash() {
  const value = window.location.hash.replace(/^#/, "");
  return views.includes(value) ? value : "overview";
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
    args: (server.args || []).join(" "),
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

function App() {
  const [configPath, setConfigPath] = useState(t("common.loadingInitial"));
  const [servers, setServers] = useState([]);
  const [endpoints, setEndpoints] = useState([]);
  const [apiKeys, setAPIKeys] = useState([]);
  const [tools, setTools] = useState([]);
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
  const [serverPage, setServerPage] = useState(1);
  const [endpointPage, setEndpointPage] = useState(1);
  const [apiKeyPage, setAPIKeyPage] = useState(1);
  const [toolPage, setToolPage] = useState(1);
  const [serverPageSize, setServerPageSize] = useState(5);
  const [endpointPageSize, setEndpointPageSize] = useState(5);
  const [apiKeyPageSize, setAPIKeyPageSize] = useState(5);
  const [toolPageSize, setToolPageSize] = useState(5);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [loadingAPIKeys, setLoadingAPIKeys] = useState(false);
  const [loadingTools, setLoadingTools] = useState(false);
  const [toolsLoaded, setToolsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingEndpoint, setSavingEndpoint] = useState(false);
  const [savingAPIKey, setSavingAPIKey] = useState(false);
  const [testingServer, setTestingServer] = useState(false);
  const [testingServerId, setTestingServerId] = useState("");
  const [pendingApiRequests, setPendingApiRequests] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [endpointModalOpen, setEndpointModalOpen] = useState(false);
  const [apiKeyModalOpen, setAPIKeyModalOpen] = useState(false);
  const [activeView, setActiveView] = useState(viewFromHash);
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

  async function request(path, options = {}) {
    setPendingApiRequests((count) => count + 1);
    try {
      return await api(path, options);
    } finally {
      setPendingApiRequests((count) => Math.max(0, count - 1));
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

  useEffect(() => {
    loadConfig().catch((error) => notify(t("toast.configLoadFailed"), error.message, "error"));
    loadServers();
    loadEndpoints();
    loadAPIKeys();
  }, []);

  useEffect(() => {
    if (activeView === "tools" && !toolsLoaded && !loadingTools) {
      loadTools(false, false);
    }
  }, [activeView, toolsLoaded, loadingTools]);

  useEffect(() => {
    function syncViewFromHash() {
      setActiveView(viewFromHash());
    }

    window.addEventListener("hashchange", syncViewFromHash);
    return () => window.removeEventListener("hashchange", syncViewFromHash);
  }, []);

  useEffect(() => {
    const nextHash = `#${activeView}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
  }, [activeView]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("mcp-gateway-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(preferencesStorageKey, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    if (!preferences.refreshInterval) return undefined;

    const interval = window.setInterval(() => {
      loadServers();
      loadEndpoints();
      loadAPIKeys();
      if (toolsLoaded) loadTools(false, false);
    }, preferences.refreshInterval * 1000);

    return () => window.clearInterval(interval);
  }, [preferences.refreshInterval, toolsLoaded]);

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

  const sortedServers = useMemo(() => sortByUpdatedAt(filteredServers, preferences.sortByRecent.servers), [filteredServers, preferences.sortByRecent.servers]);
  const sortedEndpoints = useMemo(() => sortByUpdatedAt(filteredEndpoints, preferences.sortByRecent.endpoints), [filteredEndpoints, preferences.sortByRecent.endpoints]);
  const sortedAPIKeys = useMemo(() => sortByUpdatedAt(filteredAPIKeys, preferences.sortByRecent.apiKeys), [filteredAPIKeys, preferences.sortByRecent.apiKeys]);
  const sortedTools = useMemo(() => sortByUpdatedAt(filteredTools, preferences.sortByRecent.tools), [filteredTools, preferences.sortByRecent.tools]);
  const serverColumns = visibleColumnIds(preferences, "servers");
  const endpointColumns = visibleColumnIds(preferences, "endpoints");
  const apiKeyColumns = visibleColumnIds(preferences, "apiKeys");
  const toolColumns = visibleColumnIds(preferences, "tools");
  const serverPages = pageCount(filteredServers.length, serverPageSize);
  const endpointPages = pageCount(filteredEndpoints.length, endpointPageSize);
  const apiKeyPages = pageCount(filteredAPIKeys.length, apiKeyPageSize);
  const toolPages = pageCount(filteredTools.length, toolPageSize);
  const visibleServers = sortedServers.slice((clampPage(serverPage, sortedServers.length, serverPageSize) - 1) * serverPageSize, clampPage(serverPage, sortedServers.length, serverPageSize) * serverPageSize);
  const visibleEndpoints = sortedEndpoints.slice((clampPage(endpointPage, sortedEndpoints.length, endpointPageSize) - 1) * endpointPageSize, clampPage(endpointPage, sortedEndpoints.length, endpointPageSize) * endpointPageSize);
  const visibleAPIKeys = sortedAPIKeys.slice((clampPage(apiKeyPage, sortedAPIKeys.length, apiKeyPageSize) - 1) * apiKeyPageSize, clampPage(apiKeyPage, sortedAPIKeys.length, apiKeyPageSize) * apiKeyPageSize);
  const visibleTools = sortedTools.slice((clampPage(toolPage, sortedTools.length, toolPageSize) - 1) * toolPageSize, clampPage(toolPage, sortedTools.length, toolPageSize) * toolPageSize);

  function updateForm(name, value) {
    setForm((current) => {
      if (name === "name" && !serverIdTouched && shouldAutofillID(current.id, current.name)) {
        return { ...current, name: value, id: slugFromName(value) };
      }
      return { ...current, [name]: value };
    });
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

  function selectPreset(presetId) {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) return;
    setServerIdTouched(true);
    setForm(formFromPreset(preset));
    notify(t("toast.presetLoaded"), presetDescription(preset), "warning");
  }

  function openCreateServer() {
    setServerIdTouched(false);
    setEditingServer(false);
    setForm({ ...initialForm, transport: preferences.defaultTransport });
    setActiveView("servers");
    setServerModalOpen(true);
  }

  function openCreateEndpoint() {
    setEndpointIdTouched(false);
    setEditingEndpoint(false);
    setEndpointForm(initialEndpointForm);
    setActiveView("endpoints");
    setEndpointModalOpen(true);
  }

  function openCreateAPIKey() {
    setAPIKeyIdTouched(false);
    setEditingAPIKey(false);
    setAPIKeyForm(initialAPIKeyForm);
    setActiveView("api-keys");
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
    setForm({
      presetId: "custom-http",
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
      args: (server.args || []).join(" "),
      weight: server.weight || 1,
      enabled: Boolean(server.enabled),
    });
    setActiveView("servers");
    setServerModalOpen(true);
    notify(t("toast.editingServer"), t("toast.editingLoaded", { name: server.name }), "warning");
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
    setActiveView("endpoints");
    setEndpointModalOpen(true);
    notify(t("toast.editingEndpoint"), t("toast.editingLoaded", { name: endpoint.name }), "warning");
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
    setActiveView("api-keys");
    setAPIKeyModalOpen(true);
    notify(t("toast.editingAPIKey"), t("toast.editingLoaded", { name: key.name }), "warning");
  }

  function testSuccessMessage(result) {
    const toolCount = result?.toolCount || 0;
    return t("toast.toolsDiscovered", { count: toolCount, unit: pluralKey(toolCount, "unit.tool.one", "unit.tool.other") });
  }

  async function testServerForm() {
    setTestingServer(true);
    try {
      const payload = serverPayloadFromForm(form);
      const response = await request("/api/servers/test", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      notify(t("toast.serverTestPassed"), testSuccessMessage(response.result));
    } catch (error) {
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
      notify(t("toast.endpointSaved"), t("toast.savedMessage", { name: payload.name }));
      setEndpointModalOpen(false);
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

  const runningServers = servers.filter((server) => server.status?.running).length;
  const enabledEndpoints = endpoints.filter((endpoint) => endpoint.enabled).length;
  const enabledAPIKeys = apiKeys.filter((key) => key.enabled).length;
  const viewTitle =
    activeView === "servers"
      ? t("view.servers.title")
      : activeView === "endpoints"
        ? t("view.endpoints.title")
        : activeView === "api-keys"
          ? t("view.apiKeys.title")
          : activeView === "tools"
            ? t("view.tools.title")
            : activeView === "settings"
              ? t("view.settings.title")
              : t("view.home.title");
  const viewDescription =
    activeView === "servers"
      ? t("view.servers.description")
      : activeView === "endpoints"
        ? t("view.endpoints.description")
        : activeView === "api-keys"
          ? t("view.apiKeys.description")
          : activeView === "tools"
            ? t("view.tools.description")
            : activeView === "settings"
              ? t("view.settings.description")
              : t("view.home.description");

  return (
    <>
      <ApiLoadingBar active={apiLoading} />
      <ToastStack toasts={toasts} />
      <div class={`app-shell ${preferences.denseTables ? "density-compact" : ""}`}>
        <Sidebar activeView={activeView} onNavigate={setActiveView} />
        <main class="workspace-main">
          <TopBar title={viewTitle} description={viewDescription} darkMode={darkMode} onToggleTheme={() => setTheme(darkMode ? "mcp" : "dark")}>
            {activeView === "servers" ? (
              <button class="btn btn-primary btn-sm" onClick={openCreateServer}>{t("action.createServer")}</button>
            ) : activeView === "endpoints" ? (
              <button class="btn btn-primary btn-sm" onClick={openCreateEndpoint} disabled={!servers.length}>{t("action.createEndpoint")}</button>
            ) : activeView === "api-keys" ? (
              <button class="btn btn-primary btn-sm" onClick={openCreateAPIKey} disabled={!endpoints.length}>{t("action.createAPIKey")}</button>
            ) : activeView === "tools" ? (
              <LoadingButton className="btn btn-primary btn-sm" loading={loadingTools} onClick={() => loadTools(true)}>
                {t("action.refreshTools")}
              </LoadingButton>
            ) : activeView === "settings" ? (
              <button class="btn btn-outline btn-sm" onClick={resetPreferences}>{t("action.resetPreferences")}</button>
            ) : (
              <button class="btn btn-outline btn-sm" onClick={() => { loadServers(true); loadEndpoints(true); loadAPIKeys(true); }} disabled={loadingServers || loadingEndpoints || loadingAPIKeys}>{loadingServers || loadingEndpoints || loadingAPIKeys ? t("common.refreshing") : t("common.refresh")}</button>
            )}
          </TopBar>
          {activeView === "overview" ? (
            <div class="workspace-stack">
              <section class="hero-grid workspace-panel overflow-hidden">
                <div class="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-center">
                  <div>
                    <h1 class="text-4xl font-black tracking-tight text-slate-950 md:text-6xl">{t("brand.name")}</h1>
                    <p class="mt-4 max-w-2xl text-base text-slate-600">
                      {t("overview.hero")}
                    </p>
                  </div>
                  <div class="grid gap-3">
                    <InfoTile label={t("overview.endpointPattern")} value={endpointPattern} code />
                    <InfoTile label={t("overview.sqliteDatabase")} value={configPath} />
                  </div>
                </div>
              </section>

              <section class="metric-grid">
                <Stat title={t("overview.totalServers")} value={servers.length} />
                <Stat title={t("common.endpoints")} value={endpoints.length} tone="text-secondary" />
                <Stat title={t("common.apiKeys")} value={apiKeys.length} tone="text-primary" />
                <Stat title={t("overview.loadedTools")} value={tools.length} tone="text-primary" />
              </section>

              <section class="grid gap-4 xl:grid-cols-[1fr_24rem]">
                <div class="workspace-panel">
                  <div class="section-title">{t("overview.gatewayOverview")}</div>
                  <div class="mt-4 grid gap-3 md:grid-cols-3">
                    <OverviewCard label={t("common.servers")} value={servers.length} detail={t("overview.runningDetail", { count: runningServers })} />
                    <OverviewCard label={t("common.endpoints")} value={endpoints.length} detail={t("overview.enabledEndpointDetail", { count: enabledEndpoints })} />
                    <OverviewCard label={t("common.apiKeys")} value={apiKeys.length} detail={t("overview.enabledAPIKeyDetail", { count: enabledAPIKeys })} />
                  </div>
                </div>
                <div class="workspace-panel">
                  <div class="section-title">{t("overview.notifications")}</div>
                  <div class="mt-4 rounded-xl bg-blue-50 p-4 text-sm text-blue-700">
                    {t("overview.runningServersAvailable", { count: runningServers, unit: pluralKey(runningServers, "unit.server.one", "unit.server.other") })}
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {activeView === "servers" ? (
            <div class="workspace-stack">
              <section class="metric-grid">
                <Stat title={t("overview.totalServers")} value={servers.length} />
                <Stat title={t("metric.running")} value={runningServers} tone="text-success" />
                <Stat title={t("metric.disabled")} value={servers.filter((server) => !server.enabled).length} />
                <Stat title={t("metric.gatewayTools")} value={gatewayToolsCount} tone="text-secondary" />
              </section>
              <ListPanel
                title={t("list.serversTitle")}
                subtitle={t("list.serversSubtitle", { shown: filteredServers.length, total: servers.length })}
                action={<button class="btn btn-outline btn-sm" onClick={() => loadServers(true)} disabled={loadingServers}>{loadingServers ? t("common.refreshing") : t("common.refresh")}</button>}
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
                        onEdit={editServer}
                        onRestart={restartServer}
                        onTest={testSavedServer}
                        onToggleEnabled={toggleServerEnabled}
                        onDelete={deleteServer}
                        visibleColumns={serverColumns}
                      />
                    ))
                  ) : (
                    <EmptyState message={t("empty.noServers")} />
                  )}
                </div>
              </ListPanel>
            </div>
          ) : null}

          {activeView === "endpoints" ? (
            <div class="workspace-stack">
              <section class="metric-grid">
                <Stat title={t("metric.totalEndpoints")} value={endpoints.length} />
                <Stat title={t("common.enabled")} value={enabledEndpoints} tone="text-success" />
                <Stat title={t("metric.attachedServers")} value={new Set(endpoints.flatMap((endpoint) => endpoint.serverIds || [])).size} tone="text-primary" />
                <Stat title={t("metric.limitedCalls")} value={endpoints.reduce((sum, endpoint) => sum + (endpoint.usage?.rateLimitedCalls || 0), 0)} tone="text-secondary" />
              </section>
              <ListPanel
                title={t("list.endpointsTitle")}
                subtitle={t("list.endpointsSubtitle", { shown: filteredEndpoints.length, total: endpoints.length })}
                action={<button class="btn btn-outline btn-sm" onClick={() => loadEndpoints(true)} disabled={loadingEndpoints}>{loadingEndpoints ? t("common.refreshing") : t("common.refresh")}</button>}
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
                        onEdit={editEndpoint}
                        onToggleEnabled={toggleEndpointEnabled}
                        onDelete={deleteEndpoint}
                        visibleColumns={endpointColumns}
                      />
                    ))
                  ) : (
                    <EmptyState message={servers.length ? t("empty.noEndpoints") : t("empty.needServerForEndpoint")} />
                  )}
                </div>
              </ListPanel>
            </div>
          ) : null}

          {activeView === "api-keys" ? (
            <div class="workspace-stack">
              <section class="metric-grid">
                <Stat title={t("metric.totalAPIKeys")} value={apiKeys.length} />
                <Stat title={t("common.enabled")} value={enabledAPIKeys} tone="text-success" />
                <Stat title={t("metric.endpointResources")} value={new Set(apiKeys.flatMap((key) => key.endpointIds || [])).size} tone="text-primary" />
                <Stat title={t("common.endpoints")} value={endpoints.length} tone="text-secondary" />
              </section>
              <ListPanel
                title={t("list.apiKeysTitle")}
                subtitle={t("list.apiKeysSubtitle", { shown: filteredAPIKeys.length, total: apiKeys.length })}
                action={<button class="btn btn-outline btn-sm" onClick={() => loadAPIKeys(true)} disabled={loadingAPIKeys}>{loadingAPIKeys ? t("common.refreshing") : t("common.refresh")}</button>}
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
                    <EmptyState message={endpoints.length ? t("empty.noAPIKeys") : t("empty.needEndpointForAPIKey")} />
                  )}
                </div>
              </ListPanel>
            </div>
          ) : null}

          {activeView === "tools" ? (
            <div class="workspace-stack">
              <section class="metric-grid">
                <Stat title={t("overview.loadedTools")} value={tools.length} tone="text-primary" />
                <Stat title={t("common.servers")} value={servers.length} />
                <Stat title={t("metric.runningServers")} value={runningServers} tone="text-success" />
                <Stat title={t("metric.gatewayTools")} value={gatewayToolsCount} tone="text-secondary" />
              </section>
              <ListPanel
                title={t("list.toolsTitle")}
                subtitle={t("list.toolsSubtitle", { shown: filteredTools.length, total: tools.length })}
                action={
                  <LoadingButton className="btn btn-primary btn-sm" loading={loadingTools} onClick={() => loadTools(true)}>
                    {t("action.refreshTools")}
                  </LoadingButton>
                }
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
                    <EmptyState message={t("empty.noTools")} />
                  )}
                </div>
              </ListPanel>
            </div>
          ) : null}

          {activeView === "settings" ? (
            <div class="workspace-stack">
              <section class="metric-grid">
                <Stat title={t("metric.theme")} value={darkMode ? t("common.dark") : t("common.light")} tone="text-primary" />
                <Stat title={t("metric.autoRefresh")} value={preferences.refreshInterval ? `${preferences.refreshInterval}s` : t("common.off")} />
                <Stat title={t("metric.defaultTransport")} value={preferences.defaultTransport.toUpperCase()} tone="text-secondary" />
                <Stat title={t("metric.configPath")} value={configPath === t("common.loadingInitial") ? t("common.loading") : t("common.ready")} tone="text-success" />
              </section>

              <section class="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <div class="workspace-panel">
                  <div class="flex flex-col gap-1">
                    <h2 class="text-lg font-bold text-slate-950">{t("settings.preferences")}</h2>
                    <p class="text-sm text-slate-500">{t("settings.preferencesDescription")}</p>
                  </div>

                  <div class="mt-5 grid gap-4 md:grid-cols-2">
                    <Field label={t("settings.theme")}>
                      <select class="select select-bordered w-full" value={theme} onChange={(event) => setTheme(event.currentTarget.value)}>
                        <option value="mcp">{t("common.light")}</option>
                        <option value="dark">{t("common.dark")}</option>
                      </select>
                    </Field>
                    <Field label={t("settings.refreshInterval")}>
                      <select class="select select-bordered w-full" value={preferences.refreshInterval} onChange={(event) => updatePreference("refreshInterval", Number(event.currentTarget.value))}>
                        <option value="0">{t("common.off")}</option>
                        <option value="15">{t("settings.every15Seconds")}</option>
                        <option value="30">{t("settings.every30Seconds")}</option>
                        <option value="60">{t("settings.everyMinute")}</option>
                        <option value="300">{t("settings.every5Minutes")}</option>
                      </select>
                    </Field>
                    <Field label={t("settings.defaultTransport")}>
                      <select class="select select-bordered w-full" value={preferences.defaultTransport} onChange={(event) => updatePreference("defaultTransport", event.currentTarget.value)}>
                        <option value="http">{t("settings.httpUrl")}</option>
                        <option value="stdio">{t("settings.localStdio")}</option>
                      </select>
                      <p class="mt-2 text-xs text-slate-500">{t("settings.defaultTransportHelp")}</p>
                    </Field>
                    <div class="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <label class="label cursor-pointer justify-between gap-4">
                        <span>
                          <span class="block font-bold text-slate-900">{t("settings.compactTables")}</span>
                          <span class="text-xs text-slate-500">{t("settings.compactTablesHelp")}</span>
                        </span>
                        <input class="toggle toggle-primary" type="checkbox" checked={preferences.denseTables} onChange={(event) => updatePreference("denseTables", event.currentTarget.checked)} />
                      </label>
                      <label class="label cursor-pointer justify-between gap-4">
                        <span>
                          <span class="block font-bold text-slate-900">{t("settings.advancedTableControls")}</span>
                          <span class="text-xs text-slate-500">{t("settings.advancedTableControlsHelp")}</span>
                        </span>
                        <input class="toggle toggle-primary" type="checkbox" checked={preferences.showAdvancedControls} onChange={(event) => updatePreference("showAdvancedControls", event.currentTarget.checked)} />
                      </label>
                    </div>
                  </div>
                </div>

                <div class="workspace-panel">
                  <div class="section-title">{t("settings.gatewayPaths")}</div>
                  <div class="mt-4 grid gap-3">
                    <InfoTile label={t("overview.endpointPattern")} value={endpointPattern} code />
                    <InfoTile label={t("overview.sqliteDatabase")} value={configPath} />
                    <InfoTile label={t("settings.apiBase")} value={`${location.origin}/api`} code />
                    <InfoTile label={t("settings.browserSettings")} value={preferencesStorageKey} code />
                  </div>
                </div>
              </section>
            </div>
          ) : null}
      </main>
      </div>
      <ServerModal
        open={serverModalOpen}
        title={editingServer ? t("modal.updateServer") : t("modal.createServer")}
        description={t("modal.serverDescription")}
        onClose={() => setServerModalOpen(false)}
      >
        <ServerForm
          form={form}
          saving={saving}
          testing={testingServer}
          onSubmit={saveServer}
          onTest={testServerForm}
          onClear={() => {
            setServerIdTouched(false);
            setEditingServer(false);
            setForm(initialForm);
          }}
          onPreset={selectPreset}
          onUpdate={updateForm}
          onHeaderChange={updateHeader}
          onAddHeader={addHeader}
          onRemoveHeader={removeHeader}
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
    </>
  );
}

function LoadingButton({ className, loading, onClick, children }) {
  return (
    <button class={className} onClick={onClick} disabled={loading}>
      {loading ? <span class="loading loading-spinner loading-sm"></span> : null}
      {loading ? t("common.loading") : children}
    </button>
  );
}

function ApiLoadingBar({ active }) {
  if (!active) return null;

  return (
    <div class="api-loading-overlay" role="status" aria-live="polite" aria-label={t("aria.apiRequestInProgress")}>
      <div class="api-loading-card">
        <span class="loading loading-spinner loading-lg text-primary"></span>
        <span>{t("common.loading")}</span>
      </div>
    </div>
  );
}

function Sidebar({ activeView, onNavigate }) {
  const links = [
    { id: "overview", label: t("nav.overview") },
    { id: "servers", label: t("nav.mcpServers") },
    { id: "endpoints", label: t("nav.endpoints") },
    { id: "api-keys", label: t("nav.apiKeys") },
    { id: "tools", label: t("nav.tools") },
    { id: "settings", label: t("nav.settings") },
  ];

  return (
    <>
      <aside class="module-sidebar">
        <div class="brand-row mb-5">
          <div class="brand-mark">M</div>
          <div>
            <div class="text-sm font-bold text-slate-900">{t("brand.name")}</div>
            <div class="text-xs text-slate-500">{t("nav.project")}</div>
          </div>
        </div>
        <nav class="module-group grid gap-1">
          {links.map((link) => (
            <button
              key={link.id}
              class={`sidebar-link ${activeView === link.id ? "sidebar-link-active" : ""}`}
              type="button"
              onClick={() => onNavigate(link.id)}
            >
              <span>{link.label}</span>
            </button>
          ))}
        </nav>
      </aside>
    </>
  );
}

function TopBar({ title, description, darkMode, onToggleTheme, children }) {
  return (
    <header class="topbar">
      <div>
        <h1 class="text-lg font-bold text-slate-950">{title}</h1>
        <p class="text-sm text-slate-500">{description}</p>
      </div>
      <div class="flex items-center gap-2">
        <ThemeToggle darkMode={darkMode} onToggle={onToggleTheme} />
        {children}
      </div>
    </header>
  );
}

function ThemeToggle({ darkMode, onToggle }) {
  return (
    <button class="theme-toggle" type="button" onClick={onToggle} aria-pressed={darkMode} aria-label={t("aria.toggleDarkMode")}>
      <span>{darkMode ? t("common.dark") : t("common.light")}</span>
      <span class="theme-toggle-knob">{darkMode ? "D" : "L"}</span>
    </button>
  );
}

function ServerModal({ open, title, description, onClose, children }) {
  if (!open) return null;

  return (
    <div class="modal modal-open">
      <div class="modal-box max-h-[92vh] w-11/12 max-w-6xl bg-base-100 p-0">
        <div class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-base-100/95 px-6 py-5 backdrop-blur">
          <div>
            <h2 class="text-2xl font-black">{title}</h2>
            <p class="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <button class="btn btn-circle btn-ghost" type="button" onClick={onClose} aria-label={t("modal.closeServer")}>{t("common.closeIcon")}</button>
        </div>
        {children}
      </div>
      <button class="modal-backdrop" type="button" onClick={onClose}>{t("common.close")}</button>
    </div>
  );
}

function ServerForm({ form, saving, testing, onSubmit, onTest, onClear, onPreset, onUpdate, onHeaderChange, onAddHeader, onRemoveHeader }) {
  return (
    <form class="grid gap-6 p-6" onSubmit={onSubmit}>
      <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 class="text-lg font-black">{t("server.details")}</h3>
          <p class="text-sm text-slate-500">{t("server.detailsHelp")}</p>
        </div>
        <button class="btn btn-ghost" type="button" onClick={onClear}>
          {t("common.clearForm")}
        </button>
      </div>

      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label={t("server.preset")} wide>
          <select class="select select-bordered w-full" value={form.presetId} onChange={(event) => onPreset(event.currentTarget.value)}>
                {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                    {presetLabel(preset)}
              </option>
            ))}
          </select>
          <p class="mt-2 text-xs text-slate-500">
            {t("server.presetHelp")}
          </p>
        </Field>
        <Field label={t("server.transport")}>
          <select class="select select-bordered w-full" value={form.transport} onChange={(event) => onUpdate("transport", event.currentTarget.value)}>
            <option value="http">{t("settings.httpUrl")}</option>
            <option value="stdio">{t("settings.localStdio")}</option>
          </select>
        </Field>
        <Field label={t("server.weight")}>
          <input class="input input-bordered w-full" min="1" type="number" value={form.weight} onInput={(event) => onUpdate("weight", event.currentTarget.value)} />
        </Field>
        <Field label={t("common.name")}>
          <input class="input input-bordered w-full" required value={form.name} placeholder={t("server.placeholderName")} onInput={(event) => onUpdate("name", event.currentTarget.value)} />
        </Field>
        {form.transport === "http" ? (
          <>
            <Field label={t("server.mcpServerUrl")} wide>
              <input class="input input-bordered w-full" required value={form.url} placeholder={t("server.placeholderUrl")} onInput={(event) => onUpdate("url", event.currentTarget.value)} />
              <p class="mt-2 text-xs text-slate-500">{t("server.urlHelp")}</p>
            </Field>
            <div class="xl:col-span-4">
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
          </>
        ) : (
          <>
            <Field label={t("server.command")} wide>
              <input class="input input-bordered w-full" required value={form.command} placeholder={t("server.placeholderCommand")} onInput={(event) => onUpdate("command", event.currentTarget.value)} />
            </Field>
            <Field label={t("server.args")} wide>
              <input class="input input-bordered w-full" value={form.args} placeholder={t("server.placeholderArgs")} onInput={(event) => onUpdate("args", event.currentTarget.value)} />
            </Field>
          </>
        )}
      </div>

      <div class="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <label class="label cursor-pointer justify-start gap-3">
          <input class="checkbox checkbox-primary" type="checkbox" checked={form.enabled} onChange={(event) => onUpdate("enabled", event.currentTarget.checked)} />
          <span class="label-text font-semibold">{t("common.enabled")}</span>
        </label>
        <div class="flex flex-col gap-2 sm:flex-row">
          <button class={`btn btn-outline min-w-40 ${testing ? "btn-disabled" : ""}`} type="button" disabled={testing || saving} onClick={onTest}>
            {testing ? <span class="loading loading-spinner loading-sm"></span> : null}
            {testing ? t("common.testing") : t("action.testConnection")}
          </button>
          <button class={`btn btn-primary min-w-40 ${saving ? "btn-disabled" : ""}`} type="submit" disabled={saving || testing}>
            {saving ? <span class="loading loading-spinner loading-sm"></span> : null}
            {saving ? t("common.saving") : t("action.saveServer")}
          </button>
        </div>
      </div>
    </form>
  );
}

function EndpointForm({ form, servers, saving, onSubmit, onClear, onUpdate, onToggleServer }) {
  return (
    <form class="grid gap-6 p-6" onSubmit={onSubmit}>
      <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 class="text-lg font-black">{t("endpoint.details")}</h3>
          <p class="text-sm text-slate-500">{t("endpoint.detailsHelp")}</p>
        </div>
        <button class="btn btn-ghost" type="button" onClick={onClear}>
          {t("common.clearForm")}
        </button>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <Field label={t("common.name")}>
          <input class="input input-bordered w-full" required value={form.name} placeholder={t("endpoint.placeholderName")} onInput={(event) => onUpdate("name", event.currentTarget.value)} />
        </Field>
        <Field label={t("endpoint.rateLimitPerMin")}>
          <input class="input input-bordered w-full" min="0" type="number" value={form.rateLimitPerMinute} onInput={(event) => onUpdate("rateLimitPerMinute", event.currentTarget.value)} />
          <p class="mt-2 text-xs text-slate-500">{t("endpoint.rateLimitHelp")}</p>
        </Field>
        <Field label={t("common.description")}>
          <input class="input input-bordered w-full" value={form.description} placeholder={t("endpoint.placeholderDescription")} onInput={(event) => onUpdate("description", event.currentTarget.value)} />
        </Field>
      </div>

      <div class="rounded-3xl border border-slate-200 bg-base-100 p-4">
        <div class="mb-4 flex flex-col gap-1">
          <h3 class="font-black">{t("endpoint.mcpServers")}</h3>
          <p class="text-sm text-slate-500">{t("endpoint.mcpServersHelp")}</p>
        </div>
        {servers.length ? (
          <div class="grid gap-2 md:grid-cols-2">
            {servers.map((server) => (
              <label key={server.id} class="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
                <input
                  class="checkbox checkbox-primary mt-1"
                  type="checkbox"
                  checked={form.serverIds.includes(server.id)}
                  onChange={(event) => onToggleServer(server.id, event.currentTarget.checked)}
                />
                <span class="min-w-0">
                  <span class="block truncate font-bold text-slate-900">{server.name}</span>
                  <span class="block truncate text-xs text-slate-500">{server.transport || "stdio"} - {server.enabled ? t("common.enabled") : t("common.disabled")}</span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <EmptyState message={t("empty.needServerBeforeEndpoint")} />
        )}
      </div>

      <div class="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <label class="label cursor-pointer justify-start gap-3">
          <input class="checkbox checkbox-primary" type="checkbox" checked={form.enabled} onChange={(event) => onUpdate("enabled", event.currentTarget.checked)} />
          <span class="label-text font-semibold">{t("common.enabled")}</span>
        </label>
        <button class={`btn btn-primary min-w-40 ${saving ? "btn-disabled" : ""}`} type="submit" disabled={saving || !servers.length}>
          {saving ? <span class="loading loading-spinner loading-sm"></span> : null}
          {saving ? t("common.saving") : t("action.saveEndpoint")}
        </button>
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
          <p class="text-sm text-slate-500">{t("apiKey.detailsHelp")}</p>
        </div>
        <button class="btn btn-ghost" type="button" onClick={onClear}>
          {t("common.clearForm")}
        </button>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <Field label={t("common.name")}>
          <input class="input input-bordered w-full" required value={form.name} placeholder={t("apiKey.placeholderName")} onInput={(event) => onUpdate("name", event.currentTarget.value)} />
        </Field>
        <Field label={showValueInput && editing ? t("apiKey.newValue") : t("apiKey.value")}>
          {showValueInput ? (
            <>
              <div class="join w-full">
                <input
                  class="input input-bordered join-item w-full font-mono"
                  type="text"
                  required={!editing || form.rotateValue}
                  value={form.value}
                  placeholder={t("apiKey.placeholderValue")}
                  onInput={(event) => onUpdate("value", event.currentTarget.value)}
                />
                <button class="btn btn-outline join-item" type="button" onClick={() => onUpdate("value", generateAPIKeyValue())}>
                  {t("common.generate")}
                </button>
              </div>
              <p class="mt-2 text-xs text-slate-500">{editing ? t("apiKey.rotateHelp") : t("apiKey.valueHelp")}</p>
              {editing ? (
                <button
                  class="btn btn-ghost btn-xs mt-2"
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
              <div class="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div class="min-w-0">
                  <div class="font-semibold text-slate-900">{t("apiKey.currentValue")}</div>
                  <p class="mt-1 text-xs text-slate-500">{t("apiKey.currentValueHelp")}</p>
                </div>
                <button
                  class="btn btn-outline btn-sm shrink-0"
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

      <div class="rounded-3xl border border-slate-200 bg-base-100 p-4">
        <div class="mb-4 flex flex-col gap-1">
          <h3 class="font-black">{t("apiKey.endpointResources")}</h3>
          <p class="text-sm text-slate-500">{t("apiKey.endpointResourcesHelp")}</p>
        </div>
        {endpoints.length ? (
          <div class="grid gap-2 md:grid-cols-2">
            {endpoints.map((endpoint) => (
              <label key={endpoint.id} class="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
                <input
                  class="checkbox checkbox-primary mt-1"
                  type="checkbox"
                  checked={form.endpointIds.includes(endpoint.id)}
                  onChange={(event) => onToggleEndpoint(endpoint.id, event.currentTarget.checked)}
                />
                <span class="min-w-0">
                  <span class="block truncate font-bold text-slate-900">{endpoint.name}</span>
                  <span class="block truncate text-xs text-slate-500">/mcp/{endpoint.id} - {endpoint.enabled ? t("common.enabled") : t("common.disabled")}</span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <EmptyState message={t("empty.needEndpointBeforeAPIKey")} />
        )}
      </div>

      <div class="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <label class="label cursor-pointer justify-start gap-3">
          <input class="checkbox checkbox-primary" type="checkbox" checked={form.enabled} onChange={(event) => onUpdate("enabled", event.currentTarget.checked)} />
          <span class="label-text font-semibold">{t("common.enabled")}</span>
        </label>
        <button class={`btn btn-primary min-w-40 ${saving ? "btn-disabled" : ""}`} type="submit" disabled={saving || !endpoints.length}>
          {saving ? <span class="loading loading-spinner loading-sm"></span> : null}
          {saving ? t("common.saving") : t("action.saveAPIKey")}
        </button>
      </div>
    </form>
  );
}

function InfoTile({ label, value, code = false }) {
  return (
    <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div class="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
      {code ? <code class="mt-2 block overflow-hidden text-ellipsis whitespace-nowrap rounded-lg bg-primary/10 px-2 py-1 text-sm text-primary">{value}</code> : <div class="mt-2 truncate text-sm font-semibold text-slate-700">{value}</div>}
    </div>
  );
}

function Stat({ title, value, tone = "text-slate-950" }) {
  return (
    <div class="metric-card">
      <div class="text-xs font-semibold text-slate-500">{title}</div>
      <div class={`mt-3 text-3xl font-black ${tone}`}>{value}</div>
      <div class="mt-4 h-1.5 rounded-full bg-slate-100">
        <div class="h-full w-2/3 rounded-full bg-primary/20"></div>
      </div>
    </div>
  );
}

function OverviewCard({ label, value, detail }) {
  return (
    <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div class="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div class="mt-3 text-2xl font-black text-slate-950">{value}</div>
      <p class="mt-2 text-sm text-slate-500">{detail}</p>
    </div>
  );
}

function Field({ label, children, wide = false }) {
  return (
    <label class={wide ? "form-control xl:col-span-2" : "form-control"}>
      <div class="label">
        <span class="label-text font-bold">{label}</span>
      </div>
      {children}
    </label>
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
    <div class="rounded-3xl border border-slate-200 bg-base-100 p-4">
      <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 class="font-black">{t("auth.title")}</h3>
          <p class="text-sm text-slate-500">{t("auth.description")}</p>
        </div>
        <button class="btn btn-sm btn-outline" type="button" onClick={onAddHeader}>
          {t("action.addHeader")}
        </button>
      </div>

      <div class="grid gap-4 lg:grid-cols-3">
        <Field label={t("auth.type")}>
          <select class="select select-bordered w-full" value={authType} onChange={(event) => onAuthType(event.currentTarget.value)}>
            <option value="none">{t("auth.none")}</option>
            <option value="apiKey">{t("auth.apiKey")}</option>
            <option value="bearer">{t("auth.bearer")}</option>
            <option value="jwtBearer">{t("auth.jwtBearer")}</option>
            <option value="basic">{t("auth.basic")}</option>
          </select>
        </Field>
        {authType === "apiKey" ? (
          <>
            <Field label={t("auth.keyName")}>
              <input class="input input-bordered w-full" value={apiKeyName} placeholder={t("auth.placeholderKeyName")} onInput={(event) => onAPIKeyName(event.currentTarget.value)} />
            </Field>
            <Field label={t("auth.addTo")}>
              <select class="select select-bordered w-full" value={apiKeyIn} onChange={(event) => onAPIKeyIn(event.currentTarget.value)}>
                <option value="header">{t("auth.header")}</option>
                <option value="query">{t("auth.queryParam")}</option>
              </select>
            </Field>
            <Field label={t("auth.apiKeyValue")} wide>
              <input class="input input-bordered w-full font-mono" value={apiKeyValue} placeholder={t("auth.placeholderAPIKeyValue")} onInput={(event) => onAPIKeyValue(event.currentTarget.value)} />
              <p class="mt-2 text-xs text-slate-500">{t("auth.apiKeyHelp")}</p>
            </Field>
          </>
        ) : null}
        {authType === "bearer" || authType === "jwtBearer" ? (
          <Field label={authType === "jwtBearer" ? t("auth.jwtTokenEnv") : t("auth.bearerTokenEnv")} wide>
            <input class="input input-bordered w-full font-mono" value={token} placeholder={t("auth.placeholderBearerToken")} onInput={(event) => onToken(event.currentTarget.value)} />
            <p class="mt-2 text-xs text-slate-500">{t("auth.bearerHelp")}</p>
          </Field>
        ) : null}
        {authType === "basic" ? (
          <>
            <Field label={t("auth.username")}>
              <input class="input input-bordered w-full" value={username} placeholder={t("auth.placeholderBasicUser")} onInput={(event) => onUsername(event.currentTarget.value)} />
            </Field>
            <Field label={t("auth.password")}>
              <input class="input input-bordered w-full" type="password" value={password} placeholder={t("auth.placeholderBasicPassword")} onInput={(event) => onPassword(event.currentTarget.value)} />
            </Field>
          </>
        ) : null}
        {authType === "none" ? <div class="hidden lg:block lg:col-span-2"></div> : null}
      </div>

      <div class="divider my-4">{t("auth.headers")}</div>
      <div class="hidden grid-cols-[auto_1fr_1fr_auto] gap-2 px-2 text-xs font-bold uppercase tracking-wide text-slate-500 md:grid">
        <span>{t("common.on")}</span>
        <span>{t("common.key")}</span>
        <span>{t("common.value")}</span>
        <span></span>
      </div>
      <div class="grid gap-2">
        {headers.map((row, index) => (
          <div key={index} class="grid gap-2 rounded-2xl border border-slate-100 bg-slate-50 p-2 md:grid-cols-[auto_1fr_1fr_auto] md:items-center md:border-0 md:bg-transparent md:p-0">
            <label class="label cursor-pointer justify-start gap-2 md:justify-center">
              <input class="checkbox checkbox-primary checkbox-sm" type="checkbox" checked={row.enabled} onChange={(event) => onHeaderChange(index, "enabled", event.currentTarget.checked)} />
              <span class="label-text md:hidden">{t("common.enabled")}</span>
            </label>
            <input class="input input-bordered input-sm w-full" value={row.key} placeholder={t("auth.placeholderHeaderName")} onInput={(event) => onHeaderChange(index, "key", event.currentTarget.value)} />
            <input class="input input-bordered input-sm w-full font-mono" value={row.value} placeholder={t("auth.placeholderHeaderValue")} onInput={(event) => onHeaderChange(index, "value", event.currentTarget.value)} />
            <button class="btn btn-ghost btn-sm" type="button" onClick={() => onRemoveHeader(index)}>
              {t("common.remove")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ListPanel({
  title,
  subtitle,
  action,
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
      <div class="grid gap-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 class="text-lg font-bold text-slate-950">{title}</h2>
            <p class="text-sm text-slate-500">{subtitle}</p>
          </div>
          {action}
        </div>
        <div class="border-b border-slate-200">
          <button class="tab-button tab-button-active" type="button">{title}</button>
        </div>
        <div class="table-toolbar">
          <div class="toolbar-left">
            <label class="search-control">
              <span>⌕</span>
              <input placeholder={t("common.search")} value={searchValue} onInput={(event) => onSearch(event.currentTarget.value)} />
            </label>
            {showAdvancedControls ? (
              <div class="dropdown dropdown-end">
                <button class="filter-button" type="button" tabIndex="0" disabled={!addableFilters.length}>
                  <span>+</span>
                  {t("action.addFilter")}
                </button>
                {addableFilters.length ? (
                  <div class="dropdown-content z-20 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg" tabIndex="0">
                    <div class="mb-2 px-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t("action.filtersTitle")}</div>
                    {addableFilters.map((field) => (
                      <button
                        key={field.id}
                        class="btn btn-ghost btn-sm w-full justify-start"
                        type="button"
                        onClick={() => onAddFilter?.(field.id)}
                      >
                        {t(field.labelKey)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          {showAdvancedControls ? (
            <div class="toolbar-right">
              <button class={`control-button ${sortActive ? "control-button-active" : ""}`} type="button" onClick={onToggleSort}>
                ↕ {t("action.lastExecuted")}
              </button>
              <div class="dropdown dropdown-end">
                <button class="control-button" type="button" tabIndex="0">
                  {t("action.columns", { shown: visibleColumns.length, total: columns.length })}
                </button>
                <div class="dropdown-content z-20 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-lg" tabIndex="0">
                  <div class="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t("action.columnsTitle")}</div>
                  <div class="grid gap-2">
                    {columns.map((column) => (
                      <label key={column.id} class="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                        <input
                          class="checkbox checkbox-primary checkbox-sm"
                          type="checkbox"
                          checked={columnVisible(visibleColumns, column.id)}
                          disabled={visibleColumns.length === 1 && columnVisible(visibleColumns, column.id)}
                          onChange={() => onToggleColumn?.(column.id)}
                        />
                        <span>{t(column.labelKey)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
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
        <div class="min-h-80 overflow-hidden rounded-xl border border-slate-200">{children}</div>
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
            <button type="button" onClick={prev} disabled={page <= 1} aria-label={t("action.previousPage")}>‹</button>
            <button type="button" onClick={next} disabled={page >= pages} aria-label={t("action.nextPage")}>›</button>
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

function ServerCard({ server, testing, onEdit, onRestart, onTest, onToggleEnabled, onDelete, visibleColumns }) {
  const disabled = !server.enabled;
  const running = !disabled && server.status?.running;
  const statusLabel = disabled ? t("common.disabled") : running ? t("common.running") : t("common.stopped");
  const statusClass = disabled ? "status-neutral" : running ? "status-success" : "status-error";
  const usage = server.usage || {};
  const usageLabel = `${usage.totalCalls || 0} ${pluralKey(usage.totalCalls || 0, "unit.call.one", "unit.call.other")}`;

  return (
    <div class="data-row" style={{ gridTemplateColumns: tableGridTemplate("servers", visibleColumns, true) }}>
      {columnVisible(visibleColumns, "name") ? (
        <div class="min-w-0">
          <div class="truncate font-semibold text-slate-900">{server.name}</div>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "target") ? <div class="truncate text-sm text-slate-600">{server.transport || "stdio"} - {targetFor(server)}</div> : null}
      {columnVisible(visibleColumns, "status") ? (
        <div>
          <span class={`status-pill ${statusClass}`}>{statusLabel}</span>
          {server.status?.error ? <div class="mt-1 truncate text-xs text-error">{server.status.error}</div> : null}
        </div>
      ) : null}
      {columnVisible(visibleColumns, "usage") ? (
        <div class="text-sm text-slate-500">
          <div class="font-semibold text-slate-700">{usageLabel}</div>
          <div class="mt-1 text-xs">{usage.successfulCalls || 0} {t("common.ok")} / {usage.failedCalls || 0} {t("common.failed")}</div>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "createdAt") ? <TimestampCell value={server.createdAt} /> : null}
      {columnVisible(visibleColumns, "updatedAt") ? <TimestampCell value={server.updatedAt} /> : null}
      <div class="flex justify-end">
        <div class="dropdown dropdown-end">
          <button class="btn btn-ghost btn-xs action-menu-trigger" type="button" tabIndex="0" aria-label={t("card.openActions", { name: server.name })}>
            <span></span>
            <span></span>
            <span></span>
          </button>
          <ul class="menu dropdown-content z-20 mt-2 w-36 rounded-xl border border-slate-200 bg-white p-1 shadow-lg" tabIndex="0">
            <li><button type="button" onClick={() => onEdit(server)}>{t("common.edit")}</button></li>
            <li><button type="button" onClick={() => onTest(server.id)} disabled={testing}>{testing ? t("common.testing") : t("common.test")}</button></li>
            <li><button type="button" onClick={() => onRestart(server.id)} disabled={disabled}>{t("action.restart")}</button></li>
            <li><button type="button" onClick={() => onToggleEnabled(server)}>{disabled ? t("common.enable") : t("common.disable")}</button></li>
            <li><button class="text-error" type="button" onClick={() => onDelete(server.id)}>{t("common.delete")}</button></li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function EndpointCard({ endpoint, servers, onEdit, onToggleEnabled, onDelete, visibleColumns }) {
  const disabled = !endpoint.enabled;
  const usage = endpoint.usage || {};
  const limit = usage.limitPerMinute || endpoint.rateLimit?.requestsPerMinute || 0;
  const usageLabel = `${usage.totalCalls || 0} ${pluralKey(usage.totalCalls || 0, "unit.call.one", "unit.call.other")}`;
  const limitLabel = limit ? t("endpoint.limitLeft", { remaining: usage.remainingThisMinute ?? limit, limit }) : t("common.unlimited");
  const selectedServers = servers.filter((server) => (endpoint.serverIds || []).includes(server.id));
  const missingServerCount = Math.max((endpoint.serverIds || []).length - selectedServers.length, 0);

  return (
    <div class="data-row" style={{ gridTemplateColumns: tableGridTemplate("endpoints", visibleColumns, true) }}>
      {columnVisible(visibleColumns, "name") ? (
        <div class="min-w-0">
          <div class="truncate font-semibold text-slate-900">{endpoint.name}</div>
          <div class="mt-1 flex items-center gap-2 text-xs text-slate-500">
            <span class={`status-pill ${disabled ? "status-neutral" : "status-success"}`}>{disabled ? t("common.disabled") : t("common.enabled")}</span>
          </div>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "url") ? <code class="truncate rounded-lg bg-primary/10 px-2 py-1 text-xs text-primary">{endpointUrl(endpoint)}</code> : null}
      {columnVisible(visibleColumns, "servers") ? (
        <div class="text-sm text-slate-500">
          <div class="font-semibold text-slate-700">{selectedServers.length} {pluralKey(selectedServers.length, "unit.server.one", "unit.server.other")}</div>
          <div class="mt-1 line-clamp-2 text-xs">
            {selectedServers.map((server) => server.name).join(", ") || t("card.noActiveServerRecords")}
            {missingServerCount ? `, ${missingServerCount} ${t("common.missing")}` : ""}
          </div>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "usage") ? (
        <div class="text-sm text-slate-500">
          <div class="font-semibold text-slate-700">{usageLabel}</div>
          <div class="mt-1 text-xs">{usage.successfulCalls || 0} {t("common.ok")} / {usage.failedCalls || 0} {t("common.failed")} / {usage.rateLimitedCalls || 0} {t("common.limited")}</div>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "rateLimit") ? (
        <div class="text-sm text-slate-500">
          <div class="font-semibold text-slate-700">{limitLabel}</div>
          <div class="mt-1 text-xs">{t("endpoint.quota")}</div>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "createdAt") ? <TimestampCell value={endpoint.createdAt} /> : null}
      {columnVisible(visibleColumns, "updatedAt") ? <TimestampCell value={endpoint.updatedAt} /> : null}
      <div class="flex justify-end">
        <div class="dropdown dropdown-end">
          <button class="btn btn-ghost btn-xs action-menu-trigger" type="button" tabIndex="0" aria-label={t("card.openActions", { name: endpoint.name })}>
            <span></span>
            <span></span>
            <span></span>
          </button>
          <ul class="menu dropdown-content z-20 mt-2 w-36 rounded-xl border border-slate-200 bg-white p-1 shadow-lg" tabIndex="0">
            <li><button type="button" onClick={() => onEdit(endpoint)}>{t("common.edit")}</button></li>
            <li><button type="button" onClick={() => onToggleEnabled(endpoint)}>{disabled ? t("common.enable") : t("common.disable")}</button></li>
            <li><button class="text-error" type="button" onClick={() => onDelete(endpoint.id)}>{t("common.delete")}</button></li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function APIKeyCard({ apiKey, endpoints, onEdit, onDelete, visibleColumns }) {
  const disabled = !apiKey.enabled;
  const selectedEndpoints = endpoints.filter((endpoint) => (apiKey.endpointIds || []).includes(endpoint.id));
  const missingEndpointCount = Math.max((apiKey.endpointIds || []).length - selectedEndpoints.length, 0);

  return (
    <div class="data-row" style={{ gridTemplateColumns: tableGridTemplate("apiKeys", visibleColumns, true) }}>
      {columnVisible(visibleColumns, "name") ? (
        <div class="min-w-0">
          <div class="truncate font-semibold text-slate-900">{apiKey.name}</div>
          <div class="mt-1 truncate font-mono text-xs text-slate-500">{apiKey.id}</div>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "resources") ? (
        <div class="text-sm text-slate-500">
          <div class="font-semibold text-slate-700">{selectedEndpoints.length} {pluralKey(selectedEndpoints.length, "unit.endpoint.one", "unit.endpoint.other")}</div>
          <div class="mt-1 line-clamp-2 text-xs">
            {selectedEndpoints.map((endpoint) => endpoint.name).join(", ") || t("card.noActiveEndpointRecords")}
            {missingEndpointCount ? `, ${missingEndpointCount} ${t("common.missing")}` : ""}
          </div>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "status") ? (
        <div>
          <span class={`status-pill ${disabled ? "status-neutral" : "status-success"}`}>{disabled ? t("common.disabled") : t("common.enabled")}</span>
        </div>
      ) : null}
      {columnVisible(visibleColumns, "createdAt") ? <TimestampCell value={apiKey.createdAt} /> : null}
      {columnVisible(visibleColumns, "updatedAt") ? <TimestampCell value={apiKey.updatedAt} /> : null}
      <div class="flex justify-end">
        <div class="dropdown dropdown-end">
          <button class="btn btn-ghost btn-xs action-menu-trigger" type="button" tabIndex="0" aria-label={t("card.openActions", { name: apiKey.name })}>
            <span></span>
            <span></span>
            <span></span>
          </button>
          <ul class="menu dropdown-content z-20 mt-2 w-36 rounded-xl border border-slate-200 bg-white p-1 shadow-lg" tabIndex="0">
            <li><button type="button" onClick={() => onEdit(apiKey)}>{t("common.edit")}</button></li>
            <li><button class="text-error" type="button" onClick={() => onDelete(apiKey.id)}>{t("common.delete")}</button></li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function ToolCard({ tool, visibleColumns }) {
  return (
    <div class="data-row" style={{ gridTemplateColumns: tableGridTemplate("tools", visibleColumns) }}>
      {columnVisible(visibleColumns, "name") ? <div class="break-all font-mono text-sm font-semibold text-primary">{tool.name}</div> : null}
      {columnVisible(visibleColumns, "server") ? <div class="text-sm text-slate-600">{tool.serverName}</div> : null}
      {columnVisible(visibleColumns, "nativeName") ? <div class="font-mono text-xs text-slate-500">{tool.nativeName}</div> : null}
      {columnVisible(visibleColumns, "description") ? <div class="line-clamp-2 text-sm text-slate-500">{tool.description || t("card.noDescription")}</div> : null}
      {columnVisible(visibleColumns, "createdAt") ? <TimestampCell value={tool.createdAt} /> : null}
      {columnVisible(visibleColumns, "updatedAt") ? <TimestampCell value={tool.updatedAt} /> : null}
    </div>
  );
}

function TimestampCell({ value }) {
  return (
    <div class="text-xs text-slate-500" title={value || t("common.notSet")}>
      {formatTimestamp(value)}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div class="grid min-h-60 place-items-center bg-base-100/60 p-6 text-center text-slate-500">
      {message}
    </div>
  );
}

function SkeletonList() {
  return (
    <>
      <div class="skeleton h-28 w-full"></div>
      <div class="skeleton h-28 w-full"></div>
      <div class="skeleton h-28 w-full"></div>
    </>
  );
}

function ToastStack({ toasts }) {
  return (
    <div class="toast toast-top toast-end z-50">
      {toasts.map((item) => (
        <div key={item.id} class={`alert ${item.type === "error" ? "alert-error" : item.type === "warning" ? "alert-warning" : "alert-success"} max-w-sm shadow-lg`}>
          <div>
            <h3 class="font-bold">{item.title}</h3>
            {item.message ? <div class="text-sm">{item.message}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

render(<App />, document.getElementById("app"));
