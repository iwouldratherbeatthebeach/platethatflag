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

    if (!country) {
      return new Response(JSON.stringify({ ok: false, error: "Missing country" }), {
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
      INSERT INTO country_queries (country, query_count, updated_at)
      VALUES (?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(country)
      DO UPDATE SET
        query_count = query_count + 1,
        updated_at = CURRENT_TIMESTAMP
    `)
      .bind(country)
      .run();

    await env.DB.prepare(`
      INSERT INTO query_events (country, plate_code, ip_country, hashed_ip, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `)
      .bind(country, plateCode || null, ipCountry, hashedIp, userAgent)
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
      count: row.query_count
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
