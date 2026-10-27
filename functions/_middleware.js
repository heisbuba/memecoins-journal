const FROM = "memejournal.pages.dev";
const TO = "journal.quantvat.name.ng";
const enc = new TextEncoder();
async function sig(secret, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)))].map(b => b.toString(16).padStart(2, "0")).join("");
}
function eq(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

export async function onRequest({env, request, next}) {
  const url = new URL(request.url);
  if (url.hostname === FROM) {
    url.hostname = TO;
    return Response.redirect(url.toString(), 302);
  }
  if (url.pathname.startsWith("/api/") && url.pathname !== "/api/login") {
    const m = /(?:^|; )session=([^;]+)/.exec(request.headers.get("Cookie") || "");
    if (m && env.SECRET) {
      const [exp, s] = m[1].split(".");
      if (+exp > Date.now() && eq(s || "", await sig(env.SECRET, exp))) return next();
    }
    return new Response('{"error":"auth"}', {status: 401, headers: {"Content-Type": "application/json"}});
  }
  return next();
}
