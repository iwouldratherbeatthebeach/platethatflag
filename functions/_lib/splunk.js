// Splunk HTTP Event Collector (HEC) forwarding for the Pages Functions.
//
// Every handler calls forward(context, type, data) after it has done its own work. Delivery runs
// inside context.waitUntil(), so a response never waits for Splunk, and nothing here can throw into
// a handler: a slow, misconfigured or unreachable collector only costs a log line.
//
// Configuration comes from environment variables (Pages > Settings > Variables and Secrets, or
// `wrangler pages secret put` for the token). Forwarding is off until SPLUNK_HEC_URL and
// SPLUNK_HEC_TOKEN are both set. See README.md, "Splunk HEC forwarding", for the full table.

export const EVENT_TYPES = ["lookup", "unknown_plate", "sighting", "login", "signup", "logout", "error"];

const DEFAULTS = {
  source: "platethatflag",
  sourcetype: "platethatflag:event",
  timeoutMs: 3000,
  retries: 1
};

const OFF = new Set(["0", "false", "no", "off", "disabled"]);
const ON = new Set(["1", "true", "yes", "on", "enabled"]);

function flag(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const v = String(value).trim().toLowerCase();
  if (OFF.has(v)) return false;
  if (ON.has(v)) return true;
  return fallback;
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Normalize SPLUNK_HEC_URL to the JSON event endpoint (these events are JSON, so /raw is not used).
 *   https://splunk.example.com:8088                          -> .../services/collector/event
 *   https://splunk.example.com:8088/services/collector       -> .../services/collector/event
 *   https://splunk.example.com:8088/services/collector/raw   -> .../services/collector/event
 *   https://http-inputs-acme.splunkcloud.com/services/collector/event   (kept)
 * Returns null for anything that is not an http(s) URL.
 */
export function hecEndpoint(raw) {
  if (!raw) return null;
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const path = url.pathname.replace(/\/+$/, "");
  const at = path.indexOf("/services/collector");
  url.pathname = at >= 0 ? `${path.slice(0, at)}/services/collector/event` : `${path}/services/collector/event`;
  return url.toString();
}

function parseFields(raw, warn) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      // HEC indexed fields take strings (or arrays of strings)
      if (v === null || v === undefined) continue;
      out[k] = Array.isArray(v) ? v.map(String) : String(v);
    }
    return out;
  } catch (error) {
    warn(`SPLUNK_HEC_FIELDS is not a JSON object (${error.message}); ignoring it`);
    return {};
  }
}

function parseEvents(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value === "*" || value === "all") return new Set(EVENT_TYPES);
  return new Set(value.split(/[\s,]+/).filter(Boolean));
}

/** Read the HEC settings from env. Returns null when forwarding is off or not configured. */
export function readHecConfig(env = {}) {
  const warn = (message) => console.warn(`[splunk-hec] ${message}`);
  const endpoint = hecEndpoint(env.SPLUNK_HEC_URL);
  const token = env.SPLUNK_HEC_TOKEN ? String(env.SPLUNK_HEC_TOKEN).trim() : "";
  const enabled = flag(env.SPLUNK_HEC_ENABLED, true);
  if (!enabled) return null;
  if (!endpoint || !token) {
    if (env.SPLUNK_HEC_URL && !endpoint) warn("SPLUNK_HEC_URL is not a valid http(s) URL; forwarding is off");
    return null;
  }
  const events = parseEvents(env.SPLUNK_HEC_EVENTS);
  return {
    endpoint,
    token,
    index: env.SPLUNK_HEC_INDEX ? String(env.SPLUNK_HEC_INDEX).trim() : "",
    source: env.SPLUNK_HEC_SOURCE ? String(env.SPLUNK_HEC_SOURCE).trim() : DEFAULTS.source,
    sourcetype: env.SPLUNK_HEC_SOURCETYPE ? String(env.SPLUNK_HEC_SOURCETYPE).trim() : DEFAULTS.sourcetype,
    host: env.SPLUNK_HEC_HOST ? String(env.SPLUNK_HEC_HOST).trim() : "",
    channel: env.SPLUNK_HEC_CHANNEL ? String(env.SPLUNK_HEC_CHANNEL).trim() : "",
    fields: parseFields(env.SPLUNK_HEC_FIELDS, warn),
    events,
    includeUserAgent: flag(env.SPLUNK_HEC_INCLUDE_USER_AGENT, true),
    includeIpHash: flag(env.SPLUNK_HEC_INCLUDE_IP_HASH, true),
    timeoutMs: clampInt(env.SPLUNK_HEC_TIMEOUT_MS, 250, 10000, DEFAULTS.timeoutMs),
    retries: clampInt(env.SPLUNK_HEC_RETRIES, 0, 3, DEFAULTS.retries),
    debug: flag(env.SPLUNK_HEC_DEBUG, false),
    allows(type) {
      return events.has(type);
    }
  };
}

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function header(request, name) {
  try {
    return request?.headers?.get(name) || "";
  } catch {
    return "";
  }
}

/**
 * Build one HEC event. `data` holds the handler's own fields; request metadata is added here.
 * Passwords and session ids are never accepted: callers pass only what is listed in the README.
 */
export async function buildEvent(config, request, type, data = {}, { now = Date.now() } = {}) {
  let url = null;
  try {
    url = request?.url ? new URL(request.url) : null;
  } catch {
    url = null;
  }

  const event = {
    event_type: type,
    app: "platethatflag",
    ...data,
    http_method: request?.method || undefined,
    uri_path: url ? url.pathname : undefined,
    src_country: data.src_country ?? (header(request, "CF-IPCountry") || undefined),
    cf_ray: header(request, "CF-Ray") || undefined,
    cf_colo: request?.cf?.colo || undefined
  };

  if (config.includeIpHash) {
    if (!event.src_ip_hash) {
      const ip = header(request, "CF-Connecting-IP") || header(request, "x-forwarded-for");
      event.src_ip_hash = ip ? await sha256Hex(ip) : undefined;
    }
  } else {
    delete event.src_ip_hash;
  }
  if (config.includeUserAgent) {
    event.http_user_agent = data.http_user_agent ?? (header(request, "user-agent") || undefined);
  } else {
    delete event.http_user_agent;
  }

  // drop empty values so searches see a field only when it was really recorded
  for (const key of Object.keys(event)) {
    if (event[key] === undefined || event[key] === null || event[key] === "") delete event[key];
  }

  const payload = {
    time: Math.round(now) / 1000,
    host: config.host || (url ? url.hostname : "platethatflag"),
    source: config.source,
    sourcetype: config.sourcetype,
    event
  };
  if (config.index) payload.index = config.index;
  if (Object.keys(config.fields).length) payload.fields = { ...config.fields };
  return payload;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST events to HEC as newline-separated JSON (HEC's batch format). Retries network errors,
 * 429 and 5xx (the collector answers 503 when its queue is full); never retries other 4xx such as
 * a bad token (403) or an unknown index (400).
 */
export async function sendToHec(config, events, { fetchImpl = fetch } = {}) {
  const body = events.map((e) => JSON.stringify(e)).join("\n");
  const headers = {
    Authorization: `Splunk ${config.token}`,
    "Content-Type": "application/json"
  };
  if (config.channel) headers["X-Splunk-Request-Channel"] = config.channel;

  let last = { ok: false, status: 0, error: "not sent" };
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const res = await fetchImpl(config.endpoint, { method: "POST", headers, body, signal: controller.signal });
      const text = await res.text().catch(() => "");
      if (res.ok) return { ok: true, status: res.status, attempts: attempt + 1 };
      last = { ok: false, status: res.status, error: text.slice(0, 300), attempts: attempt + 1 };
      if (res.status !== 429 && res.status < 500) return last;
    } catch (error) {
      last = { ok: false, status: 0, error: String(error?.name === "AbortError" ? `timed out after ${config.timeoutMs}ms` : error?.message || error), attempts: attempt + 1 };
    } finally {
      clearTimeout(timer);
    }
    if (attempt < config.retries) await sleep(250 * (attempt + 1));
  }
  return last;
}

/**
 * Forward one event in the background. Safe to call from any handler: returns the delivery promise
 * (or null when forwarding is off or the type is filtered out) and never throws.
 */
export function forward(context, type, data = {}, options = {}) {
  let config;
  try {
    config = readHecConfig(context?.env);
    if (!config || !config.allows(type)) return null;
  } catch (error) {
    console.warn(`[splunk-hec] config error: ${error?.message || error}`);
    return null;
  }

  const task = (async () => {
    try {
      const event = await buildEvent(config, context.request, type, data, options);
      const result = await sendToHec(config, [event], options);
      if (!result.ok) console.warn(`[splunk-hec] ${type} not delivered: ${result.status || ""} ${result.error || ""}`.trim());
      else if (config.debug) console.log(`[splunk-hec] ${type} delivered (${result.status}, attempt ${result.attempts})`);
      return result;
    } catch (error) {
      console.warn(`[splunk-hec] ${type} failed: ${error?.message || error}`);
      return { ok: false, status: 0, error: String(error) };
    }
  })();

  try {
    if (typeof context?.waitUntil === "function") context.waitUntil(task);
  } catch {
    /* outside a request (tests): the caller can await the returned promise */
  }
  return task;
}
