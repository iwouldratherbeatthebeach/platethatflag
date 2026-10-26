// Run with: node --test tests/*.test.mjs
// Checks that the rewritten decoder (assets/js/plates.js) gives the same answers as the code that
// shipped before the redesign, for every code in plates.csv and a spread of plate shapes, with one
// deliberate fix: a plate's letters must be one whole code (DGK 0001 no longer decodes as DG).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parsePlates, extractCode, splitDesc, normalizePlate, decodePlate, isFullPlate, formatPlate,
  displayCountry, wikiTitle, extractPlateCandidateFromText, countBaseCodes, flagSources, letterBlock
} from "../assets/js/plates.js";

const csv = readFileSync(new URL("../plates.csv", import.meta.url), "utf8");
const index = parsePlates(csv);

/* ---- the previous implementation, copied from index.html at be857cb ---- */
const legacy = (() => {
  const mapping = {};
  csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line) => {
    const parts = line.split(",");
    const code = parts.shift();
    const desc = parts.join(",").trim();
    if (code) mapping[code.trim().toUpperCase()] = desc;
  });
  const normalizePlateInput = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  function extract(value) {
    const cleaned = normalizePlateInput(value);
    const lettersOnly = cleaned.replace(/[0-9]/g, "");
    const knownCodes = Object.keys(mapping).sort((a, b) => b.length - a.length);
    return (
      knownCodes.find((code) => cleaned.startsWith(code)) ||
      knownCodes.find((code) => cleaned.endsWith(code)) ||
      knownCodes.find((code) => lettersOnly.includes(code)) ||
      null
    );
  }
  function split(desc) {
    const m = desc.match(/^(.+?)\s+(UN Diplomat|Consul|Diplomat|Staff)$/);
    if (m) return { country: m[1], role: m[2] };
    return { country: desc, role: "" };
  }
  function ocr(text) {
    if (!text) return "";
    const upper = String(text).toUpperCase();
    const normalizeDigits = (s) => s.replace(/O/g, "0").replace(/Q/g, "0").replace(/I/g, "1").replace(/L/g, "1").replace(/S/g, "5");
    const cleaned = upper.replace(/[^A-Z0-9]/g, "");
    const candidates = [
      cleaned.match(/([A-Z]{3})([0-9OQILS]{4})/),
      cleaned.match(/([A-Z]{2})([0-9OQILS]{4})/),
      cleaned.match(/([0-9OQILS]{4})([A-Z]{3})/),
      cleaned.match(/([0-9OQILS]{4})([A-Z]{2})/)
    ].filter(Boolean);
    if (!candidates.length) return "";
    const m = candidates[0];
    if (/^[A-Z]/.test(m[1])) return `${m[1]}${normalizeDigits(m[2])}`;
    return `${normalizeDigits(m[1])}${m[2]}`;
  }
  return { mapping, extract, split, ocr, normalizePlateInput };
})();

function samplePlates() {
  const out = new Set(["", "1234", "dbb 0789", "DAF-0789", "  daf0789 ", "QX", "qx 1234", "TF", "XQZ", "ZZZ9999", "D1AF", "0789DAF", "0789AFD", "AF", "A", "🦊 DAF 0789"]);
  for (const code of index.map.keys()) {
    out.add(code);
    out.add(`${code}0789`);
    out.add(`${code} 4417`);
    out.add(`1204${code}`);
    out.add(code.toLowerCase());
  }
  // deterministic pseudo-random plates
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let i = 0; i < 3000; i++) {
    const n = 1 + Math.floor(rand() * 3);
    let s = "";
    for (let j = 0; j < n; j++) s += letters[Math.floor(rand() * 26)];
    const digits = String(Math.floor(rand() * 10000)).padStart(4, "0");
    out.add(rand() < 0.5 ? s + digits : digits + s);
  }
  return [...out];
}

test("parses every row of plates.csv", () => {
  assert.equal(index.map.size, Object.keys(legacy.mapping).length);
  for (const [code, desc] of Object.entries(legacy.mapping)) assert.equal(index.map.get(code), desc);
});

test("extractCode matches the previous decoder, except that a plate's letters must be one whole code", () => {
  let fixed = 0;
  for (const plate of samplePlates()) {
    const block = letterBlock(plate);
    const before = legacy.extract(plate);
    if (block && before !== block) {
      // the old decoder matched part of the letters (DGK 0001 -> DG): now there is no code
      assert.equal(extractCode(plate, index), null, `plate ${JSON.stringify(plate)}`);
      fixed++;
    } else {
      assert.equal(extractCode(plate, index), before, `plate ${JSON.stringify(plate)}`);
    }
  }
  assert.ok(fixed > 100, `${fixed} sample plates changed`);
});

test("splitDesc and normalization match the previous decoder", () => {
  for (const desc of Object.values(legacy.mapping)) assert.deepEqual(splitDesc(desc), legacy.split(desc));
  for (const value of ["dbb 0789", "D-A-F", "", null, "✓AF"]) assert.equal(normalizePlate(value), legacy.normalizePlateInput(value));
});

test("wherever a code is found, the tracked country string is unchanged (stats keep aggregating under the same key)", () => {
  for (const plate of samplePlates()) {
    const code = extractCode(plate, index);
    if (!code) continue;
    assert.equal(code, legacy.extract(plate));
    const expected = legacy.split(legacy.mapping[code]);
    const decoded = decodePlate(plate, index);
    assert.equal(decoded.country, expected.country);
    assert.equal(decoded.role, expected.role);
  }
});

test("a plate whose letters are not a listed code keeps its role letter", () => {
  const parts = ({ code, prefix, countryCode, suffix, serial, country, role }) => ({ code, prefix, countryCode, suffix, serial, country, role });
  assert.equal(index.map.has("GK"), false);
  assert.equal(extractCode("DGK 0001", index), null);
  assert.deepEqual(parts(decodePlate("DGK 0001", index)), { code: null, prefix: "D", countryCode: "GK", suffix: "", serial: "0001", country: "", role: "Diplomat" });
  assert.deepEqual(parts(decodePlate("0001 GKD", index)), { code: null, prefix: "", countryCode: "GK", suffix: "D", serial: "0001", country: "", role: "UN Diplomat" });
  assert.deepEqual(parts(decodePlate("SGK", index)), { code: null, prefix: "S", countryCode: "GK", suffix: "", serial: "", country: "", role: "Staff" });
  assert.equal(index.map.has("ZZ"), false);
  assert.deepEqual(parts(decodePlate("ZZ 1234", index)), { code: null, prefix: "", countryCode: "ZZ", suffix: "", serial: "1234", country: "", role: "" });
  // listed codes are unaffected: DG alone is still Ecuador, DDG still an Ecuadorian diplomat
  assert.equal(decodePlate("DG 0001", index).country, "Ecuador");
  assert.deepEqual(parts(decodePlate("DDG 0001", index)), { code: "DDG", prefix: "D", countryCode: "DG", suffix: "", serial: "0001", country: "Ecuador", role: "Diplomat" });
});

test("decodePlate splits role letter, country code and serial", () => {
  assert.deepEqual(
    (({ code, prefix, countryCode, suffix, serial, country, role }) => ({ code, prefix, countryCode, suffix, serial, country, role }))(decodePlate("DAF 0789", index)),
    { code: "DAF", prefix: "D", countryCode: "AF", suffix: "", serial: "0789", country: "Japan", role: "Diplomat" }
  );
  const un = decodePlate("AFD 1120", index);
  assert.equal(un.role, "UN Diplomat");
  assert.equal(un.countryCode, "AF");
  assert.equal(un.suffix, "D");
  assert.equal(un.serial, "1120");
  const base = decodePlate("af", index);
  assert.equal(base.countryCode, "AF");
  assert.equal(base.role, "");
  assert.equal(decodePlate("ZZQ9", index).code, null);
});

test("shared codes keep the last row as the answer and list the others", () => {
  const qx = decodePlate("QX", index);
  assert.equal(qx.country, "Iran (DC only)");
  assert.deepEqual(qx.alternates.map((a) => a.country), ["Pakistan"]);
});

test("plates print the way they are stamped", () => {
  assert.equal(formatPlate("daf-0789"), "DAF 0789");
  assert.equal(formatPlate("0789DAF"), "0789 DAF");
  assert.equal(formatPlate("QX"), "QX");
  assert.equal(formatPlate("D1AF"), "D1AF"); // mixed: left as typed
});

test("display names", () => {
  assert.equal(displayCountry("Republic of Macedonia|Macedonia"), "Republic of Macedonia");
  assert.equal(displayCountry("UNKNOWN"), "Unknown");
  assert.equal(wikiTitle("Iran (DC only)"), "Iran");
  assert.equal(wikiTitle("Cuba (UN only)"), "Cuba");
  assert.equal(isFullPlate("DAF 0789"), true);
  assert.equal(isFullPlate("DAF"), false);
});

test("OCR candidate extraction matches the previous implementation", () => {
  const samples = ["DAF 0789", "DIPLOMAT\nDAF O789\nDEPARTMENT", "0789 DAF", "QX 1Z34", "no plate here", "", "D A F 0 7 8 9", "sAF5S1O"];
  for (const s of samples) assert.equal(extractPlateCandidateFromText(s), legacy.ocr(s), JSON.stringify(s));
});

test("counts and flag sources", () => {
  // 215 two-letter rows, two of them (QX, TF) shared by two missions
  assert.equal(countBaseCodes(index), 213);
  assert.deepEqual(flagSources("JP"), ["https://flags.restcountries.com/v5/svg/jp.svg", "https://flagcdn.com/jp.svg"]);
  assert.deepEqual(flagSources(null), []);
  assert.deepEqual(flagSources("<x>"), []);
});
