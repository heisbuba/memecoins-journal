// Charts browser UI: filter, sort and page trades, and open their charts in the shared viewer.

const byId = id => document.getElementById(id);
const setStatus = message => (byId("status-text").textContent = message);

const PAGE_SIZE = 12;
const OFFLINE_MESSAGE = "You're offline. Trades need a connection.";
const LOCKED_MESSAGE_HTML = 'The session is locked. <a href="/">Unlock on the journal page</a>, then reload.';
const EMPTY_MESSAGE = "No trades yet. Add trades on the journal page.";
const NO_CHARTS_MESSAGE = "No charts yet. Open a trade on the journal page and paste a Before or After screenshot.";

const FILTER_IDS = {
  q: "search-input",
  show: "show-filter",
  period: "period-select",
  strategy: "strategy-filter",
  result: "result-filter",
  review: "review-filter",
  sort: "sort-select"
};
const DEFAULTS = { q: "", show: "with", period: "all", strategy: "", result: "", review: "", sort: "newest" };

const SHOW_FILTERS = {
  with: trade => trade.beforeChart || trade.afterChart,
  both: trade => trade.beforeChart && trade.afterChart,
  nobefore: trade => !trade.beforeChart,
  noafter: trade => !trade.afterChart,
  none: trade => !trade.beforeChart && !trade.afterChart,
  all: () => true
};

const byNewest = (a, b) => b.trade.Date.localeCompare(a.trade.Date) || b.trade.id - a.trade.id;
const byPnl = direction => (a, b) => {
  const missingA = a.metrics.pnl == null;
  const missingB = b.metrics.pnl == null;
  if (missingA || missingB) return missingA - missingB;
  return (b.metrics.pnl - a.metrics.pnl) * direction || byNewest(a, b);
};
const SORTERS = {
  newest: byNewest,
  oldest: (a, b) => -byNewest(a, b),
  best: byPnl(1),
  worst: byPnl(-1)
};

let entries = [];
let currentPage = 0;
let viewerTrades = [];
let wantedStrategy = new URLSearchParams(location.search).get("strategy") || "";

const chartActions = createChartActions({
  findTrade: id => (entries.find(entry => entry.trade.id == id) || {}).trade,
  reload: loadTrades,
  setStatus
});

const sameText = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

function enrich(trades) {
  return trades.map(trade => {
    const metrics = calculateTrade(trade);
    return {
      trade,
      metrics,
      result: metrics.result || "Open",
      searchText: [trade.Ticker, trade.Strategy, trade.Tags, trade.Notes, metrics.result].join(" ").toLowerCase()
    };
  });
}

function readFilters() {
  return Object.fromEntries(Object.entries(FILTER_IDS).map(([key, id]) => [key, byId(id).value.trim()]));
}

function matches(entry, filters, range) {
  const { trade } = entry;
  if (!SHOW_FILTERS[filters.show](trade)) return false;
  if (range && !(trade.Date && trade.Date >= range[0] && trade.Date <= range[1])) return false;
  if (filters.strategy && !sameText(trade.Strategy, filters.strategy)) return false;
  if (filters.result && entry.result !== filters.result) return false;
  if (filters.review && !sameText(trade.Review, filters.review)) return false;
  return !filters.q || entry.searchText.includes(filters.q.toLowerCase());
}

function writeParams(filters) {
  const params = new URLSearchParams();
  Object.keys(FILTER_IDS).forEach(key => filters[key] !== DEFAULTS[key] && params.set(key, filters[key]));
  const query = params.toString();
  history.replaceState(null, "", query ? "?" + query : location.pathname);
}

function cardHtml({ trade, metrics }) {
  const result = metrics.result
    ? `<div class="chart-card-result ${signClass(metrics.pnl)}">${metrics.result} ${formatPercent(metrics.pnl)}</div>`
    : `<div class="chart-card-result">Open</div>`;
  return (
    `<article class="chart-card" data-trade-id="${trade.id}">` +
    `<header class="chart-card-head"><div><strong>${escapeHtml(trade.Ticker)}</strong>` +
    `<span>${escapeHtml(trade.Date)} · ${escapeHtml(trade.Strategy)}</span></div>${result}</header>` +
    `${chartSlotsHtml(trade)}</article>`
  );
}

function render() {
  const filters = readFilters();
  const range = periodRange(filters.period);
  const matching = entries.filter(entry => matches(entry, filters, range)).sort(SORTERS[filters.sort]);

  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(currentPage, 0), pageCount - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const pageEntries = matching.slice(pageStart, pageStart + PAGE_SIZE);
  viewerTrades = matching.map(entry => entry.trade).filter(SHOW_FILTERS.with);

  const noChartsAtAll = !entries.some(entry => SHOW_FILTERS.with(entry.trade));
  byId("charts-grid").innerHTML = pageEntries.length
    ? pageEntries.map(cardHtml).join("")
    : `<div class="empty-cell">${noChartsAtAll ? NO_CHARTS_MESSAGE : "No trades match the filters."}</div>`;

  byId("page-info").textContent =
    (matching.length ? `${pageStart + 1}–${pageStart + pageEntries.length}` : "0") +
    ` of ${matching.length} · page ${currentPage + 1}/${pageCount}`;
  byId("prev-page-button").disabled = currentPage === 0;
  byId("next-page-button").disabled = currentPage >= pageCount - 1;
  setStatus(`${matching.length} of ${entries.length} trades`);
  writeParams(filters);
}

function refreshStrategyOptions() {
  const select = byId("strategy-filter");
  const wanted = select.value || wantedStrategy;
  wantedStrategy = "";
  const strategies = [];
  entries.forEach(({ trade }) => {
    const strategy = String(trade.Strategy || "").trim();
    if (strategy && !strategies.some(known => sameText(known, strategy))) strategies.push(strategy);
  });
  strategies.sort((a, b) => a.localeCompare(b));
  select.innerHTML =
    `<option value="">All strategies</option>` +
    strategies.map(strategy => `<option value="${escapeHtml(strategy).replace(/"/g, "&quot;")}">${escapeHtml(strategy)}</option>`).join("");
  select.value = strategies.find(strategy => sameText(strategy, wanted)) || "";
}

function showMessage(html) {
  byId("charts-message").innerHTML = html;
  byId("charts-message").hidden = !html;
  byId("charts-content").hidden = Boolean(html);
}

async function loadTrades() {
  setStatus("Loading...");
  let response;
  try {
    response = await fetch("/api/trades");
  } catch (error) {
    if (entries.length) return setStatus(OFFLINE_MESSAGE);
    setStatus("");
    return showMessage(OFFLINE_MESSAGE);
  }
  if (response.status === 401) {
    setStatus("");
    return showMessage(LOCKED_MESSAGE_HTML);
  }
  try {
    if (!response.ok) throw new Error("HTTP " + response.status);
    entries = enrich(await response.json());
  } catch (error) {
    setStatus("");
    return showMessage("Could not load trades. Try reloading.");
  }
  if (!entries.length) {
    setStatus("");
    return showMessage(EMPTY_MESSAGE);
  }
  showMessage("");
  refreshStrategyOptions();
  render();
}

byId("period-select").innerHTML = PERIOD_OPTIONS_HTML;
const savedParams = new URLSearchParams(location.search);
byId("more-filters").open = ["period", "strategy", "result", "review"].some(key => savedParams.has(key));
Object.entries(FILTER_IDS).forEach(([key, id]) => {
  if (key !== "strategy" && savedParams.has(key)) byId(id).value = savedParams.get(key);
});

let searchTimer;
const refilter = () => {
  currentPage = 0;
  if (entries.length) render();
};
Object.entries(FILTER_IDS).forEach(([key, id]) =>
  byId(id).addEventListener(key === "q" ? "input" : "change", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refilter, key === "q" ? 150 : 0);
  })
);
byId("prev-page-button").onclick = () => {
  currentPage--;
  render();
};
byId("next-page-button").onclick = () => {
  currentPage++;
  render();
};
byId("reload-button").addEventListener("click", loadTrades);
window.addEventListener("online", loadTrades);

byId("charts-grid").addEventListener("click", event => {
  const button = event.target.closest("[data-chart-action]");
  if (!button) return;
  event.preventDefault();
  chartActions.handle(button, +button.closest(".chart-card").dataset.tradeId, viewerTrades);
});

loadTrades();
