const DEFAULT_BASE_URL = "http://localhost:3000";

const baseUrlInput = document.getElementById("baseUrl");
const saveButton = document.getElementById("save");
const status = document.getElementById("status");

function normalizeBaseUrl(input) {
  const value = String(input || "").trim();
  if (!value) return DEFAULT_BASE_URL;
  return value.replace(/\/+$/, "");
}

async function loadSettings() {
  const data = await chrome.storage.sync.get({ fluxBaseUrl: DEFAULT_BASE_URL });
  baseUrlInput.value = normalizeBaseUrl(data.fluxBaseUrl);
}

saveButton.addEventListener("click", async () => {
  const fluxBaseUrl = normalizeBaseUrl(baseUrlInput.value);
  await chrome.storage.sync.set({ fluxBaseUrl });
  status.textContent = "Saved.";
  setTimeout(() => {
    status.textContent = "";
  }, 1600);
});

loadSettings();
