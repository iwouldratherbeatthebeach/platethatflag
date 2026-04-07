export async function onRequestGet(context) {
  try {
    const { env } = context;

    const result = await env.DB.prepare(`
      SELECT country, MAX(queried_at) AS queried_at
      FROM query_events
      GROUP BY country
      ORDER BY queried_at DESC
      LIMIT 5
    `).all();

    return new Response(JSON.stringify({
      ok: true,
      recentSearches: result.results || []
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
