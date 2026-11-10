// Builds the Flag That Plate Splunk app (splunk/flag_that_plate):
//   1. regenerates its lookups: ptf_plate_codes.csv from plates.csv, ptf_letter_confusions.csv
//   2. packages the app as splunk/dist/flag_that_plate-<version>.spl, the .tar.gz that
//      Apps > Manage Apps > Install app from file takes
//
//   node splunk/build.mjs           lookups, then the package
//   node splunk/build.mjs --check   only check that the lookups match plates.csv (exit 1 if not)
//
// Node 22 or newer, no dependencies. The package is byte-for-byte reproducible: entries are sorted,
// and every one gets the same owner, mode and time.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { splitDesc, ROLE_INFO } from "../assets/js/plates.js";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, "..");
export const APP_NAME = "flag_that_plate";
export const APP_DIR = join(here, APP_NAME);
const LOOKUPS = join(APP_DIR, "lookups");

/* ---------------------------------------------------------------- lookups */
function csvField(value) {
  const s = String(value ?? "");
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (rows) => rows.map((row) => row.map(csvField).join(",")).join("\n") + "\n";

/**
 * Every row of plates.csv with its parts, the way the site reads it (assets/js/plates.js):
 * DAF,Japan Diplomat -> DAF, AF, D, Diplomat, Japan. Shared codes keep every row.
 */
export function plateCodesCsv(platesCsv) {
  const rows = [["plate_code", "base_code", "role_letter", "mission_role", "country"]];
  for (const line of platesCsv.split(/\r?\n/)) {
    const comma = line.indexOf(",");
    if (comma < 0) continue;
    const code = line.slice(0, comma).trim().toUpperCase();
    const desc = line.slice(comma + 1).trim();
    if (!code) continue;
    const { country, role } = splitDesc(desc);
    const info = ROLE_INFO[role];
    let base = code;
    let letter = "";
    if (info && code.length === 3 && info.position === "prefix") {
      letter = code[0];
      base = code.slice(1);
    } else if (info && code.length === 3 && info.position === "suffix") {
      letter = code[2];
      base = code.slice(0, 2);
    }
    rows.push([code, base, letter, role, country]);
  }
  return toCsv(rows);
}

// letters a stamped plate, a photo or a hurried reader can mix up
const LOOKALIKE = ["OD", "OQ", "DQ", "CG", "CO", "GO", "IJ", "IL", "IT", "JT", "UV", "VY", "BR", "BE", "EF", "FP", "PR", "MN", "MW", "HN", "HK", "KX", "XY"];
// neighbours on a QWERTY keyboard, for typos
const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

/** letter,other,why: "the code has <letter> where a listed code has <other>", both ways round. */
export function confusionsCsv() {
  const why = new Map();
  const add = (a, b, reason) => {
    for (const key of [a + b, b + a]) {
      if (!why.has(key)) why.set(key, new Set());
      why.get(key).add(reason);
    }
  };
  for (const [a, b] of LOOKALIKE) add(a, b, "looks alike");
  for (const row of KEY_ROWS) for (let i = 0; i + 1 < row.length; i++) add(row[i], row[i + 1], "next key");
  const rows = [["letter", "other", "why"]];
  for (const key of [...why.keys()].sort()) rows.push([key[0], key[1], [...why.get(key)].sort().join(" and ")]);
  return toCsv(rows);
}

export function lookups() {
  return {
    "ptf_plate_codes.csv": plateCodesCsv(readFileSync(join(ROOT, "plates.csv"), "utf8")),
    "ptf_letter_confusions.csv": confusionsCsv()
  };
}

/** Names of the lookup files that differ from what plates.csv gives now. */
export function staleLookups() {
  return Object.entries(lookups())
    .filter(([name, text]) => {
      try {
        return readFileSync(join(LOOKUPS, name), "utf8") !== text;
      } catch {
        return true;
      }
    })
    .map(([name]) => name);
}

/* ---------------------------------------------------------------- package */
export function appVersion() {
  const conf = readFileSync(join(APP_DIR, "default", "app.conf"), "utf8");
  const stanza = (name) => conf.split(/^\[/m).find((s) => s.startsWith(`${name}]`)) || "";
  const value = (name) => (stanza(name).match(/^version\s*=\s*(\S+)/m) || [])[1];
  const launcher = value("launcher");
  const id = value("id");
  if (!launcher || launcher !== id) throw new Error(`app.conf: [launcher] version ${launcher} and [id] version ${id} must match`);
  return launcher;
}

/** Every file and folder of the app, parents first, sorted; dotfiles are left out. */
export function appEntries(dir = APP_DIR) {
  const out = [];
  const walk = (path) => {
    for (const name of readdirSync(path).sort()) {
      if (name.startsWith(".")) continue;
      const full = join(path, name);
      const rel = `${APP_NAME}/${relative(APP_DIR, full).split(sep).join("/")}`;
      if (statSync(full).isDirectory()) {
        out.push({ name: `${rel}/`, dir: true });
        walk(full);
      } else {
        out.push({ name: rel, data: readFileSync(full) });
      }
    }
  };
  out.push({ name: `${APP_NAME}/`, dir: true });
  walk(dir);
  return out;
}

const MTIME = Math.floor(Date.UTC(2026, 10, 8) / 1000);

function header({ name, size, dir }) {
  const h = Buffer.alloc(512);
  if (Buffer.byteLength(name) > 100) throw new Error(`path too long for the archive: ${name}`);
  const octal = (n, width) => n.toString(8).padStart(width - 1, "0") + "\0";
  h.write(name, 0, 100, "utf8");
  h.write(octal(dir ? 0o755 : 0o644, 8), 100, 8, "ascii");
  h.write(octal(0, 8), 108, 8, "ascii"); // uid
  h.write(octal(0, 8), 116, 8, "ascii"); // gid
  h.write(octal(size, 12), 124, 12, "ascii");
  h.write(octal(MTIME, 12), 136, 12, "ascii");
  h.write(" ".repeat(8), 148, 8, "ascii"); // checksum, counted as spaces
  h.write(dir ? "5" : "0", 156, 1, "ascii");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  let sum = 0;
  for (const byte of h) sum += byte;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return h;
}

/** A gzipped POSIX tar of the entries. */
export function tarGz(entries) {
  const blocks = [];
  for (const entry of entries) {
    const size = entry.dir ? 0 : entry.data.length;
    blocks.push(header({ name: entry.name, size, dir: entry.dir }));
    if (!entry.dir) {
      blocks.push(entry.data);
      if (size % 512) blocks.push(Buffer.alloc(512 - (size % 512)));
    }
  }
  blocks.push(Buffer.alloc(1024)); // two empty blocks end the archive
  return gzipSync(Buffer.concat(blocks), { level: 9 });
}

/* ---------------------------------------------------------------- command line */
function main() {
  if (process.argv.includes("--check")) {
    const stale = staleLookups();
    if (stale.length) {
      console.error(`Out of date with plates.csv: ${stale.join(", ")}. Run: node splunk/build.mjs`);
      process.exit(1);
    }
    console.log("Lookups match plates.csv.");
    return;
  }
  mkdirSync(LOOKUPS, { recursive: true });
  for (const [name, text] of Object.entries(lookups())) {
    writeFileSync(join(LOOKUPS, name), text);
    console.log(`wrote ${relative(ROOT, join(LOOKUPS, name))} (${text.split("\n").length - 2} rows)`);
  }
  const version = appVersion();
  const dist = join(here, "dist");
  mkdirSync(dist, { recursive: true });
  const file = join(dist, `${APP_NAME}-${version}.spl`);
  const archive = tarGz(appEntries());
  writeFileSync(file, archive);
  console.log(`wrote ${relative(ROOT, file)} (${archive.length} bytes)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
