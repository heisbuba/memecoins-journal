const CHART_SLOTS = [["before", "Before"], ["after", "After"]];
const MAX_CHART_EDGE = 2400;
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

// downscale and re-encode as WebP (JPEG where WebP encoding is unsupported)
async function compressChart(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_CHART_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = type => new Promise(resolve => canvas.toBlob(resolve, type, 0.85));
  const webp = await encode("image/webp");
  return webp && webp.type == "image/webp" ? webp : encode("image/jpeg");
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

const uploadChart = async (tradeId, slot, file) => sendChart("PUT", tradeId, slot, await compressChart(file));
const removeChart = (tradeId, slot) => sendChart("DELETE", tradeId, slot);

let lightboxTrade = null;

function showLightboxSlot(slot) {
  const key = lightboxTrade[slot + "Chart"];
  chartElement("chart-lightbox-image").src = key ? chartUrl(key) : "";
  CHART_SLOTS.forEach(([name]) => {
    const button = chartElement("chart-lightbox-" + name);
    button.disabled = !lightboxTrade[name + "Chart"];
    button.classList.toggle("active", name == slot);
  });
}

function openLightbox(trade, slot) {
  lightboxTrade = trade;
  showLightboxSlot(slot);
  chartElement("chart-lightbox").hidden = false;
}

function closeLightbox() {
  chartElement("chart-lightbox").hidden = true;
  chartElement("chart-lightbox-image").src = "";
}

CHART_SLOTS.forEach(([slot]) => (chartElement("chart-lightbox-" + slot).onclick = () => showLightboxSlot(slot)));
chartElement("chart-lightbox-close").onclick = closeLightbox;
chartElement("chart-lightbox").onclick = event => {
  if (event.target.id == "chart-lightbox") closeLightbox();
};
document.addEventListener("keydown", event => {
  if (event.key == "Escape" && !chartElement("chart-lightbox").hidden) closeLightbox();
});
