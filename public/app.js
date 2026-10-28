let trades = [];
const byId = id => document.getElementById(id);
const setStatus = message => (byId("status-text").textContent = message);

// id of the form input for each trade field
const FORM_FIELD_IDS = {
  Date: "trade-date",
  Ticker: "trade-ticker",
  Strategy: "trade-strategy",
  MC: "trade-entry-mc",
  Price: "trade-price",
  "Entry Time": "trade-entry-time",
  SL: "trade-stop-loss",
  TP: "trade-take-profit",
  RRR: "trade-risk-reward",
  PnL: "trade-pnl",
  "Exit MC": "trade-exit-mc",
  "Exit Time": "trade-exit-time",
  Review: "trade-review",
  Tags: "trade-tags",
  Notes: "trade-notes"
};
const fieldInput = field => byId(FORM_FIELD_IDS[field]);

const OFFLINE_MESSAGE = "You're offline. Trades need a connection.";

async function callTradesApi(method, body, query = "") {
  let response;
  try {
    response = await fetch("/api/trades" + query, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (_) {
    throw new Error("offline");
  }
  if (response.status == 401) {
    byId("app").style.display = "none";    
    byId("lock-screen").style.display = "grid";  
    byId("pin-input").focus();
    throw new Error("locked");
  }
  if (!response.ok) throw new Error(response.status);
  return response.json();
}

async function loadTrades() {
  setStatus("Loading...");
  try {
    trades = await callTradesApi("GET");
    setStatus(trades.length + " trades");
    byId("lock-screen").style.display = "none"; 
    byId("app").style.display = "block";  
  } catch (error) {
    if (error.message == "offline") {
      if (byId("app").style.display == "block") setStatus(OFFLINE_MESSAGE);
      else {
        byId("lock-screen").style.display = "grid";
        byId("lock-error").textContent = OFFLINE_MESSAGE;
      }
    } else setStatus(error.message == "locked" ? "" : "Load failed: " + error.message);
  }
  renderJournal();
}

// one summary row per distinct value of groupKey
function buildGroupRows(entries, groupKey) {
  const groups = {};
  entries.forEach(entry => {
    const label = entry.trade[groupKey] || "-";
    (groups[label] = groups[label] || []).push(entry.metrics);
  });
  return Object.entries(groups)
    .map(([label, groupMetrics]) => {
      const wins = groupMetrics.filter(metrics => metrics.result == "Win").length;
      const totalPnl = sum(groupMetrics.map(metrics => metrics.pnl));
      const rMultiples = groupMetrics.filter(metrics => metrics.rMultiple != null).map(metrics => metrics.rMultiple);
      return (
        `<tr><td>${escapeHtml(label)}</td><td>${groupMetrics.length}</td><td>${formatPercent(wins / groupMetrics.length, 0)}</td>` +
        `<td class="${signClass(totalPnl)}">${formatPercent(totalPnl)}</td>` +
        `<td>${formatAverage(rMultiples, value => value.toFixed(2) + "R")}</td></tr>`
      );
    })
    .join("");
}

const groupHeaderRow = label =>
  `<tr><th>${label}</th><th>Trades</th><th>Win %</th><th>PnL</th><th>Avg R</th></tr>`;

const SEARCH_FIELDS = ["Ticker", "Strategy", "Tags", "Notes", "Review"];
let searchTimer, searchQuery = "", sortColumn = "Date", sortDirection = -1, currentPage = 0, pageSize = 20, selectedPeriod = "all";

// sort value of each table column
const SORT_VALUE_GETTERS = {
  Date: entry => entry.trade.Date,
  Ticker: entry => (entry.trade.Ticker || "").toLowerCase(),
  Strategy: entry => (entry.trade.Strategy || "").toLowerCase(),
  MC: entry => parseMarketCap(entry.trade.MC),
  SL: entry => (entry.metrics.stopLoss == null ? null : Math.abs(entry.metrics.stopLoss)),
  TP: entry => entry.metrics.takeProfit,
  RRR: entry => entry.metrics.riskReward,
  PnL: entry => entry.metrics.pnl,
  "Exit MC": entry => parseMarketCap(entry.trade["Exit MC"]),
  Result: entry => entry.metrics.result,
  R: entry => entry.metrics.rMultiple,
  "SL-excess": entry => entry.metrics.slExcess,
  Hold: entry => entry.metrics.holdHours,
  "Time of day": entry => timeToMinutes(entry.trade["Entry Time"]),
  Review: entry => entry.trade.Review || null,
  Tags: entry => (entry.trade.Tags || "").toLowerCase() || null
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

function renderJournal() {
  const range = periodRange(selectedPeriod);
  const allEntries = trades.map((trade, index) => ({ trade, index, metrics: calculateTrade(trade) }));
  const periodEntries = range
    ? allEntries.filter(entry => entry.trade.Date && entry.trade.Date >= range[0] && entry.trade.Date <= range[1])
    : allEntries;
  const closedEntries = periodEntries.filter(entry => entry.metrics.pnl != null);
  const closedMetrics = closedEntries.map(entry => entry.metrics);

  const winners = closedMetrics.filter(metrics => metrics.result == "Win");
  const losers = closedMetrics.filter(metrics => metrics.result == "Loss");
  const totalPnl = sum(closedMetrics.map(metrics => metrics.pnl));
  const grossWin = sum(winners.map(metrics => metrics.pnl));
  const grossLoss = Math.abs(sum(losers.map(metrics => metrics.pnl)));
  const avgRiskReward = average(closedMetrics.filter(metrics => metrics.riskReward != null).map(metrics => metrics.riskReward));

  const statCards = [
    ["Trades", closedMetrics.length],
    ["Win rate", closedMetrics.length ? formatPercent(winners.length / closedMetrics.length) : "-"],
    ["Total PnL", `<i class="${signClass(totalPnl)}">${formatPercent(totalPnl)}</i>`],
    ["Profit factor", grossLoss ? (grossWin / grossLoss).toFixed(2) : "-"],
    ["Avg R / trade", formatAverage(closedMetrics.filter(metrics => metrics.rMultiple != null).map(metrics => metrics.rMultiple), value => value.toFixed(2) + "R")],
    ["Break-even win rate", avgRiskReward ? formatPercent(1 / (1 + avgRiskReward)) : "-"],
    ["Avg hold winners", formatAverage(winners.filter(metrics => metrics.holdHours != null).map(metrics => metrics.holdHours), value => value.toFixed(1) + "h")],
    ["Avg hold losers", formatAverage(losers.filter(metrics => metrics.holdHours != null).map(metrics => metrics.holdHours), value => value.toFixed(1) + "h")]
  ];

  byId("stats-summary").innerHTML = statCards
    .map(([label, value]) => `<div class="stat-card"><b class="stat-value">${value}</b><span class="stat-label">${label}</span></div>`)
    .join("");
  byId("strategy-table").innerHTML = groupHeaderRow("Strategy") + buildGroupRows(closedEntries, "Strategy");

  const entriesWithTimeOfDay = closedEntries.map(entry => ({
    trade: { ...entry.trade, timeOfDay: entry.metrics.timeOfDay },
    metrics: entry.metrics
  }));
  byId("time-review-table").innerHTML =
    groupHeaderRow("Time of day") + buildGroupRows(entriesWithTimeOfDay, "timeOfDay") +
    groupHeaderRow("Review") + buildGroupRows(closedEntries, "Review");

  byId("strategy-list").innerHTML = [...new Set(trades.map(trade => trade.Strategy).filter(Boolean))]
    .map(strategy => `<option value="${strategy.replace(/"/g, "&quot;")}">`)
    .join("");

  const dataColumns = ["Date", "Ticker", "Strategy", "MC", "SL", "TP", "RRR", "PnL", "Exit MC"];
  const headerColumns = [...dataColumns, "Result", "R", "SL-excess", "Hold", "Time of day", "Review", "Tags"];

  let matchingEntries = periodEntries.slice();
  if (searchQuery) {
    matchingEntries = matchingEntries.filter(({ trade, metrics }) =>
      (SEARCH_FIELDS.map(field => trade[field] || "").join(" ") + " " + (metrics.result || "")).toLowerCase().includes(searchQuery)
    );
  }

  const getSortValue = SORT_VALUE_GETTERS[sortColumn] || SORT_VALUE_GETTERS.Date;
  matchingEntries.sort((a, b) => {
    const x = getSortValue(a), y = getSortValue(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return ((x < y ? -1 : x > y ? 1 : 0) * sortDirection) || ((a.index - b.index) * sortDirection);
  });

  const pageCount = Math.max(1, Math.ceil(matchingEntries.length / pageSize));
  if (currentPage >= pageCount) currentPage = pageCount - 1;
  if (currentPage < 0) currentPage = 0;

  const pageStart = currentPage * pageSize;
  const pageEntries = matchingEntries.slice(pageStart, pageStart + pageSize);

  byId("page-info").textContent =
    (matchingEntries.length ? pageStart + 1 + "–" + (pageStart + pageEntries.length) : "0") +
    " of " + matchingEntries.length +
    (searchQuery && matchingEntries.length != periodEntries.length ? " (filtered from " + periodEntries.length + ")" : "") +
    " · page " + (currentPage + 1) + "/" + pageCount;

  byId("prev-page-button").disabled = currentPage <= 0;
  byId("next-page-button").disabled = currentPage >= pageCount - 1;

  byId("trades-table").innerHTML =
    `<tr>${headerColumns.map(column =>
      `<th class="sortable" data-column="${column}">${column}${sortColumn == column ? (sortDirection > 0 ? " ▲" : " ▼") : ""}</th>`
    ).join("")}<th></th></tr>` +
    pageEntries
      .map(({ trade, index, metrics }) => {
        return (
          `<tr title="${escapeHtml((trade.Notes || "").slice(0, 400)).replace(/"/g, "&quot;")}">` +
          dataColumns.map(column => `<td>${escapeHtml(trade[column] || "")}</td>`).join("") +
          `<td class="${metrics.result == "Win" ? "positive" : metrics.result == "Loss" ? "negative" : ""}">${metrics.result || ""}</td>` +
          `<td>${metrics.rMultiple == null ? "" : metrics.rMultiple.toFixed(2) + "R"}</td>` +
          `<td class="${signClass(metrics.slExcess)}">${metrics.slExcess ? formatPercent(metrics.slExcess) : ""}</td>` +
          `<td>${metrics.holdHours == null ? "" : metrics.holdHours.toFixed(1) + "h"}</td>` +
          `<td>${metrics.timeOfDay}</td>` +
          `<td>${escapeHtml(trade.Review || "")}</td>` +
          `<td>${escapeHtml(trade.Tags || "")}</td>` +
          `<td><a href="#" data-index="${index}" class="edit-link" title="Edit">✎</a> ` +
          `<a href="#" data-index="${index}" class="delete-link" title="Delete">✕</a></td></tr>`
        );
      })
      .join("");
}

["SL", "TP"].forEach(field => {
  fieldInput(field).oninput = () => {
    const stopLoss = parsePercent(fieldInput("SL").value);
    const takeProfit = parsePercent(fieldInput("TP").value);
    fieldInput("RRR").value = stopLoss && takeProfit != null ? "1:" + (Math.abs(takeProfit) / Math.abs(stopLoss)).toFixed(1) : "";
  };
});

let editingTradeId = null;

function endEdit() {
  editingTradeId = null;
  ["Ticker", "MC", "Price", "Entry Time", "SL", "TP", "RRR", "PnL", "Exit Time", "Exit MC", "Tags", "Notes"].forEach(
    field => (fieldInput(field).value = "")
  );
  fieldInput("Date").valueAsDate = new Date();
  byId("save-trade-button").textContent = "Add trade";
  byId("cancel-edit-button").hidden = true;
}

function startEdit(trade) {
  editingTradeId = trade.id;
  TRADE_FIELDS.forEach(field => {
    const input = fieldInput(field);
    if (input) {
      input.value = ["SL", "TP", "PnL"].includes(field)
        ? String(trade[field] || "").replace("%", "")
        : (trade[field] || "");
    }
  });
  fieldInput("SL").dispatchEvent(new Event("input"));
  byId("save-trade-button").textContent = "Save changes";
  byId("cancel-edit-button").hidden = false;
  fieldInput("Date").scrollIntoView({ behavior: "smooth", block: "center" });
  setStatus("Editing " + trade.Ticker);
}

byId("cancel-edit-button").onclick = () => {
  endEdit();
  setStatus("");
};

byId("save-trade-button").onclick = async () => {
  const trade = {};
  TRADE_FIELDS.forEach(field => {
    const input = fieldInput(field);
    trade[field] = input ? input.value.trim() : "";
  });
  trade.Ticker = trade.Ticker && !trade.Ticker.startsWith("$") ? "$" + trade.Ticker : trade.Ticker;
  if (!trade.Date || !trade.Ticker) return setStatus("Date and Ticker are required");
  finalizeTrade(trade);
  try {
    const editedId = editingTradeId;
    if (editedId) await callTradesApi("PUT", { trade }, "?id=" + editedId);
    else await callTradesApi("POST", { trades: [trade] });
    endEdit();
    await loadTrades();
    setStatus(editedId ? "Updated ✓" : "Saved ✓");
  } catch (error) {
    setStatus("Save failed: " + error.message);
  }
};

byId("search-input").oninput = event => {
  const text = event.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchQuery = text.toLowerCase().trim();
    currentPage = 0;
    renderJournal();
  }, 150);
};

byId("page-size-select").onchange = event => {
  pageSize = +event.target.value;
  currentPage = 0;
  renderJournal();
};

byId("prev-page-button").onclick = () => {
  currentPage--;
  renderJournal();
};
byId("next-page-button").onclick = () => {
  currentPage++;
  renderJournal();
};

byId("trades-table").onclick = async event => {
  const header = event.target.closest && event.target.closest("th[data-column]");
  if (header) {
    const column = header.dataset.column;
    sortDirection = sortColumn == column ? -sortDirection : 1;
    sortColumn = column;
    currentPage = 0;
    return renderJournal();
  }
  const classes = event.target.classList;
  if (classes.contains("edit-link")) {
    event.preventDefault();
    return startEdit(trades[+event.target.dataset.index]);
  }
  if (!classes.contains("delete-link")) return;
  event.preventDefault();
  const trade = trades[+event.target.dataset.index];
  if (!confirm("Delete " + trade.Ticker + "?")) return;
  try {
    await callTradesApi("DELETE", null, "?id=" + trade.id);
    await loadTrades();
  } catch (_) {
    setStatus("Delete failed");
  }
};

function downloadFile(fileName, text, mimeType) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: mimeType }));
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

const todayIsoDate = () => new Date().toISOString().slice(0, 10);

byId("export-csv-button").onclick = () =>
  downloadFile(
    "trades-" + todayIsoDate() + ".csv",
    [TRADE_FIELDS.join(",")].concat(trades.map(trade => TRADE_FIELDS.map(field => escapeCsvValue(trade[field] || "")).join(","))).join("\n") + "\n",
    "text/csv"
  );

byId("unlock-button").onclick = async () => {
  const lockError = byId("lock-error");
  lockError.textContent = "";
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: byId("pin-input").value })
    });
    if (response.ok) {
      byId("pin-input").value = "";
      loadTrades();
      return;
    }
    let errorMessage = "";
    try {
      errorMessage = (await response.json()).error || "";
    } catch (_) {}
    lockError.textContent = errorMessage || ("Server error " + response.status + " - check D1 tables, DB binding and secrets");
  } catch (error) {
    lockError.textContent = "Network error";
  }
};

byId("pin-input").onkeydown = event => {
  if (event.key == "Enter") byId("unlock-button").click();
};

byId("lock-button").onclick = async () => {
  await fetch("/api/login", { method: "DELETE" });
  trades = [];
  renderJournal();
  setStatus("");
  byId("app").style.display = "none";    // Hide app
  byId("lock-screen").style.display = "grid";   // Show lock
};

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

const periodSelect = byId("period-select");
periodSelect.innerHTML = PERIOD_OPTIONS_HTML;
periodSelect.value = selectedPeriod;
periodSelect.title = "All trades";
periodSelect.onchange = event => {
  selectedPeriod = event.target.value;
  const range = periodRange(selectedPeriod);
  periodSelect.title = range ? range[0] + " → " + range[1] : "All trades";
  currentPage = 0;
  renderJournal();
};

byId("reload-button").onclick = loadTrades;
fieldInput("Date").valueAsDate = new Date();
loadTrades();

window.addEventListener("online", () => {
  byId("lock-error").textContent = "";
  loadTrades();
});
window.addEventListener("offline", () => setStatus(OFFLINE_MESSAGE));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
