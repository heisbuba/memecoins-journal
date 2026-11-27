const CHART_SLOTS = [["before", "Before"], ["after", "After"]];
const MAX_CHART_BYTES = 5 * 1024 * 1024;
const CHART_TYPES = ["image/png", "image/jpeg", "image/webp"];
const chartElement = id => document.getElementById(id);
const chartUrl = key => "/api/images?key=" + encodeURIComponent(key);

function chartSlotsHtml(trade) {
  return `<div class="chart-slots">${CHART_SLOTS.map(([slot, label]) => {
    const key = trade[slot + "Chart"];
    if (!key) {
      return `<button class="secondary chart-slot chart-empty" data-chart-action="add" data-slot="${slot}">+ ${label} chart</button>`;
    }
    return (
      `<figure class="chart-slot">` +
      `<img class="chart-thumb" loading="lazy" src="${chartUrl(key)}" alt="${label} chart" data-chart-action="view" data-slot="${slot}">` +
      `<figcaption>${label} · <a href="#" data-chart-action="add" data-slot="${slot}">replace</a> · ` +
      `<a href="#" data-chart-action="remove" data-slot="${slot}">remove</a></figcaption></figure>`
    );
  }).join("")}</div>`;
}

async function sendChart(method, tradeId, slot, image) {
  let response;
  try {
    response = await fetch(`/api/images?id=${tradeId}&slot=${slot}`, {
      method,
      headers: image ? { "Content-Type": image.type } : {},
      body: image
    });
  } catch (_) {
    throw new Error("offline");
  }
  if (response.status == 401) throw new Error("locked");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || response.status);
  }
}

function uploadChart(tradeId, slot, file) {
  if (!CHART_TYPES.includes(file.type)) throw new Error("use a PNG, JPEG or WebP image");
  if (file.size > MAX_CHART_BYTES) throw new Error("image must be under 5 MB");
  return sendChart("PUT", tradeId, slot, file);
}
const removeChart = (tradeId, slot) => sendChart("DELETE", tradeId, slot);

// file picker and viewer overlay, shared by the journal and the charts browser
document.body.insertAdjacentHTML(
  "beforeend",
  `<input type="file" id="chart-file-input" accept="image/*" hidden>
  <div id="chart-lightbox" class="chart-lightbox" hidden>
    <div class="chart-lightbox-bar">
      <div class="chart-lightbox-group" id="chart-lightbox-modes">
        <button type="button" class="secondary" data-mode="before">Before</button>
        <button type="button" class="secondary" data-mode="after">After</button>
        <button type="button" class="secondary" data-mode="compare">Compare</button>
      </div>
      <div class="chart-lightbox-group">
        <button type="button" class="secondary" id="chart-lightbox-prev" aria-label="Previous trade">‹</button>
        <span id="chart-lightbox-count"></span>
        <button type="button" class="secondary" id="chart-lightbox-next" aria-label="Next trade">›</button>
        <a class="button-link" id="chart-lightbox-download">Download</a>
        <button type="button" class="secondary" id="chart-lightbox-close" aria-label="Close">✕</button>
      </div>
    </div>
    <div class="chart-lightbox-caption" id="chart-lightbox-caption"></div>
    <div class="chart-lightbox-stage" id="chart-lightbox-stage">
      <img id="chart-lightbox-before" alt="Before chart">
      <img id="chart-lightbox-after" alt="After chart">
    </div>
  </div>`
);

const lightbox = { trades: [], index: 0, preferred: "before" };
const hasChart = (trade, slot) => Boolean(trade[slot + "Chart"]);
const formatChartHold = hours => (hours < 1 ? Math.round(hours * 60) + "m" : hours.toFixed(1) + "h");

function chartCaptionHtml(trade) {
  const metrics = calculateTrade(trade);
  const result = metrics.result
    ? `<span class="${signClass(metrics.pnl)}">${metrics.result} ${formatPercent(metrics.pnl)}</span>`
    : "Open";
  const details = [
    (trade.MC || trade["Exit MC"]) && `MC ${escapeHtml(trade.MC || "-")} → ${escapeHtml(trade["Exit MC"] || "-")}`,
    metrics.amount != null && `Size ${formatMoney(metrics.amount, metrics.currency)}`,
    metrics.holdHours != null && `Hold ${formatChartHold(metrics.holdHours)}`,
    trade.Review && `Review ${escapeHtml(trade.Review)}`,
    trade.Tags && `Tags ${escapeHtml(trade.Tags)}`
  ].filter(Boolean);
  return (
    `<strong>${escapeHtml(trade.Ticker)}</strong> · ${escapeHtml(trade.Date)} · ${escapeHtml(trade.Strategy)} · ${result}` +
    `<div class="chart-lightbox-meta">${details.join(" · ")}</div>` +
    (trade.Notes ? `<div class="chart-lightbox-notes">${escapeHtml(trade.Notes)}</div>` : "")
  );
}

// the preferred view, or whichever chart the trade actually has
function fitMode(trade, preferred) {
  if (preferred == "compare" && hasChart(trade, "before") && hasChart(trade, "after")) return preferred;
  if (preferred != "compare" && hasChart(trade, preferred)) return preferred;
  return hasChart(trade, "before") ? "before" : "after";
}

function renderLightbox() {
  const trade = lightbox.trades[lightbox.index];
  const mode = fitMode(trade, lightbox.preferred);
  const shown = mode == "compare" ? CHART_SLOTS.map(([slot]) => slot) : [mode];
  CHART_SLOTS.forEach(([slot]) => {
    const image = chartElement("chart-lightbox-" + slot);
    image.hidden = !shown.includes(slot);
    if (image.hidden) image.removeAttribute("src");
    else image.src = chartUrl(trade[slot + "Chart"]);
  });
  chartElement("chart-lightbox-stage").classList.toggle("compare", mode == "compare");
  chartElement("chart-lightbox-modes").querySelectorAll("button").forEach(button => {
    const target = button.dataset.mode;
    button.classList.toggle("active", target == mode);
    button.disabled =
      target == "compare" ? !(hasChart(trade, "before") && hasChart(trade, "after")) : !hasChart(trade, target);
  });
  const count = lightbox.trades.length;
  chartElement("chart-lightbox-prev").hidden = chartElement("chart-lightbox-next").hidden = count < 2;
  chartElement("chart-lightbox-count").hidden = count < 2;
  chartElement("chart-lightbox-prev").disabled = lightbox.index == 0;
  chartElement("chart-lightbox-next").disabled = lightbox.index == count - 1;
  chartElement("chart-lightbox-count").textContent = `${lightbox.index + 1} / ${count}`;
  const download = chartElement("chart-lightbox-download");
  download.hidden = mode == "compare";
  if (mode != "compare") {
    const key = trade[mode + "Chart"];
    download.href = chartUrl(key);
    download.download = key.split("/").pop();
  }
  chartElement("chart-lightbox-caption").innerHTML = chartCaptionHtml(trade);
}

// trades is the list that Previous and Next walk through
function openLightbox(trade, slot, trades = [trade]) {
  const index = trades.findIndex(entry => entry.id == trade.id);
  lightbox.trades = index < 0 ? [trade] : trades;
  lightbox.index = Math.max(index, 0);
  lightbox.preferred = slot;
  renderLightbox();
  chartElement("chart-lightbox").hidden = false;
}

function closeLightbox() {
  chartElement("chart-lightbox").hidden = true;
  CHART_SLOTS.forEach(([slot]) => chartElement("chart-lightbox-" + slot).removeAttribute("src"));
}

function stepLightbox(delta) {
  const next = lightbox.index + delta;
  if (next < 0 || next >= lightbox.trades.length) return;
  lightbox.index = next;
  renderLightbox();
}

chartElement("chart-lightbox-modes").onclick = event => {
  const button = event.target.closest("button[data-mode]");
  if (!button || button.disabled) return;
  lightbox.preferred = button.dataset.mode;
  renderLightbox();
};
chartElement("chart-lightbox-prev").onclick = () => stepLightbox(-1);
chartElement("chart-lightbox-next").onclick = () => stepLightbox(1);
chartElement("chart-lightbox-close").onclick = closeLightbox;
chartElement("chart-lightbox").onclick = event => {
  if (event.target.id == "chart-lightbox" || event.target.id == "chart-lightbox-stage") closeLightbox();
};
document.addEventListener("keydown", event => {
  if (chartElement("chart-lightbox").hidden) return;
  if (event.key == "Escape") closeLightbox();
  if (event.key == "ArrowLeft") stepLightbox(-1);
  if (event.key == "ArrowRight") stepLightbox(1);
});

// upload, replace and remove from any page that shows chartSlotsHtml
function createChartActions({ findTrade, reload, setStatus }) {
  const fileInput = chartElement("chart-file-input");
  let pending = null;

  async function change(action, doneMessage) {
    setStatus("Saving chart...");
    try {
      await action();
      await reload();
      setStatus(doneMessage);
    } catch (error) {
      if (error.message == "locked") return reload();
      setStatus("Chart failed: " + error.message);
    }
  }

  fileInput.onchange = () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file || !pending) return;
    const { tradeId, slot } = pending;
    change(() => uploadChart(tradeId, slot, file), "Chart saved ✓");
  };

  function handle(button, tradeId, viewList) {
    const { chartAction, slot } = button.dataset;
    if (chartAction == "view") return openLightbox(findTrade(tradeId), slot, viewList);
    if (chartAction == "remove") {
      if (confirm("Remove the " + slot + " chart?")) change(() => removeChart(tradeId, slot), "Chart removed ✓");
      return;
    }
    pending = { tradeId, slot };
    fileInput.click();
  }

  return { change, handle };
}
