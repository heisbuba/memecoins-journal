// Cloudflare Pages Function: /api/images (R2 binding: BUCKET)
const SLOT_COLUMN = { before: "before_image", after: "after_image" };
const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_BYTES = 5 * 1024 * 1024;
const KEY_PATTERN = /^trades\/\d+\/(before|after)-\d+\.(png|jpg|webp)$/;

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });

const guarded = handler => async context => {
  try {
    return await handler(context);
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: "Server error" }, 500);
  }
};

function readTarget(request) {
  const params = new URL(request.url).searchParams;
  const id = +params.get("id");
  const slot = params.get("slot");
  return id && SLOT_COLUMN[slot] ? { id, slot, column: SLOT_COLUMN[slot] } : null;
}

const findCurrentKey = (env, target) =>
  env.DB.prepare(`SELECT ${target.column} AS key FROM trades WHERE id=?`).bind(target.id).first();

export const onRequestGet = guarded(async ({ env, request }) => {
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!KEY_PATTERN.test(key)) return jsonResponse({ error: "bad key" }, 400);
  const object = await env.BUCKET.get(key);
  if (!object) return jsonResponse({ error: "not found" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata.contentType,
      "Cache-Control": "private, max-age=31536000, immutable"
    }
  });
});

export const onRequestPut = guarded(async ({ env, request }) => {
  const target = readTarget(request);
  const contentType = request.headers.get("Content-Type");
  const extension = EXTENSIONS[contentType];
  if (!target || !extension) return jsonResponse({ error: "id, slot and a png, jpeg or webp image required" }, 400);

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return jsonResponse({ error: "image must be under 5 MB" }, 413);

  const current = await findCurrentKey(env, target);
  if (!current) return jsonResponse({ error: "trade not found" }, 404);

  const key = `trades/${target.id}/${target.slot}-${Date.now()}.${extension}`;
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType } });
  await env.DB.prepare(`UPDATE trades SET ${target.column}=? WHERE id=?`).bind(key, target.id).run();
  if (current.key) await env.BUCKET.delete(current.key);
  return jsonResponse({ key });
});

export const onRequestDelete = guarded(async ({ env, request }) => {
  const target = readTarget(request);
  if (!target) return jsonResponse({ error: "id and slot required" }, 400);

  const current = await findCurrentKey(env, target);
  if (!current) return jsonResponse({ error: "trade not found" }, 404);

  await env.DB.prepare(`UPDATE trades SET ${target.column}=NULL WHERE id=?`).bind(target.id).run();
  if (current.key) await env.BUCKET.delete(current.key);
  return jsonResponse({ deleted: target.slot });
});
