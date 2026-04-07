import { getUserFromRequest } from "./_lib/auth.js";

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    const user = await getUserFromRequest(env, request);

    return new Response(JSON.stringify({
      ok: true,
      loggedIn: !!user,
      username: user?.username || null,
      userId: user?.id || null
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
