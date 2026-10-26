// Flag That Plate — toasts.
// The site has no React, so Sonner itself cannot be used (see the pick-ui-library notes in the PR).
// This is a small vanilla version that keeps Sonner's API shape and the behavior that makes it
// feel right: one toaster, toast()/toast.success()/toast.error()/toast.promise()/toast.dismiss(),
// enter and exit through the same edge with CSS transitions (interruptible, never keyframes),
// timers that pause on hover, focus and hidden tabs, swipe to dismiss on a flick, and a polite
// live region so screen readers hear them. Toasts confirm; anything the user must act on stays inline.

const DEFAULT_DURATION = 4000;
const VISIBLE = 3;
const EXIT_MS = 400; // matches --dur-toast
const SWIPE_DISTANCE = 56;
const SWIPE_VELOCITY = 0.11; // px per ms, a flick is enough

const ICONS = {
  success: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9.5"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>'
};

let region;
let list;
let seq = 0;
let paused = false;
const toasts = new Map();

function svg(name, className) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("fill", "none");
  el.setAttribute("stroke", "currentColor");
  el.setAttribute("stroke-width", "1.7");
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  el.setAttribute("aria-hidden", "true");
  if (className) el.setAttribute("class", className);
  el.innerHTML = ICONS[name] || "";
  return el;
}

function ensureRegion() {
  if (region) return;
  region = document.createElement("section");
  region.setAttribute("aria-label", "Notifications");
  list = document.createElement("ol");
  list.className = "toaster";
  list.setAttribute("aria-live", "polite");
  list.setAttribute("aria-relevant", "additions text");
  region.append(list);
  document.body.append(region);

  // pause every timer while the pointer is over the stack or focus is inside it
  list.addEventListener("pointerenter", () => setPaused(true));
  list.addEventListener("pointerleave", () => setPaused(false));
  list.addEventListener("focusin", () => setPaused(true));
  list.addEventListener("focusout", (e) => {
    if (!list.contains(e.relatedTarget)) setPaused(false);
  });
  // a hidden tab never eats a toast nobody saw
  document.addEventListener("visibilitychange", () => setPaused(document.hidden));
}

function setPaused(value) {
  if (paused === value) return;
  paused = value;
  for (const t of toasts.values()) (value ? pauseTimer : startTimer)(t);
}

function startTimer(t) {
  if (!Number.isFinite(t.duration) || t.type === "loading" || paused) return;
  clearTimeout(t.timer);
  t.startedAt = Date.now();
  t.timer = setTimeout(() => dismiss(t.id), t.remaining);
}

function pauseTimer(t) {
  if (!t.timer) return;
  clearTimeout(t.timer);
  t.timer = null;
  t.remaining = Math.max(0, t.remaining - (Date.now() - t.startedAt));
}

function render(t) {
  const el = t.el;
  el.className = `toast${t.type && t.type !== "default" ? ` toast--${t.type}` : ""}`;
  el.replaceChildren();

  if (t.type === "loading") {
    const spin = document.createElement("span");
    spin.className = "spinner toast__icon";
    spin.setAttribute("aria-hidden", "true");
    el.append(spin);
  } else if (ICONS[t.type]) {
    el.append(svg(t.type, "toast__icon"));
  }

  const body = document.createElement("div");
  body.className = "toast__body";
  const title = document.createElement("p");
  title.className = "toast__title";
  title.textContent = t.title;
  body.append(title);
  if (t.description) {
    const desc = document.createElement("p");
    desc.className = "toast__desc";
    desc.textContent = t.description;
    body.append(desc);
  }
  el.append(body);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast__close";
  close.setAttribute("aria-label", "Dismiss notification");
  close.append(svg("close"));
  close.addEventListener("click", () => dismiss(t.id));
  el.append(close);
}

function attachSwipe(t) {
  const el = t.el;
  let start = null;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    if (start) return; // multi-touch protection: ignore a second finger
    start = { x: e.clientX, y: e.clientY, time: Date.now(), id: e.pointerId };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    if (!el.dataset.swiping && Math.abs(dx) < 6) return; // a little hysteresis before committing
    el.dataset.swiping = "true";
    el.style.transform = `translate3d(${dx}px, 0, 0)`; // set on the element itself, not a parent variable
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const velocity = Math.abs(dx) / Math.max(1, Date.now() - start.time);
    start = null;
    delete el.dataset.swiping; // transitions back on, so both outcomes below animate from here
    if (Math.abs(dx) >= SWIPE_DISTANCE || (velocity > SWIPE_VELOCITY && Math.abs(dx) > 12)) {
      // leave the way the finger was going, from where it let go
      el.style.transform = `translate3d(${dx < 0 ? -110 : 110}%, 0, 0)`;
      el.dataset.swiped = "true";
      dismiss(t.id, { swiped: true });
    } else {
      el.style.transform = ""; // settle back into place
    }
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

function create(title, options = {}) {
  ensureRegion();
  const id = options.id ?? `t${++seq}`;
  const existing = toasts.get(id);
  const duration = options.duration ?? (options.type === "loading" ? Infinity : DEFAULT_DURATION);

  if (existing) {
    // update in place: same element, new content, fresh timer (Sonner: same id updates)
    Object.assign(existing, { title, description: options.description || "", type: options.type || "default", duration, remaining: duration });
    render(existing);
    pauseTimer(existing);
    startTimer(existing);
    return id;
  }

  const el = document.createElement("li");
  el.dataset.mounted = "false";
  const t = { id, el, title, description: options.description || "", type: options.type || "default", duration, remaining: duration, timer: null, startedAt: 0 };
  toasts.set(id, t);
  render(t);
  attachSwipe(t);
  list.append(el);

  // mount: paint the off-screen state first, then let the transition carry it in
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.dataset.mounted = "true";
  }));
  startTimer(t);

  // keep the stack short: the oldest leaves first
  const live = [...toasts.values()].filter((x) => !x.removing);
  if (live.length > VISIBLE) dismiss(live[0].id);
  return id;
}

export function dismiss(id, { swiped = false } = {}) {
  if (id === undefined) {
    [...toasts.keys()].forEach((key) => dismiss(key));
    return;
  }
  const t = toasts.get(id);
  if (!t || t.removing) return;
  t.removing = true;
  clearTimeout(t.timer);
  if (!swiped) t.el.dataset.removed = "true";
  const remove = () => {
    t.el.remove();
    toasts.delete(id);
  };
  t.el.addEventListener("transitionend", (e) => {
    if (e.target === t.el && e.propertyName === "opacity") remove();
  });
  setTimeout(remove, EXIT_MS + 80); // in case no transition runs (reduced motion, hidden tab)
}

export function toast(title, options) {
  return create(title, options);
}
toast.success = (title, options = {}) => create(title, { ...options, type: "success" });
toast.error = (title, options = {}) => create(title, { ...options, type: "error" });
toast.info = (title, options = {}) => create(title, { ...options, type: "info" });
toast.loading = (title, options = {}) => create(title, { ...options, type: "loading" });
toast.dismiss = dismiss;
toast.promise = (promise, { loading, success, error }) => {
  const id = toast.loading(loading);
  Promise.resolve(typeof promise === "function" ? promise() : promise).then(
    (value) => toast.success(typeof success === "function" ? success(value) : success, { id }),
    (err) => toast.error(typeof error === "function" ? error(err) : error, { id })
  );
  return id;
};
