export async function onRequestGet(context) {
  try {
    const { env } = context;

    const topCountries = await env.DB.prepare(`
      SELECT country, query_count, updated_at
      FROM country_queries
      ORDER BY query_count DESC, country ASC
      LIMIT 5
    `).all();

    const topPlates = await env.DB.prepare(`
      SELECT plate_code, country, query_count, updated_at
      FROM plate_queries
      ORDER BY query_count DESC, plate_code ASC
      LIMIT 5
    `).all();

    return new Response(JSON.stringify({
      ok: true,
      topCountries: topCountries.results || [],
      topPlates: topPlates.results || []
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
