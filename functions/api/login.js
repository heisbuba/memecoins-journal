// POST /api/login {pin}  -> sets a signed session cookie.  DELETE /api/login -> logs out.
// Needs Pages secrets: PIN (your PIN/passphrase) and SECRET (long random string), plus the D1 binding DB.
const enc = new TextEncoder();
async function sig(secret, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)))].map(b => b.toString(16).padStart(2, "0")).join("");
}
function eq(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
const R = (o, s = 200, h = {}) => new Response(JSON.stringify(o), {status: s, headers: {"Content-Type": "application/json", ...h}});

export async function onRequestPost({env, request}) {
  const ip = request.headers.get("CF-Connecting-IP") || "x", now = Date.now();
  await env.DB.prepare("DELETE FROM login_attempts WHERE ts<?").bind(now - 86400000).run();
  const row = await env.DB.prepare("SELECT COUNT(*) n FROM login_attempts WHERE ip=? AND ts>?").bind(ip, now - 900000).first();
  if (row.n >= 5) return R({error: "Too many attempts. Try again in 15 minutes."}, 429);
  let b = {}; try { b = await request.json(); } catch {}
  const ok = env.PIN && env.SECRET && eq(await sig(env.SECRET, String(b.pin || "")), await sig(env.SECRET, env.PIN));
  if (!ok) { await env.DB.prepare("INSERT INTO login_attempts(ip,ts) VALUES(?,?)").bind(ip, now).run(); return R({error: "Wrong PIN"}, 401); }
  const exp = String(now + 7 * 864e5);
  return R({ok: true}, 200, {"Set-Cookie": `session=${exp}.${await sig(env.SECRET, exp)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`});
}
export async function onRequestDelete() {
  return R({ok: true}, 200, {"Set-Cookie": "session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"});
}
