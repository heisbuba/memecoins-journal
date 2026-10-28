// Needs Pages secrets: PIN and SECRET string
const textEncoder = new TextEncoder();

async function signMessage(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(message)))]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const jsonResponse = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders }
  });

export async function onRequestPost({ env, request }) {
  const ip = request.headers.get("CF-Connecting-IP") || "x";
  const now = Date.now();
  await env.DB.prepare("DELETE FROM login_attempts WHERE ts<?").bind(now - 86400000).run();
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) n FROM login_attempts WHERE ip=? AND ts>?"
  )
    .bind(ip, now - 900000)
    .first();
  if (recent.n >= 5) return jsonResponse({ error: "Too many attempts. Try again in 15 minutes." }, 429);

  let requestBody = {};
  try {
    requestBody = await request.json();
  } catch {}

  const pinMatches =
    env.PIN &&
    env.SECRET &&
    safeEqual(
      await signMessage(env.SECRET, String(requestBody.pin || "")),
      await signMessage(env.SECRET, env.PIN)
    );

  if (!pinMatches) {
    await env.DB.prepare("INSERT INTO login_attempts(ip,ts) VALUES(?,?)").bind(ip, now).run();
    return jsonResponse({ error: "Wrong PIN" }, 401);
  }

  const expiry = String(now + 7 * 864e5);
  return jsonResponse(
    { ok: true },
    200,
    {
      "Set-Cookie": `session=${expiry}.${await signMessage(env.SECRET, expiry)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`
    }
  );
}

export async function onRequestDelete() {
  return jsonResponse(
    { ok: true },
    200,
    {
      "Set-Cookie": "session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
    }
  );
}
