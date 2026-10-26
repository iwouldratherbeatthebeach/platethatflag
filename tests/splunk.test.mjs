// Run with: node --test tests/*.test.mjs
// Splunk HEC forwarding: configuration, event shape, delivery and retries against a local mock
// collector, and the real Pages Functions handlers with a fake D1 database.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readHecConfig, hecEndpoint, buildEvent, sendToHec, forward, sha256Hex } from "../functions/_lib/splunk.js";
import { onRequestPost as track } from "../functions/track.js";
import { onRequestPost as login } from "../functions/login.js";
import { onRequestPost as unknown } from "../functions/unknown.js";
import { onRequestPost as observe } from "../functions/observe.js";
import { onRequestPost as signup } from "../functions/signup.js";
import { onRequestPost as logout } from "../functions/logout.js";

/* ---------------------------------------------------------------- a mock HEC collector */
let server;
let base;
const received = [];
let statuses = [];
let delayMs = 0;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({ path: req.url, headers: req.headers, body });
      const status = statuses.length ? statuses.shift() : 200;
      setTimeout(() => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(status === 200 ? { text: "Success", code: 0 } : { text: "Server is busy", code: 9 }));
      }, delayMs);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function reset() {
  received.length = 0;
  statuses = [];
  delayMs = 0;
}

const events = () => received.flatMap((r) => r.body.split("\n").filter(Boolean).map((line) => JSON.parse(line)));

/* ---------------------------------------------------------------- Pages Functions fakes */
function fakeDb({ sessionUser = null, userRow = null, countryCount = 41, plateCount = 3, failRun = null } = {}) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      statements.push(sql.replace(/\s+/g, " ").trim());
      return {
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async run() {
          if (failRun && failRun.test(sql)) throw new Error("D1_ERROR: UNIQUE constraint failed: users.username: SQLITE_CONSTRAINT");
          return { success: true };
        },
        async first() {
          if (/FROM sessions/.test(sql)) return sessionUser;
          if (/FROM plate_queries/.test(sql)) return { query_count: plateCount };
          if (/FROM country_queries/.test(sql)) return { country: this.args[0], query_count: countryCount };
          if (/FROM users/.test(sql)) return userRow;
          return null;
        },
        async all() {
          return { results: [] };
        }
      };
    }
  };
}

function context({ path = "/track", body = {}, env = {}, cookie = "", db = fakeDb() } = {}) {
  const pending = [];
  const request = new Request(`https://platethatflag.pages.dev${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.7",
      "CF-IPCountry": "US",
      "CF-Ray": "8c1e5d2a9f0b1234-IAD",
      "user-agent": "Mozilla/5.0 (test)",
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  });
  return {
    request,
    env: { DB: db, ...env },
    pending,
    waitUntil(promise) {
      pending.push(promise);
    }
  };
}

const hecEnv = (extra = {}) => ({ SPLUNK_HEC_URL: base, SPLUNK_HEC_TOKEN: "test-token", SPLUNK_HEC_INDEX: "platethatflag", ...extra });

/* ---------------------------------------------------------------- configuration */
test("forwarding is off until a URL and a token are set", () => {
  assert.equal(readHecConfig({}), null);
  assert.equal(readHecConfig({ SPLUNK_HEC_URL: "https://splunk.example.com:8088" }), null);
  assert.equal(readHecConfig({ SPLUNK_HEC_TOKEN: "t" }), null);
  assert.equal(readHecConfig({ SPLUNK_HEC_URL: "ftp://x", SPLUNK_HEC_TOKEN: "t" }), null);
  assert.equal(readHecConfig({ SPLUNK_HEC_URL: "https://h:8088", SPLUNK_HEC_TOKEN: "t", SPLUNK_HEC_ENABLED: "false" }), null);
  assert.ok(readHecConfig({ SPLUNK_HEC_URL: "https://h:8088", SPLUNK_HEC_TOKEN: "t" }));
});

test("the URL is normalized to the JSON event endpoint", () => {
  assert.equal(hecEndpoint("https://splunk.example.com:8088"), "https://splunk.example.com:8088/services/collector/event");
  assert.equal(hecEndpoint("https://splunk.example.com:8088/"), "https://splunk.example.com:8088/services/collector/event");
  assert.equal(hecEndpoint("https://splunk.example.com:8088/services/collector"), "https://splunk.example.com:8088/services/collector/event");
  assert.equal(hecEndpoint("https://splunk.example.com:8088/services/collector/raw"), "https://splunk.example.com:8088/services/collector/event");
  assert.equal(hecEndpoint("https://http-inputs-acme.splunkcloud.com/services/collector/event"), "https://http-inputs-acme.splunkcloud.com/services/collector/event");
  assert.equal(hecEndpoint("not a url"), null);
});

test("options: defaults, event allowlist, indexed fields, limits", () => {
  const c = readHecConfig({ SPLUNK_HEC_URL: "https://h", SPLUNK_HEC_TOKEN: "t" });
  assert.equal(c.source, "platethatflag");
  assert.equal(c.sourcetype, "platethatflag:event");
  assert.equal(c.timeoutMs, 3000);
  assert.equal(c.retries, 1);
  assert.ok(["lookup", "unknown_plate", "sighting", "login", "signup", "logout", "error"].every((t) => c.allows(t)));

  const d = readHecConfig({
    SPLUNK_HEC_URL: "https://h", SPLUNK_HEC_TOKEN: "t",
    SPLUNK_HEC_EVENTS: "login, signup", SPLUNK_HEC_FIELDS: '{"env":"production","n":2}',
    SPLUNK_HEC_TIMEOUT_MS: "99999", SPLUNK_HEC_RETRIES: "9", SPLUNK_HEC_INCLUDE_USER_AGENT: "no"
  });
  assert.equal(d.allows("login"), true);
  assert.equal(d.allows("lookup"), false);
  assert.deepEqual(d.fields, { env: "production", n: "2" });
  assert.equal(d.timeoutMs, 10000);
  assert.equal(d.retries, 3);
  assert.equal(d.includeUserAgent, false);

  const bad = readHecConfig({ SPLUNK_HEC_URL: "https://h", SPLUNK_HEC_TOKEN: "t", SPLUNK_HEC_FIELDS: "{nope" });
  assert.deepEqual(bad.fields, {});
});

/* ---------------------------------------------------------------- event shape */
test("events carry HEC metadata, request context and a hashed IP, never the raw IP", async () => {
  const config = readHecConfig(hecEnv({ SPLUNK_HEC_FIELDS: '{"env":"test"}' }));
  const { request } = context({ path: "/track" });
  const e = await buildEvent(config, request, "lookup", { country: "Canada", plate: "DTG4417", empty: "", nothing: null }, { now: 1761434400123 });
  assert.equal(e.time, 1761434400.123);
  assert.equal(e.host, "platethatflag.pages.dev");
  assert.equal(e.index, "platethatflag");
  assert.equal(e.source, "platethatflag");
  assert.equal(e.sourcetype, "platethatflag:event");
  assert.deepEqual(e.fields, { env: "test" });
  assert.equal(e.event.event_type, "lookup");
  assert.equal(e.event.country, "Canada");
  assert.equal(e.event.uri_path, "/track");
  assert.equal(e.event.http_method, "POST");
  assert.equal(e.event.src_country, "US");
  assert.equal(e.event.cf_ray, "8c1e5d2a9f0b1234-IAD");
  assert.equal(e.event.src_ip_hash, await sha256Hex("203.0.113.7"));
  assert.equal(e.event.http_user_agent, "Mozilla/5.0 (test)");
  assert.ok(!("empty" in e.event) && !("nothing" in e.event));
  assert.ok(!JSON.stringify(e).includes("203.0.113.7"));
});

test("privacy switches drop the user agent and the IP hash", async () => {
  const config = readHecConfig(hecEnv({ SPLUNK_HEC_INCLUDE_USER_AGENT: "false", SPLUNK_HEC_INCLUDE_IP_HASH: "false" }));
  const { request } = context();
  const e = await buildEvent(config, request, "lookup", { src_ip_hash: "abc", http_user_agent: "x" });
  assert.ok(!("src_ip_hash" in e.event));
  assert.ok(!("http_user_agent" in e.event));
});

/* ---------------------------------------------------------------- delivery */
test("delivery: Splunk token header, channel header, newline-separated batch", async () => {
  reset();
  const config = readHecConfig(hecEnv({ SPLUNK_HEC_CHANNEL: "0a1b2c3d-1111-2222-3333-444455556666" }));
  const result = await sendToHec(config, [{ event: { n: 1 } }, { event: { n: 2 } }]);
  assert.equal(result.ok, true);
  assert.equal(received.length, 1);
  assert.equal(received[0].path, "/services/collector/event");
  assert.equal(received[0].headers.authorization, "Splunk test-token");
  assert.equal(received[0].headers["x-splunk-request-channel"], "0a1b2c3d-1111-2222-3333-444455556666");
  assert.deepEqual(received[0].body.split("\n").map((l) => JSON.parse(l).event.n), [1, 2]);
});

test("delivery: retries a busy collector (503), not a rejected token (403)", async () => {
  reset();
  statuses = [503, 200];
  const config = readHecConfig(hecEnv());
  const ok = await sendToHec(config, [{ event: {} }]);
  assert.equal(ok.ok, true);
  assert.equal(ok.attempts, 2);

  reset();
  statuses = [403, 200];
  const denied = await sendToHec(config, [{ event: {} }]);
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
  assert.equal(received.length, 1);
});

test("delivery: a slow collector times out instead of hanging", async () => {
  reset();
  delayMs = 1500;
  const config = readHecConfig(hecEnv({ SPLUNK_HEC_TIMEOUT_MS: "300", SPLUNK_HEC_RETRIES: "0" }));
  const started = Date.now();
  const result = await sendToHec(config, [{ event: {} }]);
  assert.equal(result.ok, false);
  assert.match(result.error, /timed out/);
  assert.ok(Date.now() - started < 1200);
});

test("forward() never throws and does nothing when forwarding is off", async () => {
  reset();
  assert.equal(forward({ env: {} }, "lookup", {}), null);
  assert.equal(forward({}, "lookup", {}), null);
  assert.equal(forward(null, "lookup", {}), null);
  assert.equal(received.length, 0);
});

/* ---------------------------------------------------------------- the real handlers */
test("/track: same response as before, lookup event sent in the background", async () => {
  reset();
  const ctx = context({ body: { country: "Canada", plateCode: "dtg4417", missionRole: "Diplomat" }, env: hecEnv() });
  const res = await track(ctx);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, country: "Canada", count: 41, plateCount: 3, missionRole: "Diplomat", searchedBy: "Anonymous" });
  assert.equal(ctx.pending.length, 1, "delivery is handed to waitUntil");
  const delivery = await ctx.pending[0];
  assert.equal(delivery.ok, true);
  const [e] = events();
  assert.equal(e.event.event_type, "lookup");
  assert.equal(e.event.country, "Canada");
  assert.equal(e.event.plate, "DTG4417");
  assert.equal(e.event.mission_role, "Diplomat");
  assert.equal(e.event.full_plate, true);
  assert.equal(e.event.country_lookups, 41);
  assert.equal(e.event.plate_lookups, 3);
  assert.equal(e.event.anonymous, true);
  assert.equal(e.event.src_ip_hash, await sha256Hex("203.0.113.7"));
  assert.equal(e.index, "platethatflag");
});

test("/track: with forwarding off nothing is sent and nothing is scheduled", async () => {
  reset();
  const ctx = context({ body: { country: "Canada", plateCode: "DTG", missionRole: "Diplomat" } });
  const res = await track(ctx);
  assert.equal(res.status, 200);
  assert.equal(ctx.pending.length, 0);
  assert.equal(received.length, 0);
});

test("/track: an unreachable collector never affects the response", async () => {
  reset();
  const ctx = context({ body: { country: "Japan", plateCode: "DAF0789", missionRole: "Diplomat" }, env: { SPLUNK_HEC_URL: "http://127.0.0.1:9", SPLUNK_HEC_TOKEN: "t", SPLUNK_HEC_RETRIES: "0", SPLUNK_HEC_TIMEOUT_MS: "300" } });
  const started = Date.now();
  const res = await track(ctx);
  assert.equal(res.status, 200);
  assert.ok(Date.now() - started < 250, "the response did not wait for Splunk");
  const delivery = await ctx.pending[0];
  assert.equal(delivery.ok, false);
});

test("/track: SPLUNK_HEC_EVENTS filters event types", async () => {
  reset();
  const ctx = context({ body: { country: "Canada", plateCode: "DTG", missionRole: "Diplomat" }, env: hecEnv({ SPLUNK_HEC_EVENTS: "login,signup" }) });
  await track(ctx);
  assert.equal(ctx.pending.length, 0);
  assert.equal(received.length, 0);
});

test("/login: failures are audited with a reason and without the password", async () => {
  reset();
  const db = fakeDb({ userRow: { id: 5, username: "PlateHunter", password_hash: "not-the-hash" } });
  const ctx = context({ path: "/login", body: { username: "PlateHunter", password: "hunter2-secret" }, env: hecEnv(), db });
  const res = await login(ctx);
  assert.equal(res.status, 401);
  await Promise.all(ctx.pending);
  const [e] = events();
  assert.equal(e.event.event_type, "login");
  assert.equal(e.event.signature, "login");
  assert.equal(e.event.action, "failure");
  assert.equal(e.event.reason, "bad_password");
  assert.equal(e.event.user, "PlateHunter");
  assert.ok(!received[0].body.includes("hunter2-secret"), "the password never leaves the function");
});

test("/unknown and /observe send their own event types", async () => {
  reset();
  const u = context({ path: "/unknown", body: { plateCode: "zzq9" }, env: hecEnv() });
  assert.equal((await unknown(u)).status, 200);
  const o = context({ path: "/observe", body: { country: "Canada", plateCode: "DTG4417", city: "Washington", vehicleMake: "Lexus" }, env: hecEnv() });
  assert.equal((await observe(o)).status, 200);
  await Promise.all([...u.pending, ...o.pending]);
  const byType = Object.fromEntries(events().map((e) => [e.event.event_type, e.event]));
  assert.equal(byType.unknown_plate.plate, "ZZQ9");
  assert.equal(byType.sighting.vehicle_make, "Lexus");
  assert.equal(byType.sighting.city, "Washington");
  assert.ok(!("vehicle_model" in byType.sighting), "empty optional fields are left out");
});

test("/signup: success and duplicate usernames are audited, never the password", async () => {
  reset();
  const ok = context({ path: "/signup", body: { username: "NewSpotter", password: "s3cret-pass" }, env: hecEnv(), db: fakeDb({ userRow: { id: 9, username: "NewSpotter" } }) });
  const res = await signup(ok);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, username: "NewSpotter" });

  const dup = context({ path: "/signup", body: { username: "NewSpotter", password: "s3cret-pass" }, env: hecEnv(), db: fakeDb({ failRun: /INSERT INTO users/ }) });
  const dupRes = await signup(dup);
  assert.equal(dupRes.status, 409);
  assert.equal((await dupRes.json()).error, "Username already exists");

  await Promise.all([...ok.pending, ...dup.pending]);
  const [success, duplicate, ...rest] = events();
  assert.equal(rest.length, 0, "a duplicate is a signup failure, not an error event");
  assert.equal(success.event.event_type, "signup");
  assert.equal(success.event.action, "success");
  assert.equal(success.event.user, "NewSpotter");
  assert.equal(success.event.user_id, 9);
  assert.equal(duplicate.event.action, "failure");
  assert.equal(duplicate.event.reason, "duplicate_username");
  assert.equal(duplicate.event.status, 409);
  assert.ok(received.every((r) => !r.body.includes("s3cret-pass")));
});

test("/logout: names who signed out; with forwarding off it skips the extra lookup", async () => {
  reset();
  const db = fakeDb({ sessionUser: { id: 5, username: "PlateHunter", session_id: "abc", expires_at: "2099-01-01" } });
  const ctx = context({ path: "/logout", cookie: "session_id=abc", env: hecEnv(), db });
  const res = await logout(ctx);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.match(res.headers.get("Set-Cookie"), /session_id=;.*Max-Age=0/);
  await Promise.all(ctx.pending);
  const [e] = events();
  assert.equal(e.event.event_type, "logout");
  assert.equal(e.event.user, "PlateHunter");
  assert.ok(db.statements.some((s) => s.startsWith("DELETE FROM sessions")), "the session is still deleted");

  reset();
  const quietDb = fakeDb();
  const quiet = context({ path: "/logout", cookie: "session_id=abc", db: quietDb });
  assert.equal((await logout(quiet)).status, 200);
  assert.equal(quiet.pending.length, 0);
  assert.deepEqual(quietDb.statements, ["DELETE FROM sessions WHERE id = ?"], "only the original query runs");
});
