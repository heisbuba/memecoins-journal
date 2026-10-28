// Cloudflare Pages Function: /api/trades
const FIELD_TO_COLUMN = {
  Date: "date",
  Ticker: "ticker",
  Strategy: "strategy",
  MC: "mc",
  Price: "price",
  "Entry Time": "entry_time",
  SL: "sl",
  TP: "tp",
  RRR: "rrr",
  PnL: "pnl",
  "Exit Time": "exit_time",
  "Exit MC": "exit_mc",
  Review: "review",
  Tags: "tags",
  Notes: "notes"
};

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare("SELECT * FROM trades ORDER BY date, id").all();
  return jsonResponse(
    results.map(row => {
      const trade = { id: row.id };
      for (const field in FIELD_TO_COLUMN) trade[field] = row[FIELD_TO_COLUMN[field]] || "";
      return trade;
    })
  );
}

export async function onRequestPost({ env, request }) {
  let requestBody;
  try {
    requestBody = await request.json();
  } catch {
    return jsonResponse({ error: "bad json" }, 400);
  }
  const validTrades = (requestBody.trades || []).slice(0, 2000).filter(trade => trade && trade.Date && trade.Ticker);
  const columns = Object.values(FIELD_TO_COLUMN);
  const insertStatement = env.DB.prepare(
    `INSERT INTO trades (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`
  );
  for (let i = 0; i < validTrades.length; i += 50) {
    await env.DB.batch(
      validTrades.slice(i, i + 50).map(trade =>
        insertStatement.bind(...Object.keys(FIELD_TO_COLUMN).map(field => String(trade[field] ?? "").slice(0, 20000)))
      )
    );
  }
  return jsonResponse({ added: validTrades.length });
}

export async function onRequestDelete({ env, request }) {
  const id = +new URL(request.url).searchParams.get("id");
  if (!id) return jsonResponse({ error: "id required" }, 400);
  await env.DB.prepare("DELETE FROM trades WHERE id=?").bind(id).run();
  return jsonResponse({ deleted: id });
}

export async function onRequestPut({ env, request }) {
  const id = +new URL(request.url).searchParams.get("id");
  let requestBody;
  try {
    requestBody = await request.json();
  } catch {
    return jsonResponse({ error: "bad json" }, 400);
  }
  const trade = requestBody.trade;
  if (!id || !trade || !trade.Date || !trade.Ticker) return jsonResponse({ error: "id and trade required" }, 400);
  const fields = Object.keys(FIELD_TO_COLUMN);
  await env.DB.prepare(
    `UPDATE trades SET ${fields.map(field => FIELD_TO_COLUMN[field] + "=?").join(",")} WHERE id=?`
  )
    .bind(...fields.map(field => String(trade[field] ?? "").slice(0, 20000)), id)
    .run();
  return jsonResponse({ updated: id });
}
