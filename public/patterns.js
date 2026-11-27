// Patterns page UI. Analysis lives in patterns-engine.js.

const byId = id => document.getElementById(id);
const setStatus = message => (byId("status-text").textContent = message);

const OFFLINE_MESSAGE = "You're offline. Trades need a connection.";
const LOCKED_MESSAGE_HTML = 'The session is locked. <a href="/">Unlock on the journal page</a>, then reload.';
const EMPTY_MESSAGE = "No closed trades yet. Add trades with a PnL on the journal page.";

let allEntries = [];
let skippedTradeCount = 0;
let minSample = DEFAULT_MIN_SAMPLE;
let report = null;
const whenState = { slice: "timeOfDay", view: "chart", metric: "total" };
const WHEN_SLICE_HEADERS = { timeOfDay: "Time of day", weekdays: "Weekday", hours: "Entry hour" };

const escapeAttribute = text => escapeHtml(text).replace(/"/g, "&quot;");
const formatPercentOrDash = value => (value == null ? "-" : formatPercent(value));
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

const tradesLabel = count => `${count} ${count === 1 ? "trade" : "trades"}`;

const emptyChartHtml = '<div class="empty-cell">No trades match the filters.</div>';

function emptyTableHtml(firstHeader) {
  return `<tr><th>${firstHeader}</th></tr><tr><td class="empty-cell">No trades match the filters.</td></tr>`;
}

function sliceTableHtml(rows, firstHeader) {
  if (!rows.length) return emptyTableHtml(firstHeader);
  const header = `<tr><th>${firstHeader}</th><th>Trades</th><th>Win %</th><th>Total PnL</th><th>Avg PnL</th></tr>`;
  const body = rows.map(row => {
    const summary = row.summary;
    const range = summary.winRateRange
      ? `95% range ${formatPercent(summary.winRateRange[0], 0)} to ${formatPercent(summary.winRateRange[1], 0)}`
      : "";
    return (
      `<tr class="${summary.lowSample ? "low-sample" : ""}" title="${summary.lowSample ? `Fewer than ${minSample} trades` : ""}">` +
      `<td>${escapeHtml(row.label)}</td><td>${summary.count}</td>` +
      `<td title="${range}">${formatPercentOrDash(summary.winRate)}</td>` +
      `<td>${pnlHtml(summary.totalPnl)}</td><td>${pnlHtml(summary.averagePnl)}</td></tr>`
    );
  });
  return header + body.join("");
}

// signed metrics grow left or right of a zero line, the others grow from the left
const BAR_METRICS = {
  total: { value: summary => summary.totalPnl, format: formatPercent, signed: true },
  average: { value: summary => summary.averagePnl, format: formatPercent, signed: true },
  win: { value: summary => summary.winRate, format: value => formatPercent(value, 0), signed: false },
  count: { value: summary => summary.count, format: String, signed: false }
};

function barChartHtml(rows, metricKey = "total") {
  if (!rows.length) return emptyChartHtml;
  const metric = BAR_METRICS[metricKey];
  const values = rows.map(row => metric.value(row.summary) ?? 0);
  const largest = Math.max(...values.map(Math.abs)) || 1;
  return rows
    .map((row, index) => {
      const value = values[index];
      const width = (Math.abs(value) / largest) * (metric.signed ? 50 : 100);
      const left = metric.signed ? (value < 0 ? 50 - width : 50) : 0;
      const fillClass = !metric.signed ? "bar-neutral" : value < 0 ? "bar-negative" : "bar-positive";
      return (
        `<div class="bar-row${row.summary.lowSample ? " low-sample" : ""}" title="${row.summary.lowSample ? `Fewer than ${minSample} trades` : ""}">` +
        `<span class="bar-label">${escapeHtml(row.label)}</span>` +
        `<span class="bar-track${metric.signed ? " bar-signed" : ""}"><span class="bar-fill ${fillClass}" data-left="${left.toFixed(1)}" data-width="${width.toFixed(1)}"></span></span>` +
        `<span class="bar-value ${metric.signed ? signClass(value) : ""}">${metric.format(value)}</span>` +
        `<span class="bar-count">n=${row.summary.count}</span></div>`
      );
    })
    .join("");
}

function findingHtml(finding) {
  const describe = row => `${escapeHtml(row.label)} (${pnlHtml(row.summary.totalPnl)}, ${tradesLabel(row.summary.count)})`;
  if (finding.type === "extremes") {
    const parts = [];
    if (finding.best) parts.push(`best ${describe(finding.best)}`);
    if (finding.worst) parts.push(`weakest ${describe(finding.worst)}`);
    return `<strong>${finding.group}:</strong> ${parts.join(", ")}.`;
  }
  if (finding.type === "mistakes") {
    return (
      `<strong>Mistakes:</strong> ${tradesLabel(finding.mistakeCount)} lost ${formatPercent(Math.abs(finding.mistakePnl))}. ` +
      `Without them the total would be ${pnlHtml(finding.withoutMistakes)} (actual ${pnlHtml(finding.totalPnl)}).`
    );
  }
  return (
    `<strong>One-trade dependence:</strong> without your best trade the total is ${pnlHtml(finding.pnlWithoutBest)} ` +
    `(actual ${pnlHtml(finding.totalPnl)}).`
  );
}

const findingsHtml = findings =>
  findings.length
    ? findings.map(finding => `<p class="finding">${findingHtml(finding)}</p>`).join("")
    : `<p class="finding">Nothing to flag yet. A row needs ${minSample}+ trades and a clear win or loss to be named here.</p>`;

function marketCapNoteHtml(study) {
  if (study.winnersMedianEntry == null && study.losersMedianEntry == null) return "";
  return (
    `Winners entered at a median of <strong>${formatMarketCap(study.winnersMedianEntry)}</strong>, ` +
    `losers at <strong>${formatMarketCap(study.losersMedianEntry)}</strong>.`
  );
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

const tagNoteHtml = tagStudy =>
  tagStudy.rows.length ? `${tagStudy.taggedCount} tagged, ${tagStudy.untaggedCount} untagged trades.` : "No tags logged in this view.";

function riskNoteHtml(risk) {
  const stops = risk.losersWithStop
    ? `<strong>Stops broken:</strong> ${risk.stopBreaks} of ${risk.losersWithStop} losing trades (${formatPercentOrDash(risk.stopBreakRate)}), ` +
      `${pnlHtml(risk.totalSlExcess)} beyond the stop in total.`
    : "No losing trades with a stop-loss in this view.";
  return `${stops} <strong>Median hold:</strong> winners ${formatHours(risk.holdWinners)}, losers ${formatHours(risk.holdLosers)}.`;
}

function overviewHtml(summary) {
  return [
    statCardHtml("Trades", summary.count),
    statCardHtml("Win rate", formatPercentOrDash(summary.winRate)),
    statCardHtml("Total PnL", pnlHtml(summary.totalPnl)),
    statCardHtml("Avg PnL per trade", pnlHtml(summary.averagePnl))
  ].join("");
}

function applyBarWidths() {
  document.querySelectorAll("[data-width]").forEach(bar => {
    bar.style.width = bar.dataset.width + "%";
    bar.style.left = bar.dataset.left + "%";
  });
}

function renderWhen() {
  const rows = report[whenState.slice];
  const isChart = whenState.view === "chart";
  byId("when-metrics").hidden = !isChart;
  byId("when-content").innerHTML = isChart
    ? barChartHtml(rows, whenState.metric)
    : `<div class="table-scroll"><table class="slice-table">${sliceTableHtml(rows, WHEN_SLICE_HEADERS[whenState.slice])}</table></div>`;
  applyBarWidths();
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
  report = buildPatternsReport(entries, minSample);

  byId("overview-stats").innerHTML = overviewHtml(report.overview);
  byId("findings").innerHTML = findingsHtml(report.findings);
  byId("strategy-chart").innerHTML = barChartHtml(report.strategies);
  byId("strategy-table").innerHTML = sliceTableHtml(report.strategies, "Strategy");
  byId("market-cap-chart").innerHTML = barChartHtml(report.marketCap.buckets);
  byId("market-cap-note").innerHTML = marketCapNoteHtml(report.marketCap);
  byId("review-chart").innerHTML = barChartHtml(report.reviews);
  byId("review-impact").innerHTML = reviewImpactHtml(report.reviewImpact);
  byId("tag-chart").innerHTML = barChartHtml(report.tags.rows);
  byId("tag-note").textContent = tagNoteHtml(report.tags);
  byId("risk-note").innerHTML = riskNoteHtml(report.risk);
  byId("stop-loss-chart").innerHTML = barChartHtml(report.stopLossBuckets);
  byId("hold-chart").innerHTML = barChartHtml(report.holdBuckets);
  byId("filter-note").textContent = `Rows with fewer than ${minSample} trades are dimmed. Treat them as noise.`;
  renderWhen();

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

function wireToggle(containerId, stateKey) {
  const container = byId(containerId);
  container.addEventListener("click", event => {
    const button = event.target.closest("button[data-value]");
    if (!button || !report) return;
    whenState[stateKey] = button.dataset.value;
    [...container.children].forEach(child => child.classList.toggle("active", child === button));
    renderWhen();
  });
}
wireToggle("when-slices", "slice");
wireToggle("when-views", "view");
wireToggle("when-metrics", "metric");
window.addEventListener("online", loadTrades);

loadTrades();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
