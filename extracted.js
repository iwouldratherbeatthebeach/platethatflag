
let mapping = {};
let exampleCodes = [];
let lastLookupCountry = null;
let lastLookupPlate = null;

// Free, keyless flag CDN (https://restcountries.com/flags) served from
// flags.restcountries.com. The old restcountries.com/v3.1 data API used
// below was retired and now requires a paid account + API key, so flags
// are resolved locally against ISO 3166-1 alpha-2 codes instead of an
// external country-data lookup.
const countryToIso2 = {
  "Afghanistan": "af",
  "Albania": "al",
  "Algeria": "dz",
  "Andorra": "ad",
  "Angola": "ao",
  "Antigua & Barbuda": "ag",
  "Argentina": "ar",
  "Armenia": "am",
  "Australia": "au",
  "Austria": "at",
  "Azerbaijan": "az",
  "Bahamas": "bs",
  "Bahrain": "bh",
  "Bangladesh": "bd",
  "Barbados": "bb",
  "Belarus": "by",
  "Belgium": "be",
  "Belize": "bz",
  "Benin": "bj",
  "Bhutan": "bt",
  "Bolivia": "bo",
  "Bosnia-Herzegovina": "ba",
  "Botswana": "bw",
  "Brazil": "br",
  "Brunei": "bn",
  "Bulgaria": "bg",
  "Burkina Faso": "bf",
  "Burundi": "bi",
  "Cambodia": "kh",
  "Cameroon": "cm",
  "Canada": "ca",
  "Cape Verde": "cv",
  "Central African Republic": "cf",
  "Chad": "td",
  "Chile": "cl",
  "Colombia": "co",
  "Comoros": "km",
  "Costa Rica": "cr",
  "Cote d'Ivoire": "ci",
  "Croatia": "hr",
  "Cuba (UN only)": "cu",
  "Cyprus": "cy",
  "Czech Republic": "cz",
  "Denmark": "dk",
  "Djibouti": "dj",
  "Dominica": "dm",
  "Dominican Republic": "do",
  "Ecuador": "ec",
  "Egypt": "eg",
  "El Salvador": "sv",
  "Equatorial Guinea": "gq",
  "Eritrea": "er",
  "Estonia": "ee",
  "Ethiopia": "et",
  "Fiji": "fj",
  "Finland": "fi",
  "France": "fr",
  "Gabon": "ga",
  "Gambia": "gm",
  "Georgia": "ge",
  "Germany": "de",
  "Ghana": "gh",
  "Greece": "gr",
  "Grenada": "gd",
  "Guatemala": "gt",
  "Guinea": "gn",
  "Guinea Bissau": "gw",
  "Guyana": "gy",
  "Haiti": "ht",
  "Holy See": "va",
  "Honduras": "hn",
  "Hungary": "hu",
  "Iceland": "is",
  "India": "in",
  "Indonesia": "id",
  "Iran (DC only)": "ir",
  "Iran (UN only)": "ir",
  "Iraq (DC only)": "iq",
  "Iraq (UN only)": "iq",
  "Ireland": "ie",
  "Israel": "il",
  "Italy": "it",
  "Jamaica": "jm",
  "Japan": "jp",
  "Jordan": "jo",
  "Kazakhstan": "kz",
  "Kenya": "ke",
  "Kuwait": "kw",
  "Kyrgyzstan": "kg",
  "Laos": "la",
  "Latvia": "lv",
  "Lebanon": "lb",
  "Lesotho": "ls",
  "Liberia": "lr",
  "Libya": "ly",
  "Liechtenstein": "li",
  "Lithuania": "lt",
  "Luxembourg": "lu",
  "Madagascar": "mg",
  "Malawi": "mw",
  "Malaysia": "my",
  "Maldives": "mv",
  "Mali": "ml",
  "Malta": "mt",
  "Marshall Islands": "mh",
  "Mauritania": "mr",
  "Mauritius": "mu",
  "Mexico": "mx",
  "Micronesia": "fm",
  "Moldova": "md",
  "Monaco": "mc",
  "Mongolia": "mn",
  "Morocco": "ma",
  "Mozambique": "mz",
  "Myanmar": "mm",
  "Myanmar (Burma)": "mm",
  "Namibia": "na",
  "Nauru": "nr",
  "Nepal": "np",
  "Netherlands": "nl",
  "New Zealand": "nz",
  "Nicaragua": "ni",
  "Niger": "ne",
  "Nigeria": "ng",
  "North Korea": "kp",
  "Norway": "no",
  "Oman": "om",
  "Pakistan": "pk",
  "Palau": "pw",
  "Panama": "pa",
  "Papua New Guinea": "pg",
  "Paraguay": "py",
  "People's Republic of China": "cn",
  "Peru": "pe",
  "Philippines": "ph",
  "Poland": "pl",
  "Portugal": "pt",
  "Qatar": "qa",
  "Republic of Macedonia|Macedonia": "mk",
  "Republic of the Congo": "cg",
  "Romania": "ro",
  "Russia": "ru",
  "Rwanda": "rw",
  "Saint Lucia": "lc",
  "Saint Vincent and the Grenadines": "vc",
  "San Marino": "sm",
  "Sao Tome & Principe": "st",
  "Saudi Arabia": "sa",
  "Senegal": "sn",
  "Seychelles": "sc",
  "Sierra Leone": "sl",
  "Singapore": "sg",
  "Slovakia": "sk",
  "Slovenia": "si",
  "Solomon Islands": "sb",
  "Somalia": "so",
  "South Africa": "za",
  "South Korea": "kr",
  "Spain": "es",
  "Sri Lanka": "lk",
  "St. Kitts & Nevis": "kn",
  "Sudan": "sd",
  "Suriname": "sr",
  "Swaziland": "sz",
  "Sweden": "se",
  "Switzerland": "ch",
  "Syria": "sy",
  "Tajikistan": "tj",
  "Tanzania": "tz",
  "Thailand": "th",
  "Togo": "tg",
  "Tonga": "to",
  "Trinidad & Tobago": "tt",
  "Tunisia": "tn",
  "Turkey": "tr",
  "Turkmenistan": "tm",
  "Uganda": "ug",
  "Ukraine": "ua",
  "United Arab Emirates": "ae",
  "United Kingdom": "gb",
  "Uruguay": "uy",
  "Uzbekistan": "uz",
  "Vanuatu": "vu",
  "Venezuela": "ve",
  "Vietnam": "vn",
  "Western Samoa": "ws",
  "Yemen": "ye",
  "Zaire": "cd",
  "Zambia": "zm",
  "Zimbabwe": "zw"
};

const roleDefs = {
  "Consul": `<strong>Consul</strong><br>Helps citizens abroad with passports, visas, legal paperwork, and emergencies.`,
  "Diplomat": `<strong>Diplomat</strong><br>Represents the home government in formal relations with the host country.`,
  "Staff": `<strong>Staff</strong><br>Supports embassy or mission operations such as administration, logistics, and protocol.`,
  "UN Diplomat": `<strong>UN Diplomat</strong><br>Represents a country in multilateral diplomacy at the United Nations.`
};

const plateInput = document.getElementById("plate");
const unknownBox = document.getElementById("unknown-box");
const lookupMessage = document.getElementById("lookup-message");
const resultStack = document.getElementById("result-stack");
const vehicleCard = document.getElementById("vehicle-card");
const vehicleStatus = document.getElementById("vehicle-status");

function normalizePlateInput(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function extractPlateCandidateFromText(text) {
  if (!text) return "";

  const upper = String(text).toUpperCase();

  const normalizeDigits = s =>
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

  if (/^[A-Z]/.test(m[1])) {
    return `${m[1]}${normalizeDigits(m[2])}`;
  }

  return `${normalizeDigits(m[1])}${m[2]}`;
}
function extractCode(value) {
  const cleaned = normalizePlateInput(value);
  const lettersOnly = cleaned.replace(/[0-9]/g, "");

  const knownCodes = Object.keys(mapping).sort((a, b) => b.length - a.length);

  return (
    knownCodes.find(code => cleaned.startsWith(code)) ||
    knownCodes.find(code => cleaned.endsWith(code)) ||
    knownCodes.find(code => lettersOnly.includes(code)) ||
    null
  );
}

function splitDesc(desc) {
  const m = desc.match(/^(.+?)\s+(UN Diplomat|Consul|Diplomat|Staff)$/);
  if (m) return { country: m[1], role: m[2] };
  return { country: desc, role: "" };
}

function isFullPlate(value) {
  return /\d/.test(normalizePlateInput(value));
}

function setLookupMessage(message, type) {
  lookupMessage.textContent = message;
  lookupMessage.className = `inline-message show ${type}`;
}

function clearLookupMessage() {
  lookupMessage.textContent = "";
  lookupMessage.className = "inline-message";
}

function setVehicleStatus(message, type) {
  vehicleStatus.textContent = message;
  vehicleStatus.className = `vehicle-status show ${type}`;
}

function clearVehicleStatus() {
  vehicleStatus.textContent = "";
  vehicleStatus.className = "vehicle-status";
}

function setOcrStatus(message) {
  const el = document.getElementById("ocr-status");
  if (el) el.textContent = message;
}

async function loadPlateData() {
  const res = await fetch("/plates.csv");
  if (!res.ok) throw new Error(`Could not load plates.csv: HTTP ${res.status}`);

  const csv = await res.text();
  const map = {};

  csv.split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => {
      const parts = line.split(",");
      const code = parts.shift();
      const desc = parts.join(",").trim();
      if (code) map[code.trim().toUpperCase()] = desc;
    });

  mapping = map;
  exampleCodes = Object.keys(mapping);
  startExampleRotation();
}

function startExampleRotation() {
  if (!exampleCodes.length) return;

  const codeEl = document.getElementById("example-code");
  const plateEl = document.getElementById("example-plate");

  const update = () => {
    const code = exampleCodes[Math.floor(Math.random() * exampleCodes.length)];
    codeEl.textContent = code;
    plateEl.textContent = `${code}0150`;
  };

  update();
  setInterval(update, 2500);
}

function slugifyForWiki(country) {
  return country.replace(/\s+/g, "_");
}

function slugifyForState(country) {
  return country
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function renderCountryLinks(country) {
  const linksEl = document.getElementById("country-links");
  const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(slugifyForWiki(country))}`;
  const stateUrl = `https://www.state.gov/countries-areas/${encodeURIComponent(slugifyForState(country))}/`;
  const newsUrl = `https://news.google.com/search?q=${encodeURIComponent(country)}`;

  linksEl.innerHTML = `
    <li><a href="${wikiUrl}" target="_blank" rel="noopener noreferrer">Wikipedia</a></li>
    <li><a href="${stateUrl}" target="_blank" rel="noopener noreferrer">U.S. State Department</a></li>
    <li><a href="${newsUrl}" target="_blank" rel="noopener noreferrer">Recent News</a></li>
  `;
}

async function trackLookup(country, plateCode, missionRole) {
  const res = await fetch("/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ country, plateCode, missionRole })
  });

  if (!res.ok) throw new Error(`Track lookup failed: HTTP ${res.status}`);
  return res.json();
}

async function logUnknownCode(plateCode) {
  try {
    await fetch("/unknown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plateCode })
    });
  } catch (e) {
    console.warn("Unknown logging failed", e);
  }
}

async function saveObservation() {
  if (!lastLookupCountry || !lastLookupPlate) {
    setVehicleStatus("No full plate lookup is active yet.", "bad");
    return;
  }

  const payload = {
    country: lastLookupCountry,
    plateCode: lastLookupPlate,
    city: document.getElementById("obs-city").value.trim(),
    state: document.getElementById("obs-state").value.trim(),
    vehicleMake: document.getElementById("obs-make").value.trim(),
    vehicleModel: document.getElementById("obs-model").value.trim(),
    vehicleColor: document.getElementById("obs-color").value.trim()
  };

  try {
    const res = await fetch("/observe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setVehicleStatus("Observation saved.", "good");
  } catch (e) {
    setVehicleStatus("Could not save observation right now.", "bad");
  }
}

async function loadTopCountries() {
  const list = document.getElementById("top-countries-list");

  try {
    const res = await fetch("/stats");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rows = data.topCountries || [];

    list.innerHTML = rows.length
      ? rows.map(row => `
          <li>
            <span>${row.country}</span>
            <strong>${row.query_count}</strong>
          </li>
        `).join("")
      : `<li><span>No lookups yet.</span></li>`;
  } catch (e) {
    list.innerHTML = `<li><span>Could not load stats.</span></li>`;
  }
}

async function loadRecentSearches() {
  const list = document.getElementById("recent-searches-list");

  try {
    const res = await fetch("/recent");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rows = data.recentSearches || [];

    list.innerHTML = rows.length
      ? rows.map(row => `
          <li>
            <div>
              <div>${row.country}</div>
              <div class="recent-meta">by ${row.searched_by || "Anonymous"}</div>
            </div>
          </li>
        `).join("")
      : `<li><span>No recent searches yet.</span></li>`;
  } catch (e) {
    list.innerHTML = `<li><span>Could not load recent searches.</span></li>`;
  }
}

async function loadMe() {
  const authEl = document.getElementById("auth-status");

  try {
    const res = await fetch("/me");
    const data = await res.json();

    if (data.loggedIn) {
      authEl.innerHTML = `
        Signed in as <strong>${data.username}</strong>
        · <a href="#" id="logout-link">Logout</a>
      `;
      document.getElementById("logout-link").addEventListener("click", async (e) => {
        e.preventDefault();
        await logout();
      });
    } else {
      authEl.innerHTML = `Not signed in · <a href="/login.html">Login</a>`;
    }
  } catch (e) {
    authEl.textContent = "Could not load login status.";
  }
}

async function logout() {
  try {
    await fetch("/logout", { method: "POST" });
    setLookupMessage("Signed out.", "good");
    await loadMe();
    await loadRecentSearches();
  } catch (e) {
    setLookupMessage("Could not log out right now.", "bad");
  }
}

async function enrichCountry(country, plateCode, missionRole) {
  const flagEl = document.getElementById("flag");
  const countEl = document.getElementById("count");
  const factsEl = document.getElementById("facts");

  const iso2 = countryToIso2[country];

  if (iso2) {
    flagEl.src = `https://flags.restcountries.com/v5/svg/${iso2}.svg`;
    flagEl.alt = `Flag of ${country}`;
    flagEl.style.display = "block";
  } else {
    flagEl.removeAttribute("src");
    flagEl.style.display = "none";
    console.warn(`No flag mapping available for "${country}"`);
  }

  try {
    const track = await trackLookup(country, plateCode, missionRole);
    const lines = [`<div><strong>Country lookups:</strong> ${track.count}</div>`];

    if (track.plateCount !== null && track.plateCount !== undefined) {
      lines.push(`<div><strong>Exact plate lookups:</strong> ${track.plateCount}</div>`);
    }

    if (track.searchedBy) {
      lines.push(`<div><strong>Searched by:</strong> ${track.searchedBy}</div>`);
    }

    countEl.innerHTML = lines.join("");
  } catch (e) {
    countEl.innerHTML = `<strong>Lookup Count:</strong> Could not update lookup count right now.`;
  }

  let wikiExtract = "";
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(country)}`
    );

    if (res.ok) {
      const wiki = await res.json();
      wikiExtract = wiki.extract || "";
    }
  } catch (e) {
    console.warn("Wiki API error", e);
  }

  let html = "";

  if (wikiExtract) {
    html += `<div><strong>Summary:</strong> ${wikiExtract}</div>`;
  }

  factsEl.innerHTML = html || `<div>No country enrichment available.</div>`;

  renderCountryLinks(country);
  await loadTopCountries();
  await loadRecentSearches();
}

async function scanPlateImage(file) {
  if (!file) return;

  setOcrStatus("Scanning image...");

  try {
    const result = await Tesseract.recognize(file, "eng", {
      logger: () => {}
    });

    const raw = result?.data?.text || "";
    const cleaned = extractPlateCandidateFromText(raw);

    console.log("RAW OCR:", raw);
    console.log("CLEANED OCR:", normalizePlateInput(raw));
    console.log("PLATE CANDIDATE:", cleaned);

    if (!cleaned) {
      setOcrStatus(`Could not detect plate text. OCR read: ${normalizePlateInput(raw).slice(0, 80)}`);
      return;
    }

    const code = extractCode(cleaned);
    plateInput.value = cleaned;

    if (!code) {
      setOcrStatus(`Detected plate candidate: ${cleaned}. No matching code found.`);
      return;
    }

    setOcrStatus(`Detected plate candidate: ${cleaned}. Matched code: ${code}.`);
    await runLookup();

  } catch (e) {
    console.warn("OCR failed", e);
    setOcrStatus("OCR failed. Check browser console for details.");
  }
}

async function runLookup() {
  clearLookupMessage();
  unknownBox.classList.remove("show");
  unknownBox.innerHTML = "";
  resultStack.classList.remove("show");
  vehicleCard.classList.remove("show");
  clearVehicleStatus();

  lastLookupCountry = null;
  lastLookupPlate = null;

  document.getElementById("flag").style.display = "none";
  document.getElementById("flag").src = "";
  document.getElementById("result").textContent = "";
  document.getElementById("count").innerHTML = "";
  document.getElementById("facts").innerHTML = "";
  document.getElementById("role-def").innerHTML = "";
  document.getElementById("country-links").innerHTML = `<li><span>Run a lookup to load country links.</span></li>`;

  const raw = normalizePlateInput(plateInput.value);
  const code = extractCode(raw);

  if (!code) {
    if (raw) await logUnknownCode(raw);

    unknownBox.innerHTML = raw
      ? `<strong>Code not found.</strong><br>This plate code is not in the current database yet. Diplomatic and mission-related plate assignments can change over time, and new codes may be issued. Your lookup has been logged for review.`
      : `Please enter at least one letter.`;

    unknownBox.classList.add("show");
    return;
  }

  const desc = mapping[code];

  if (!desc) {
    await logUnknownCode(raw);
    unknownBox.innerHTML = `
      <strong>Code not found.</strong><br>
      This plate code is not in the current database yet. Diplomatic and mission-related
      plate assignments can change over time, and new codes may be issued. Your lookup
      has been logged for review.
    `;
    unknownBox.classList.add("show");
    return;
  }

  const { country, role } = splitDesc(desc);

  document.getElementById("result").textContent = role ? `${country} (${role})` : country;

  document.getElementById("role-def").innerHTML = `
    <h2 class="section-title">Mission Role</h2>
    <p>${role && roleDefs[role] ? roleDefs[role] : "No role description is available for this plate type."}</p>
  `;

  resultStack.classList.add("show");

  await enrichCountry(country, raw, role);

  if (isFullPlate(raw)) {
    lastLookupCountry = country;
    lastLookupPlate = raw;
    vehicleCard.classList.add("show");
  }
}

document.getElementById("go").addEventListener("click", runLookup);
document.getElementById("save-observation").addEventListener("click", saveObservation);

plateInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runLookup();
});

document.getElementById("plate-image").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];

  if (!file) {
    setOcrStatus("No image selected.");
    return;
  }

  await scanPlateImage(file);
  e.target.value = "";
});

async function init() {
  try {
    await loadPlateData();
  } catch (e) {
    console.error("Failed to load plates.csv", e);
    setLookupMessage("Could not load plate data.", "bad");
  }

  loadTopCountries();
  loadRecentSearches();
  loadMe();
}

init();
