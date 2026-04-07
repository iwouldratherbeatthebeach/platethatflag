import { getSessionIdFromRequest, clearSessionCookie } from "./_lib/auth.js";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const sessionId = getSessionIdFromRequest(request);

    if (sessionId) {
      await env.DB.prepare(`
        DELETE FROM sessions
        WHERE id = ?
      `)
        .bind(sessionId)
        .run();
    }

    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", clearSessionCookie());

    return new Response(JSON.stringify({ ok: true }), { headers });
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
