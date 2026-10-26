// Flag That Plate — the leaderboard. GET /api/leaderboard, unchanged:
// { topCountries: [{ country, searches }], topVehicles: [{ vehicle_make, vehicle_model, observations }],
//   topSubmitters: [{ username, submissions }] }
import { $, h, api, formatNumber, flagImage, initials, initShell } from "./core.js";
import { displayCountry, flagSources } from "./plates.js";

let iso = {};

function skeleton(n) {
  return Array.from({ length: n }, () =>
    h("li", { class: "skeleton-row", "aria-hidden": "true" }, h("span", { class: "skeleton skeleton--flag" }), h("span", { class: "skeleton" }), h("span", { class: "skeleton skeleton--fig" }))
  );
}

function vehicleName(row) {
  const known = (v) => v && String(v).trim() && String(v).trim().toLowerCase() !== "unknown";
  const make = known(row.vehicle_make) ? String(row.vehicle_make).trim() : "";
  const model = known(row.vehicle_model) ? String(row.vehicle_model).trim() : "";
  if (make && model) return { title: `${make} ${model}`, sub: "" };
  if (make) return { title: make, sub: "Model not recorded" };
  if (model) return { title: model, sub: "Make not recorded" };
  return { title: "Make and model not recorded", sub: "" };
}

function renderCountries(list, rows) {
  if (!rows.length) return list.replaceChildren(h("li", { class: "empty" }, "No lookups yet."));
  const max = Math.max(...rows.map((r) => Number(r.searches) || 0), 1);
  list.replaceChildren(
    ...rows.map((row, i) =>
      h(
        "li",
        { class: "ranking__row", style: { "--share": ((Number(row.searches) || 0) / max).toFixed(3) } },
        h("span", { class: "rank" }, i + 1),
        flagImage(flagSources(iso[row.country]), "", "row"),
        h("span", { class: "ranking__name", title: displayCountry(row.country) }, displayCountry(row.country)),
        h("span", { class: "ranking__value" }, formatNumber(row.searches))
      )
    )
  );
}

function renderVehicles(list, rows) {
  if (!rows.length) return list.replaceChildren(h("li", { class: "empty" }, "No sightings logged yet. Look up a full plate to log one."));
  list.replaceChildren(
    ...rows.map((row, i) => {
      const name = vehicleName(row);
      return h(
        "li",
        { class: "row" },
        h("span", { class: "rank" }, i + 1),
        h("span", { class: "row__main" }, h("span", { class: "row__title", title: name.title }, name.title), name.sub ? h("span", { class: "row__sub" }, name.sub) : null),
        h("span", { class: "row__figure" }, formatNumber(row.observations))
      );
    })
  );
}

function renderSpotters(list, rows) {
  if (!rows.length) return list.replaceChildren(h("li", { class: "empty" }, "No signed-in lookups yet. Sign in and your lookups count here."));
  list.replaceChildren(
    ...rows.map((row, i) =>
      h(
        "li",
        { class: "row" },
        h("span", { class: "rank" }, i + 1),
        h("span", { class: "avatar", "aria-hidden": "true" }, initials(row.username)),
        h("span", { class: "row__main" }, h("span", { class: "row__title", title: row.username }, row.username)),
        h("span", { class: "row__figure" }, formatNumber(row.submissions))
      )
    )
  );
}

function renderError(lists) {
  for (const list of lists) {
    list.replaceChildren(
      h(
        "li",
        { class: "inline-error", style: { padding: "8px 0" } },
        h("strong", null, "Couldn't load the leaderboard."),
        h("button", { class: "text-button", type: "button", onclick: load }, "Try again")
      )
    );
  }
}

async function load() {
  const lists = [$("[data-countries]"), $("[data-vehicles]"), $("[data-spotters]")];
  lists.forEach((list) => list.replaceChildren(...skeleton(5)));
  try {
    const [{ ok, data }, isoMap] = await Promise.all([
      api("/api/leaderboard"),
      fetch("/iso_mapping.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
    ]);
    iso = isoMap || {};
    if (!ok || !data) throw new Error("leaderboard failed");
    renderCountries(lists[0], (data.topCountries || []).filter((r) => r && r.country));
    renderVehicles(lists[1], (data.topVehicles || []).filter(Boolean));
    renderSpotters(lists[2], (data.topSubmitters || []).filter((r) => r && r.username));
  } catch {
    renderError(lists);
  }
}

function renderFoot(user) {
  const foot = $("[data-spotters-foot]");
  if (!foot) return;
  if (user && user.loggedIn) foot.replaceChildren(`Signed in as ${user.username}. Your lookups count here.`);
  else foot.replaceChildren("Lookups you make while signed in count here. ", h("a", { class: "link", href: "/login.html" }, "Sign in"));
}

initShell().then(renderFoot);
document.addEventListener("auth:change", (event) => renderFoot(event.detail));
load();
