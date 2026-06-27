(() => {
  "use strict";

  const CONTENT_VERSION = "1.1.0";
  if (globalThis.__VSC_CONTENT_VERSION__ === CONTENT_VERSION) {
    globalThis.dispatchEvent(new CustomEvent("vsc:rescan"));
    return;
  }
  globalThis.__VSC_CONTENT_VERSION__ = CONTENT_VERSION;

  const METADATA_URL = chrome.runtime.getURL("data/metadata.json");
  const DATA_PART_PREFIX = "data/uk-sponsors.index.json.gz.part";
  const SETTINGS_DEFAULTS = { enabled: true, country: "GB" };
  const CARD_SELECTORS = [
    ".job-card-container",
    ".jobs-search-results__list-item",
    "li.scaffold-layout__list-item",
    "li[data-occludable-job-id]",
    "li[data-job-id]"
  ];
  const CARD_COMPANY_SELECTORS = [
    ".artdeco-entity-lockup__subtitle",
    ".job-card-container__primary-description",
    ".base-search-card__subtitle",
    "[class*='job-card'] [class*='primary-description']",
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
  let sponsorIndexPromise = null;
  let observer = null;
  let scanTimer = null;
  let currentUrl = location.href;
  const resultCache = new Map();
  const pageStatus = {
    phase: "loading",
    error: null,
    checked: 0,
    licensed: 0,
    unlicensed: 0,
    companies: []
  };

  async function loadSettings() {
    settings = { ...SETTINGS_DEFAULTS, ...(await chrome.storage.local.get(SETTINGS_DEFAULTS)) };
  }

  async function createSponsorIndex() {
    if (typeof DecompressionStream !== "function") throw new Error("This Chrome version cannot decompress the offline register.");
    const metadataResponse = await fetch(METADATA_URL);
    if (!metadataResponse.ok) throw new Error(`Sponsor metadata failed to load (${metadataResponse.status}).`);
    const metadata = await metadataResponse.json();
    const partCount = Number(metadata.indexPartCount);
    if (!Number.isInteger(partCount) || partCount < 1) throw new Error("The offline sponsor register is incomplete.");

    const responses = await Promise.all(Array.from({ length: partCount }, (_, index) =>
      fetch(chrome.runtime.getURL(`${DATA_PART_PREFIX}${String(index).padStart(2, "0")}`))
    ));
    const failed = responses.find((response) => !response.ok);
    if (failed) throw new Error(`Sponsor data failed to load (${failed.status}).`);

    const buffers = await Promise.all(responses.map((response) => response.arrayBuffer()));
    const totalLength = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
    const compressed = new Uint8Array(totalLength);
    let offset = 0;
    for (const buffer of buffers) {
      compressed.set(new Uint8Array(buffer), offset);
      offset += buffer.byteLength;
    }

    const decompressed = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
    const dataset = JSON.parse(await new Response(decompressed).text());
    return VSCMatcher.buildIndex(dataset);
  }

  async function loadSponsorIndex() {
    if (sponsorIndex) return sponsorIndex;
    if (!sponsorIndexPromise) sponsorIndexPromise = createSponsorIndex();
    sponsorIndex = await sponsorIndexPromise;
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
    const route = result.skilledWorker ? "Skilled Worker route listed." : "Licensed sponsor, but the Skilled Worker route is not listed.";
    return `Matched to: ${result.officialName}\n${route}\nConfidence: ${Math.round(result.confidence * 100)}% (${result.method})`;
  }

  function makeCompanyMarker(companyName, result) {
    const marker = document.createElement("span");
    marker.className = `vsc-company-marker ${result.found ? "vsc-company-marker--licensed" : "vsc-company-marker--unlicensed"}`;
    marker.dataset.vscMarker = "true";
    marker.textContent = result.found ? "Licensed" : "Not found";
    marker.title = resultTitle(companyName, result);
    return marker;
  }

  function clearCard(card) {
    card.classList.remove("vsc-job-card", "vsc-job-card--licensed", "vsc-job-card--unlicensed");
    card.querySelectorAll(".vsc-company-marker").forEach((marker) => marker.remove());
    delete card.dataset.vscCompanyKey;
  }

  function applyCard(card, companyElement, companyName, result) {
    clearCard(card);
    const companyKey = VSCMatcher.canonicalize(companyName);
    card.dataset.vscCompanyKey = companyKey;
    card.classList.add("vsc-job-card", result.found ? "vsc-job-card--licensed" : "vsc-job-card--unlicensed");
    companyElement.classList.remove("vsc-company--licensed", "vsc-company--unlicensed");
    companyElement.classList.add(result.found ? "vsc-company--licensed" : "vsc-company--unlicensed");
    companyElement.dataset.vscChecked = "true";
    companyElement.dataset.vscCompany = companyName;
    companyElement.title = resultTitle(companyName, result);
    companyElement.insertAdjacentElement("afterend", makeCompanyMarker(companyName, result));
  }

  function normalizedCard(element) {
    if (element.matches?.(".job-card-container")) return element;
    return element.querySelector?.(".job-card-container") || element;
  }

  function scanCards() {
    const cards = new Set();
    for (const selector of CARD_SELECTORS) {
      document.querySelectorAll(selector).forEach((element) => cards.add(normalizedCard(element)));
    }

    cards.forEach((card) => {
      const found = findCompanyElement(card, CARD_COMPANY_SELECTORS);
      if (!found) return;
      const companyKey = VSCMatcher.canonicalize(found.text);
      if (card.dataset.vscCompanyKey === companyKey && card.querySelector(".vsc-company-marker")) return;
      applyCard(card, found.element, found.text, match(found.text));
    });
  }

  function scanDetail() {
    const previous = document.querySelector(".vsc-detail-status");
    const found = findCompanyElement(document, DETAIL_COMPANY_SELECTORS);
    if (!found) {
      previous?.remove();
      return;
    }

    const result = match(found.text);
    const companyKey = VSCMatcher.canonicalize(found.text);
    if (previous?.dataset.companyKey === companyKey) return;
    previous?.remove();

    found.element.classList.remove("vsc-company--licensed", "vsc-company--unlicensed");
    found.element.classList.add(result.found ? "vsc-company--licensed" : "vsc-company--unlicensed");
    found.element.dataset.vscChecked = "true";
    found.element.dataset.vscCompany = found.text;
    found.element.title = resultTitle(found.text, result);

    const status = document.createElement("div");
    status.className = `vsc-detail-status ${result.found ? "vsc-detail-status--licensed" : "vsc-detail-status--unlicensed"}`;
    status.dataset.companyKey = companyKey;
    status.title = resultTitle(found.text, result);
    const secondary = result.found
      ? (result.skilledWorker ? result.officialName : `${result.officialName} · no Skilled Worker route`)
      : "No reliable match in the UK register";
    status.innerHTML = `<span class="vsc-detail-status__dot"></span><span class="vsc-detail-status__text"><strong>${result.found ? "Licensed sponsor" : "Sponsor not found"}</strong><span class="vsc-detail-status__secondary">${escapeHtml(secondary)}</span></span>`;
    found.element.insertAdjacentElement("afterend", status);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
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
    document.querySelectorAll(".vsc-company-marker, .vsc-detail-status").forEach((element) => element.remove());
    document.querySelectorAll("[data-vsc-checked]").forEach((element) => {
      element.classList.remove("vsc-company--licensed", "vsc-company--unlicensed");
      delete element.dataset.vscChecked;
      delete element.dataset.vscCompany;
      element.removeAttribute("title");
    });
    document.querySelectorAll(".vsc-job-card").forEach(clearCard);
    resetStatus();
  }

  async function runScan({ force = false } = {}) {
    if (!settings.enabled || settings.country !== "GB") {
      pageStatus.phase = "disabled";
      pageStatus.error = null;
      removeHighlights();
      return pageStatus;
    }

    try {
      pageStatus.phase = "loading";
      pageStatus.error = null;
      await loadSponsorIndex();
      if (force) removeHighlights();
      scanCards();
      scanDetail();
      refreshStatusFromDom();
      pageStatus.phase = "ready";
    } catch (error) {
      pageStatus.phase = "error";
      pageStatus.error = error instanceof Error ? error.message : String(error);
      console.error("[Visa Sponsorship Checker]", error);
    }
    return pageStatus;
  }

  function scheduleScan(force = false) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => runScan({ force }), 160);
  }

  function startObserver() {
    observer?.disconnect();
    observer = new MutationObserver(() => {
      const urlChanged = location.href !== currentUrl;
      if (urlChanged) currentUrl = location.href;
      scheduleScan(urlChanged);
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
        supported: VSCUrl.isLinkedInJobsUrl(location.href),
        connected: true,
        enabled: settings.enabled,
        country: settings.country,
        ...pageStatus
      });
      return false;
    }
    if (message?.type === "RECHECK_PAGE") {
      runScan({ force: true }).then((status) => sendResponse({
        ok: status.phase !== "error",
        supported: true,
        connected: true,
        enabled: settings.enabled,
        country: settings.country,
        ...status
      }));
      return true;
    }
    return false;
  });

  globalThis.addEventListener("vsc:rescan", () => scheduleScan(true));

  async function init() {
    await loadSettings();
    startObserver();
    await runScan({ force: true });
  }

  init();
})();
