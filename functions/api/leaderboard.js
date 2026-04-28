export async function onRequestGet(context) {
  try {
    const { env } = context;

    // Top scorers on the users table
    const topScorers = await env.DB.prepare(`
      SELECT username, score
      FROM users
      WHERE score > 0
      ORDER BY score DESC
      LIMIT 10
    `).all();

    // Top searched countries
    const topCountries = await env.DB.prepare(`
      SELECT country, COUNT(*) AS searches
      FROM query_events
      GROUP BY country
      ORDER BY searches DESC
      LIMIT 10
    `).all();

    // Most observed vehicle types
    const topVehicles = await env.DB.prepare(`
      SELECT
        COALESCE(vehicle_make,  'Unknown') AS vehicle_make,
        COALESCE(vehicle_model, 'Unknown') AS vehicle_model,
        COUNT(*) AS observations
      FROM vehicle_observations
      GROUP BY vehicle_make, vehicle_model
      ORDER BY observations DESC
      LIMIT 10
    `).all();

    // Most prolific submitters (observations + lookups combined)
    const topSubmitters = await env.DB.prepare(`
      SELECT
        u.username,
        u.score,
        COUNT(DISTINCT qe.id) AS lookups,
        COUNT(DISTINCT vo.id) AS observations
      FROM users u
      LEFT JOIN query_events       qe ON qe.user_id = u.id
      LEFT JOIN vehicle_observations vo ON vo.user_id = u.id
      GROUP BY u.id
      HAVING (lookups + observations) > 0
      ORDER BY u.score DESC, observations DESC
      LIMIT 10
    `).all();

    // First-spotter achievements: unique plates first observed per user
    const topSpotters = await env.DB.prepare(`
      SELECT u.username, COUNT(*) AS first_spots
      FROM (
        SELECT plate_code, MIN(id) AS first_obs_id
        FROM vehicle_observations
        WHERE anonymous = 0
        GROUP BY plate_code
      ) AS firsts
      JOIN vehicle_observations vo ON vo.id = firsts.first_obs_id
      JOIN users u ON u.id = vo.user_id
      GROUP BY u.id
      ORDER BY first_spots DESC
      LIMIT 10
    `).all();

    return new Response(JSON.stringify({
      ok: true,
      topScorers:    topScorers.results    || [],
      topCountries:  topCountries.results  || [],
      topVehicles:   topVehicles.results   || [],
      topSubmitters: topSubmitters.results || [],
      topSpotters:   topSpotters.results   || []
    }), { headers: { "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: "Server error", details: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
