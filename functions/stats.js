export async function onRequestGet(context) {
  try {
    const { env } = context;

    const result = await env.DB.prepare(`
      SELECT country, query_count, updated_at
      FROM country_queries
      ORDER BY query_count DESC, country ASC
      LIMIT 10
    `).all();

    return new Response(
      JSON.stringify({
        ok: true,
        topCountries: result.results || []
      }),
      {
        headers: { "Content-Type": "application/json" }
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Server error",
        details: String(error)
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
