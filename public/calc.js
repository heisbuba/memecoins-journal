const H = [
  "Date", "Ticker", "Strategy", "MC", "Price", "Entry Time",
  "SL", "TP", "RRR", "PnL", "Exit Time", "Exit MC", "Review", "Tags", "Notes"
];
const BE = 0.01;

function parseCSV(t) {
  const o = [];
  let r = [], f = "", q = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c == '"') {
        if (t[i + 1] == '"') {
          f += '"';
          i++;
        } else {
          q = 0;
        }
      } else {
        f += c;
      }
    } else if (c == '"') {
      q = 1;
    } else if (c == ",") {
      r.push(f);
      f = "";
    } else if (c == "\n" || c == "\r") {
      if (c == "\r" && t[i + 1] == "\n") i++;
      r.push(f);
      o.push(r);
      r = [];
      f = "";
    } else {
      f += c;
    }
  }
  if (f !== "" || r.length) {
    r.push(f);
    o.push(r);
  }
  const h = o.shift() || [];
  return o
    .filter(a => a.some(x => x.trim()))
    .map(a => Object.fromEntries(h.map((k, i) => [k.trim(), a[i] || ""])));
}

const esc = v => /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;

// normalise unicode minus/dashes (U+2212, en/em dash) so pasted "−34%" parses
const clean = s => String(s ?? "").replace(/[\u2212\u2013\u2014]/g, "-").trim();

const num = s => {
  const v = parseFloat(clean(s).replace("%", ""));
  return isNaN(v) ? null : v / 100;
};

const mins = t => {
  const m = /^(\d+):(\d+)/.exec(t || "");
  return m ? +m[1] * 60 + +m[2] : null;
};

function calc(r) {
  const p = num(r.PnL);
  const sl = num(r.SL);
  const tp = num(r.TP);
  const e = mins(r["Entry Time"]);
  const x = mins(r["Exit Time"]);
  return {
    p,
    sl,
    tp,
    res: p == null ? null : p > BE ? "Win" : p < -BE ? "Loss" : "BE",
    R: p != null && sl ? p / Math.abs(sl) : null,
    over: p != null && sl != null ? (p < -Math.abs(sl) ? p + Math.abs(sl) : 0) : null,
    rrr: sl && tp != null ? Math.abs(tp) / Math.abs(sl) : null,
    hold: e != null && x != null ? (((x - e) % 1440 + 1440) % 1440) / 60 : null,
    tod: e == null
      ? ""
      : e < 360
        ? "Night (00-06)"
        : e < 720
          ? "Morning (06-12)"
          : e < 1080
            ? "Afternoon (12-18)"
            : "Evening (18-24)"
  };
}

const sum = a => a.reduce((x, y) => x + y, 0);
const avg = a => a.length ? sum(a) / a.length : 0;
const pc = (v, d = 1) => (v * 100).toFixed(d) + "%";
const cl = v => (v > 0 ? "g" : v < 0 ? "r" : "");
const esc2 = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const pf = s => {
  const v = parseFloat(clean(s).replace("%", ""));
  return isNaN(v) ? "" : v + "%";
};

// single place that normalises SL/TP/PnL and derives RRR: used by add, CSV, JSON and legacy-JSON import
function finalize(r) {
  ["SL", "TP", "PnL"].forEach(k => (r[k] = pf(r[k])));
  const c = calc(r);
  r.RRR = c.rrr != null ? "1:" + c.rrr.toFixed(1) : "";
  return r;
}

const fromRow = o => finalize(Object.fromEntries(H.map(k => [k, String(o[k] ?? "").trim()])));

// average that shows "-" instead of a fake 0 when there is no data
const fmtAvg = (a, f) => (a.length ? f(avg(a)) : "-");

const mcv = s => {
  const m = /^\$?\s*([\d.,]+)\s*([kmb])?$/i.exec(String(s || "").trim());
  return m
    ? parseFloat(m[1].replace(/,/g, "")) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || "").toLowerCase()] || 1)
    : null;
};

function fromOld(o) {
  const e = mcv(o.entry_mcap);
  const raw = String(o.take_profit || "").trim();
  let tp = raw;
  if (/[kmb]$/i.test(raw) && e && mcv(raw)) {
    tp = ((mcv(raw) / e - 1) * 100).toFixed(1) + "%";
  }
  const r = {
    Date: o.trade_date || "",
    Ticker: o.ticker || "",
    Strategy: o.strategy || "",
    MC: o.entry_mcap || "",
    Price: o.entry_price || "",
    "Entry Time": o.entry_time || "",
    SL: pf(o.stop_loss || ""),
    TP: pf(tp),
    RRR: "",
    PnL: pf(o.pnl || ""),
    "Exit Time": o.exit_time || "",
    "Exit MC": o.exit_mcap || "",
    Review: o.rules_followed ? "Plan" : "Mistake",
    Tags: Array.isArray(o.tags) ? o.tags.join(", ") : (o.tags || ""),
    Notes: o.notes || ""
  };
  return finalize(r);
}

// lets the pure functions be unit-tested in Node; ignored in the browser
if (typeof module !== "undefined") {
  module.exports = {
    H, BE, parseCSV, esc, num, mins, calc, sum, avg, pc, cl, esc2,
    pf, finalize, fromRow, fmtAvg, mcv, fromOld, clean
  };
}
