// Pattern analysis engine: pure functions, no DOM.
// Needs calc.js loaded first (calculateTrade, parseMarketCap, timeToMinutes, sum, average).

const DEFAULT_MIN_SAMPLE = 5;
const UNKNOWN_LABEL = "Unknown";
const NO_VALUE_LABEL = "(none)";
const NO_STOP_LABEL = "No SL";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIME_OF_DAY_LABELS = ["Night (00-06)", "Morning (06-12)", "Afternoon (12-18)", "Evening (18-24)"];
const REVIEW_LABELS = ["Plan", "Mistake", "Unplanned"];

// a value belongs to the first bucket whose max is above it
const MARKET_CAP_BUCKETS = [
  { label: "<50k", max: 5e4 },
  { label: "50k-100k", max: 1e5 },
  { label: "100k-250k", max: 2.5e5 },
  { label: "250k-500k", max: 5e5 },
  { label: "500k-1M", max: 1e6 },
  { label: "1M-5M", max: 5e6 },
  { label: "5M+", max: Infinity }
];
const HOLD_BUCKETS = [
  { label: "<15m", max: 0.25 },
  { label: "15m-1h", max: 1 },
  { label: "1-4h", max: 4 },
  { label: "4-12h", max: 12 },
  { label: "12h+", max: Infinity }
];
const STOP_LOSS_BUCKETS = [
  { label: "<10%", max: 0.1 },
  { label: "10-20%", max: 0.2 },
  { label: "20-30%", max: 0.3 },
  { label: "30-50%", max: 0.5 },
  { label: "50%+", max: Infinity }
];
const bucketLabels = buckets => buckets.map(bucket => bucket.label);

const finiteOrNull = value => (Number.isFinite(value) ? value : null);
const averageOrNull = values => (values.length ? average(values) : null);

function medianOf(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// 95% Wilson score interval for a win rate
function wilsonInterval(successes, total, z = 1.96) {
  if (!total) return null;
  const proportion = successes / total;
  const zSquared = z * z;
  const denominator = 1 + zSquared / total;
  const centre = (proportion + zSquared / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((proportion * (1 - proportion)) / total + zSquared / (4 * total * total))) / denominator;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

function pickBucket(buckets, value) {
  if (value == null || Number.isNaN(value)) return UNKNOWN_LABEL;
  return buckets.find(bucket => value < bucket.max).label;
}

// same text in any casing shares one label, spelled like its first appearance
function canonicalLabel(labelPool, text) {
  const cleaned = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const key = cleaned.toLowerCase();
  if (!labelPool.has(key)) labelPool.set(key, cleaned);
  return labelPool.get(key);
}

function parseTagList(text, labelPool) {
  const tags = [];
  String(text ?? "")
    .split(/[,;]+/)
    .forEach(part => {
      const tag = canonicalLabel(labelPool, part);
      if (tag && !tags.includes(tag)) tags.push(tag);
    });
  return tags;
}

function weekdayOf(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText || "")) return UNKNOWN_LABEL;
  const dayIndex = new Date(dateText + "T00:00:00Z").getUTCDay();
  return Number.isNaN(dayIndex) ? UNKNOWN_LABEL : WEEKDAY_LABELS[(dayIndex + 6) % 7];
}

function formatMarketCap(value) {
  if (value == null) return "-";
  const units = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "k"]];
  for (const [size, suffix] of units) if (value >= size) return +(value / size).toFixed(1) + suffix;
  return String(Math.round(value));
}

// closed trades (with a PnL) plus the features every report slices by
function enrichTrades(trades) {
  const strategyLabels = new Map();
  const tagLabels = new Map();
  const entries = [];
  trades.forEach((trade, index) => {
    const metrics = calculateTrade(trade);
    if (metrics.pnl == null) return;
    const entryMinutes = timeToMinutes(trade["Entry Time"]);
    const entryMarketCap = finiteOrNull(parseMarketCap(trade.MC));
    const exitMarketCap = finiteOrNull(parseMarketCap(trade["Exit MC"]));
    entries.push({
      trade,
      index,
      metrics,
      strategy: canonicalLabel(strategyLabels, trade.Strategy) || NO_VALUE_LABEL,
      review: String(trade.Review ?? "").trim() || NO_VALUE_LABEL,
      tags: parseTagList(trade.Tags, tagLabels),
      entryMarketCap,
      exitMarketCap,
      marketCapMultiple: entryMarketCap > 0 && exitMarketCap != null ? exitMarketCap / entryMarketCap : null,
      weekday: weekdayOf(trade.Date),
      hour: entryMinutes == null ? UNKNOWN_LABEL : String(Math.floor(entryMinutes / 60)).padStart(2, "0") + ":00",
      timeOfDay: metrics.timeOfDay || UNKNOWN_LABEL,
      marketCapBucket: pickBucket(MARKET_CAP_BUCKETS, entryMarketCap),
      holdBucket: pickBucket(HOLD_BUCKETS, metrics.holdHours),
      stopLossBucket: metrics.stopLoss ? pickBucket(STOP_LOSS_BUCKETS, Math.abs(metrics.stopLoss)) : NO_STOP_LABEL
    });
  });
  return entries;
}

function filterEntries(entries, filters = {}) {
  const { range = null, strategy = "", review = "", minMarketCap = null, maxMarketCap = null } = filters;
  return entries.filter(entry => {
    const date = entry.trade.Date;
    if (range && !(date && date >= range[0] && date <= range[1])) return false;
    if (strategy && entry.strategy !== strategy) return false;
    if (review && entry.review !== review) return false;
    if (minMarketCap != null && !(entry.entryMarketCap != null && entry.entryMarketCap >= minMarketCap)) return false;
    if (maxMarketCap != null && !(entry.entryMarketCap != null && entry.entryMarketCap <= maxMarketCap)) return false;
    return true;
  });
}

// one metric suite used for every slice
function summarizeEntries(entries, minSample = DEFAULT_MIN_SAMPLE) {
  const count = entries.length;
  const pnls = entries.map(entry => entry.metrics.pnl);
  const wins = entries.filter(entry => entry.metrics.result === "Win").length;
  const totalPnl = sum(pnls);
  return {
    count,
    winRate: count ? wins / count : null,
    winRateRange: wilsonInterval(wins, count),
    totalPnl,
    averagePnl: averageOrNull(pnls),
    pnlWithoutBest: count > 1 ? totalPnl - Math.max(...pnls) : null,
    lowSample: count < minSample
  };
}

// keyOf returns a label, a list of labels (tags), or null to skip the trade
function groupEntries(entries, keyOf, options = {}) {
  const { order = null, sortBy = "totalPnl", minSample = DEFAULT_MIN_SAMPLE } = options;
  const groups = new Map();
  entries.forEach(entry => {
    [].concat(keyOf(entry)).forEach(key => {
      if (key == null || key === "") return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });
  });
  const rows = [...groups].map(([label, members]) => ({ label, summary: summarizeEntries(members, minSample) }));
  if (order) {
    const position = label => (order.includes(label) ? order.indexOf(label) : order.length);
    rows.sort((a, b) => position(a.label) - position(b.label) || a.label.localeCompare(b.label));
  } else if (sortBy === "label") {
    rows.sort((a, b) => a.label.localeCompare(b.label));
  } else {
    rows.sort((a, b) => b.summary.totalPnl - a.summary.totalPnl || a.label.localeCompare(b.label));
  }
  return rows;
}

const medianEntryMarketCap = entries =>
  medianOf(entries.map(entry => entry.entryMarketCap).filter(value => value != null));

function buildMarketCapStudy(entries, minSample) {
  return {
    buckets: groupEntries(entries, entry => entry.marketCapBucket, {
      order: [...bucketLabels(MARKET_CAP_BUCKETS), UNKNOWN_LABEL],
      minSample
    }),
    winnersMedianEntry: medianEntryMarketCap(entries.filter(entry => entry.metrics.result === "Win")),
    losersMedianEntry: medianEntryMarketCap(entries.filter(entry => entry.metrics.result === "Loss"))
  };
}

function buildTagStudy(entries, minSample) {
  return {
    rows: groupEntries(entries, entry => entry.tags, { minSample }),
    taggedCount: entries.filter(entry => entry.tags.length).length,
    untaggedCount: entries.filter(entry => !entry.tags.length).length
  };
}

const medianHold = entries =>
  medianOf(entries.map(entry => entry.metrics.holdHours).filter(value => value != null));

function buildRiskStudy(entries) {
  const losersWithStop = entries.filter(entry => entry.metrics.stopLoss && entry.metrics.result === "Loss");
  const stopBreaks = losersWithStop.filter(entry => entry.metrics.slExcess < 0);
  return {
    losersWithStop: losersWithStop.length,
    stopBreaks: stopBreaks.length,
    stopBreakRate: losersWithStop.length ? stopBreaks.length / losersWithStop.length : null,
    totalSlExcess: sum(stopBreaks.map(entry => entry.metrics.slExcess)),
    holdWinners: medianHold(entries.filter(entry => entry.metrics.result === "Win")),
    holdLosers: medianHold(entries.filter(entry => entry.metrics.result === "Loss"))
  };
}

function buildReviewImpact(entries) {
  const pnlOf = review => sum(entries.filter(entry => entry.review === review).map(entry => entry.metrics.pnl));
  const countOf = review => entries.filter(entry => entry.review === review).length;
  const totalPnl = sum(entries.map(entry => entry.metrics.pnl));
  return {
    totalPnl,
    mistakeCount: countOf("Mistake"),
    mistakePnl: pnlOf("Mistake"),
    unplannedCount: countOf("Unplanned"),
    unplannedPnl: pnlOf("Unplanned"),
    withoutMistakes: totalPnl - pnlOf("Mistake")
  };
}

// best and weakest rows that have enough trades and a clear sign
function extremesOf(group, rows) {
  const ranked = rows
    .filter(row => !row.summary.lowSample && ![UNKNOWN_LABEL, NO_VALUE_LABEL].includes(row.label))
    .sort((a, b) => b.summary.totalPnl - a.summary.totalPnl);
  if (!ranked.length) return null;
  const best = ranked[0].summary.totalPnl > 0 ? ranked[0] : null;
  const last = ranked[ranked.length - 1];
  const worst = last !== best && last.summary.totalPnl < 0 ? last : null;
  return best || worst ? { type: "extremes", group, best, worst } : null;
}

function buildFindings(report) {
  const findings = [
    extremesOf("Strategy", report.strategies),
    extremesOf("Time of day", report.timeOfDay),
    extremesOf("Weekday", report.weekdays),
    extremesOf("Entry market cap", report.marketCap.buckets)
  ].filter(Boolean);
  const impact = report.reviewImpact;
  if (impact.mistakeCount && impact.mistakePnl < 0) findings.push({ type: "mistakes", ...impact });
  const { totalPnl, pnlWithoutBest } = report.overview;
  if (totalPnl > 0 && pnlWithoutBest != null && pnlWithoutBest <= 0) {
    findings.push({ type: "outlier", totalPnl, pnlWithoutBest });
  }
  return findings;
}

// every report the patterns page shows, for one filtered set of entries
function buildPatternsReport(entries, minSample = DEFAULT_MIN_SAMPLE) {
  const report = {
    overview: summarizeEntries(entries, minSample),
    strategies: groupEntries(entries, entry => entry.strategy, { minSample }),
    timeOfDay: groupEntries(entries, entry => entry.timeOfDay, {
      order: [...TIME_OF_DAY_LABELS, UNKNOWN_LABEL],
      minSample
    }),
    weekdays: groupEntries(entries, entry => entry.weekday, { order: [...WEEKDAY_LABELS, UNKNOWN_LABEL], minSample }),
    hours: groupEntries(entries, entry => entry.hour, { sortBy: "label", minSample }),
    marketCap: buildMarketCapStudy(entries, minSample),
    reviews: groupEntries(entries, entry => entry.review, { order: [...REVIEW_LABELS, NO_VALUE_LABEL], minSample }),
    reviewImpact: buildReviewImpact(entries),
    tags: buildTagStudy(entries, minSample),
    risk: buildRiskStudy(entries),
    stopLossBuckets: groupEntries(entries, entry => entry.stopLossBucket, {
      order: [...bucketLabels(STOP_LOSS_BUCKETS), NO_STOP_LABEL],
      minSample
    }),
    holdBuckets: groupEntries(entries, entry => entry.holdBucket, {
      order: [...bucketLabels(HOLD_BUCKETS), UNKNOWN_LABEL],
      minSample
    })
  };
  return { ...report, findings: buildFindings(report) };
}
