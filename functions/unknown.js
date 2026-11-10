import { forward } from "./_lib/splunk.js";
import { plateParts, MAX_PLATE_LENGTH, ENTERED_VIA } from "./_lib/plate.js";

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    // the page sends at most 12 characters; anything longer is cut, not stored whole
    const plateCode = String(body.plateCode || "").trim().toUpperCase().slice(0, MAX_PLATE_LENGTH);

    if (!plateCode) {
      return new Response(JSON.stringify({ ok: false, error: "Missing plateCode" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const ip =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for") ||
      "";

    const ipCountry =
      request.headers.get("CF-IPCountry") ||
      "XX";

    const userAgent =
      request.headers.get("user-agent") ||
      "";

    const hashedIp = ip ? await sha256Hex(ip) : null;

    await env.DB.prepare(`
      INSERT INTO unknown_queries (plate_code, ip_country, hashed_ip, user_agent)
      VALUES (?, ?, ?, ?)
    `)
      .bind(plateCode, ipCountry, hashedIp, userAgent)
      .run();

    // Splunk HEC: sent in the background (waitUntil); never delays or changes this response.
    // The plate's parts and how it was entered feed the research queue in the Splunk app.
    const parts = plateParts(plateCode);
    forward(context, "unknown_plate", {
      plate: plateCode,
      code: parts.code,
      letters: parts.letters,
      role_letter: parts.role_letter,
      mission_role: parts.mission_role,
      serial: parts.serial,
      layout: parts.layout,
      plate_shaped: parts.plate_shaped,
      entered_via: ENTERED_VIA.has(body.enteredVia) ? body.enteredVia : undefined,
      src_country: ipCountry,
      src_ip_hash: hashedIp,
      http_user_agent: userAgent,
      status: 200
    });

    return new Response(JSON.stringify({ ok: true, logged: true }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    forward(context, "error", { status: 500, error: String(error) });
    return new Response(JSON.stringify({
      ok: false,
      error: "Server error",
      details: String(error)
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
