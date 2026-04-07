export async function onRequestGet(context) {
  try {
    const { env } = context;

    const topCountries = await env.DB.prepare(`
      SELECT country, COUNT(*) AS searches
      FROM query_events
      GROUP BY country
      ORDER BY searches DESC
      LIMIT 20
    `).all();

    const topVehicles = await env.DB.prepare(`
      SELECT
        COALESCE(vehicle_make, 'Unknown') AS vehicle_make,
        COALESCE(vehicle_model, 'Unknown') AS vehicle_model,
        COUNT(*) AS observations
      FROM vehicle_observations
      GROUP BY vehicle_make, vehicle_model
      ORDER BY observations DESC
      LIMIT 20
    `).all();

    const topSubmitters = await env.DB.prepare(`
      SELECT users.username, COUNT(*) AS submissions
      FROM vehicle_observations
      JOIN users ON vehicle_observations.user_id = users.id
      GROUP BY users.username
      ORDER BY submissions DESC
      LIMIT 20
    `).all();

    return new Response(JSON.stringify({
      ok: true,
      topCountries: topCountries.results || [],
      topVehicles: topVehicles.results || [],
      topSubmitters: topSubmitters.results || []
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
