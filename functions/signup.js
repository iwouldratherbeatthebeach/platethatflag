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

    if (username.length < 3 || password.length < 6) {
      return new Response(JSON.stringify({ ok: false, error: "Username or password too short" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const passwordHash = await hashPassword(password);

    await env.DB.prepare(`
      INSERT INTO users (username, password_hash)
      VALUES (?, ?)
    `)
      .bind(username, passwordHash)
      .run();

    const user = await env.DB.prepare(`
      SELECT id, username
      FROM users
      WHERE username = ?
    `)
      .bind(username)
      .first();

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
    const message = String(error);
    const isDuplicate = message.includes("UNIQUE");

    return new Response(JSON.stringify({
      ok: false,
      error: isDuplicate ? "Username already exists" : "Server error",
      details: message
    }), {
      status: isDuplicate ? 409 : 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
