const DEFAULTS = { enabled: true, country: "GB" };
const CONTENT_VERSION = "1.3.0";
const INJECTION_FILES = ["src/matcher.js", "src/url-utils.js", "src/linkedin-extractor.js", "src/structural-scanner.js"];

const elements = {
  toggle: document.getElementById("enabledToggle"),
  country: document.getElementById("countrySelect"),
  connection: document.getElementById("connectionCard"),
  connectionLabel: document.getElementById("connectionLabel"),
  connectionTitle: document.getElementById("connectionTitle"),
  connectionDescription: document.getElementById("connectionDescription"),
  sponsorCount: document.getElementById("sponsorCount"),
  registerDate: document.getElementById("registerDate"),
  checked: document.getElementById("checkedCount"),
  licensed: document.getElementById("licensedCount"),
  unlicensed: document.getElementById("unlicensedCount"),
  recheck: document.getElementById("recheckButton")
};

let currentTab = null;
let currentSettings = { ...DEFAULTS };
let busy = false;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function setConnection(state, label, title, description) {
  elements.connection.dataset.state = state;
  elements.connectionLabel.textContent = label;
  elements.connectionTitle.textContent = title;
  elements.connectionDescription.textContent = description;
}

function renderEnabled(enabled) {
  elements.toggle.checked = enabled;
  if (!enabled) setConnection("disabled", "PAUSED", "Sponsor checking is off", "Turn it on to scan LinkedIn job cards.");
}

function renderCounts(status = {}) {
  elements.checked.textContent = status.checked ?? 0;
  elements.licensed.textContent = status.licensed ?? 0;
  elements.unlicensed.textContent = status.unlicensed ?? 0;
}

function renderStatus(status) {
  renderCounts(status);
  if (!currentSettings.enabled) {
    renderEnabled(false);
    return;
  }

  if (status?.phase === "loading") {
    setConnection("loading", "LOADING REGISTER", "Preparing offline sponsor data", "The first scan can take a moment.");
    return;
  }

  if (status?.phase === "error") {
    setConnection("error", "SCAN ERROR", "The sponsor register could not load", status.error || "Reload the extension and try again.");
    return;
  }

  const checked = status?.checked ?? 0;
  const cards = status?.cardsDetected ?? 0;
  const extracted = status?.companiesExtracted ?? 0;
  let description = "Scroll the job list or press rescan.";
  if (checked) description = `${status.licensed ?? 0} licensed · ${status.unlicensed ?? 0} not found.`;
  else if (cards) description = `${cards} job cards detected; ${extracted} company names extracted.`;

  setConnection(
    "connected",
    "CONNECTED",
    checked ? `${checked} ${checked === 1 ? "company" : "companies"} checked` : "Connected to LinkedIn Jobs",
    description
  );
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function sendStatusMessage(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_STATUS" });
}

async function injectContent(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["src/content.css"] });
  for (const file of INJECTION_FILES) {
    await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
  }
}

async function waitForSettledStatus(tabId, initialStatus) {
  let status = initialStatus;
  for (let attempt = 0; status?.phase === "loading" && attempt < 30; attempt += 1) {
    await wait(150);
    status = await sendStatusMessage(tabId);
    renderStatus(status);
  }
  return status;
}

async function connectToLinkedIn({ forceScan = false } = {}) {
  if (busy) return;
  busy = true;
  elements.recheck.disabled = true;
  elements.recheck.classList.add("is-spinning");

  try {
    if (!currentSettings.enabled) {
      renderEnabled(false);
      renderCounts();
      return;
    }

    currentTab = await getActiveTab();
    const activeUrl = currentTab?.url || currentTab?.pendingUrl || "";
    if (!currentTab?.id || !VSCUrl.isLinkedInJobsUrl(activeUrl)) {
      renderCounts();
      setConnection("unsupported", "NO LINKEDIN JOB TAB", "Open a LinkedIn Jobs page", "The checker only runs on LinkedIn job-search pages.");
      return;
    }

    setConnection("loading", "CONNECTING", "Connecting to LinkedIn Jobs", "Checking the page integration.");

    let status;
    try {
      status = await sendStatusMessage(currentTab.id);
      if (status?.version !== CONTENT_VERSION) throw new Error("Outdated content script");
    } catch {
      await injectContent(currentTab.id);
      await wait(300);
      status = await sendStatusMessage(currentTab.id);
    }

    if (forceScan) {
      await chrome.tabs.sendMessage(currentTab.id, { type: "RECHECK_PAGE" });
      await wait(350);
      status = await sendStatusMessage(currentTab.id);
    } else {
      status = await waitForSettledStatus(currentTab.id, status);
      await wait(250);
      status = await sendStatusMessage(currentTab.id);
    }
    renderStatus(status);
  } catch (error) {
    console.error("[Visa Sponsorship Checker] Could not connect", error);
    renderCounts();
    setConnection("error", "CONNECTION FAILED", "Could not attach to this tab", "Reload the LinkedIn tab once, then press rescan.");
  } finally {
    busy = false;
    elements.recheck.disabled = false;
    elements.recheck.classList.remove("is-spinning");
  }
}

async function loadMetadata() {
  try {
    const response = await fetch(chrome.runtime.getURL("data/metadata.json"));
    if (!response.ok) throw new Error(`Metadata HTTP ${response.status}`);
    const metadata = await response.json();
    elements.sponsorCount.textContent = Number(metadata.organisationCount).toLocaleString("en-GB");
    elements.registerDate.textContent = new Date(`${metadata.registerUpdated}T00:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric"
    });
  } catch (error) {
    console.error("[Visa Sponsorship Checker] Metadata unavailable", error);
    elements.sponsorCount.textContent = "Offline data";
    elements.registerDate.textContent = "Unavailable";
  }
}

async function init() {
  currentSettings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  renderEnabled(currentSettings.enabled);
  elements.country.value = currentSettings.country;
  await Promise.all([loadMetadata(), connectToLinkedIn()]);
}

elements.toggle.addEventListener("change", async () => {
  currentSettings.enabled = elements.toggle.checked;
  await chrome.storage.local.set({ enabled: currentSettings.enabled });
  renderEnabled(currentSettings.enabled);
  if (currentSettings.enabled) await connectToLinkedIn({ forceScan: true });
  else renderCounts();
});

elements.country.addEventListener("change", async () => {
  currentSettings.country = elements.country.value;
  await chrome.storage.local.set({ country: currentSettings.country });
  await connectToLinkedIn({ forceScan: true });
});

elements.recheck.addEventListener("click", () => connectToLinkedIn({ forceScan: true }));

init();
