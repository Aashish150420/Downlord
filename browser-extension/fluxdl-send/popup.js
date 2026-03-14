const sendButton = document.getElementById("sendCurrent");
const openOptionsLink = document.getElementById("openOptions");

sendButton.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;
  chrome.runtime.sendMessage({ type: "OPEN_FLUXDL", url: tab.url }, () => {
    window.close();
  });
});

openOptionsLink.addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});
