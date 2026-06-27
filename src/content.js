(() => {
  "use strict";

  const DATA_URL = chrome.runtime.getURL("data/uk-sponsors.index.json");
  const SETTINGS_DEFAULTS = { enabled: true, country: "GB" };
  const CARD_SELECTORS = [
    ".job-card-container",
    ".jobs-search-results__list-item",
    "li.scaffold-layout__list-item",
    "li[data-job-id]",
    "div.job-card-container[data-job-id]"
  ];
  const CARD_COMPANY_SELECTORS = [
    ".artdeco-entity-lockup__subtitle",
    ".job-card-container__primary-description",
    ".base-search-card__subtitle",
    "[class*='job-card'] [class*='subtitle']"
  ];
  const DETAIL_COMPANY_SELECTORS = [
    ".job-details-jobs-unified-top-card__company-name",
    ".jobs-unified-top-card__company-name",
    ".topcard__org-name-link",
    ".job-details-jobs-unified-top-card__primary-description-container a"
  ];

  let settings = { ...SETTINGS_DEFAULTS };
  let sponsorIndex = null;
  let observer = null;
  let scanTimer = null;
  let currentUrl = location.href;
  const resultCache = new Map();
  const pageStatus = { checked: 0, licensed: 0, unlicensed: 0, companies: [] };

  async function loadSettings() {
    settings = { ...SETTINGS_DEFAULTS, ...(await chrome.storage.local.get(SETTINGS_DEFAULTS)) };
  }

  async function loadSponsorIndex() {
    if (sponsorIndex) return sponsorIndex;
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`Sponsor data failed to load: ${response.status}`);
    const dataset = await response.json();
    sponsorIndex = VSCMatcher.buildIndex(dataset);
    return sponsorIndex;
  }

  function cleanCompanyName(value) {
    return String(value || "")
      .replace(/\s*[|·•]\s*(?:LinkedIn|Hiring|Careers).*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findCompanyElement(container, selectors) {
    for (const selector of selectors) {
      const element = container.querySelector(selector);
      const text = cleanCompanyName(element?.textContent);
      if (element && text && text.length <= 180) return { element, text };
    }
    return null;
  }

  function match(companyName) {
    const key = VSCMatcher.canonicalize(companyName);
    if (!resultCache.has(key)) resultCache.set(key, VSCMatcher.matchCompany(sponsorIndex, companyName));
    return resultCache.get(key);
  }

  function resultTitle(companyName, result) {
    if (!result.found) return `${companyName} was not found in the bundled UK sponsor register.`;
    const route = result.skilledWorker ? "Skilled Worker route listed." : "Licensed sponsor, but Skilled Worker route is not listed.";
    return `Matched: ${result.officialName}\n${route}\nConfidence: ${Math.round(result.confidence * 100)}% (${result.method})`;
  }

  function applyHighlight(element, companyName, result) {
    element.classList.remove("vsc-company--licensed", "vsc-company--unlicensed");
    element.classList.add(result.found ? "vsc-company--licensed" : "vsc-company--unlicensed");
    element.dataset.vscChecked = "true";
    element.dataset.vscCompany = companyName;
    element.title = resultTitle(companyName, result);
  }

  function makeRail(result, companyName) {
    const rail = document.createElement("span");
    rail.className = `vsc-card-rail ${result.found ? "vsc-card-rail--licensed" : "vsc-card-rail--unlicensed"}`;
    rail.setAttribute("aria-label", result.found ? "Licensed sponsor" : "Sponsor not found");
    rail.title = resultTitle(companyName, result);
    rail.innerHTML = `<span class="vsc-card-rail__dot"></span><span class="vsc-card-rail__label">${result.found ? "Sponsor" : "Not found"}</span>`;
    return rail;
  }

  function scanCards() {
    const cards = new Set();
    CARD_SELECTORS.forEach((selector) => document.querySelectorAll(selector).forEach((element) => cards.add(element)));

    cards.forEach((card) => {
      if (card.dataset.vscProcessed === "true") return;
      const found = findCompanyElement(card, CARD_COMPANY_SELECTORS);
      if (!found) return;
      const result = match(found.text);
      card.dataset.vscProcessed = "true";
      card.classList.add("vsc-job-card");
      applyHighlight(found.element, found.text, result);
      card.querySelector(":scope > .vsc-card-rail")?.remove();
      card.prepend(makeRail(result, found.text));
    });
  }

  function scanDetail() {
    const found = findCompanyElement(document, DETAIL_COMPANY_SELECTORS);
    if (!found) {
      document.getElementById("vsc-detail-panel")?.remove();
      return;
    }

    const companyName = found.text;
    const result = match(companyName);
    applyHighlight(found.element, companyName, result);

    let panel = document.getElementById("vsc-detail-panel");
    if (!panel) {
      panel = document.createElement("aside");
      panel.id = "vsc-detail-panel";
      panel.setAttribute("role", "status");
      document.body.appendChild(panel);
    }

    panel.className = result.found ? "vsc-detail-panel--licensed" : "vsc-detail-panel--unlicensed";
    panel.innerHTML = `
      <div class="vsc-detail-panel__glow"></div>
      <div class="vsc-detail-panel__icon">${result.found ? "✓" : "×"}</div>
      <div class="vsc-detail-panel__content">
        <span class="vsc-detail-panel__eyebrow">UK SPONSOR CHECK</span>
        <strong>${result.found ? "Licensed sponsor" : "Not found"}</strong>
        <span>${escapeHtml(companyName)}</span>
        ${result.found ? `<small>Official: ${escapeHtml(result.officialName)}</small>` : ""}
        ${result.found && !result.skilledWorker ? "<small class='vsc-warning'>No Skilled Worker route found</small>" : ""}
      </div>`;
    panel.title = resultTitle(companyName, result);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }

  function refreshStatusFromDom() {
    const companies = new Map();
    document.querySelectorAll("[data-vsc-checked][data-vsc-company]").forEach((element) => {
      const companyName = element.dataset.vscCompany;
      const key = VSCMatcher.canonicalize(companyName);
      if (!key || companies.has(key)) return;
      const result = match(companyName);
      companies.set(key, {
        companyName,
        found: result.found,
        officialName: result.officialName || null,
        confidence: result.confidence,
        skilledWorker: Boolean(result.skilledWorker)
      });
    });
    pageStatus.companies = [...companies.values()];
    pageStatus.checked = pageStatus.companies.length;
    pageStatus.licensed = pageStatus.companies.filter((item) => item.found).length;
    pageStatus.unlicensed = pageStatus.checked - pageStatus.licensed;
  }

  function resetStatus() {
    pageStatus.checked = 0;
    pageStatus.licensed = 0;
    pageStatus.unlicensed = 0;
    pageStatus.companies = [];
  }

  function removeHighlights() {
    document.querySelectorAll(".vsc-card-rail, #vsc-detail-panel").forEach((element) => element.remove());
    document.querySelectorAll("[data-vsc-checked]").forEach((element) => {
      element.classList.remove("vsc-company--licensed", "vsc-company--unlicensed");
      delete element.dataset.vscChecked;
      delete element.dataset.vscCompany;
      element.removeAttribute("title");
    });
    document.querySelectorAll("[data-vsc-processed]").forEach((element) => {
      delete element.dataset.vscProcessed;
      element.classList.remove("vsc-job-card");
    });
    resetStatus();
  }

  async function runScan({ force = false } = {}) {
    if (!settings.enabled || settings.country !== "GB") {
      removeHighlights();
      return;
    }
    try {
      await loadSponsorIndex();
      if (force) removeHighlights();
      scanCards();
      scanDetail();
      refreshStatusFromDom();
    } catch (error) {
      console.error("[Visa Sponsorship Checker]", error);
    }
  }

  function scheduleScan(force = false) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => runScan({ force }), 180);
  }

  function startObserver() {
    observer?.disconnect();
    observer = new MutationObserver(() => {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        scheduleScan(true);
      } else {
        scheduleScan(false);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.country) settings.country = changes.country.newValue;
    scheduleScan(true);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_PAGE_STATUS") {
      sendResponse({
        supported: location.hostname === "www.linkedin.com" && location.pathname.startsWith("/jobs"),
        enabled: settings.enabled,
        country: settings.country,
        ...pageStatus
      });
      return false;
    }
    if (message?.type === "RECHECK_PAGE") {
      runScan({ force: true }).then(() => sendResponse({ ok: true, ...pageStatus }));
      return true;
    }
    return false;
  });

  async function init() {
    await loadSettings();
    startObserver();
    await runScan({ force: true });
  }

  init();
})();
