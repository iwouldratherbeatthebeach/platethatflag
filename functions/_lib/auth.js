function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) continue;
    cookies[rawKey] = decodeURIComponent(rest.join("=") || "");
  }

  return cookies;
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPassword(password) {
  return sha256Hex(password);
}

export function makeSessionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function getSessionIdFromRequest(request) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  return cookies.session_id || null;
}

export async function getUserFromRequest(env, request) {
  const sessionId = getSessionIdFromRequest(request);
  if (!sessionId) return null;

  const row = await env.DB.prepare(`
    SELECT
      users.id,
      users.username,
      sessions.id AS session_id,
      sessions.expires_at
    FROM sessions
    JOIN users ON sessions.user_id = users.id
    WHERE sessions.id = ?
      AND sessions.expires_at > CURRENT_TIMESTAMP
  `)
    .bind(sessionId)
    .first();

  return row || null;
}

export function buildSessionCookie(sessionId) {
  return `session_id=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
}

export function clearSessionCookie() {
  return `session_id=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
