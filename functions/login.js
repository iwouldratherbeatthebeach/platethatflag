import { hashPassword, makeSessionId, buildSessionCookie } from "./_lib/auth.js";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    const username = (body.username || "").trim();
    const password = body.password || "";

    if (!username || !password) {
      return new Response(JSON.stringify({ ok: false, error: "Missing username or password" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const user = await env.DB.prepare(`
      SELECT id, username, password_hash
      FROM users
      WHERE username = ?
    `)
      .bind(username)
      .first();

    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid credentials" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const passwordHash = await hashPassword(password);

    if (passwordHash !== user.password_hash) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid credentials" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const sessionId = makeSessionId();

    await env.DB.prepare(`
      INSERT INTO sessions (id, user_id, expires_at)
      VALUES (?, ?, datetime('now', '+30 days'))
    `)
      .bind(sessionId, user.id)
      .run();

    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", buildSessionCookie(sessionId));

    return new Response(JSON.stringify({
      ok: true,
      username: user.username
    }), { headers });
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
