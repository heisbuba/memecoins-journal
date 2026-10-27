// Cloudflare Pages Function: /api/trades 
const M = {Date:"date",Ticker:"ticker",Strategy:"strategy",MC:"mc",Price:"price","Entry Time":"entry_time",SL:"sl",TP:"tp",RRR:"rrr",PnL:"pnl","Exit Time":"exit_time",Review:"review",Tags:"tags",Notes:"notes"};
const J = (o, s = 200) => new Response(JSON.stringify(o), {status: s, headers: {"Content-Type": "application/json", "Cache-Control": "no-store"}});

export async function onRequestGet({env}) {
  const {results} = await env.DB.prepare("SELECT * FROM trades ORDER BY date, id").all();
  return J(results.map(r => { const o = {id: r.id}; for (const k in M) o[k] = r[M[k]] || ""; return o; }));
}

export async function onRequestPost({env, request}) {
  let b; try { b = await request.json(); } catch { return J({error: "bad json"}, 400); }
  const ok = (b.trades || []).slice(0, 2000).filter(t => t && t.Date && t.Ticker);
  const cols = Object.values(M);
  const st = env.DB.prepare(`INSERT INTO trades (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
  for (let i = 0; i < ok.length; i += 50)
    await env.DB.batch(ok.slice(i, i + 50).map(t => st.bind(...Object.keys(M).map(k => String(t[k] ?? "").slice(0, 20000)))));
  return J({added: ok.length});
}

export async function onRequestDelete({env, request}) {
  const id = +new URL(request.url).searchParams.get("id");
  if (!id) return J({error: "id required"}, 400);
  await env.DB.prepare("DELETE FROM trades WHERE id=?").bind(id).run();
  return J({deleted: id});
}

export async function onRequestPut({env, request}) {
  const id = +new URL(request.url).searchParams.get("id");
  let b; try { b = await request.json(); } catch { return J({error: "bad json"}, 400); }
  const t = b.trade;
  if (!id || !t || !t.Date || !t.Ticker) return J({error: "id and trade required"}, 400);
  const keys = Object.keys(M);
  await env.DB.prepare(`UPDATE trades SET ${keys.map(k => M[k] + "=?").join(",")} WHERE id=?`)
    .bind(...keys.map(k => String(t[k] ?? "").slice(0, 20000)), id).run();
  return J({updated: id});
}
