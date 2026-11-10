// Run with: node --test tests/*.test.mjs
// The Splunk app (splunk/flag_that_plate), checked without a Splunk server: every .conf and view
// parses, every macro, lookup, view and dashboard token it uses is defined, its searches are
// balanced, its lookups match plates.csv, the package is the app folder and nothing else, and the
// ptf_plate_parts macro (run by a small evaluator for the eval functions it uses) reads plates the
// way the site does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { APP_DIR, APP_NAME, appEntries, tarGz, staleLookups, appVersion } from "../splunk/build.mjs";
import { plateParts } from "../functions/_lib/plate.js";

const read = (path) => readFileSync(join(APP_DIR, path), "utf8");
const VIEWS = "default/data/ui/views";
const views = readdirSync(join(APP_DIR, VIEWS)).filter((f) => f.endsWith(".xml"));

/* ---------------------------------------------------------------- .conf files */
const TOP = "(before any stanza)";
function parseConf(text, file) {
  const conf = {};
  let current = (conf[TOP] = {});
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(#|$)/.test(line)) continue;
    const stanza = line.match(/^\[(.*)\]\s*$/);
    if (stanza) {
      assert.ok(!(stanza[1] in conf), `${file}: [${stanza[1]}] twice`);
      current = conf[stanza[1]] = {};
      continue;
    }
    const setting = line.match(/^(\S[^=]*?)\s*=\s*(.*)$/);
    assert.ok(setting, `${file}: not a setting: ${JSON.stringify(line)}`);
    let value = setting[2];
    while (value.endsWith("\\")) value = `${value.slice(0, -1)}\n${lines[++i]}`;
    assert.ok(!(setting[1] in current), `${file}: ${setting[1]} twice in one stanza`);
    current[setting[1]] = value.trim();
  }
  return conf;
}
const conf = Object.fromEntries(
  readdirSync(join(APP_DIR, "default")).filter((f) => f.endsWith(".conf")).map((f) => [f.replace(".conf", ""), parseConf(read(`default/${f}`), f)])
);

/* ---------------------------------------------------------------- XML (well-formedness only) */
function parseXml(text, file) {
  const stack = [];
  const elements = [];
  let root = null;
  const checkText = (s, where) => {
    assert.ok(!/</.test(s), `${file}: stray < in ${where}`);
    assert.ok(!/&(?!(?:lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(s), `${file}: bare & in ${where}`);
  };
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([A-Za-z_][\w.-]*)\s*>|<([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  let at = 0;
  while ((m = re.exec(text))) {
    assert.equal(m.index, at, `${file}: can't parse at ${JSON.stringify(text.slice(at, at + 40))}`);
    at = re.lastIndex;
    const [all, cdata, close, open, attrs, selfClose, chars] = m;
    if (all.startsWith("<!--")) continue;
    if (cdata !== undefined || chars !== undefined) {
      if (chars !== undefined) checkText(chars, stack.at(-1)?.name || "the prolog");
      if (stack.length) stack.at(-1).text += cdata ?? chars;
      else assert.ok(!(chars || "").trim(), `${file}: text outside the root element`);
      continue;
    }
    if (close) {
      const el = stack.pop();
      assert.equal(el?.name, close, `${file}: </${close}> closes <${el?.name}>`);
      continue;
    }
    const attributes = {};
    for (const a of attrs.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      assert.ok(!(a[1] in attributes), `${file}: ${a[1]} twice on <${open}>`);
      checkText(a[2] ?? a[3], `the ${a[1]} attribute`);
      attributes[a[1]] = (a[2] ?? a[3]).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    }
    const el = { name: open, attributes, text: "", parent: stack.at(-1) || null, children: [] };
    if (el.parent) el.parent.children.push(el);
    else {
      assert.equal(root, null, `${file}: more than one root element`);
      root = el;
    }
    elements.push(el);
    if (!selfClose) stack.push(el);
  }
  assert.equal(at, text.length, `${file}: unparsed text at the end`);
  assert.equal(stack.length, 0, `${file}: <${stack.at(-1)?.name}> is never closed`);
  return { root, elements };
}
const dashboards = Object.fromEntries(views.map((f) => [f.replace(".xml", ""), parseXml(read(`${VIEWS}/${f}`), f)]));
const nav = parseXml(read("default/data/ui/nav/default.xml"), "nav/default.xml");

/* ---------------------------------------------------------------- searches */
const dashboardSearches = () =>
  Object.entries(dashboards).flatMap(([name, { elements }]) => elements.filter((e) => e.name === "query").map((e) => ({ where: name, spl: e.text })));
const allSearches = () => [
  ...Object.entries(conf.savedsearches).filter(([n]) => n !== TOP).map(([name, s]) => ({ where: name, spl: s.search })),
  ...Object.entries(conf.macros).filter(([n]) => n !== TOP).map(([name, s]) => ({ where: `macro ${name}`, spl: s.definition })),
  ...Object.entries(conf.eventtypes).filter(([n]) => n !== TOP).map(([name, s]) => ({ where: `eventtype ${name}`, spl: s.search })),
  ...dashboardSearches()
];
// dashboard tokens ($code|s$, $time.earliest$) stand in as a quoted value, $$ as a literal $
const withoutTokens = (spl) => spl.replace(/\$\$/g, "").replace(/\$[\w.:]+(\|[a-z]+)?\$/g, '"X"');

function assertBalanced(spl, where) {
  const stack = [];
  const pairs = { ")": "(", "]": "[" };
  let quote = null;
  for (let i = 0; i < spl.length; i++) {
    const c = spl[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") stack.push(c);
    else if (c in pairs) assert.equal(stack.pop(), pairs[c], `${where}: unbalanced ${c}`);
  }
  assert.equal(quote, null, `${where}: unclosed ${quote} quote`);
  assert.deepEqual(stack, [], `${where}: unclosed ${stack.join("")}`);
}

test("every .conf file parses; app.conf names the app and one version", () => {
  assert.equal(conf.app.package.id, APP_NAME);
  assert.equal(conf.app.id.name, APP_NAME);
  assert.match(appVersion(), /^\d+\.\d+\.\d+$/);
  parseConf(read("metadata/default.meta"), "default.meta");
  assert.ok(!readdirSync(APP_DIR).includes("local"), "no local/ folder: it would override the user's settings");
});

test("dashboards are Simple XML 1.1 forms, and the nav lists only views that exist", () => {
  for (const [name, { root }] of Object.entries(dashboards)) {
    assert.ok(["form", "dashboard"].includes(root.name), name);
    assert.equal(root.attributes.version, "1.1", `${name}: version="1.1" (jQuery 3.5)`);
    assert.ok(root.children.some((c) => c.name === "label"), `${name} has a label`);
  }
  assert.equal(nav.root.name, "nav");
  const builtIn = new Set(["search", "alerts", "reports", "dashboards"]);
  for (const v of nav.elements.filter((e) => e.name === "view")) {
    assert.ok(builtIn.has(v.attributes.name) || dashboards[v.attributes.name], `nav view ${v.attributes.name}`);
  }
  // every dashboard is reachable from the nav
  for (const name of Object.keys(dashboards)) assert.ok(nav.elements.some((e) => e.attributes.name === name), `${name} in the nav`);
});

test("every macro, lookup and linked view the app uses is defined", () => {
  const macros = new Set(Object.keys(conf.macros));
  const lookups = new Set(Object.keys(conf.transforms));
  for (const { where, spl } of allSearches()) {
    for (const [, name, args] of spl.matchAll(/`([\w]+)(?:\(([^`]*)\))?`/g)) {
      const arity = args === undefined ? 0 : args.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).length;
      assert.ok(macros.has(arity ? `${name}(${arity})` : name), `${where}: macro ${name}${arity ? `(${arity})` : ""}`);
    }
    // the table is the first bare word after the command's key=value options
    for (const [, name] of spl.matchAll(/\b(?:input|output)?lookup(?:\s+\w+=\S+)*\s+(\w+)/g)) assert.ok(lookups.has(name), `${where}: lookup ${name}`);
    assert.ok(!/outputlookup\s+\w+\s+\w+=/.test(spl), `${where}: outputlookup options go before the table name`);
  }
  for (const [name, stanza] of Object.entries(conf.transforms)) {
    if (stanza.filename) statSync(join(APP_DIR, "lookups", stanza.filename));
    if (stanza.collection) assert.ok(conf.collections[stanza.collection], `${name}: collection ${stanza.collection}`);
  }
  for (const [name, { elements }] of Object.entries(dashboards)) {
    for (const link of elements.filter((e) => e.name === "link")) {
      const view = link.text.trim().split("?")[0];
      assert.ok(dashboards[view], `${name}: link to ${view}`);
    }
    for (const a of elements.filter((e) => e.name === "a" && !/^https:/.test(e.attributes.href))) {
      assert.ok(dashboards[a.attributes.href], `${name}: link to ${a.attributes.href}`);
    }
  }
});

test("every dashboard token is set by an input, <init>, <set> or <eval>, and no stray $ is left", () => {
  for (const [name, { elements }] of Object.entries(dashboards)) {
    const defined = new Set();
    for (const e of elements) {
      if (e.name === "input") {
        defined.add(e.attributes.token);
        if (e.attributes.type === "time") ["earliest", "latest"].forEach((p) => defined.add(`${e.attributes.token}.${p}`));
      }
      if (["set", "eval"].includes(e.name)) defined.add(e.attributes.token.replace(/^form\./, ""));
    }
    const builtIn = /^(env:|job\.|result\.|row\.|click\.|form\.)|^(value|label)$/;
    for (const e of elements) {
      const texts = [e.text, ...Object.values(e.attributes)];
      for (const t of texts) {
        for (const [, token] of t.matchAll(/\$([\w.:]+)(?:\|[a-z]+)?\$/g)) {
          assert.ok(defined.has(token) || builtIn.test(token), `${name}: $${token}$ is never set`);
        }
        const stray = t.replace(/\$\$/g, "").replace(/\$[\w.:]+(\|[a-z]+)?\$/g, "");
        assert.ok(!stray.includes("$"), `${name}: a lone $ in ${JSON.stringify(t.slice(0, 80))} (write $$ for a literal $)`);
      }
    }
  }
});

test("every search has balanced quotes, parentheses and brackets", () => {
  for (const { where, spl } of allSearches()) {
    assert.ok(spl && spl.trim(), `${where}: empty search`);
    assertBalanced(withoutTokens(spl), where);
  }
});

test("scheduled alerts have a schedule, a time range and a trigger", () => {
  for (const [name, s] of Object.entries(conf.savedsearches).filter(([n]) => n !== TOP)) {
    assert.equal(s.enableSched, "1", name);
    assert.equal(s.cron_schedule.split(/\s+/).length, 5, `${name}: cron`);
    assert.ok(s["dispatch.earliest_time"], `${name}: earliest`);
    assert.deepEqual([s.counttype, s.relation, s.quantity], ["number of events", "greater than", "0"], `${name}: trigger`);
  }
});

test("the dashboard's save and the ptf_research_set macro write the same record with the same statuses", () => {
  const save = dashboardSearches().find((s) => s.where === "ptf_research_code" && /outputlookup/.test(s.spl)).spl;
  const macro = conf.macros["ptf_research_set(5)"].definition;
  const statuses = (spl) => spl.match(/in\(status, ([^)]*)\)/)[1];
  assert.equal(statuses(save), statuses(macro));
  const queue = conf.savedsearches["Flag That Plate - New codes to research"].search;
  const columns = (spl) => spl.match(/\| table ([^|\n]*)/)[1].trim();
  assert.equal(columns(save), columns(macro));
  assert.equal(columns(queue), columns(macro));
  assert.equal(conf.transforms.ptf_research.fields_list.replace(/\s/g, ""), columns(macro).replace(/ /g, ","));
  // the queue's statuses are the ones the dashboards offer
  const choices = (view, token) => dashboards[view].elements.filter((e) => e.name === "choice" && e.parent.attributes.token === token).map((e) => e.attributes.value);
  assert.equal(choices("ptf_research_code", "new_status").map((c) => `"${c}"`).join(", "), statuses(macro));
  // the queue's filter offers each status alone, plus "Still open" and "All", which is every status
  const filters = choices("ptf_research_queue", "status");
  for (const status of statuses(macro).split(", ")) assert.ok(filters.includes(status), `the queue can filter on ${status}`);
  assert.ok(filters.includes(statuses(macro)), "All lists every status");
});

test("the lookups match plates.csv (node splunk/build.mjs regenerates them)", () => {
  assert.deepEqual(staleLookups(), []);
  const rows = read("lookups/ptf_plate_codes.csv").trim().split("\n");
  assert.equal(rows[0], "plate_code,base_code,role_letter,mission_role,country");
  assert.ok(rows.includes("DAF,AF,D,Diplomat,Japan"));
  assert.ok(rows.includes("AFD,AF,D,UN Diplomat,Japan"));
  assert.ok(rows.includes("QX,QX,,,Pakistan") && rows.includes("QX,QX,,,Iran (DC only)"), "shared codes keep both rows");
});

test("the package is the app folder, every file in it, in a fixed order", () => {
  const archive = tarGz(appEntries());
  assert.deepEqual(archive, tarGz(appEntries()), "two builds are identical");
  const tar = gunzipSync(archive);
  const names = [];
  for (let off = 0; off + 512 <= tar.length; ) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.subarray(0, 100).toString().replace(/\0.*$/s, "");
    const size = parseInt(h.subarray(124, 136).toString(), 8);
    const sum = h.reduce((s, b, i) => s + (i >= 148 && i < 156 ? 32 : b), 0);
    assert.equal(parseInt(h.subarray(148, 156).toString(), 8), sum, `${name}: header checksum`);
    assert.equal(h.subarray(257, 263).toString(), "ustar\0");
    names.push(name);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(names.every((n) => n.startsWith(`${APP_NAME}/`)), "one top-level folder, named as the app");
  assert.ok(!names.some((n) => /\/\./.test(n)), "no hidden files");
  for (const f of ["default/app.conf", "metadata/default.meta", "static/appIcon.png", "static/appIcon_2x.png", "README.md", "lookups/ptf_plate_codes.csv"]) {
    assert.ok(names.includes(`${APP_NAME}/${f}`), f);
  }
});

test("the app icons are the sizes Splunk expects", () => {
  const size = (f) => {
    const png = readFileSync(join(APP_DIR, "static", f));
    assert.equal(png.subarray(1, 4).toString(), "PNG", f);
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
  };
  assert.deepEqual(size("appIcon.png"), [36, 36]);
  assert.deepEqual(size("appIconAlt.png"), [36, 36]);
  assert.deepEqual(size("appIcon_2x.png"), [72, 72]);
  assert.deepEqual(size("appIconAlt_2x.png"), [72, 72]);
});

/* ---------------------------------------------------------------- a small SPL eval evaluator */
// Enough of eval for ptf_plate_parts: strings, numbers, fields, . + - == != < <= > >= AND OR NOT,
// and the functions below, with Splunk's null rules (a comparison with null is null, and only a
// true condition counts in if() and case()).
function splEval(source, fields) {
  const tokens = [...source.matchAll(/\s*("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z_][\w.]*|\d+(?:\.\d+)?|==|!=|<=|>=|[-+*/.,()<>=])/gy)].map((m) => m[1]);
  assert.equal(tokens.join("").replace(/\s/g, ""), source.replace(/\s/g, ""), "the evaluator read the whole expression");
  let i = 0;
  const peek = () => tokens[i];
  const take = (t) => {
    assert.equal(tokens[i], t, `expected ${t} at token ${i}: ${tokens.slice(i, i + 5).join(" ")}`);
    i++;
  };
  const FUNCS = {
    upper: (s) => (s == null ? null : String(s).toUpperCase()),
    lower: (s) => (s == null ? null : String(s).toLowerCase()),
    trim: (s) => (s == null ? null : String(s).trim()),
    replace: (s, re, to) => (s == null ? null : String(s).replace(new RegExp(re, "g"), to)),
    substr: (s, start, len) => {
      if (s == null) return null;
      const str = String(s);
      const from = start > 0 ? start - 1 : Math.max(0, str.length + start);
      return len == null ? str.slice(from) : str.slice(from, from + len);
    },
    len: (s) => (s == null ? null : String(s).length),
    match: (s, re) => (s == null ? null : new RegExp(re).test(String(s))),
    coalesce: (...a) => a.find((v) => v != null) ?? null,
    null: () => null,
    true: () => true,
    false: () => false
  };
  const LAZY = {
    if: (args) => (expr(args[0]) === true ? expr(args[1]) : expr(args[2])),
    case: (args) => {
      for (let k = 0; k + 1 < args.length; k += 2) if (expr(args[k]) === true) return expr(args[k + 1]);
      return null;
    }
  };
  // parse to closures, evaluate on demand (if and case only evaluate the branch they pick)
  const expr = (node) => node();
  function parseOr() {
    let left = parseAnd();
    while (peek() === "OR") {
      i++;
      const l = left, r = parseAnd();
      left = () => { const a = l(), b = r(); return a === true || b === true ? true : a === false && b === false ? false : null; };
    }
    return left;
  }
  function parseAnd() {
    let left = parseNot();
    while (peek() === "AND") {
      i++;
      const l = left, r = parseNot();
      left = () => { const a = l(), b = r(); return a === false || b === false ? false : a === true && b === true ? true : null; };
    }
    return left;
  }
  function parseNot() {
    if (peek() === "NOT") {
      i++;
      const inner = parseNot();
      return () => { const v = inner(); return v == null ? null : !v; };
    }
    return parseCompare();
  }
  function parseCompare() {
    const left = parseAdd();
    const op = peek();
    if (!["==", "=", "!=", "<", "<=", ">", ">="].includes(op)) return left;
    i++;
    const right = parseAdd();
    return () => {
      const a = left(), b = right();
      if (a == null || b == null) return null;
      switch (op) {
        case "==": case "=": return a === b;
        case "!=": return a !== b;
        case "<": return a < b;
        case "<=": return a <= b;
        case ">": return a > b;
        default: return a >= b;
      }
    };
  }
  function parseAdd() {
    let left = parsePrimary();
    while ([".", "+", "-"].includes(peek())) {
      const op = tokens[i++];
      const l = left, r = parsePrimary();
      left = () => {
        const a = l(), b = r();
        if (a == null || b == null) return null;
        return op === "." ? `${a}${b}` : op === "+" ? a + b : a - b;
      };
    }
    return left;
  }
  function parseArgs() {
    take("(");
    const args = [];
    while (peek() !== ")") {
      args.push(parseOr());
      if (peek() === ",") i++;
    }
    take(")");
    return args;
  }
  function parsePrimary() {
    const t = tokens[i++];
    if (t === "(") {
      const inner = parseOr();
      take(")");
      return inner;
    }
    if (t.startsWith('"')) {
      const value = JSON.parse(t);
      return () => value;
    }
    if (/^\d/.test(t)) return () => Number(t);
    if (peek() === "(") {
      const args = parseArgs();
      if (LAZY[t]) return () => LAZY[t](args);
      assert.ok(FUNCS[t], `the evaluator doesn't know ${t}()`);
      return () => FUNCS[t](...args.map((a) => a()));
    }
    const field = t.replace(/^'|'$/g, "");
    return () => fields[field] ?? null;
  }
  // eval a=..., b=...: each assignment sees the ones before it
  assert.match(source, /^eval\s/);
  i = 1;
  while (i < tokens.length) {
    const name = tokens[i++];
    take("=");
    const value = parseOr()();
    if (value == null) delete fields[name];
    else fields[name] = value;
    if (peek() === ",") i++;
  }
  return fields;
}

test("the ptf_plate_parts macro reads plates the way the site does", () => {
  const definition = conf.macros.ptf_plate_parts.definition;
  const plates = new Set(["", "DGK 0001", "dgk-0001", "1034 CZD", "1034 CYD", "CZD 1034", "SGK", "GK", "ZZ 1234", "XQZ", "D1AF", "DGK 00001", "A", "12", "ABCD 12", "DAF 0789", "0789 AFD", "EAB 1234", "Q", "🦊 DAF 0789"]);
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let n = 0; n < 1500; n++) {
    const letters = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => L[Math.floor(rand() * 26)]).join("");
    const digits = String(Math.floor(rand() * 100000)).slice(0, Math.floor(rand() * 6));
    plates.add(rand() < 0.15 ? `${letters[0]}${digits}${letters.slice(1)}` : rand() < 0.5 ? letters + digits : digits + letters);
  }
  for (const plate of plates) {
    const spl = splEval(definition, { plate });
    const js = plateParts(plate);
    const got = {
      code: spl.code ?? "",
      letters: spl.letters ?? "",
      role_letter: spl.role_letter ?? "",
      mission_role: spl.mission_role ?? "",
      serial: spl.serial ?? "",
      layout: spl.layout,
      plate_shaped: spl.plate_shaped === "true"
    };
    const want = { code: js.code, letters: js.letters, role_letter: js.role_letter, mission_role: js.mission_role, serial: js.serial, layout: js.layout, plate_shaped: js.plate_shaped };
    assert.deepEqual(got, want, `plate ${JSON.stringify(plate)}`);
    assert.ok(!("ptf_p" in spl) && !("ptf_at" in spl), "the macro's working fields are removed");
  }
  // a lookup's own role (from plates.csv) is kept
  assert.equal(splEval(definition, { plate: "EAB1234", mission_role: "Staff" }).mission_role, "Staff");
});
