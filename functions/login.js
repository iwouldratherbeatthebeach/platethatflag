import { hashPassword, makeSessionId, buildSessionCookie } from "./_lib/auth.js";
import { forward } from "./_lib/splunk.js";

// Splunk HEC: sign-in outcomes for security monitoring (CIM Authentication: action, user, reason).
// The password is never sent. Delivery is in the background and never changes the response.
const audit = (context, data) => forward(context, "login", { signature: "login", ...data });

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    const username = (body.username || "").trim();
    const password = body.password || "";

    if (!username || !password) {
      audit(context, { action: "failure", reason: "missing_fields", user: username, status: 400 });
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
      audit(context, { action: "failure", reason: "unknown_user", user: username, status: 401 });
      return new Response(JSON.stringify({ ok: false, error: "Invalid credentials" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const passwordHash = await hashPassword(password);

    if (passwordHash !== user.password_hash) {
      audit(context, { action: "failure", reason: "bad_password", user: user.username, user_id: user.id, status: 401 });
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

    audit(context, { action: "success", user: user.username, user_id: user.id, status: 200 });

    return new Response(JSON.stringify({
      ok: true,
      username: user.username
    }), { headers });
  } catch (error) {
    forward(context, "error", { status: 500, error: String(error) });
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
