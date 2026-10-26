// Flag That Plate — plate data and decoding.
// Pure functions, no DOM: shared by the decoder page, the leaderboard, the about page and the tests.
// The matching rules are the ones the site has always used, so a plate decodes to the same country
// and role (and is tracked under the same country string) as before, with one fix: a plate's
// letters must be one whole code. DGK 0001 used to borrow DG (Ecuador) from inside its letters.

export const ROLES = ["UN Diplomat", "Consul", "Diplomat", "Staff"];

export const ROLE_INFO = {
  Diplomat: {
    word: "Diplomat",
    band: "Diplomat",
    letter: "D",
    position: "prefix",
    plate: "a diplomat's plate",
    question: "What a diplomat does",
    text: "Represents the home government in formal relations with the host country."
  },
  Consul: {
    word: "Consul",
    band: "Consul",
    letter: "C",
    position: "prefix",
    plate: "a consul's plate",
    question: "What a consul does",
    text: "Helps citizens abroad with passports, visas, legal paperwork and emergencies."
  },
  Staff: {
    word: "Staff",
    band: "Staff",
    letter: "S",
    position: "prefix",
    plate: "a mission staff plate",
    question: "What mission staff do",
    text: "Supports embassy or mission operations such as administration, logistics and protocol."
  },
  "UN Diplomat": {
    word: "UN diplomat",
    band: "UN Diplomat",
    letter: "D",
    position: "suffix",
    plate: "a UN diplomat's plate",
    question: "What a UN diplomat does",
    text: "Represents a country in multilateral diplomacy at the United Nations."
  }
};

/** Uppercase and strip everything that is not A-Z or 0-9 ("dbb 0789" -> "DBB0789"). */
export function normalizePlate(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** "Barbados Diplomat" -> { country: "Barbados", role: "Diplomat" }. */
export function splitDesc(desc) {
  const m = String(desc || "").match(/^(.+?)\s+(UN Diplomat|Consul|Diplomat|Staff)$/);
  if (m) return { country: m[1], role: m[2] };
  return { country: String(desc || ""), role: "" };
}

/**
 * Parse plates.csv ("CODE,Description" per line) into an index.
 * As before, a code that appears twice resolves to its last row; the earlier rows are kept as
 * `alternates` so the page can say that a code is shared (QX: Pakistan and Iran (DC only)).
 */
export function parsePlates(csv) {
  const map = new Map();
  const alternates = new Map();

  String(csv || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const parts = line.split(",");
      const rawCode = parts.shift();
      const desc = parts.join(",").trim();
      if (!rawCode) return;
      const code = rawCode.trim().toUpperCase();
      if (!code) return;
      if (map.has(code)) {
        const list = alternates.get(code) || [];
        list.push(map.get(code));
        alternates.set(code, list);
      }
      map.set(code, desc); // a Map keeps the first insertion position, like the old object did
    });

  // longest codes first; equal lengths keep file order (Array.prototype.sort is stable)
  const codes = [...map.keys()].sort((a, b) => b.length - a.length);
  return { map, alternates, codes };
}

/**
 * The letters of a plate-shaped value: 2 or 3 letters, alone or before or after the serial
 * ("DAF 0789" -> "DAF", "0789 AFD" -> "AFD", "QX" -> "QX"). Anything else -> null.
 */
export function letterBlock(value) {
  const cleaned = normalizePlate(value);
  const m = cleaned.match(/^([A-Z]{2,3})[0-9]*$/) || cleaned.match(/^[0-9]+([A-Z]{2,3})$/);
  return m ? m[1] : null;
}

/**
 * The code on a plate. On a plate-shaped value the code is the whole letter block or nothing:
 * DGK 0001 is a diplomat's plate with the unlisted code GK, not Ecuador's DG with the serial K0001.
 * Other values keep the original order of tests: prefix, suffix, then letters anywhere.
 */
export function extractCode(value, index) {
  const cleaned = normalizePlate(value);
  if (!cleaned || !index) return null;
  const block = letterBlock(cleaned);
  if (block) return index.map.has(block) ? block : null;
  const lettersOnly = cleaned.replace(/[0-9]/g, "");
  const codes = index.codes;
  return (
    codes.find((code) => cleaned.startsWith(code)) ||
    codes.find((code) => cleaned.endsWith(code)) ||
    codes.find((code) => lettersOnly.includes(code)) ||
    null
  );
}

/** Print a plate the way it is stamped: letters, a space, the serial ("DAF0789" -> "DAF 0789"). */
export function formatPlate(value) {
  const cleaned = normalizePlate(value);
  return cleaned.replace(/^([A-Z]+)([0-9]+)$/, "$1 $2").replace(/^([0-9]+)([A-Z]+)$/, "$1 $2");
}

export function isFullPlate(value) {
  return /\d/.test(normalizePlate(value));
}

/** The name people recognize: drops the "|alias" part of a few rows. Tracking keeps the raw string. */
export function displayCountry(country) {
  const name = String(country || "").split("|")[0].trim();
  if (name.toUpperCase() === "UNKNOWN") return "Unknown";
  return name;
}

/** A Wikipedia page title for a country row ("Iran (DC only)" -> "Iran"). */
export function wikiTitle(country) {
  return displayCountry(country)
    .replace(/\s*\((?:DC|UN) only\)\s*/gi, " ")
    .trim();
}

/** Where a plate's mission is: "(DC only)" and "(UN only)" rows say so in their name. */
export function missionNote(country) {
  if (/\(DC only\)/i.test(country)) return "Embassy in Washington, D.C. only";
  if (/\(UN only\)/i.test(country)) return "UN mission in New York only";
  return "";
}

/**
 * What an unlisted plate's letters still say: a leading D, C or S is the role letter (DGK: a
 * diplomat, code GK), a trailing D the UN's (GKD); the rest is the country code.
 */
function unlistedParts(cleaned) {
  const block = letterBlock(cleaned);
  if (!block) return {};
  const serial = cleaned.replace(/[A-Z]/g, "");
  if (block.length === 2) return { countryCode: block, serial };
  const prefixRole = Object.keys(ROLE_INFO).find((role) => ROLE_INFO[role].position === "prefix" && ROLE_INFO[role].letter === block[0]);
  if (prefixRole) return { role: prefixRole, prefix: block[0], countryCode: block.slice(1), serial };
  if (block[2] === ROLE_INFO["UN Diplomat"].letter) return { role: "UN Diplomat", suffix: block[2], countryCode: block.slice(0, 2), serial };
  return { countryCode: block, serial };
}

/**
 * Decode a plate into its parts for display.
 * Returns { cleaned, code, desc, country, role, prefix, countryCode, suffix, serial, alternates }.
 * `code` is null when no known code is found; a plate-shaped value then still gets its role and
 * country code letters (`country` stays empty).
 */
export function decodePlate(value, index) {
  const cleaned = normalizePlate(value);
  const out = {
    cleaned,
    code: null,
    desc: "",
    country: "",
    role: "",
    prefix: "",
    countryCode: "",
    suffix: "",
    serial: cleaned.replace(/[A-Z]/g, ""),
    alternates: []
  };
  if (!cleaned || !index) return out;

  const code = extractCode(cleaned, index);
  const desc = code ? index.map.get(code) : "";
  if (!desc) return Object.assign(out, unlistedParts(cleaned));

  const { country, role } = splitDesc(desc);
  out.code = code;
  out.desc = desc;
  out.country = country;
  out.role = role;
  out.alternates = (index.alternates.get(code) || []).map(splitDesc);

  const info = ROLE_INFO[role];
  if (info && code.length === 3 && info.position === "prefix") {
    out.prefix = code[0];
    out.countryCode = code.slice(1);
  } else if (info && code.length === 3 && info.position === "suffix") {
    out.countryCode = code.slice(0, 2);
    out.suffix = code[2];
  } else {
    out.countryCode = code;
  }

  // the serial is whatever is left of the plate around the code
  let start = -1;
  if (cleaned.startsWith(code)) start = 0;
  else if (cleaned.endsWith(code)) start = cleaned.length - code.length;
  else start = cleaned.indexOf(code);
  out.serial = start >= 0
    ? cleaned.slice(0, start) + cleaned.slice(start + code.length)
    : cleaned.replace(/[A-Z]/g, "");

  return out;
}

/** Every role that uses a country's two-letter code, for the about page's examples. */
export function codesForCountry(index, country) {
  const found = [];
  for (const [code, desc] of index.map) {
    const parts = splitDesc(desc);
    if (parts.country === country) found.push({ code, role: parts.role });
  }
  return found;
}

/** Count distinct two-letter base codes (one per country or organization row). */
export function countBaseCodes(index) {
  return index.codes.filter((code) => code.length === 2).length;
}

/**
 * Pull the most plate-like string out of OCR text.
 * Same patterns as before: three or two letters and four digits, either way round, with the
 * usual OCR confusions (O/Q -> 0, I/L -> 1, S -> 5) fixed in the digit part only.
 */
export function extractPlateCandidateFromText(text) {
  if (!text) return "";
  const upper = String(text).toUpperCase();
  const normalizeDigits = (s) =>
    s.replace(/O/g, "0")
      .replace(/Q/g, "0")
      .replace(/I/g, "1")
      .replace(/L/g, "1")
      .replace(/S/g, "5");
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

/** Flag images: the source the site already used, with flagcdn.com as the fallback. */
export function flagSources(iso2) {
  if (!iso2) return [];
  const code = String(iso2).toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) return [];
  return [
    `https://flags.restcountries.com/v5/svg/${code}.svg`,
    `https://flagcdn.com/${code}.svg`
  ];
}
