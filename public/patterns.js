// Patterns page UI. Analysis lives in patterns-engine.js.

const byId = id => document.getElementById(id);
const setStatus = message => (byId("status-text").textContent = message);

const OFFLINE_MESSAGE = "You're offline. Trades need a connection.";
const LOCKED_MESSAGE_HTML = 'The session is locked. <a href="/">Unlock on the journal page</a>, then reload.';
const EMPTY_MESSAGE = "No closed trades yet. Add trades with a PnL on the journal page.";

let allEntries = [];
let skippedTradeCount = 0;
let minSample = DEFAULT_MIN_SAMPLE;

const escapeAttribute = text => escapeHtml(text).replace(/"/g, "&quot;");
const formatPercentOrDash = value => (value == null ? "-" : formatPercent(value));
const formatRMultiple = value => (value == null ? "-" : value.toFixed(2) + "R");
const formatRatio = value => (value == null ? "-" : value.toFixed(2));
const formatMultiple = value => (value == null ? "-" : value.toFixed(2) + "x");
const formatHours = hours => (hours == null ? "-" : hours < 1 ? Math.round(hours * 60) + "m" : hours.toFixed(1) + "h");
const pnlHtml = value => (value == null ? "-" : `<span class="${signClass(value)}">${formatPercent(value)}</span>`);

function showMessage(html) {
  const message = byId("patterns-message");
  message.innerHTML = html;
  message.hidden = !html;
}

const setContentVisible = visible => (byId("patterns-content").hidden = !visible);

function statCardHtml(label, valueHtml) {
  return `<div class="stat-card"><span class="stat-value">${valueHtml}</span><span class="stat-label">${label}</span></div>`;
}

function emptyTableHtml(firstHeader) {
  return `<tr><th>${firstHeader}</th></tr><tr><td class="empty-cell">No trades match the filters.</td></tr>`;
}

// standard metric columns for any slice of trades
function sliceTableHtml(rows, firstHeader) {
  if (!rows.length) return emptyTableHtml(firstHeader);
  const maxTotal = Math.max(...rows.map(row => Math.abs(row.summary.totalPnl)));
  const header =
    `<tr><th>${firstHeader}</th><th>Trades</th><th>Win %</th><th>Total PnL</th><th>Avg PnL</th><th>Median</th>` +
    `<th>Avg win</th><th>Avg loss</th><th>Profit factor</th><th>Avg R</th><th>Share</th></tr>`;
  const body = rows.map(row => {
    const summary = row.summary;
    const barWidth = maxTotal ? Math.round((Math.abs(summary.totalPnl) / maxTotal) * 100) : 0;
    const barClass = summary.totalPnl >= 0 ? "pnl-bar-positive" : "pnl-bar-negative";
    const range = summary.winRateRange
      ? `95% range ${formatPercent(summary.winRateRange[0], 0)} to ${formatPercent(summary.winRateRange[1], 0)}`
      : "";
    const rowTitle = summary.lowSample ? `Fewer than ${minSample} trades` : "";
    return (
      `<tr class="${summary.lowSample ? "low-sample" : ""}" title="${rowTitle}">` +
      `<td>${escapeHtml(row.label)}</td>` +
      `<td>${summary.count}</td>` +
      `<td title="${range}">${formatPercentOrDash(summary.winRate)}</td>` +
      `<td class="pnl-bar-cell">${pnlHtml(summary.totalPnl)}<span class="pnl-bar ${barClass}" data-width="${barWidth}"></span></td>` +
      `<td>${pnlHtml(summary.averagePnl)}</td>` +
      `<td>${pnlHtml(summary.medianPnl)}</td>` +
      `<td>${pnlHtml(summary.averageWin)}</td>` +
      `<td>${pnlHtml(summary.averageLoss)}</td>` +
      `<td>${formatRatio(summary.profitFactor)}</td>` +
      `<td>${formatRMultiple(summary.averageR)}</td>` +
      `<td>${row.shareOfTotal == null ? "-" : formatPercent(row.shareOfTotal, 0)}</td>` +
      `</tr>`
    );
  });
  return header + body.join("");
}

function marketCapCompareHtml(study) {
  const groups = [["Winners", study.winners], ["Losers", study.losers], ["All trades", study.all]];
  const header =
    "<tr><th>Group</th><th>Trades with MC</th><th>Avg entry MC</th><th>Median entry MC</th>" +
    "<th>Avg exit multiple</th><th>Median exit multiple</th></tr>";
  const body = groups.map(
    ([label, group]) =>
      `<tr><td>${label}</td><td>${group.count}</td><td>${formatMarketCap(group.averageEntry)}</td>` +
      `<td>${formatMarketCap(group.medianEntry)}</td><td>${formatMultiple(group.averageMultiple)}</td>` +
      `<td>${formatMultiple(group.medianMultiple)}</td></tr>`
  );
  return header + body.join("");
}

function marketCapHeadlineHtml(study) {
  if (!study.bestBucket) return `No market cap bucket has ${minSample}+ trades yet.`;
  const describe = row => `${row.label} (avg ${formatPercent(row.summary.averagePnl)}, ${row.summary.count} trades)`;
  let text = `<strong>Best bucket:</strong> ${describe(study.bestBucket)}.`;
  if (study.worstBucket) text += ` <strong>Weakest:</strong> ${describe(study.worstBucket)}.`;
  return text;
}

function reviewImpactHtml(impact) {
  if (!impact.mistakeCount && !impact.unplannedCount) return "No Mistake or Unplanned trades in this view.";
  const parts = [];
  if (impact.mistakeCount) {
    parts.push(
      `<strong>Mistake trades:</strong> ${impact.mistakeCount} for ${pnlHtml(impact.mistakePnl)}. ` +
        `Total without them: ${pnlHtml(impact.withoutMistakes)} (actual ${pnlHtml(impact.totalPnl)}).`
    );
  }
  if (impact.unplannedCount) {
    parts.push(`<strong>Unplanned trades:</strong> ${impact.unplannedCount} for ${pnlHtml(impact.unplannedPnl)}.`);
  }
  return parts.join(" ");
}

function tagListHtml(rows) {
  return rows.length ? rows.map(row => `${escapeHtml(row.label)} (${row.summary.count})`).join(", ") : "-";
}

function tagHighlightsHtml(tagStudy) {
  if (!tagStudy.rows.length) return "No tags logged in this view.";
  let text = `<strong>Most mentioned:</strong> ${tagListHtml(tagStudy.mostUsed)}.`;
  if (tagStudy.leastUsed.length) text += ` <strong>Least mentioned:</strong> ${tagListHtml(tagStudy.leastUsed)}.`;
  return text + ` ${tagStudy.taggedCount} tagged, ${tagStudy.untaggedCount} untagged trades.`;
}

function tagTableHtml(tagStudy) {
  if (!tagStudy.rows.length) return emptyTableHtml("Tag");
  const header =
    "<tr><th>Tag</th><th>Used</th><th>Plan</th><th>Mistake</th><th>Unplanned</th><th>Win %</th>" +
    "<th>Total PnL</th><th>Avg PnL</th></tr>";
  const body = tagStudy.rows.map(row => {
    const summary = row.summary;
    return (
      `<tr class="${summary.lowSample ? "low-sample" : ""}">` +
      `<td>${escapeHtml(row.label)}</td><td>${summary.count}</td>` +
      `<td>${row.reviewCounts.Plan || 0}</td><td>${row.reviewCounts.Mistake || 0}</td>` +
      `<td>${row.reviewCounts.Unplanned || 0}</td>` +
      `<td>${formatPercentOrDash(summary.winRate)}</td><td>${pnlHtml(summary.totalPnl)}</td>` +
      `<td>${pnlHtml(summary.averagePnl)}</td></tr>`
    );
  });
  return header + body.join("");
}

function overviewHtml(summary) {
  return [
    statCardHtml("Trades", summary.count),
    statCardHtml("Win rate", formatPercentOrDash(summary.winRate)),
    statCardHtml("Total PnL", pnlHtml(summary.totalPnl)),
    statCardHtml("Avg PnL per trade", pnlHtml(summary.averagePnl)),
    statCardHtml("Median PnL", pnlHtml(summary.medianPnl)),
    statCardHtml("Profit factor", formatRatio(summary.profitFactor)),
    statCardHtml("Avg R", formatRMultiple(summary.averageR)),
    statCardHtml("Total without best trade", pnlHtml(summary.pnlWithoutBest))
  ].join("");
}

function riskStatsHtml(risk) {
  return [
    statCardHtml(`Losers past stop (${risk.stopBreaks}/${risk.losersWithStop})`, formatPercentOrDash(risk.stopBreakRate)),
    statCardHtml("Avg loss beyond stop", pnlHtml(risk.averageSlExcess)),
    statCardHtml("Total beyond stop", pnlHtml(risk.totalSlExcess)),
    statCardHtml("Planned avg RRR", risk.plannedRiskReward == null ? "-" : "1:" + risk.plannedRiskReward.toFixed(1)),
    statCardHtml("Avg R of winners", formatRMultiple(risk.winnerR)),
    statCardHtml("Avg R of losers", formatRMultiple(risk.loserR)),
    statCardHtml("Median hold, winners", formatHours(risk.holdWinners.median)),
    statCardHtml("Median hold, losers", formatHours(risk.holdLosers.median))
  ].join("");
}

function applyBarWidths() {
  document.querySelectorAll("[data-width]").forEach(bar => (bar.style.width = bar.dataset.width + "%"));
}

function currentFilters() {
  return {
    range: periodRange(byId("period-select").value),
    strategy: byId("strategy-filter").value,
    review: byId("review-filter").value,
    minMarketCap: parseMarketCap(byId("min-market-cap-filter").value),
    maxMarketCap: parseMarketCap(byId("max-market-cap-filter").value)
  };
}

function renderPatterns() {
  minSample = Math.max(1, parseInt(byId("min-sample-input").value, 10) || DEFAULT_MIN_SAMPLE);
  const filters = currentFilters();
  byId("period-select").title = filters.range ? `${filters.range[0]} to ${filters.range[1]}` : "All trades";
  const entries = filterEntries(allEntries, filters);
  const report = buildPatternsReport(entries, minSample);

  byId("overview-stats").innerHTML = overviewHtml(report.overview);
  byId("strategy-table").innerHTML = sliceTableHtml(report.strategies, "Strategy");
  byId("time-of-day-table").innerHTML = sliceTableHtml(report.timeOfDay, "Time of day");
  byId("weekday-table").innerHTML = sliceTableHtml(report.weekdays, "Weekday");
  byId("hour-table").innerHTML = sliceTableHtml(report.hours, "Hour");
  byId("market-cap-headline").innerHTML = marketCapHeadlineHtml(report.marketCap);
  byId("market-cap-compare-table").innerHTML = marketCapCompareHtml(report.marketCap);
  byId("market-cap-bucket-table").innerHTML = sliceTableHtml(report.marketCap.buckets, "Entry MC");
  byId("review-table").innerHTML = sliceTableHtml(report.reviews, "Review");
  byId("review-impact").innerHTML = reviewImpactHtml(report.reviewImpact);
  byId("tag-highlights").innerHTML = tagHighlightsHtml(report.tags);
  byId("tag-table").innerHTML = tagTableHtml(report.tags);
  byId("keyword-table").innerHTML = sliceTableHtml(report.keywords, "Word");
  byId("risk-stats").innerHTML = riskStatsHtml(report.risk);
  byId("stop-loss-table").innerHTML = sliceTableHtml(report.stopLossBuckets, "Stop-loss");
  byId("hold-table").innerHTML = sliceTableHtml(report.holdBuckets, "Hold");
  byId("filter-note").textContent = `Rows with fewer than ${minSample} trades are dimmed. Treat them as noise.`;
  applyBarWidths();

  const skipped = skippedTradeCount ? `, ${skippedTradeCount} without PnL skipped` : "";
  setStatus(`${entries.length} of ${allEntries.length} closed trades${skipped}`);
}

function refreshStrategyOptions() {
  const select = byId("strategy-filter");
  const previous = select.value;
  const strategies = [...new Set(allEntries.map(entry => entry.strategy))].sort((a, b) => a.localeCompare(b));
  select.innerHTML =
    `<option value="">All strategies</option>` +
    strategies.map(strategy => `<option value="${escapeAttribute(strategy)}">${escapeHtml(strategy)}</option>`).join("");
  select.value = strategies.includes(previous) ? previous : "";
}

function showOffline() {
  if (allEntries.length) {
    setStatus(OFFLINE_MESSAGE);
    return;
  }
  setContentVisible(false);
  showMessage(OFFLINE_MESSAGE);
  setStatus("");
}

async function loadTrades() {
  setStatus("Loading...");
  let response;
  try {
    response = await fetch("/api/trades");
  } catch (error) {
    showOffline();
    return;
  }
  if (response.status === 401) {
    setContentVisible(false);
    showMessage(LOCKED_MESSAGE_HTML);
    setStatus("");
    return;
  }
  try {
    if (!response.ok) throw new Error("HTTP " + response.status);
    const trades = await response.json();
    allEntries = enrichTrades(trades);
    skippedTradeCount = trades.length - allEntries.length;
  } catch (error) {
    setContentVisible(false);
    showMessage("Could not load trades. Try reloading.");
    setStatus("");
    return;
  }
  if (!allEntries.length) {
    setContentVisible(false);
    showMessage(EMPTY_MESSAGE);
    setStatus("");
    return;
  }
  showMessage("");
  setContentVisible(true);
  refreshStrategyOptions();
  renderPatterns();
}

byId("period-select").innerHTML = PERIOD_OPTIONS_HTML;
["period-select", "strategy-filter", "review-filter", "min-market-cap-filter", "max-market-cap-filter", "min-sample-input"]
  .forEach(id => byId(id).addEventListener("change", () => allEntries.length && renderPatterns()));
byId("reload-button").addEventListener("click", loadTrades);
window.addEventListener("online", loadTrades);

loadTrades();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
