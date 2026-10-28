const PAGES_DEV_HOST = "memejournal.pages.dev";
const CUSTOM_DOMAIN = "journal.quantvat.name.ng";
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

export async function onRequest({ env, request, next }) {
  const url = new URL(request.url);

  if (url.hostname === PAGES_DEV_HOST) {
    url.hostname = CUSTOM_DOMAIN;
    return Response.redirect(url.toString(), 302);
  }

  if (url.pathname.startsWith("/api/") && url.pathname !== "/api/login") {
    const sessionCookie = /(?:^|; )session=([^;]+)/.exec(request.headers.get("Cookie") || "");
    if (sessionCookie && env.SECRET) {
      const [expiry, signature] = sessionCookie[1].split(".");
      if (+expiry > Date.now() && safeEqual(signature || "", await signMessage(env.SECRET, expiry))) {
        return next();
      }
    }
    return new Response('{"error":"auth"}', {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  return next();
}
