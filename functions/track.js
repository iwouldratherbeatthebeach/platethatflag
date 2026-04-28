import { getUserFromRequest } from "./_lib/auth.js";

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
    const missionRole = (body.missionRole || "").trim();

    if (!country) {
      return new Response(JSON.stringify({ ok: false, error: "Missing country" }), {
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
    const isFullPlate = /\d/.test(plateCode);

    await env.DB.prepare(`
      INSERT INTO country_queries (country, query_count, updated_at)
      VALUES (?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(country)
      DO UPDATE SET
        query_count = query_count + 1,
        updated_at = CURRENT_TIMESTAMP
    `)
      .bind(country)
      .run();

    let plateCount = null;

    if (isFullPlate) {
      await env.DB.prepare(`
        INSERT INTO plate_queries (plate_code, country, query_count, updated_at)
        VALUES (?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(plate_code)
        DO UPDATE SET
          query_count = query_count + 1,
          country = excluded.country,
          updated_at = CURRENT_TIMESTAMP
      `)
        .bind(plateCode, country)
        .run();

      const plateRow = await env.DB.prepare(`
        SELECT query_count
        FROM plate_queries
        WHERE plate_code = ?
      `)
        .bind(plateCode)
        .first();

      plateCount = plateRow?.query_count ?? null;
    }

    await env.DB.prepare(`
      INSERT INTO query_events (
        country, plate_code, ip_country, hashed_ip, user_agent, user_id, anonymous
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        country,
        plateCode || null,
        ipCountry,
        hashedIp,
        userAgent,
        user?.id || null,
        user ? 0 : 1
      )
      .run();

    const row = await env.DB.prepare(`
      SELECT country, query_count
      FROM country_queries
      WHERE country = ?
    `)
      .bind(country)
      .first();

    return new Response(JSON.stringify({
      ok: true,
      country: row.country,
      count: row.query_count,
      plateCount,
      missionRole,
      searchedBy: user?.username || "Anonymous"
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
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
