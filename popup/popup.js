const DEFAULTS = { enabled: true, country: "GB" };

const elements = {
  toggle: document.getElementById("enabledToggle"),
  country: document.getElementById("countrySelect"),
  statusDot: document.getElementById("statusDot"),
  statusLabel: document.getElementById("statusLabel"),
  sponsorCount: document.getElementById("sponsorCount"),
  registerDate: document.getElementById("registerDate"),
  checked: document.getElementById("checkedCount"),
  licensed: document.getElementById("licensedCount"),
  unlicensed: document.getElementById("unlicensedCount"),
  pagePill: document.getElementById("pagePill"),
  recheck: document.getElementById("recheckButton"),
  spotlightCard: document.getElementById("spotlightCard")
};

function renderEnabled(enabled) {
  elements.toggle.checked = enabled;
  elements.statusLabel.textContent = enabled ? "Enabled" : "Disabled";
  elements.statusDot.classList.toggle("off", !enabled);
}

function renderPageStatus(status) {
  if (!status?.supported) {
    elements.pagePill.textContent = "Open LinkedIn Jobs";
    elements.pagePill.className = "live-pill unsupported";
    elements.recheck.disabled = true;
    return;
  }
  elements.pagePill.textContent = "Live";
  elements.pagePill.className = "live-pill supported";
  elements.recheck.disabled = false;
  elements.checked.textContent = status.checked ?? 0;
  elements.licensed.textContent = status.licensed ?? 0;
  elements.unlicensed.textContent = status.unlicensed ?? 0;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refreshPageStatus() {
  try {
    const tab = await activeTab();
    const isLinkedInJobs = tab?.url?.startsWith("https://www.linkedin.com/jobs/");
    if (!isLinkedInJobs) return renderPageStatus({ supported: false });
    const status = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_STATUS" });
    renderPageStatus(status);
  } catch {
    renderPageStatus({ supported: false });
  }
}

async function init() {
  const settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  renderEnabled(settings.enabled);
  elements.country.value = settings.country;

  try {
    const metadata = await (await fetch(chrome.runtime.getURL("data/metadata.json"))).json();
    elements.sponsorCount.textContent = Number(metadata.organisationCount).toLocaleString("en-GB");
    elements.registerDate.textContent = new Date(`${metadata.registerUpdated}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    elements.sponsorCount.textContent = "Offline";
  }

  await refreshPageStatus();
}

elements.toggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ enabled: elements.toggle.checked });
  renderEnabled(elements.toggle.checked);
  setTimeout(refreshPageStatus, 100);
});

elements.country.addEventListener("change", async () => {
  await chrome.storage.local.set({ country: elements.country.value });
  setTimeout(refreshPageStatus, 100);
});

elements.recheck.addEventListener("click", async () => {
  elements.recheck.disabled = true;
  elements.recheck.textContent = "Checking…";
  try {
    const tab = await activeTab();
    const status = await chrome.tabs.sendMessage(tab.id, { type: "RECHECK_PAGE" });
    renderPageStatus({ supported: true, ...status });
  } finally {
    elements.recheck.innerHTML = "<span>↻</span> Recheck page";
    elements.recheck.disabled = false;
  }
});

elements.spotlightCard.addEventListener("pointermove", (event) => {
  const rect = elements.spotlightCard.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const spotlight = elements.spotlightCard.querySelector(".spotlight");
  spotlight.style.left = `${x}px`;
  spotlight.style.top = `${y}px`;
  const rotateY = ((x / rect.width) - 0.5) * 2.2;
  const rotateX = ((y / rect.height) - 0.5) * -2.2;
  elements.spotlightCard.style.transform = `perspective(700px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
});

elements.spotlightCard.addEventListener("pointerleave", () => {
  elements.spotlightCard.style.transform = "";
});

init();
