// Flag That Plate — the decoder page.
// Same endpoints and payloads as before: GET /plates.csv, /stats, /recent, /me;
// POST /track { country, plateCode, missionRole }, /unknown { plateCode },
// /observe { country, plateCode, city, state, vehicleMake, vehicleModel, vehicleColor }.
import {
  $, $$, h, icon, api, fetchText, toast, formatNumber, parseDbTime, timeAgo, fullTime,
  arrive, announce, setBusy, flagImage, initShell
} from "./core.js";
import {
  ROLE_INFO, parsePlates, decodePlate, normalizePlate, formatPlate, isFullPlate, displayCountry, wikiTitle,
  missionNote, extractCode, flagSources
} from "./plates.js";
import { readPlate, warmUp } from "./reader.js";

const EXAMPLE = "DAF 0789";

const state = {
  index: null,
  iso: {},
  ready: null, // resolves once the plate list and the flag map have loaded
  lookupId: 0,
  last: null // { country, plate } of the last full-plate lookup, for the sighting form
};

const el = {};

/* ---------------------------------------------------------------- data */
async function loadData() {
  const [csv, iso] = await Promise.all([
    fetchText("/plates.csv"),
    fetchText("/iso_mapping.json").then((t) => JSON.parse(t)).catch(() => ({}))
  ]);
  state.index = parsePlates(csv);
  state.iso = iso || {};
}

const isoFor = (country) => state.iso[country] || null;
const flagFor = (country, size) =>
  flagImage(flagSources(isoFor(country)), size === "large" ? `Flag of ${displayCountry(country)}` : "", size);

/* ---------------------------------------------------------------- live decode (no animation: it follows the keyboard) */
function bandWord(decoded) {
  return decoded.role ? ROLE_INFO[decoded.role].band : "Diplomatic";
}

function part(label, code, value, { empty = false, hit = false, country = false } = {}) {
  return h(
    "div",
    { class: `decode__part${country ? " decode__part--country" : ""}${hit ? " decode__part--hit" : ""}` },
    h("dt", null, label, code ? h("span", { class: "decode__code" }, code) : null),
    h("dd", { class: empty ? "is-empty" : null }, value)
  );
}

function renderDecode() {
  const raw = el.input.value;
  const example = !normalizePlate(raw);
  const d = decodePlate(example ? EXAMPLE : raw, state.index);

  el.band.textContent = bandWord(d);
  el.plate.dataset.role = d.role || "";

  const roleLetter = d.prefix || d.suffix;
  const roleText = d.role ? ROLE_INFO[d.role].word : d.code ? "No role letter" : "—";
  let countryText;
  if (d.code) countryText = displayCountry(d.country);
  else if (!state.index) countryText = "Loading codes…";
  else if (d.countryCode) countryText = "Not in our list";
  else countryText = "No match yet";

  el.decode.replaceChildren(
    part("Role", roleLetter, roleText, { empty: example || !d.role, hit: !example && !!d.role }),
    part("Country", d.countryCode, countryText, { empty: example || !d.code, hit: !example && !!d.code, country: true }),
    part("Serial", null, d.serial || "—", { empty: example || !d.serial })
  );
  el.decode.setAttribute("aria-label", example ? `Example: ${EXAMPLE} decoded` : "Your plate, decoded");

  // shared codes: the plate list has a few codes issued to two missions (QX: Pakistan and Iran)
  const alternates = !example && d.code ? d.alternates.filter((a) => a.country !== d.country) : [];
  if (alternates.length) {
    el.also.replaceChildren(
      "This code is also listed for ",
      ...alternates.flatMap((a, i) => [i ? ", " : "", h("strong", null, displayCountry(a.country)), a.role ? ` (${ROLE_INFO[a.role]?.word || a.role})` : ""]),
      "."
    );
    el.also.hidden = false;
  } else {
    el.also.hidden = true;
  }
}

let announceTimer;
function onInput() {
  clearPlateError();
  renderDecode();
  // a calm announcement for screen readers once typing pauses
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    const value = normalizePlate(el.input.value);
    if (!value || !state.index) return;
    const d = decodePlate(value, state.index);
    const role = d.role ? ROLE_INFO[d.role].word : "";
    if (d.code) announce(`${displayCountry(d.country)}${role ? `, ${role}` : ""}`);
    else if (d.countryCode) announce(`${role ? `${role}, ` : ""}code ${d.countryCode} is not in our list`);
    else announce("No match yet");
  }, 700);
}

function showPlateError(message) {
  el.plateError.replaceChildren(icon("alert"), h("span", null, message));
  el.plateError.hidden = false;
  el.input.setAttribute("aria-invalid", "true");
}
function clearPlateError() {
  el.plateError.hidden = true;
  el.input.removeAttribute("aria-invalid");
}

/* ---------------------------------------------------------------- lookup */
async function runLookup({ fromUrl = false } = {}) {
  clearPlateError();
  const raw = normalizePlate(el.input.value);
  if (!state.index) {
    showPlateError("The plate list is still loading. Try again in a moment.");
    return;
  }
  if (!raw || !/[A-Z]/.test(raw)) {
    showPlateError("Type at least one letter from the plate.");
    el.input.focus();
    return;
  }

  const id = ++state.lookupId;
  state.last = null;
  el.sighting.hidden = true;
  el.messages.replaceChildren();
  updateUrl(raw);
  // on submit (never while typing) the plate is reprinted the way it is stamped: "daf-0789" -> "DAF 0789"
  el.input.value = formatPlate(raw);

  const code = extractCode(raw, state.index);
  const desc = code ? state.index.map.get(code) : null;

  if (!code || !desc) {
    el.result.hidden = true;
    api("/unknown", { method: "POST", body: { plateCode: raw } }).catch(() => {});
    const parts = decodePlate(raw, state.index);
    const info = ROLE_INFO[parts.role];
    const message = h(
      "div",
      { class: "message message--notice", role: "status" },
      icon("info"),
      h(
        "div",
        null,
        h("strong", null, parts.countryCode ? `We don't know the code “${parts.countryCode}” yet` : `We don't know “${raw}” yet`),
        h(
          "p",
          null,
          info ? `${parts.prefix || parts.suffix} marks ${info.plate}, but ${parts.countryCode} isn't in our list. ` : "",
          "Plate codes change and new ones are issued. We've logged this plate so it can be reviewed and added."
        )
      )
    );
    el.messages.replaceChildren(message);
    arrive(message);
    announce(`No match for ${raw}. The code has been logged for review.`);
    return;
  }

  const d = decodePlate(raw, state.index);
  const { country, role } = d;
  renderResult(d);
  announce(`${displayCountry(country)}${role ? `, ${ROLE_INFO[role].word}` : ""}. Details loading.`);

  setBusy(el.submit, true);
  const [track] = await Promise.allSettled([
    api("/track", { method: "POST", body: { country, plateCode: raw, missionRole: role } }),
    loadSummary(country, id)
  ]);
  setBusy(el.submit, false);
  if (id !== state.lookupId) return; // a newer lookup replaced this one

  const response = track.status === "fulfilled" ? track.value : null;
  renderCounts(country, response && response.ok ? response.data : null);

  if (isFullPlate(raw)) {
    state.last = { country, plate: raw };
    showSighting(d);
  }
  loadTop();
  loadRecent();
  if (fromUrl) el.result.scrollIntoView({ block: "nearest" });
}

function updateUrl(raw) {
  try {
    const url = new URL(location.href);
    url.searchParams.set("plate", raw);
    history.replaceState(null, "", url);
  } catch {
    /* ignore: some embedded views do not allow it */
  }
}

/* ---------------------------------------------------------------- the answer */
function renderResult(d) {
  const { country, role, code } = d;
  const info = ROLE_INFO[role];
  const note = missionNote(country);

  const roleLine = h(
    "p",
    { class: "result__role" },
    info ? [h("strong", null, `${info.word} plate`), ` · code ${code}`] : h("strong", null, `Country code ${code}`),
    note ? ` · ${note}` : ""
  );
  // "(DC only)" rows: the note says where the mission is, so the title is just the country
  const title = note ? wikiTitle(country) : displayCountry(country);

  el.result.replaceChildren(
    h(
      "div",
      { class: "result__head" },
      flagFor(country, "large"),
      h("div", null, h("h2", { class: "result__country", id: "result-title", tabindex: "-1" }, title), roleLine)
    ),
    h(
      "div",
      { class: "stats", style: { "--cols": 3 }, "data-counts": "" },
      stat("Lookups of this country", h("span", { class: "skeleton skeleton--fig" })),
      stat(isFullPlate(d.cleaned) ? "Lookups of this plate" : "Plate", isFullPlate(d.cleaned) ? h("span", { class: "skeleton skeleton--fig" }) : h("span", { class: "muted" }, "—")),
      stat("Looked up by", h("span", { class: "skeleton", style: { width: "8ch" } }), true)
    ),
    h("div", { "data-summary": "" }, h("span", { class: "skeleton", style: { width: "100%" } }), h("span", { class: "skeleton", style: { width: "82%", marginTop: "10px" } })),
    h(
      "div",
      { class: "result__grid" },
      h(
        "div",
        { class: "role-def" },
        h("h3", null, info ? info.question : "About this code"),
        h("p", null, info ? info.text : "A two-letter code on its own names the country. On a full plate it comes with a role letter: D for diplomat, C for consul, S for staff, or a trailing D for a UN diplomat.")
      ),
      h(
        "div",
        null,
        h("h3", { class: "sr-only" }, "Links"),
        h("ul", { class: "link-list" }, ...countryLinks(country))
      )
    )
  );
  el.result.hidden = false;
  arrive(el.result);
}

function stat(label, value, text = false) {
  return h(
    "div",
    { class: "stat" },
    h("span", { class: "stat__label" }, label),
    h("span", { class: `stat__value${text ? " stat__value--text" : ""}` }, value)
  );
}

function renderCounts(country, data) {
  const box = $("[data-counts]", el.result);
  if (!box) return;
  const values = $$(".stat__value", box);
  if (!data) {
    box.replaceWith(
      h(
        "p",
        { class: "inline-error" },
        h("strong", null, "Couldn't update the lookup count."),
        h("span", null, "The decode above is still right."),
        h("button", { class: "text-button", type: "button", onclick: () => runLookup() }, "Try again")
      )
    );
    return;
  }
  values[0].replaceChildren(formatNumber(data.count));
  if (data.plateCount !== null && data.plateCount !== undefined) values[1].replaceChildren(formatNumber(data.plateCount));
  values[2].replaceChildren(h("span", { title: data.searchedBy || "Anonymous" }, data.searchedBy || "Anonymous"));
  const label = $$(".stat__label", box)[0];
  label.textContent = `Lookups of ${displayCountry(country)}`;
}

async function loadSummary(country, id) {
  const title = wikiTitle(country);
  let extract = "";
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: { Accept: "application/json" } });
    if (res.ok) extract = (await res.json()).extract || "";
  } catch {
    extract = "";
  }
  if (id !== state.lookupId) return;
  const slot = $("[data-summary]", el.result);
  if (!slot) return;
  if (extract) {
    slot.replaceChildren(
      h("p", { class: "result__summary" }, extract),
      h("p", { class: "result__source" }, "Summary from ", h("a", { class: "link", href: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`, target: "_blank", rel: "noopener noreferrer" }, "Wikipedia"), ", CC BY-SA 4.0.")
    );
  } else {
    slot.replaceChildren(h("p", { class: "muted" }, "No summary is available for this country right now."));
  }
}

function slugifyForState(country) {
  return country
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function countryLinks(country) {
  const name = wikiTitle(country);
  const links = [
    ["Wikipedia", "Country article", `https://en.wikipedia.org/wiki/${encodeURIComponent(name.replace(/\s+/g, "_"))}`],
    ["U.S. State Department", "Country page", `https://www.state.gov/countries-areas/${encodeURIComponent(slugifyForState(name))}/`],
    ["Recent news", "Google News", `https://news.google.com/search?q=${encodeURIComponent(name)}`]
  ];
  return links.map(([label, sub, href]) =>
    h(
      "li",
      null,
      h(
        "a",
        { href, target: "_blank", rel: "noopener noreferrer" },
        h("span", null, label, h("span", { class: "sr-only" }, " (opens in a new tab)")),
        h("span", null, sub, " ", icon("arrow"))
      )
    )
  );
}

/* ---------------------------------------------------------------- sighting (vehicle observation) */
function showSighting(d) {
  el.sightingPlate.textContent = `${d.cleaned} · ${displayCountry(d.country)}`;
  el.sightingStatus.hidden = true;
  el.sighting.hidden = false;
  arrive(el.sighting);
}

async function saveSighting(event) {
  event.preventDefault();
  if (!state.last) return;
  const form = el.sightingForm;
  const value = (name) => form.elements[name].value.trim();
  const payload = {
    country: state.last.country,
    plateCode: state.last.plate,
    city: value("city"),
    state: value("state"),
    vehicleMake: value("make"),
    vehicleModel: value("model"),
    vehicleColor: value("color")
  };
  const button = $("button[type=submit]", form);
  setBusy(button, true);
  el.sightingStatus.hidden = true;
  try {
    const { ok } = await api("/observe", { method: "POST", body: payload });
    if (!ok) throw new Error("observe failed");
    toast.success("Sighting saved", { description: `${payload.plateCode} · ${displayCountry(payload.country)}` });
    form.reset();
    loadTop();
  } catch {
    el.sightingStatus.replaceChildren(icon("alert"), h("span", null, "Couldn't save the sighting. Your details are still here; try again."));
    el.sightingStatus.hidden = false;
  } finally {
    setBusy(button, false);
  }
}

/* ---------------------------------------------------------------- photo reading (reader.js; the OCR library loads on first use) */
let photo = null; // { file, url } of the photo being read
let readId = 0; // only the newest read (a new photo, or a tap) updates the page
let fromPhoto = ""; // the plate as the reader last filled it in
let lastOcrText = "";

const STAGE_TEXT = {
  "Opening the photo": "Opening the photo…",
  "Loading the reader": "Loading the photo reader…",
  "Looking for the plate": "Looking for the plate…",
  "Reading the plate": "Reading the plate…",
  Done: "Reading the plate…"
};

function setOcr({ text = null, progress = null, choices = null, tappable = null }) {
  el.ocr.hidden = false;
  if (text !== null) {
    // the line is a live region: only touch it when the words change, so it is read out once
    const parts = Array.isArray(text) ? text : [text];
    const key = parts.map((p) => (typeof p === "string" ? p : p.textContent)).join("");
    if (key !== lastOcrText) {
      lastOcrText = key;
      el.ocrText.replaceChildren(...parts);
    }
  }
  el.ocrProgress.hidden = progress === null;
  if (progress !== null) el.ocrFill.style.setProperty("--p", String(Math.max(0, Math.min(1, progress))));
  if (choices !== null) {
    el.ocrChoices.hidden = !choices.length;
    el.ocrChoices.replaceChildren(
      ...(choices.length
        ? [
            h("span", null, "Other readings:"),
            ...choices.map((plate) =>
              h("button", { class: "text-button", type: "button", onclick: () => usePlate(plate) }, formatPlate(plate))
            )
          ]
        : [])
    );
  }
  if (tappable !== null) {
    // aria-disabled, not disabled: a keyboard press on the photo keeps its focus while it is read
    el.ocrPhoto.disabled = false;
    el.ocrPhoto.setAttribute("aria-disabled", String(!tappable));
    el.ocrHint.hidden = !tappable;
  }
}

/** Put a plate read from the photo into the field, decoded, for the visitor to check. */
function fillPlate(plate) {
  el.input.value = fromPhoto = formatPlate(plate);
  renderDecode();
}

/** A new photo with no reading also takes the last photo's reading out of the field (not a typed plate). */
function dropPhotoPlate() {
  if (fromPhoto && el.input.value === fromPhoto) {
    el.input.value = "";
    renderDecode();
  }
  fromPhoto = "";
}

function usePlate(plate) {
  fillPlate(plate);
  el.input.focus();
}

/** Readings worth offering besides the best one: close in score, not just a piece of it. */
function otherReadings(best, candidates) {
  return candidates
    .filter((c) => c.plate !== best.plate && c.score >= best.score - 12 && !best.plate.includes(c.plate))
    .slice(0, 2)
    .map((c) => c.plate);
}

/** Take down the answer on screen: it was for another plate. */
function clearAnswer() {
  state.lookupId++; // a lookup still loading no longer applies
  state.last = null;
  el.result.hidden = true;
  el.sighting.hidden = true;
  el.messages.replaceChildren();
}

async function readPhoto(focus = null) {
  if (!photo) return;
  const id = ++readId;
  clearAnswer();
  el.ocrMark.hidden = !focus;
  if (focus) {
    el.ocrMark.style.left = `${focus.x * 100}%`;
    el.ocrMark.style.top = `${focus.y * 100}%`;
  }
  setBusy(el.scan, true);
  setOcr({ text: focus ? "Looking where you tapped…" : "Opening the photo…", progress: 0.02, choices: [], tappable: false });
  try {
    if (!state.index) await state.ready;
    const result = await readPlate(photo.file, {
      index: state.index,
      focus,
      onProgress: (fraction, stage) => {
        if (id === readId) setOcr({ text: STAGE_TEXT[stage] || null, progress: fraction });
      }
    });
    if (id !== readId) return; // a newer photo or tap took over
    await showReading(result, focus);
  } catch (error) {
    if (id !== readId) return;
    console.warn("Photo reading failed", error);
    if (!focus) dropPhotoPlate();
    const notImage = /not an image/i.test(String(error?.message || ""));
    setOcr({
      text: notImage
        ? [h("strong", null, "That file isn't a photo this browser can open."), " Try a JPEG or PNG, or type the plate."]
        : [h("strong", null, "The photo reader didn't load."), " Check your connection and try again, or type the plate."],
      progress: null,
      tappable: false
    });
  } finally {
    if (id === readId) setBusy(el.scan, false);
  }
}

async function showReading({ best, confident, candidates }, focus) {
  if (!best) {
    if (!focus) dropPhotoPlate(); // after a tap, the photo's first reading stays
    setOcr({
      text: [h("strong", null, focus ? "Couldn't read a plate there." : "Couldn't find the plate in this photo."), " Tap the plate in the photo, or type it above."],
      progress: null,
      choices: [],
      tappable: true
    });
    return;
  }
  fillPlate(best.plate);
  const shown = el.input.value;
  const choices = otherReadings(best, candidates);
  // only a clear reading is looked up (and counted) without asking; anything less waits for the visitor
  if (confident && extractCode(best.plate, state.index)) {
    setOcr({ text: [h("strong", null, `Read ${shown} from your photo.`), " Not right? Fix the plate above."], progress: null, choices, tappable: true });
    await runLookup();
    return;
  }
  setOcr({
    text: [h("strong", null, `This looks like ${shown}.`), " Check it against the plate and fix anything that's off, then look it up."],
    progress: null,
    choices,
    tappable: true
  });
  el.input.focus();
}

function choosePhoto(file) {
  if (photo) URL.revokeObjectURL(photo.url);
  photo = { file, url: URL.createObjectURL(file) };
  el.ocrThumb.src = photo.url;
  readPhoto();
}

function tapPhoto(event) {
  if (!photo || el.ocrPhoto.getAttribute("aria-disabled") === "true") return;
  const rect = el.ocrThumb.getBoundingClientRect();
  // a keyboard press has no pointer position: look at the middle of the photo
  const pointer = event.detail > 0 && rect.width > 0 && rect.height > 0;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const x = pointer ? clamp((event.clientX - rect.left) / rect.width) : 0.5;
  const y = pointer ? clamp((event.clientY - rect.top) / rect.height) : 0.5;
  readPhoto({ x, y });
}

/* ---------------------------------------------------------------- the rail: most looked up, recent */
function skeletonRows(n) {
  return Array.from({ length: n }, () =>
    h("li", { class: "skeleton-row", "aria-hidden": "true" }, h("span", { class: "skeleton skeleton--flag" }), h("span", { class: "skeleton" }), h("span", { class: "skeleton skeleton--fig" }))
  );
}

function railError(list, what, retry) {
  list.replaceChildren(
    h(
      "li",
      { class: "inline-error", style: { padding: "8px 0" } },
      h("strong", null, `Couldn't load ${what}.`),
      h("button", { class: "text-button", type: "button", onclick: retry }, "Try again")
    )
  );
}

async function loadTop() {
  const list = el.top;
  try {
    const [{ ok, data }] = await Promise.all([api("/stats"), state.ready.catch(() => {})]);
    if (!ok || !data) throw new Error("stats failed");
    const rows = (data.topCountries || []).filter((r) => r && r.country);
    if (!rows.length) {
      list.replaceChildren(h("li", { class: "empty" }, "No lookups yet. Yours will be the first."));
      return;
    }
    const max = Math.max(...rows.map((r) => Number(r.query_count) || 0), 1);
    list.replaceChildren(
      ...rows.map((row) =>
        h(
          "li",
          { class: "ranking__row", style: { "--share": ((Number(row.query_count) || 0) / max).toFixed(3) } },
          flagFor(row.country, "row"),
          h("span", { class: "ranking__name", title: displayCountry(row.country) }, displayCountry(row.country)),
          h("span", { class: "ranking__value" }, formatNumber(row.query_count))
        )
      )
    );
  } catch {
    railError(list, "the most looked-up countries", loadTop);
  }
}

async function loadRecent() {
  const list = el.recent;
  try {
    const [{ ok, data }] = await Promise.all([api("/recent"), state.ready.catch(() => {})]);
    if (!ok || !data) throw new Error("recent failed");
    const rows = (data.recentSearches || []).filter((r) => r && r.country);
    if (!rows.length) {
      list.replaceChildren(h("li", { class: "empty" }, "No lookups yet."));
      return;
    }
    list.replaceChildren(
      ...rows.map((row) => {
        const when = parseDbTime(row.queried_at);
        const who = row.searched_by || "Anonymous";
        return h(
          "li",
          { class: "row" },
          flagFor(row.country, "row"),
          h(
            "span",
            { class: "row__main" },
            h("span", { class: "row__title", title: displayCountry(row.country) }, displayCountry(row.country)),
            // the name truncates, the time never does (a long email as a username hid it)
            h(
              "span",
              { class: "row__sub row__sub--split" },
              h("span", { class: "row__who", title: who }, who),
              when ? h("span", { class: "row__when" }, " · ", h("time", { datetime: when.toISOString(), title: fullTime(when) }, timeAgo(when))) : null
            )
          )
        );
      })
    );
  } catch {
    railError(list, "recent lookups", loadRecent);
  }
}

/* ---------------------------------------------------------------- start */
function cacheElements() {
  el.form = $("#lookup-form");
  el.input = $("#plate");
  el.plate = $("[data-plate]");
  el.band = $("[data-band]");
  el.decode = $("[data-decode]");
  el.also = $("[data-also]");
  el.plateError = $("#plate-error");
  el.submit = $("[data-submit]");
  el.scan = $("[data-scan]");
  el.file = $("[data-file]");
  el.ocr = $("[data-ocr]");
  el.ocrPhoto = $("[data-ocr-photo]");
  el.ocrThumb = $("[data-ocr-thumb]");
  el.ocrMark = $("[data-ocr-mark]");
  el.ocrText = $("[data-ocr-text]");
  el.ocrProgress = $("[data-ocr-progress]");
  el.ocrFill = $("[data-ocr-fill]");
  el.ocrChoices = $("[data-ocr-choices]");
  el.ocrHint = $("[data-ocr-hint]");
  el.messages = $("[data-messages]");
  el.result = $("[data-result]");
  el.sighting = $("[data-sighting]");
  el.sightingForm = $("#sighting-form");
  el.sightingPlate = $("[data-sighting-plate]");
  el.sightingStatus = $("[data-sighting-status]");
  el.top = $("[data-top]");
  el.recent = $("[data-recent]");
}

function bindEvents() {
  el.form.addEventListener("submit", (event) => {
    event.preventDefault();
    runLookup();
  });
  el.input.addEventListener("input", onInput);
  el.scan.addEventListener("click", () => {
    el.file.click();
    warmUp(); // load the reader while the picker is open
  });
  el.file.addEventListener("change", () => {
    const file = el.file.files && el.file.files[0];
    el.file.value = "";
    if (file) choosePhoto(file);
  });
  el.ocrPhoto.addEventListener("click", tapPhoto);
  $$("[data-example]").forEach((button) =>
    button.addEventListener("click", () => {
      // fills the plate and decodes it; looking it up (and counting it) stays the visitor's choice
      el.input.value = button.dataset.example;
      onInput();
      el.input.focus();
    })
  );
  el.sightingForm.addEventListener("submit", saveSighting);
  document.addEventListener("auth:change", () => loadRecent());
}

async function start() {
  cacheElements();
  bindEvents();
  initShell();
  el.top.replaceChildren(...skeletonRows(5));
  el.recent.replaceChildren(...skeletonRows(5));
  // the lists fetch in parallel with the plate data and render once the flag map is in
  state.ready = loadData();
  loadTop();
  loadRecent();

  try {
    await state.ready;
  } catch {
    el.messages.replaceChildren(
      h(
        "div",
        { class: "message message--error", role: "alert" },
        icon("alert"),
        h("div", null, h("strong", null, "Couldn't load the plate list."), h("p", null, "Check your connection, then ", h("button", { class: "text-button", type: "button", onclick: () => location.reload() }, "reload the page"), "."))
      )
    );
  }
  renderDecode();

  // a shared link (?plate=DAF0789) opens straight to its answer
  const shared = new URLSearchParams(location.search).get("plate");
  if (shared && state.index) {
    el.input.value = formatPlate(shared).slice(0, 12);
    renderDecode();
    runLookup({ fromUrl: true });
  }
}

start();
