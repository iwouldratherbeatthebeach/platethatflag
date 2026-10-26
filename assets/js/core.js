// Flag That Plate — shared page code: safe DOM building, API calls, formatting, the shell
// (top bar, phone menu, account, theme) and small motion helpers.
import { toast } from "./toast.js";

export { toast };

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/**
 * Build DOM without innerHTML. Strings and numbers become text nodes, so data from the server
 * (country names, usernames, vehicle makes) can never be parsed as markup.
 * h("li", { class: "row", dataset: { code: "BB" } }, "Barbados", h("strong", null, 12))
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "dataset") Object.assign(el.dataset, value);
      else if (key === "style" && typeof value === "object") {
        for (const [prop, v] of Object.entries(value)) {
          if (prop.startsWith("--")) el.style.setProperty(prop, String(v));
          else el.style[prop] = v;
        }
      }
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
      else if (key in el && typeof value !== "string") el[key] = value;
      else el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Inline SVG icons drawn as one 1.5px outline set. Constant markup only, never data. */
const ICONS = {
  camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.3l1.2-1.8A1.5 1.5 0 0 1 10.3 3.5h3.4a1.5 1.5 0 0 1 1.3.7L16.2 6h1.3A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
  arrow: '<path d="M7 17 17 7M9 7h8v8"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1.2-3.3 3.9-5 7-5s5.8 1.7 7 5"/>'
};

export function icon(name, extraClass = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (extraClass) svg.setAttribute("class", extraClass);
  svg.innerHTML = ICONS[name] || "";
  return svg;
}

/**
 * fetch() for the site's own JSON endpoints. Resolves { ok, status, data }; rejects only when the
 * request never completes (offline, timeout). Same paths, methods and bodies as before.
 */
export async function api(path, { method = "GET", body, timeout = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      signal: controller.signal
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(path, { timeout = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(path, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- formatting */
const numberFormat = new Intl.NumberFormat(undefined);
export const formatNumber = (n) => {
  const value = Number(n);
  return Number.isFinite(value) ? numberFormat.format(value) : "—";
};

/** "Lookups" / "lookup": plural by count, through Intl.PluralRules. */
const plural = new Intl.PluralRules("en-US");
export function countNoun(n, one, other) {
  return `${formatNumber(n)} ${plural.select(Number(n)) === "one" ? one : other}`;
}

/** D1 stores CURRENT_TIMESTAMP as "YYYY-MM-DD HH:MM:SS" in UTC. */
export function parseDbTime(value) {
  if (!value) return null;
  const iso = String(value).includes("T") ? String(value) : String(value).replace(" ", "T");
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export function timeAgo(date, now = Date.now()) {
  if (!date) return "";
  const seconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 86400 * 7) return relative.format(Math.round(seconds / 86400), "day");
  return shortDate.format(date);
}
export const fullTime = (date) => (date ? longDate.format(date) : "");

/** Initials from grapheme clusters, so "🦊 Fox" or "Ólafur" never become half a character. */
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
function firstGrapheme(word) {
  if (!word) return "";
  if (segmenter) {
    const first = segmenter.segment(word)[Symbol.iterator]().next().value;
    return first ? first.segment : "";
  }
  return Array.from(word)[0] || "";
}
export function initials(name) {
  // an email used as a username: take initials from the part before the @
  const base = String(name || "").trim().split("@")[0];
  const words = base.split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length > 1 ? firstGrapheme(words[0]) + firstGrapheme(words[words.length - 1]) : firstGrapheme(words[0]);
  return letters.toLocaleUpperCase();
}

/* ---------------------------------------------------------------- motion helpers */
export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Show a block that was just filled: one short fade-and-settle, never a hidden resting state. */
export function arrive(el) {
  if (!el) return;
  el.classList.add("arrive", "is-entering");
  // two frames: the first paints the start state, the second starts the transition
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("is-entering")));
}

/** A polite live region for announcements that are not visible text. */
let announcer;
export function announce(message) {
  if (!announcer) {
    announcer = h("div", { class: "sr-only", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    document.body.append(announcer);
  }
  announcer.textContent = "";
  // a fresh node per message makes screen readers read repeats too
  setTimeout(() => {
    announcer.textContent = message;
  }, 60);
}

export function setBusy(button, busy) {
  if (!button) return;
  if (busy) {
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-disabled", "true");
    if (!button.querySelector(".spinner")) button.append(h("span", { class: "spinner", "aria-hidden": "true" }));
  } else {
    button.removeAttribute("aria-busy");
    button.removeAttribute("aria-disabled");
  }
}

/* ---------------------------------------------------------------- flags */
/**
 * A flag <img> that falls back to the second source, then to a neutral globe.
 * size "row" is the 28x20 list slot; "large" is the result header.
 */
export function flagImage(sources, alt, size = "row") {
  const large = size === "large";
  if (!sources.length) return flagPlaceholder(size, alt);
  // flags are small SVGs shown near the top of every list, so they load straight away;
  // list flags yield to the page's own requests
  const img = h("img", {
    class: large ? "result__flag" : "flag",
    alt,
    fetchpriority: large ? "high" : "low",
    decoding: "async",
    referrerpolicy: "no-referrer",
    width: large ? 144 : 28,
    height: large ? 96 : 20
  });
  let i = 0;
  img.addEventListener("error", () => {
    i += 1;
    if (i < sources.length) img.src = sources[i];
    else img.replaceWith(flagPlaceholder(size, alt));
  });
  img.src = sources[0];
  return img;
}

export function flagPlaceholder(size = "row", label = "") {
  const large = size === "large";
  return h(
    "span",
    {
      class: large ? "result__flag result__flag--none" : "flag flag--none",
      role: "img",
      "aria-label": label ? `${label} (no flag available)` : "No flag available"
    },
    icon("globe")
  );
}

/* ---------------------------------------------------------------- shell */
const THEME_KEY = "ptf-theme";
const THEME_COLORS = { light: "#f4f6f8", dark: "#0d0e10" };

function readTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function applyTheme(choice) {
  const root = document.documentElement;
  if (choice === "light" || choice === "dark") root.setAttribute("data-theme", choice);
  else root.removeAttribute("data-theme");
  // the status bar follows the page ground (mobile-native: one theme-color per scheme)
  $$('meta[name="theme-color"]').forEach((meta) => {
    const scheme = meta.media.includes("dark") ? "dark" : "light";
    meta.content = THEME_COLORS[choice === "system" ? scheme : choice];
  });
}

function initTheme() {
  const group = $("[data-theme-switch]");
  if (!group) return;
  const buttons = $$("button[data-value]", group);
  const sync = (choice) => buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === choice)));
  sync(readTheme());
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const choice = button.dataset.value;
      try {
        if (choice === "system") localStorage.removeItem(THEME_KEY);
        else localStorage.setItem(THEME_KEY, choice);
      } catch {
        /* storage blocked: the choice lasts for this page */
      }
      const run = () => {
        applyTheme(choice);
        sync(choice);
      };
      // a rare action: cross-fade the whole page so light and dark do not flash (Apple: ease theme changes)
      if (document.startViewTransition && !reducedMotion()) document.startViewTransition(run);
      else run();
    });
  });
}

function initTopbar() {
  const bar = $(".topbar");
  if (!bar) return;
  let ticking = false;
  const update = () => {
    bar.classList.toggle("is-scrolled", window.scrollY > 4);
    ticking = false;
  };
  window.addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  update();
}

function initMenu() {
  const button = $(".menu-button");
  const sheet = $("#menu-sheet");
  const scrim = $("[data-scrim]");
  if (!button || !sheet) return;

  const setOpen = (open, { focus = true } = {}) => {
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    button.replaceChildren(icon(open ? "close" : "menu"));
    sheet.classList.toggle("is-open", open);
    scrim?.classList.toggle("is-open", open);
    sheet.toggleAttribute("inert", !open);
    if (open && focus) $("a, button", sheet)?.focus({ preventScroll: true });
    if (!open && focus && sheet.contains(document.activeElement)) button.focus({ preventScroll: true });
  };

  sheet.setAttribute("inert", "");
  button.addEventListener("click", () => setOpen(button.getAttribute("aria-expanded") !== "true"));
  scrim?.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") setOpen(false);
  });
  window.matchMedia("(min-width: 47.5625em)").addEventListener("change", (e) => {
    if (e.matches) setOpen(false, { focus: false });
  });
}

/* the account: fetched once per page from /me, shown in the bar and in the phone sheet */
let currentUser = { loggedIn: false, username: null };
export const getUser = () => currentUser;

export async function loadUser() {
  try {
    const { ok, data } = await api("/me");
    currentUser = ok && data ? { loggedIn: !!data.loggedIn, username: data.username || null } : { loggedIn: false, username: null, error: !ok };
  } catch {
    currentUser = { loggedIn: false, username: null, error: true };
  }
  renderAccount();
  return currentUser;
}

export async function signOut() {
  try {
    const { ok } = await api("/logout", { method: "POST" });
    if (!ok) throw new Error("logout failed");
    currentUser = { loggedIn: false, username: null };
    renderAccount();
    toast.success("Signed out", { description: "Your lookups are recorded as Anonymous." });
    document.dispatchEvent(new CustomEvent("auth:change", { detail: currentUser }));
  } catch {
    toast.error("Couldn't sign out", { description: "Check your connection and try again." });
  }
}

export function setUser(user) {
  currentUser = user;
  renderAccount();
  document.dispatchEvent(new CustomEvent("auth:change", { detail: currentUser }));
}

// on the sign-in page itself the bar does not offer a second way to the same forms
const onLoginPage = /^\/login(\.html)?$/.test(location.pathname);

function accountNodes(compact) {
  const signIn = onLoginPage ? null : h("a", { class: "btn btn--small", href: "/login.html" }, "Sign in");
  if (currentUser.error && !currentUser.loggedIn) return [signIn];
  if (!currentUser.loggedIn) {
    return [compact && signIn ? null : h("span", { class: "account__state" }, "Browsing as Anonymous"), signIn];
  }
  const name = currentUser.username || "";
  return [
    h("span", { class: "avatar", "aria-hidden": "true" }, initials(name)),
    h("span", { class: "account__name", title: name }, name),
    h("button", { class: "btn btn--small btn--quiet", type: "button", onclick: signOut }, "Sign out")
  ];
}

const compactBar = window.matchMedia("(max-width: 56.1875em)");

function renderAccount() {
  const slot = $("[data-account]");
  if (slot) slot.replaceChildren(...accountNodes(compactBar.matches).filter(Boolean));
  const sheetSlot = $("[data-account-sheet]");
  if (sheetSlot) sheetSlot.replaceChildren(...accountNodes(false).filter(Boolean));
}

export function initShell() {
  initTopbar();
  initMenu();
  initTheme();
  compactBar.addEventListener("change", renderAccount);
  return loadUser();
}
