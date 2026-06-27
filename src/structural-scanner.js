(() => {
  "use strict";

  const VERSION = "1.4.0";
  if (globalThis.__VSC_LEFT_PANEL_SCANNER__ === VERSION) {
    globalThis.dispatchEvent(new CustomEvent("vsc:left-panel-rescan"));
    return;
  }
  globalThis.__VSC_LEFT_PANEL_SCANNER__ = VERSION;

  const DEFAULTS = { enabled: true, country: "GB" };
  const CARD_SELECTOR = [
    "[data-occludable-job-id]",
    "[data-job-id]",
    "li.jobs-search-results__list-item",
    "li.scaffold-layout__list-item",
    "li.discovery-templates-entity-item",
    "li.jobs-collections-module__list-item",
    "li.jobs-collection__list-item",
    "article.job-search-card",
    "article.base-card",
    "div.base-card"
  ].join(",");
  const DETAIL_SELECTOR = [
    ".scaffold-layout__detail",
    ".jobs-search__job-details--container",
    "[class*='jobs-search__job-details']",
    "[class*='job-details']",
    "[class*='jobs-unified-top-card']"
  ].join(",");
  const TITLE_SELECTORS = [
    "[data-view-name='job-card-title']",
    "a.job-card-list__title--link",
    ".job-card-list__title",
    "a[href*='/jobs/view/']",
    "a[href*='currentJobId=']",
    "[class*='job-title']",
    "h3"
  ];
  const COMPANY_SELECTORS = [
    ".artdeco-entity-lockup__subtitle",
    ".job-card-container__primary-description",
    ".base-search-card__subtitle",
    ".job-card-list__company-name",
    "[class*='primary-description']",
    "[class*='company-name']",
    "a[href*='/company/']"
  ];

  let settings = { ...DEFAULTS };
  let sponsorIndex;
  let sponsorIndexPromise;
  let observer;
  let scanTimer;
  const matchCache = new Map();
  const pageStatus = {
    phase: "loading",
    error: null,
    cardsDetected: 0,
    companiesExtracted: 0,
    checked: 0,
    licensed: 0,
    unlicensed: 0,
    companies: []
  };

  const normalize = (value) => VSCLinkedInExtractor.normalizeText(value);

  function clean(value) {
    return normalize(value)
      .replace(/\s*[|·•]\s*(?:LinkedIn|Hiring|Careers).*$/i, "")
      .trim();
  }

  function textLines(element) {
    if (!element) return [];
    const clone = element.cloneNode(true);
    clone.querySelectorAll?.(".vsc-company-marker,.vsc-detail-status").forEach((node) => node.remove());
    return VSCLinkedInExtractor.uniqueLines(clone.textContent || "")
      .map(clean)
      .filter(Boolean)
      .filter((line) => !/^(?:licensed|not found|licensed sponsor|sponsor not found)$/i.test(line));
  }

  function textOf(element) {
    return clean(textLines(element).join(" "));
  }

  function isVisible(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isLeftJobCard(element) {
    if (!isVisible(element) || element.closest(DETAIL_SELECTOR)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.left >= window.innerWidth * 0.52) return false;
    if (rect.width < 260 || rect.width > 760) return false;
    if (rect.height < 65 || rect.height > 420) return false;
    return textLines(element).length >= 2;
  }

  function normalizeCard(element) {
    const inner = element.matches(".job-card-container")
      ? element
      : element.querySelector(":scope > .job-card-container, .job-card-container");
    return inner && isLeftJobCard(inner) ? inner : element;
  }

  function collectCards() {
    const candidates = [...document.querySelectorAll(CARD_SELECTOR)]
      .map(normalizeCard)
      .filter(isLeftJobCard);

    const unique = [];
    const seen = new Set();
    for (const card of candidates) {
      const jobId = card.getAttribute("data-job-id")
        || card.getAttribute("data-occludable-job-id")
        || card.closest("[data-job-id],[data-occludable-job-id]")?.getAttribute("data-job-id")
        || card.closest("[data-job-id],[data-occludable-job-id]")?.getAttribute("data-occludable-job-id")
        || card.querySelector("a[href*='/jobs/view/'],a[href*='currentJobId=']")?.href
        || textLines(card).slice(0, 2).join("|");
      const key = String(jobId || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(card);
    }
    return unique;
  }

  async function loadIndex() {
    if (sponsorIndex) return sponsorIndex;
    if (!sponsorIndexPromise) {
      sponsorIndexPromise = (async () => {
        if (typeof DecompressionStream !== "function") throw new Error("Chrome cannot decompress the offline sponsor register.");
        const metadataResponse = await fetch(chrome.runtime.getURL("data/metadata.json"));
        if (!metadataResponse.ok) throw new Error(`Sponsor metadata failed (${metadataResponse.status}).`);
        const metadata = await metadataResponse.json();
        const count = Number(metadata.indexPartCount);
        if (!Number.isInteger(count) || count < 1) throw new Error("The offline sponsor register is incomplete.");

        const responses = await Promise.all(Array.from({ length: count }, (_, part) =>
          fetch(chrome.runtime.getURL(`data/uk-sponsors.index.json.gz.part${String(part).padStart(2, "0")}`))
        ));
        const failed = responses.find((response) => !response.ok);
        if (failed) throw new Error(`Sponsor register failed (${failed.status}).`);

        const buffers = await Promise.all(responses.map((response) => response.arrayBuffer()));
        const bytes = new Uint8Array(buffers.reduce((total, buffer) => total + buffer.byteLength, 0));
        let offset = 0;
        for (const buffer of buffers) {
          bytes.set(new Uint8Array(buffer), offset);
          offset += buffer.byteLength;
        }
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        return VSCMatcher.buildIndex(JSON.parse(await new Response(stream).text()));
      })();
    }
    sponsorIndex = await sponsorIndexPromise;
    return sponsorIndex;
  }

  function findTitle(card) {
    for (const selector of TITLE_SELECTORS) {
      for (const element of card.querySelectorAll(selector)) {
        const value = textOf(element);
        if (value.length >= 2 && value.length <= 220 && !VSCLinkedInExtractor.isNoiseLine(value)) return value;
      }
    }
    return textLines(card)[0] || "";
  }

  function validCompany(value, title) {
    return value.length >= 2
      && value.length <= 180
      && value.toLowerCase() !== title.toLowerCase()
      && !VSCLinkedInExtractor.isNoiseLine(value, title)
      && !VSCLinkedInExtractor.looksLikeLocation(value);
  }

  function smallestElement(card, target) {
    const key = clean(target).toLowerCase();
    return [...card.querySelectorAll("a,span,p,div")]
      .filter((element) => {
        if (element.closest(".vsc-company-marker,.vsc-detail-status")) return false;
        const lines = textLines(element);
        return lines.length === 1 && lines[0].toLowerCase() === key;
      })
      .sort((left, right) => left.childElementCount - right.childElementCount || left.textContent.length - right.textContent.length)[0] || null;
  }

  function findCompany(card, title) {
    for (const selector of COMPANY_SELECTORS) {
      for (const element of card.querySelectorAll(selector)) {
        const value = textOf(element);
        if (validCompany(value, title)) return { element, text: value };
      }
    }

    const lines = textLines(card);
    const titleIndex = lines.findIndex((line) => line.toLowerCase() === title.toLowerCase());
    const remaining = titleIndex >= 0 ? lines.slice(titleIndex + 1) : lines.slice(1);
    for (const value of remaining) {
      if (!validCompany(value, title)) continue;
      const element = smallestElement(card, value);
      if (element) return { element, text: value };
    }
    return null;
  }

  function matchCompany(name) {
    const key = VSCMatcher.canonicalize(name);
    if (!matchCache.has(key)) matchCache.set(key, VSCMatcher.matchCompany(sponsorIndex, name));
    return matchCache.get(key);
  }

  function tooltip(name, result) {
    if (!result.found) return `${name} was not found in the bundled UK sponsor register.`;
    const route = result.skilledWorker ? "Skilled Worker route listed." : "Skilled Worker route is not listed.";
    return `Matched to: ${result.officialName}\n${route}\nConfidence: ${Math.round(result.confidence * 100)}% (${result.method})`;
  }

  function restore(element) {
    element.classList.remove("vsc-company--licensed", "vsc-company--unlicensed");
    delete element.dataset.vscChecked;
    delete element.dataset.vscCompany;
    if (element.dataset.vscOriginalTitle !== undefined) {
      element.title = element.dataset.vscOriginalTitle;
      delete element.dataset.vscOriginalTitle;
    }
  }

  function clearCard(card) {
    card.classList.remove("vsc-job-card", "vsc-job-card--licensed", "vsc-job-card--unlicensed");
    card.querySelectorAll(".vsc-company-marker").forEach((node) => node.remove());
    card.querySelectorAll("[data-vsc-checked]").forEach(restore);
    delete card.dataset.vscSignature;
    delete card.dataset.vscJobId;
  }

  function clearEverywhere() {
    document.querySelectorAll(".vsc-company-marker,.vsc-detail-status").forEach((node) => node.remove());
    document.querySelectorAll("[data-vsc-checked]").forEach(restore);
    document.querySelectorAll(".vsc-job-card").forEach(clearCard);
  }

  function makeMarker(name, result) {
    const badge = document.createElement("span");
    badge.className = `vsc-company-marker ${result.found ? "vsc-company-marker--licensed" : "vsc-company-marker--unlicensed"}`;
    badge.textContent = result.found ? "Licensed" : "Not found";
    badge.title = tooltip(name, result);
    return badge;
  }

  function markCard(card, company, result, signature, jobId) {
    clearCard(card);
    card.dataset.vscSignature = signature;
    card.dataset.vscJobId = jobId;
    card.classList.add("vsc-job-card", result.found ? "vsc-job-card--licensed" : "vsc-job-card--unlicensed");

    company.element.classList.add(result.found ? "vsc-company--licensed" : "vsc-company--unlicensed");
    company.element.dataset.vscChecked = "true";
    company.element.dataset.vscCompany = company.text;
    company.element.dataset.vscOriginalTitle = company.element.getAttribute("title") || "";
    company.element.title = tooltip(company.text, result);
    company.element.insertAdjacentElement("afterend", makeMarker(company.text, result));
  }

  function updateStatus(cards) {
    const results = cards.map((card) => {
      const companyElement = card.querySelector("[data-vsc-checked][data-vsc-company]");
      if (!companyElement) return null;
      const companyName = companyElement.dataset.vscCompany;
      const result = matchCompany(companyName);
      return {
        jobId: card.dataset.vscJobId || null,
        companyName,
        found: result.found,
        officialName: result.officialName || null,
        confidence: result.confidence,
        skilledWorker: Boolean(result.skilledWorker)
      };
    }).filter(Boolean);

    pageStatus.companies = results;
    pageStatus.checked = results.length;
    pageStatus.licensed = results.filter((item) => item.found).length;
    pageStatus.unlicensed = results.length - pageStatus.licensed;
  }

  async function scan(force = false) {
    if (!settings.enabled || settings.country !== "GB") {
      clearEverywhere();
      Object.assign(pageStatus, { phase: "disabled", error: null, cardsDetected: 0, companiesExtracted: 0, checked: 0, licensed: 0, unlicensed: 0, companies: [] });
      return pageStatus;
    }

    try {
      pageStatus.phase = "loading";
      pageStatus.error = null;
      await loadIndex();
      if (force) clearEverywhere();

      document.querySelectorAll(".vsc-detail-status").forEach((node) => node.remove());
      document.querySelectorAll("[data-vsc-checked]").forEach((element) => {
        if (element.closest(DETAIL_SELECTOR)) restore(element);
      });
      document.querySelectorAll(".vsc-job-card").forEach((element) => {
        if (element.closest(DETAIL_SELECTOR) || !isLeftJobCard(element)) clearCard(element);
      });

      const cards = collectCards();
      pageStatus.cardsDetected = cards.length;
      let extracted = 0;

      for (const card of cards) {
        const title = findTitle(card);
        const company = findCompany(card, title);
        if (!company) continue;
        extracted += 1;

        const jobId = card.getAttribute("data-job-id")
          || card.getAttribute("data-occludable-job-id")
          || card.closest("[data-job-id],[data-occludable-job-id]")?.getAttribute("data-job-id")
          || card.closest("[data-job-id],[data-occludable-job-id]")?.getAttribute("data-occludable-job-id")
          || VSCLinkedInExtractor.extractJobId(card.querySelector("a[href*='/jobs/view/'],a[href*='currentJobId=']")?.href || "")
          || textLines(card).slice(0, 2).join("|");
        const signature = `${jobId}|${VSCMatcher.canonicalize(company.text)}`;
        if (card.dataset.vscSignature === signature && card.querySelector(".vsc-company-marker")) continue;
        markCard(card, company, matchCompany(company.text), signature, String(jobId));
      }

      pageStatus.companiesExtracted = extracted;
      updateStatus(cards);
      pageStatus.phase = "ready";
    } catch (error) {
      pageStatus.phase = "error";
      pageStatus.error = error instanceof Error ? error.message : String(error);
      console.error("[Visa Sponsorship Checker]", error);
    }
    return pageStatus;
  }

  function schedule(force = false) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scan(force), 90);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.country) settings.country = changes.country.newValue;
    schedule(true);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_PAGE_STATUS") {
      sendResponse({ supported: VSCUrl.isLinkedInJobsUrl(location.href), connected: true, enabled: settings.enabled, country: settings.country, version: VERSION, ...pageStatus });
      return false;
    }
    if (message?.type === "RECHECK_PAGE") {
      scan(true).then((result) => sendResponse({ ok: result.phase !== "error", supported: true, connected: true, enabled: settings.enabled, country: settings.country, version: VERSION, ...result }));
      return true;
    }
    return false;
  });

  globalThis.addEventListener("vsc:left-panel-rescan", () => schedule(true));
  window.addEventListener("scroll", () => schedule(false), true);
  window.addEventListener("resize", () => schedule(false));

  (async () => {
    settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
    clearEverywhere();
    observer = new MutationObserver(() => schedule(false));
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    await scan(false);
    setTimeout(() => schedule(false), 250);
    setTimeout(() => schedule(false), 900);
  })();
})();
