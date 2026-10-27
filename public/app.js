let rows = [];
const $ = i => document.getElementById(i);
const say = m => ($("st").textContent = m);

async function api(m, body, q = "") {
  const r = await fetch("/api/trades" + q, {
    method: m,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status == 401) {
    $("lock").style.display = "grid";
    $("pin").focus();
    throw new Error("locked");
  }
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

async function load() {
  say("Loading...");
  try {
    rows = await api("GET");
    say(rows.length + " trades");
    $("lock").style.display = "none";
  } catch (e) {
    say(e.message == "locked" ? "" : "Load failed: " + e.message);
  }
  render();
}

function group(list, key) {
  const m = {};
  list.forEach(t => {
    const k = t.r[key] || "-";
    (m[k] = m[k] || []).push(t.c);
  });
  return Object.entries(m)
    .map(([k, a]) => {
      const w = a.filter(c => c.res == "Win").length;
      const s = sum(a.map(c => c.p));
      return (
        `<tr><td>${esc2(k)}</td><td>${a.length}</td><td>${pc(w / a.length, 0)}</td>` +
        `<td class="${cl(s)}">${pc(s)}</td>` +
        `<td>${fmtAvg(a.filter(c => c.R != null).map(c => c.R), v => v.toFixed(2) + "R")}</td></tr>`
      );
    })
    .join("");
}

const hdr = n =>
  `<tr><th>${n}</th><th>Trades</th><th>Win %</th><th>PnL</th><th>Avg R</th></tr>`;

const SEARCH = ["Ticker", "Strategy", "Tags", "Notes", "Review"];
let qt, q = "", sortK = "Date", sortD = -1, page = 0, PS = 20;

const SK = {
  Date: t => t.r.Date,
  Ticker: t => (t.r.Ticker || "").toLowerCase(),
  Strategy: t => (t.r.Strategy || "").toLowerCase(),
  "Entry MC": t => mcv(t.r.MC),
  SL: t => (t.c.sl == null ? null : Math.abs(t.c.sl)),
  TP: t => t.c.tp,
  RRR: t => t.c.rrr,
  PnL: t => t.c.p,
  "Exit MC": t => mcv(t.r["Exit MC"]),
  Result: t => t.c.res,
  R: t => t.c.R,
  Overshoot: t => t.c.over,
  Hold: t => t.c.hold,
  "Time of day": t => mins(t.r["Entry Time"]),
  Review: t => t.r.Review || null,
  Tags: t => (t.r.Tags || "").toLowerCase() || null
};

function render() {
  const all = rows.map(r => ({ r, c: calc(r) }));
  const cl_ = all.filter(t => t.c.p != null);
  const C = cl_.map(t => t.c);

  const w = C.filter(c => c.res == "Win");
  const l = C.filter(c => c.res == "Loss");
  const tot = sum(C.map(c => c.p));
  const gw = sum(w.map(c => c.p));
  const gl = Math.abs(sum(l.map(c => c.p)));
  const ov = sum(C.map(c => c.over || 0));
  const rr = avg(C.filter(c => c.rrr != null).map(c => c.rrr));

  const K = [
    ["Trades", C.length],
    ["Win rate", C.length ? pc(w.length / C.length) : "-"],
    ["Total PnL", `<i class="${cl(tot)}">${pc(tot)}</i>`],
    ["Profit factor", gl ? (gw / gl).toFixed(2) : "-"],
    ["Avg R / trade", fmtAvg(C.filter(c => c.R != null).map(c => c.R), v => v.toFixed(2) + "R")],
    ["Break-even win rate", rr ? pc(1 / (1 + rr)) : "-"],
    ["Avg hold winners", fmtAvg(w.filter(c => c.hold != null).map(c => c.hold), v => v.toFixed(1) + "h")],
    ["Avg hold losers", fmtAvg(l.filter(c => c.hold != null).map(c => c.hold), v => v.toFixed(1) + "h")]
  ];

  $("kpi").innerHTML = K.map(([a, b]) => `<div class="k"><b>${b}</b><span>${a}</span></div>`).join("");
  $("t1").innerHTML = hdr("Strategy") + group(cl_, "Strategy");

  const tt = cl_.map(t => ({ r: { ...t.r, tod: t.c.tod }, c: t.c }));
  $("t2").innerHTML = hdr("Time of day") + group(tt, "tod") + hdr("Review") + group(cl_, "Review");

  $("sl").innerHTML = [...new Set(rows.map(r => r.Strategy).filter(Boolean))]
    .map(s => `<option value="${s.replace(/"/g, "&quot;")}">`)
    .join("");

  const cols = ["Date", "Ticker", "Strategy", "MC", "SL", "TP", "RRR", "PnL", "Exit MC"];
  const ths = [...cols, "Result", "R", "SL-excess", "Hold", "Time of day", "Review", "Tags"];

  let v = all.map((t, i) => ({ t, i }));
  if (q) {
    v = v.filter(({ t }) =>
      (SEARCH.map(k => t.r[k] || "").join(" ") + " " + (t.c.res || "")).toLowerCase().includes(q)
    );
  }

  const g = SK[sortK] || SK.Date;
  v.sort((a, b) => {
    const x = g(a.t), y = g(b.t);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return ((x < y ? -1 : x > y ? 1 : 0) * sortD) || ((a.i - b.i) * sortD);
  });

  const pages = Math.max(1, Math.ceil(v.length / PS));
  if (page >= pages) page = pages - 1;
  if (page < 0) page = 0;

  const from = page * PS;
  const vis = v.slice(from, from + PS);

  $("pi").textContent =
    (v.length ? from + 1 + "–" + (from + vis.length) : "0") +
    " of " + v.length +
    (q && v.length != all.length ? " (filtered from " + all.length + ")" : "") +
    " · page " + (page + 1) + "/" + pages;

  $("prev").disabled = page <= 0;
  $("next").disabled = page >= pages - 1;

  $("tb").innerHTML =
    `<tr>${ths.map(k =>
      `<th class="srt" data-k="${k}" style="cursor:pointer">${k}${sortK == k ? (sortD > 0 ? " ▲" : " ▼") : ""}</th>`
    ).join("")}<th></th></tr>` +
    vis
      .map(({ t, i }) => {
        const c = t.c;
        return (
          `<tr title="${esc2((t.r.Notes || "").slice(0, 400)).replace(/"/g, "&quot;")}">` +
          cols.map(k => `<td>${esc2(t.r[k] || "")}</td>`).join("") +
          `<td class="${c.res == "Win" ? "g" : c.res == "Loss" ? "r" : ""}">${c.res || ""}</td>` +
          `<td>${c.R == null ? "" : c.R.toFixed(2) + "R"}</td>` +
          `<td class="${cl(c.over)}">${c.over ? pc(c.over) : ""}</td>` +
          `<td>${c.hold == null ? "" : c.hold.toFixed(1) + "h"}</td>` +
          `<td>${c.tod}</td>` +
          `<td>${esc2(t.r.Review || "")}</td>` +
          `<td>${esc2(t.r.Tags || "")}</td>` +
          `<td><a href="#" data-i="${i}" class="ed" title="Edit">✎</a> ` +
          `<a href="#" data-i="${i}" class="del" title="Delete">✕</a></td></tr>`
        );
      })
      .join("");
}

["SL", "TP"].forEach(k => {
  $(k).oninput = () => {
    const s = num($("SL").value);
    const t = num($("TP").value);
    $("RRR").value = s && t != null ? "1:" + (Math.abs(t) / Math.abs(s)).toFixed(1) : "";
  };
});

let editId = null;

function endEdit() {
  editId = null;
  ["Ticker", "MC", "Price", "Entry Time", "SL", "TP", "RRR", "PnL", "Exit Time", "Exit MC", "Tags", "Notes"].forEach(
    k => ($(k).value = "")
  );
  $("Date").valueAsDate = new Date();
  $("add").textContent = "Add trade";
  $("cancel").style.display = "none";
}

function startEdit(x) {
  editId = x.id;
  H.forEach(k => {
    const e = $(k);
    if (e) {
      e.value = ["SL", "TP", "PnL"].includes(k)
        ? String(x[k] || "").replace("%", "")
        : (x[k] || "");
    }
  });
  $("SL").dispatchEvent(new Event("input"));
  $("add").textContent = "Save changes";
  $("cancel").style.display = "";
  $("Date").scrollIntoView({ behavior: "smooth", block: "center" });
  say("Editing " + x.Ticker);
}

$("cancel").onclick = () => {
  endEdit();
  say("");
};

$("add").onclick = async () => {
  const r = {};
  H.forEach(k => {
    const e = $(k);
    r[k] = e ? e.value.trim() : "";
  });
  r.Ticker = r.Ticker && !r.Ticker.startsWith("$") ? "$" + r.Ticker : r.Ticker;
  if (!r.Date || !r.Ticker) return say("Date and Ticker are required");
  finalize(r);
  try {
    const was = editId;
    if (was) await api("PUT", { trade: r }, "?id=" + was);
    else await api("POST", { trades: [r] });
    endEdit();
    await load();
    say(was ? "Updated ✓" : "Saved ✓");
  } catch (e) {
    say("Save failed: " + e.message);
  }
};

$("q").oninput = e => {
  const val = e.target.value;
  clearTimeout(qt);
  qt = setTimeout(() => {
    q = val.toLowerCase().trim();
    page = 0;
    render();
  }, 150);
};

$("ps").onchange = e => {
  PS = +e.target.value;
  page = 0;
  render();
};

$("prev").onclick = () => {
  page--;
  render();
};
$("next").onclick = () => {
  page++;
  render();
};

$("tb").onclick = async e => {
  const th = e.target.closest && e.target.closest("th[data-k]");
  if (th) {
    const k = th.dataset.k;
    sortD = sortK == k ? -sortD : 1;
    sortK = k;
    page = 0;
    return render();
  }
  const c = e.target.classList;
  if (c.contains("ed")) {
    e.preventDefault();
    return startEdit(rows[+e.target.dataset.i]);
  }
  if (!c.contains("del")) return;
  e.preventDefault();
  const x = rows[+e.target.dataset.i];
  if (!confirm("Delete " + x.Ticker + "?")) return;
  try {
    await api("DELETE", null, "?id=" + x.id);
    await load();
  } catch (_) {
    say("Delete failed");
  }
};

function dl(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

$("exc").onclick = () =>
  dl(
    "trades-" + stamp() + ".csv",
    [H.join(",")].concat(rows.map(r => H.map(k => esc(r[k] || "")).join(","))).join("\n") + "\n",
    "text/csv"
  );

$("unlock").onclick = async () => {
  const le = $("le");
  le.textContent = "";
  try {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: $("pin").value })
    });
    if (r.ok) {
      $("pin").value = "";
      load();
      return;
    }
    let m = "";
    try {
      m = (await r.json()).error || "";
    } catch (_) {}
    le.textContent = m || ("Server error " + r.status + " - check D1 tables, DB binding and secrets");
  } catch (e) {
    le.textContent = "Network error";
  }
};

$("pin").onkeydown = e => {
  if (e.key == "Enter") $("unlock").click();
};

$("lk").onclick = async () => {
  await fetch("/api/login", { method: "DELETE" });
  rows = [];
  render();
  say("");
  $("lock").style.display = "grid";
};

$("reload").onclick = load;
$("Date").valueAsDate = new Date();
load();
