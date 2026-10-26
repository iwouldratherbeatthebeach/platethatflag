import { getSessionIdFromRequest, clearSessionCookie, getUserFromRequest } from "./_lib/auth.js";
import { forward, readHecConfig } from "./_lib/splunk.js";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const sessionId = getSessionIdFromRequest(request);

    // Splunk HEC: who signed out. The session lookup runs only when "logout" events are forwarded,
    // and before the session is deleted.
    const hec = readHecConfig(env);
    const audit = Boolean(hec && hec.allows("logout"));
    const user = audit && sessionId ? await getUserFromRequest(env, request).catch(() => null) : null;

    if (sessionId) {
      await env.DB.prepare(`
        DELETE FROM sessions
        WHERE id = ?
      `)
        .bind(sessionId)
        .run();
    }

    if (audit) forward(context, "logout", { signature: "logout", action: "success", user: user?.username, user_id: user?.id, status: 200 });

    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", clearSessionCookie());

    return new Response(JSON.stringify({ ok: true }), { headers });
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
