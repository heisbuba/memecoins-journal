// Trade fields in form and CSV order
const TRADE_FIELDS = [
  "Date", "Ticker", "Strategy", "MC", "Entry Size", "Currency", "Entry Time",
  "SL", "TP", "RRR", "PnL", "Exit MC",  "Exit Time", "Review", "Tags", "Notes"
];
const BREAK_EVEN_THRESHOLD = 0.01;

const escapeCsvValue = value =>
  /[",\n\r]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;

// normalises minues/dashes, time, and percent
const normalizeDashes = text => String(text ?? "").replace(/[\u2212\u2013\u2014]/g, "-").trim();

const parsePercent = text => {
  const value = parseFloat(normalizeDashes(text).replace("%", ""));
  return isNaN(value) ? null : value / 100;
};

const CURRENCY_SYMBOLS = { USD: "$", NGN: "₦" };
const DEFAULT_CURRENCY = "NGN";

const normalizeCurrency = text => {
  const code = String(text ?? "").trim().toUpperCase();
  return CURRENCY_SYMBOLS[code] ? code : DEFAULT_CURRENCY;
};

const detectCurrency = text => (/\$|usd/i.test(String(text ?? "")) ? "USD" : "NGN");

const parseAmount = text => {
  const value = parseFloat(normalizeDashes(text).replace(/[^0-9.\-]/g, ""));
  return isNaN(value) ? null : value;
};

const formatMoney = (amount, currency) =>
  (amount < 0 ? "-" : "") +
  CURRENCY_SYMBOLS[normalizeCurrency(currency)] +
  Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const timeToMinutes = time => {
  const match = /^(\d+):(\d+)/.exec(time || "");
  return match ? +match[1] * 60 + +match[2] : null;
};

// derived numbers for one trade
function calculateTrade(trade) {
  const pnl = parsePercent(trade.PnL);
  const stopLoss = parsePercent(trade.SL);
  const takeProfit = parsePercent(trade.TP);
  const amount = parseAmount(trade["Entry Size"]);
  const currency = normalizeCurrency(trade.Currency);
  const entryMinutes = timeToMinutes(trade["Entry Time"]);
  const exitMinutes = timeToMinutes(trade["Exit Time"]);
  return {
    pnl,
    amount,
    currency,
    pnlAmount: amount != null && pnl != null ? amount * pnl : null,
    stopLoss,
    takeProfit,
    result:
      pnl == null ? null : pnl > BREAK_EVEN_THRESHOLD ? "Win" : pnl < -BREAK_EVEN_THRESHOLD ? "Loss" : "BE",
    rMultiple: pnl != null && stopLoss ? pnl / Math.abs(stopLoss) : null,
    slExcess:
      pnl != null && stopLoss != null ? (pnl < -Math.abs(stopLoss) ? pnl + Math.abs(stopLoss) : 0) : null,
    riskReward: stopLoss && takeProfit != null ? Math.abs(takeProfit) / Math.abs(stopLoss) : null,
    holdHours:
      entryMinutes != null && exitMinutes != null
        ? (((exitMinutes - entryMinutes) % 1440 + 1440) % 1440) / 60
        : null,
    timeOfDay:
      entryMinutes == null
        ? ""
        : entryMinutes < 360
          ? "Night (00-06)"
          : entryMinutes < 720
            ? "Morning (06-12)"
            : entryMinutes < 1080
              ? "Afternoon (12-18)"
              : "Evening (18-24)"
  };
}

const sum = values => values.reduce((total, value) => total + value, 0);
const average = values => values.length ? sum(values) / values.length : 0;
const formatPercent = (fraction, decimals = 1) => (fraction * 100).toFixed(decimals) + "%";
const signClass = value => (value > 0 ? "positive" : value < 0 ? "negative" : "");
const escapeHtml = text =>
  String(text).replace(/[&<>]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
const toPercentText = text => {
  const value = parseFloat(normalizeDashes(text).replace("%", ""));
  return isNaN(value) ? "" : value + "%";
};

// normalises SL/TP/PnL > derives RRR and format average
function finalizeTrade(trade) {
  ["SL", "TP", "PnL"].forEach(field => (trade[field] = toPercentText(trade[field])));
  trade.Currency = detectCurrency(trade["Entry Size"]);
  const amount = parseAmount(trade["Entry Size"]);
  trade["Entry Size"] = amount == null ? "" : String(amount);
  const metrics = calculateTrade(trade);
  trade.RRR = metrics.riskReward != null ? "1:" + metrics.riskReward.toFixed(1) : "";
  return trade;
}

function summarizeByCurrency(metricsList) {
  const totals = {};
  metricsList.forEach(metrics => {
    if (metrics.amount == null || metrics.pnlAmount == null) return;
    const row = totals[metrics.currency] || (totals[metrics.currency] = { currency: metrics.currency, trades: 0, invested: 0, gained: 0, lost: 0, net: 0 });
    row.trades++;
    row.invested += metrics.amount;
    if (metrics.pnlAmount > 0) row.gained += metrics.pnlAmount;
    else if (metrics.pnlAmount < 0) row.lost += -metrics.pnlAmount;
    row.net += metrics.pnlAmount;
  });
  return Object.values(totals);
}

const formatAverage = (values, format) => (values.length ? format(average(values)) : "-");

// normalize marketcap
const MARKET_CAP_UNITS = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
const parseMarketCap = text => {
  const match = /^\$?\s*([\d.,]+)\s*(k|m(?:m|il|illion)?|b(?:n|il|illion)?|t(?:n|ril|rillion)?)?$/i.exec(
    String(text || "").trim()
  );
  return match
    ? parseFloat(match[1].replace(/,/g, "")) *
        (MARKET_CAP_UNITS[(match[2] || "").charAt(0).toLowerCase()] || 1)
    : null;
};

// calendar-window boundaries for the period selector
function periodRange(period) {
  if (period === "all") return null;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const weekday = (now.getDay() + 6) % 7;             // Mon=0
  const toIsoDate = date => date.toISOString().slice(0, 10);
  const utcDate = (y, m, d) => new Date(Date.UTC(y, m, d));
  switch (period) {
    case "week":     return [toIsoDate(utcDate(year, month, day - weekday)),     toIsoDate(utcDate(year, month, day - weekday + 6))];
    case "month":    return [toIsoDate(utcDate(year, month, 1)),                 toIsoDate(utcDate(year, month + 1, 0))];
    case "quarter":  { const quarter = Math.floor(month / 3);
                       return [toIsoDate(utcDate(year, quarter * 3, 1)),         toIsoDate(utcDate(year, quarter * 3 + 3, 0))]; }
    case "year":     return [toIsoDate(utcDate(year, 0, 1)),                     toIsoDate(utcDate(year, 11, 31))];
    case "lweek":    return [toIsoDate(utcDate(year, month, day - weekday - 7)), toIsoDate(utcDate(year, month, day - weekday - 1))];
    case "lmonth":   return [toIsoDate(utcDate(year, month - 1, 1)),             toIsoDate(utcDate(year, month, 0))];
    case "lquarter": { const quarter = Math.floor(month / 3) - 1;
                       return [toIsoDate(utcDate(year, quarter * 3, 1)),         toIsoDate(utcDate(year, quarter * 3 + 3, 0))]; }
    case "lyear":    return [toIsoDate(utcDate(year - 1, 0, 1)),                 toIsoDate(utcDate(year - 1, 11, 31))];
  }
  return null;
}

const PERIOD_OPTIONS_HTML = `
  <option value="all">All time</option>
  <optgroup label="Current">
    <option value="week">This week</option>
    <option value="month">This month</option>
    <option value="quarter">This quarter</option>
    <option value="year">This year</option>
  </optgroup>
  <optgroup label="Previous">
    <option value="lweek">Last week</option>
    <option value="lmonth">Last month</option>
    <option value="lquarter">Last quarter</option>
    <option value="lyear">Last year</option>
  </optgroup>`;
