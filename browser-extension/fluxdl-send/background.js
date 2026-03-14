const DEFAULT_BASE_URL = "http://localhost:3000";
const MENU_ID = "fluxdl-send";

function normalizeBaseUrl(input) {
  const value = String(input || "").trim();
  if (!value) return DEFAULT_BASE_URL;
  return value.replace(/\/+$/, "");
}

async function getBaseUrl() {
  const data = await chrome.storage.sync.get({ fluxBaseUrl: DEFAULT_BASE_URL });
  return normalizeBaseUrl(data.fluxBaseUrl);
}

async function openFluxDlWithUrl(mediaUrl) {
  if (!mediaUrl) return;
  const baseUrl = await getBaseUrl();
  const targetUrl = `${baseUrl}/?extUrl=${encodeURIComponent(mediaUrl)}`;
  chrome.tabs.create({ url: targetUrl });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Send to FluxDL",
    contexts: ["link", "video", "audio", "page"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const url = info.linkUrl || info.srcUrl || info.pageUrl || tab?.url;
  openFluxDlWithUrl(url);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OPEN_FLUXDL" && message?.url) {
    openFluxDlWithUrl(message.url)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || "Failed" }),
      );
    return true;
  }
  return false;
});
