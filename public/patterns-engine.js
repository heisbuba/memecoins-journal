// Pattern analysis engine: pure functions, no DOM.
// Needs calc.js loaded first (calculateTrade, parseMarketCap, timeToMinutes, sum, average).

const DEFAULT_MIN_SAMPLE = 10;
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

const NOTE_STOP_WORDS = new Set(
  ("the and for that this with was were are but not you your have has had from they them then than into out " +
    "its it's just got get too very can could would should about after before again all any because been " +
    "being both did does doing down during each few more most other our own same she him her his how " +
    "what when where which while who why will won't also over under until only once here there these those " +
    "some such off one two still like need needed want wanted")
    .split(" ")
);

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
  const winnerPnls = entries.filter(entry => entry.metrics.result === "Win").map(entry => entry.metrics.pnl);
  const loserPnls = entries.filter(entry => entry.metrics.result === "Loss").map(entry => entry.metrics.pnl);
  const rMultiples = entries.map(entry => entry.metrics.rMultiple).filter(value => value != null);
  const totalPnl = sum(pnls);
  const grossWin = sum(winnerPnls);
  const grossLoss = Math.abs(sum(loserPnls));
  const averageWin = averageOrNull(winnerPnls);
  const averageLoss = averageOrNull(loserPnls);
  const bestPnl = count ? Math.max(...pnls) : null;
  return {
    count,
    wins: winnerPnls.length,
    losses: loserPnls.length,
    breakEven: count - winnerPnls.length - loserPnls.length,
    winRate: count ? winnerPnls.length / count : null,
    winRateRange: wilsonInterval(winnerPnls.length, count),
    totalPnl,
    averagePnl: averageOrNull(pnls),
    medianPnl: medianOf(pnls),
    averageWin,
    averageLoss,
    payoffRatio: averageWin != null && averageLoss ? averageWin / Math.abs(averageLoss) : null,
    profitFactor: grossLoss ? grossWin / grossLoss : null,
    averageR: averageOrNull(rMultiples),
    bestPnl,
    worstPnl: count ? Math.min(...pnls) : null,
    pnlWithoutBest: count > 1 ? totalPnl - bestPnl : null,
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
  const grandTotal = sum(entries.map(entry => entry.metrics.pnl));
  const rows = [...groups].map(([label, members]) => {
    const summary = summarizeEntries(members, minSample);
    return { label, entries: members, summary, shareOfTotal: grandTotal > 0 ? summary.totalPnl / grandTotal : null };
  });
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

function countBy(entries, keyOf) {
  const counts = {};
  entries.forEach(entry => {
    const key = keyOf(entry);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function describeMarketCaps(entries) {
  const entryCaps = entries.map(entry => entry.entryMarketCap).filter(value => value != null);
  const multiples = entries.map(entry => entry.marketCapMultiple).filter(value => value != null);
  return {
    count: entryCaps.length,
    averageEntry: averageOrNull(entryCaps),
    medianEntry: medianOf(entryCaps),
    multipleCount: multiples.length,
    averageMultiple: averageOrNull(multiples),
    medianMultiple: medianOf(multiples)
  };
}

function buildMarketCapStudy(entries, minSample) {
  const buckets = groupEntries(entries, entry => entry.marketCapBucket, {
    order: [...bucketLabels(MARKET_CAP_BUCKETS), UNKNOWN_LABEL],
    minSample
  });
  const ranked = buckets
    .filter(row => row.label !== UNKNOWN_LABEL && !row.summary.lowSample)
    .sort((a, b) => b.summary.averagePnl - a.summary.averagePnl);
  return {
    winners: describeMarketCaps(entries.filter(entry => entry.metrics.result === "Win")),
    losers: describeMarketCaps(entries.filter(entry => entry.metrics.result === "Loss")),
    all: describeMarketCaps(entries),
    buckets,
    bestBucket: ranked[0] || null,
    worstBucket: ranked.length > 1 ? ranked[ranked.length - 1] : null
  };
}

function buildTagStudy(entries, minSample) {
  const rows = groupEntries(entries, entry => entry.tags, { minSample })
    .map(row => ({ ...row, reviewCounts: countBy(row.entries, entry => entry.review) }))
    .sort((a, b) => b.summary.count - a.summary.count || a.label.localeCompare(b.label));
  const mostUsed = rows.slice(0, 5);
  const leastUsed = rows.slice(5).reverse().slice(0, 5);
  return {
    rows,
    mostUsed,
    leastUsed,
    taggedCount: entries.filter(entry => entry.tags.length).length,
    untaggedCount: entries.filter(entry => !entry.tags.length).length
  };
}

function buildKeywordRows(entries, minSample, minTrades = 2, limit = 15) {
  const wordsOf = entry =>
    [...new Set(String(entry.trade.Notes ?? "").toLowerCase().match(/\p{L}[\p{L}'-]{2,}/gu) || [])].filter(
      word => !NOTE_STOP_WORDS.has(word)
    );
  return groupEntries(entries, wordsOf, { minSample })
    .filter(row => row.summary.count >= minTrades)
    .sort((a, b) => b.summary.count - a.summary.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function describeHold(entries) {
  const hours = entries.map(entry => entry.metrics.holdHours).filter(value => value != null);
  return { count: hours.length, average: averageOrNull(hours), median: medianOf(hours) };
}

function buildRiskStudy(entries) {
  const withStop = entries.filter(entry => entry.metrics.stopLoss);
  const losersWithStop = withStop.filter(entry => entry.metrics.result === "Loss");
  const stopBreaks = losersWithStop.filter(entry => entry.metrics.slExcess < 0);
  const rOf = result =>
    averageOrNull(
      entries.filter(entry => entry.metrics.result === result && entry.metrics.rMultiple != null)
        .map(entry => entry.metrics.rMultiple)
    );
  return {
    tradesWithStop: withStop.length,
    losersWithStop: losersWithStop.length,
    stopBreaks: stopBreaks.length,
    stopBreakRate: losersWithStop.length ? stopBreaks.length / losersWithStop.length : null,
    totalSlExcess: sum(stopBreaks.map(entry => entry.metrics.slExcess)),
    averageSlExcess: averageOrNull(stopBreaks.map(entry => entry.metrics.slExcess)),
    plannedRiskReward: averageOrNull(
      entries.map(entry => entry.metrics.riskReward).filter(value => value != null)
    ),
    winnerR: rOf("Win"),
    loserR: rOf("Loss"),
    holdWinners: describeHold(entries.filter(entry => entry.metrics.result === "Win")),
    holdLosers: describeHold(entries.filter(entry => entry.metrics.result === "Loss"))
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
    planCount: countOf("Plan"),
    planPnl: pnlOf("Plan"),
    withoutMistakes: totalPnl - pnlOf("Mistake")
  };
}

// every report the patterns page shows, for one filtered set of entries
function buildPatternsReport(entries, minSample = DEFAULT_MIN_SAMPLE) {
  return {
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
    keywords: buildKeywordRows(entries, minSample),
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
}
