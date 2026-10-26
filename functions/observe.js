import { getUserFromRequest } from "./_lib/auth.js";
import { forward } from "./_lib/splunk.js";

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

    const country = (body.country || "").trim();
    const plateCode = (body.plateCode || "").trim().toUpperCase();
    const city = (body.city || "").trim();
    const state = (body.state || "").trim();
    const vehicleMake = (body.vehicleMake || "").trim();
    const vehicleModel = (body.vehicleModel || "").trim();
    const vehicleColor = (body.vehicleColor || "").trim();

    if (!country || !plateCode) {
      return new Response(JSON.stringify({ ok: false, error: "Missing country or plateCode" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const user = await getUserFromRequest(env, request);

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
      INSERT INTO vehicle_observations (
        country, plate_code, city, state, vehicle_make, vehicle_model, vehicle_color,
        ip_country, hashed_ip, user_agent, user_id, anonymous
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        country,
        plateCode,
        city || null,
        state || null,
        vehicleMake || null,
        vehicleModel || null,
        vehicleColor || null,
        ipCountry,
        hashedIp,
        userAgent,
        user?.id || null,
        user ? 0 : 1
      )
      .run();

    // Splunk HEC: sent in the background (waitUntil); never delays or changes this response
    forward(context, "sighting", {
      country,
      plate: plateCode,
      city,
      state,
      vehicle_make: vehicleMake,
      vehicle_model: vehicleModel,
      vehicle_color: vehicleColor,
      user: user?.username,
      user_id: user?.id,
      anonymous: !user,
      src_country: ipCountry,
      src_ip_hash: hashedIp,
      http_user_agent: userAgent,
      status: 200
    });

    return new Response(JSON.stringify({ ok: true }), {
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
