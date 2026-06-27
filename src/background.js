const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  country: "GB"
});

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set({
    enabled: typeof existing.enabled === "boolean" ? existing.enabled : true,
    country: existing.country || "GB"
  });
});
