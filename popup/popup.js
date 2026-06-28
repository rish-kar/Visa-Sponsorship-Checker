const DEFAULTS = { enabled: true, country: "GB" };
const CONTENT_VERSION = "1.5.8";
const INJECTION_FILES = ["src/matcher.js", "src/url-utils.js", "src/linkedin-extractor.js", "src/job-list-scanner.js"];
const COUNTRIES = {
  GB: {
    flagSrc: "../icons/flag-gb.svg",
    name: "United Kingdom",
    metadataPath: "data/metadata.json",
    countLabel: "licensed organisations"
  },
  NL: {
    flagSrc: "../icons/flag-nl.svg",
    name: "Netherlands",
    metadataPath: "data/nl-metadata.json",
    countLabel: "recognised sponsors"
  }
};

const elements = {
  toggle: document.getElementById("enabledToggle"),
  country: document.getElementById("countrySelect"),
  connection: document.getElementById("connectionCard"),
  connectionLabel: document.getElementById("connectionLabel"),
  connectionTitle: document.getElementById("connectionTitle"),
  connectionDescription: document.getElementById("connectionDescription"),
  countryField: document.getElementById("countryField"),
  countryButton: document.getElementById("countryButton"),
  countryMenu: document.getElementById("countryMenu"),
  countryFlag: document.getElementById("countryFlag"),
  countryFlagImage: document.getElementById("countryFlagImage"),
  countryName: document.getElementById("countryName"),
  sponsorLabel: document.getElementById("sponsorLabel"),
  sponsorCount: document.getElementById("sponsorCount"),
  registerDate: document.getElementById("registerDate"),
  checked: document.getElementById("checkedCount"),
  licensed: document.getElementById("licensedCount"),
  unlicensed: document.getElementById("unlicensedCount"),
  recheck: document.getElementById("recheckButton")
};
elements.countryOptions = [...elements.countryMenu.querySelectorAll("[data-country]")];

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

function countryConfig(country = currentSettings.country) {
  return COUNTRIES[country] || COUNTRIES.GB;
}

function renderCountry() {
  const config = countryConfig();
  elements.country.value = currentSettings.country;
  elements.countryButton.setAttribute("aria-expanded", String(!elements.countryMenu.hidden));
  elements.countryButton.setAttribute("aria-label", `Country: ${config.name}`);
  elements.countryFlagImage.src = config.flagSrc;
  elements.countryName.textContent = config.name;
  elements.sponsorLabel.textContent = config.countLabel;
  elements.countryOptions.forEach((option) => {
    option.setAttribute("aria-selected", String(option.dataset.country === currentSettings.country));
  });
}

function closeCountryMenu() {
  elements.countryMenu.hidden = true;
  elements.countryField.classList.remove("is-open");
  elements.countryButton.setAttribute("aria-expanded", "false");
}

function openCountryMenu() {
  elements.countryMenu.hidden = false;
  elements.countryField.classList.add("is-open");
  elements.countryButton.setAttribute("aria-expanded", "true");
}

function toggleCountryMenu() {
  if (elements.countryMenu.hidden) openCountryMenu();
  else closeCountryMenu();
}

async function selectCountry(country) {
  if (!COUNTRIES[country]) return;
  closeCountryMenu();
  if (currentSettings.country === country) {
    renderCountry();
    return;
  }
  currentSettings.country = country;
  await chrome.storage.local.set({ country: currentSettings.country });
  renderCountry();
  await loadMetadata();
  const refreshed = await hardRefreshCurrentTab();
  await connectToLinkedIn({ forceScan: !refreshed });
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

  if (status?.phase === "disabled") {
    const country = status.country || currentSettings.country;
    if (!COUNTRIES[country]) {
      setConnection("unsupported", "COUNTRY UNAVAILABLE", "That register is not bundled yet", "Choose United Kingdom or Netherlands to scan LinkedIn job cards.");
    } else {
      renderEnabled(false);
    }
    return;
  }

  const checked = status?.checked ?? 0;
  const cards = status?.cardsDetected ?? 0;
  const extracted = status?.companiesExtracted ?? 0;
  let description = `Detected ${cards} cards and extracted ${extracted} company names.`;
  if (checked) description = `${status.licensed ?? 0} licensed · ${status.unlicensed ?? 0} not found.`;

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

function sendBackgroundMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response);
      });
    } catch {
      resolve(null);
    }
  });
}

async function injectContent(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["src/content.css"] });
  for (const file of INJECTION_FILES) {
    await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
  }
}

async function waitForSettledStatus(tabId, initialStatus) {
  let status = initialStatus;
  const deadline = Date.now() + 30000;
  while (status?.phase === "loading" && Date.now() < deadline) {
    await wait(250);
    status = await sendStatusMessage(tabId);
    renderStatus(status);
  }
  return status;
}

async function waitForTabReload(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 20000);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function hardRefreshCurrentTab() {
  currentTab = await getActiveTab();
  const activeUrl = currentTab?.url || currentTab?.pendingUrl || "";
  if (!currentTab?.id || !VSCUrl.isLinkedInJobsUrl(activeUrl)) return false;
  setConnection("loading", "RELOADING", "Reloading LinkedIn Jobs", "Applying the selected country register.");
  renderCounts();
  await chrome.tabs.reload(currentTab.id, { bypassCache: true });
  await waitForTabReload(currentTab.id);
  await wait(500);
  return true;
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
      await wait(350);
      status = await sendStatusMessage(currentTab.id);
    }

    if (forceScan) {
      status = await chrome.tabs.sendMessage(currentTab.id, { type: "RECHECK_PAGE", country: currentSettings.country });
    } else {
      status = await waitForSettledStatus(currentTab.id, status);
      await wait(300);
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

function renderMetadata(metadata) {
  elements.sponsorCount.textContent = Number(metadata.organisationCount).toLocaleString("en-GB");
  elements.registerDate.textContent = new Date(`${metadata.registerUpdated}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric"
  });
}

async function loadMetadata() {
  const config = countryConfig();
  try {
    const cached = await sendBackgroundMessage({ type: "GET_SPONSOR_METADATA", country: currentSettings.country });
    if (cached?.ok && cached.metadata) {
      renderMetadata(cached.metadata);
      return;
    }

    const response = await fetch(chrome.runtime.getURL(config.metadataPath));
    if (!response.ok) throw new Error(`Metadata HTTP ${response.status}`);
    renderMetadata(await response.json());
  } catch (error) {
    console.error("[Visa Sponsorship Checker] Metadata unavailable", error);
    elements.sponsorCount.textContent = "Offline data";
    elements.registerDate.textContent = "Unavailable";
  }
}

async function init() {
  currentSettings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  if (!COUNTRIES[currentSettings.country]) {
    currentSettings.country = DEFAULTS.country;
    await chrome.storage.local.set({ country: currentSettings.country });
  }
  renderEnabled(currentSettings.enabled);
  renderCountry();
  await Promise.all([loadMetadata(), connectToLinkedIn()]);
}

elements.toggle.addEventListener("change", async () => {
  currentSettings.enabled = elements.toggle.checked;
  await chrome.storage.local.set({ enabled: currentSettings.enabled });
  renderEnabled(currentSettings.enabled);
  if (currentSettings.enabled) await connectToLinkedIn({ forceScan: true });
  else renderCounts();
});

elements.countryButton.addEventListener("click", toggleCountryMenu);

elements.countryButton.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "Enter", " "].includes(event.key)) return;
  event.preventDefault();
  openCountryMenu();
  const selected = elements.countryOptions.find((option) => option.dataset.country === currentSettings.country) || elements.countryOptions[0];
  selected?.focus();
});

elements.countryOptions.forEach((option) => {
  option.addEventListener("click", () => selectCountry(option.dataset.country));
  option.addEventListener("keydown", (event) => {
    const index = elements.countryOptions.indexOf(option);
    if (event.key === "Escape") {
      closeCountryMenu();
      elements.countryButton.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const next = elements.countryOptions[(index + direction + elements.countryOptions.length) % elements.countryOptions.length];
      next.focus();
    }
  });
});

elements.country.addEventListener("change", () => selectCountry(elements.country.value));
document.addEventListener("click", (event) => {
  if (!elements.countryField.contains(event.target)) closeCountryMenu();
});

elements.recheck.addEventListener("click", () => connectToLinkedIn({ forceScan: true }));

init();
