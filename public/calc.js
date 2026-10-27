const H = [
  "Date", "Ticker", "Strategy", "MC", "Price", "Entry Time",
  "SL", "TP", "RRR", "PnL", "Exit MC",  "Exit Time", "Review", "Tags", "Notes"
];
const BE = 0.01;

const esc = v => /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;

// normalise unicode minus/dashes
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

// single place that normalises SL/TP/PnL and derives RRR
function finalize(r) {
  ["SL", "TP", "PnL"].forEach(k => (r[k] = pf(r[k])));
  const c = calc(r);
  r.RRR = c.rrr != null ? "1:" + c.rrr.toFixed(1) : "";
  return r;
}

// average that shows "-" instead of a fake 0 when there is no data
const fmtAvg = (a, f) => (a.length ? f(avg(a)) : "-");

// market cap text ("118k", "1.2m", "3bn", "1.5 trillion") to a number
const MC_UNITS = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
const mcv = s => {
  const m = /^\$?\s*([\d.,]+)\s*(k|m(?:m|il|illion)?|b(?:n|il|illion)?|t(?:n|ril|rillion)?)?$/i.exec(
    String(s || "").trim()
  );
  return m
    ? parseFloat(m[1].replace(/,/g, "")) * (MC_UNITS[(m[2] || "").charAt(0).toLowerCase()] || 1)
    : null;
};

// test pure functions in Node
if (typeof module !== "undefined") {
  module.exports = {
    H, BE, esc, num, mins, calc, sum, avg, pc, cl, esc2,
    pf, finalize, fmtAvg, mcv, clean
  };
}
