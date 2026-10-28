// Trade fields in form and CSV order
const TRADE_FIELDS = [
  "Date", "Ticker", "Strategy", "MC", "Price", "Entry Time",
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

const timeToMinutes = time => {
  const match = /^(\d+):(\d+)/.exec(time || "");
  return match ? +match[1] * 60 + +match[2] : null;
};

// derived numbers for one trade
function calculateTrade(trade) {
  const pnl = parsePercent(trade.PnL);
  const stopLoss = parsePercent(trade.SL);
  const takeProfit = parsePercent(trade.TP);
  const entryMinutes = timeToMinutes(trade["Entry Time"]);
  const exitMinutes = timeToMinutes(trade["Exit Time"]);
  return {
    pnl,
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
  const metrics = calculateTrade(trade);
  trade.RRR = metrics.riskReward != null ? "1:" + metrics.riskReward.toFixed(1) : "";
  return trade;
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

// test pure functions in Node
if (typeof module !== "undefined") {
  module.exports = {
    TRADE_FIELDS, BREAK_EVEN_THRESHOLD, escapeCsvValue, parsePercent, timeToMinutes,
    calculateTrade, sum, average, formatPercent, signClass, escapeHtml,
    toPercentText, finalizeTrade, formatAverage, parseMarketCap, normalizeDashes
  };
}
