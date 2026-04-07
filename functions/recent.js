export async function onRequestGet(context) {
  try {
    const { env } = context;

    const result = await env.DB.prepare(`
      SELECT
        query_events.country,
        query_events.queried_at,
        COALESCE(users.username, 'Anonymous') AS searched_by
      FROM query_events
      LEFT JOIN users ON query_events.user_id = users.id
      ORDER BY query_events.queried_at DESC
      LIMIT 10
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
