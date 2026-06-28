(() => {
  "use strict";

  const VERSION = "1.5.8";
  const previousRuntime = globalThis.__VSC_JOB_LIST_SCANNER_STATE__;
  if (previousRuntime?.version === VERSION) {
    globalThis.dispatchEvent(new CustomEvent("vsc:job-list-rescan"));
    return;
  }
  if (previousRuntime?.cleanup) previousRuntime.cleanup();

  const runtimeState = {
    version: VERSION,
    cleanups: [],
    cleanup() {
      clearTimeout(scanTimer);
      if (observer) observer.disconnect();
      matchCache.clear();
      this.cleanups.splice(0).forEach((cleanup) => cleanup());
    }
  };
  globalThis.__VSC_JOB_LIST_SCANNER_STATE__ = runtimeState;

  const DEFAULTS = { enabled: true, country: "GB" };
  const COUNTRY_CONFIGS = {
    GB: {
      metadataPath: "data/metadata.json",
      partPrefix: "data/uk-sponsors.index.json.gz.part",
      licensedLabel: "Licensed",
      notFoundLabel: "Not found",
      tooltipFound: "Skilled Worker route listed.",
      tooltipMissing: "Skilled Worker route is not listed.",
      missingRegisterText: "bundled UK sponsor register"
    },
    NL: {
      metadataPath: "data/nl-metadata.json",
      partPrefix: "data/nl-sponsors.index.json.gz.part",
      licensedLabel: "Recognised sponsor",
      notFoundLabel: "Not found",
      tooltipFound: "Recognised sponsor for work listed.",
      tooltipMissing: "Recognised sponsor for work is not listed.",
      missingRegisterText: "bundled Netherlands recognised-sponsor work register"
    }
  };
  const JOB_ID_SELECTOR = [
    "[data-occludable-job-id]",
    "[data-job-id]",
    "[data-entity-urn*='jobPosting' i]",
    "[data-occludable-entity-urn*='jobPosting' i]",
    "[data-chameleon-result-urn*='jobPosting' i]",
    "[componentkey*='job-card-component-ref-' i]",
    "a[href*='/jobs/view/']",
    "a[href*='currentJobId=']"
  ].join(",");
  const JOB_SEED_SELECTOR = [
    JOB_ID_SELECTOR,
    "[data-view-name='job-card-title']"
  ].join(",");
  const JOB_TITLE_SIGNAL_SELECTOR = [
    "[data-view-name='job-card-title']",
    "a.job-card-list__title--link",
    ".job-card-list__title",
    "a[href*='/jobs/view/']",
    "a[href*='currentJobId=']"
  ].join(",");
  const ROW_CANDIDATE_SELECTOR = [
    ".jobs-search-results__list-item",
    ".scaffold-layout__list-item",
    ".job-card-container",
    ".job-card-list",
    ".base-search-card",
    ".job-search-card",
    "[data-view-name='job-card']",
    "[data-view-name='job-card-list']",
    "[data-view-name='jobs-search-results-list-item']",
    "li[data-occludable-job-id]",
    "li[data-job-id]",
    "li[data-entity-urn*='jobPosting' i]",
    "li[data-occludable-entity-urn*='jobPosting' i]",
    "li[data-chameleon-result-urn*='jobPosting' i]",
    "[componentkey*='job-card-component-ref-' i]"
  ].join(",");
  const DETAIL_SELECTOR = [
    ".scaffold-layout__detail",
    ".jobs-search__job-details--container",
    "[class*='jobs-search__job-details']",
    "[class*='job-details']",
    "[class*='jobs-unified-top-card']"
  ].join(",");
  const LIST_CONTAINER_SELECTOR = [
    ".jobs-search-results-list",
    ".jobs-search-results__list",
    ".jobs-search__results-list",
    ".scaffold-layout__list",
    ".two-pane-serp-page__results-list",
    "[class*='jobs-search-results-list']",
    "[class*='jobs-search-results__list']"
  ].join(",");
  const JOB_CARD_SELECTOR = [
    ".job-card-container",
    ".job-card-list",
    ".base-search-card",
    ".job-search-card",
    ".base-card",
    "[data-view-name='job-card']",
    "[data-view-name='job-card-list']",
    "[data-view-name='jobs-search-results-list-item']",
    "[data-occludable-job-id]",
    "[data-job-id]",
    "[data-entity-urn*='jobPosting' i]",
    "[data-occludable-entity-urn*='jobPosting' i]",
    "[data-chameleon-result-urn*='jobPosting' i]",
    "[componentkey*='job-card-component-ref-' i]"
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
    ".job-card-container__company-name",
    ".base-search-card__subtitle",
    ".job-card-list__company-name",
    ".job-card-list__subtitle",
    "[class*='primary-description']",
    "[class*='company-name']",
    "a[href*='/company/']"
  ];
  const NON_JOB_PANEL_PATTERNS = [
    /\bare these results helpful\b/i,
    /\byour feedback helps\b/i,
    /\bsee jobs where you.?re a top applicant\b/i,
    /\breactivate premium\b/i
  ];
  const THEME_TARGETS = [
    () => document.body,
    () => document.documentElement,
    () => document.querySelector("main"),
    () => document.querySelector("[role='main']"),
    () => document.querySelector(".application-outlet")
  ];

  let settings = { ...DEFAULTS };
  const sponsorIndexes = new Map();
  const sponsorIndexPromises = new Map();
  let locationIndexPromise;
  let observer;
  let scanTimer;
  const matchCache = new Map();
  const status = {
    phase: "loading",
    error: null,
    cardsDetected: 0,
    companiesExtracted: 0,
    checked: 0,
    licensed: 0,
    unlicensed: 0,
    companies: []
  };

  function clean(value) {
    return VSCLinkedInExtractor.normalizeText(value)
      .replace(/\s*[|·•]\s*(?:LinkedIn|Hiring|Careers).*$/i, "")
      .trim();
  }

  function lines(element) {
    if (!element) return [];
    return VSCLinkedInExtractor.uniqueLines(element.innerText || element.textContent || "")
      .map(clean)
      .filter(Boolean)
      .filter((line) => !/^(?:licensed|not found|licensed sponsor|sponsor not found)$/i.test(line));
  }

  function text(element) {
    return clean(lines(element).join(" "));
  }

  function luminanceFromColor(value) {
    const match = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([.\d]+))?\)/i);
    if (!match || Number(match[4] ?? 1) === 0) return null;
    const [red, green, blue] = match.slice(1, 4).map(Number);
    return ((red * 0.2126) + (green * 0.7152) + (blue * 0.0722)) / 255;
  }

  function detectLinkedInTheme() {
    const themeText = [
      document.documentElement?.dataset?.theme,
      document.documentElement?.getAttribute?.("data-theme"),
      document.documentElement?.getAttribute?.("class"),
      document.body?.getAttribute?.("class")
    ].filter(Boolean).join(" ").toLowerCase();
    if (/\bdark\b/.test(themeText)) return "dark";
    if (/\blight\b/.test(themeText)) return "light";

    if (typeof getComputedStyle !== "function") return "dark";
    for (const getTarget of THEME_TARGETS) {
      const target = getTarget();
      if (!target) continue;
      const styles = getComputedStyle(target);
      const background = luminanceFromColor(styles.backgroundColor);
      if (background !== null) return background > 0.55 ? "light" : "dark";
      const color = luminanceFromColor(styles.color);
      if (color !== null) return color < 0.5 ? "light" : "dark";
    }
    return "dark";
  }

  function applyLinkedInTheme() {
    const theme = detectLinkedInTheme();
    document.documentElement.classList.remove("vsc-linkedin-theme--light", "vsc-linkedin-theme--dark");
    document.documentElement.classList.add(theme === "light" ? "vsc-linkedin-theme--light" : "vsc-linkedin-theme--dark");
  }

  function cleanJobTitle(value) {
    let title = clean(value)
      .replace(/^selected,\s*/i, "")
      .replace(/\s*\(verified job\)\s*/gi, " ")
      .replace(/\bverified job\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const words = title.split(" ").filter(Boolean);
    if (words.length % 2 === 0) {
      const midpoint = words.length / 2;
      const first = words.slice(0, midpoint).join(" ");
      const second = words.slice(midpoint).join(" ");
      if (first && first.toLowerCase() === second.toLowerCase()) title = first;
    }
    return title;
  }

  function visible(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function inDetailPanel(element) {
    return Boolean(element?.closest(DETAIL_SELECTOR));
  }

  function inListContainer(element) {
    return Boolean(element?.closest(LIST_CONTAINER_SELECTOR));
  }

  function nonJobPanel(element) {
    const value = lines(element).join(" ");
    return NON_JOB_PANEL_PATTERNS.some((pattern) => pattern.test(value));
  }

  function addJobId(ids, value) {
    const textValue = String(value || "");
    if (/^\d{5,}$/.test(textValue)) {
      ids.add(textValue);
      return;
    }
    const urnMatch = textValue.match(/jobPosting[:/-](\d{5,})/i);
    if (urnMatch) {
      ids.add(urnMatch[1]);
      return;
    }
    const componentKeyMatch = textValue.match(/job-card-component-ref-(\d{5,})/i);
    if (componentKeyMatch) {
      ids.add(componentKeyMatch[1]);
      return;
    }
    const extracted = VSCLinkedInExtractor.extractJobId(textValue);
    if (extracted) ids.add(extracted);
  }

  function collectJobIds(element) {
    const ids = new Set();
    if (!element) return ids;

    [element, ...element.querySelectorAll(JOB_ID_SELECTOR)]
      .forEach((node) => {
        addJobId(ids, node.getAttribute?.("data-job-id"));
        addJobId(ids, node.getAttribute?.("data-occludable-job-id"));
        addJobId(ids, node.getAttribute?.("data-entity-urn"));
        addJobId(ids, node.getAttribute?.("data-occludable-entity-urn"));
        addJobId(ids, node.getAttribute?.("data-chameleon-result-urn"));
        addJobId(ids, node.getAttribute?.("componentkey"));
        if (node.matches?.("a")) addJobId(ids, node.href || node.getAttribute("href"));
      });
    return ids;
  }

  function seedJobId(element) {
    const ids = collectJobIds(element);
    return ids.size === 1 ? [...ids][0] : "";
  }

  function locationInfo(element, jobTitle = "", companyName = "") {
    const titleKey = cleanJobTitle(jobTitle).toLowerCase();
    const companyKey = clean(companyName).toLowerCase();
    for (const line of lines(element)) {
      if (titleKey && cleanJobTitle(line).toLowerCase() === titleKey) continue;
      if (companyKey && textPieces(line).some((piece) => piece.toLowerCase() === companyKey)) continue;
      const country = VSCLinkedInExtractor.classifyLocationCountry(line);
      if (country) return { line, country };
    }
    return { line: "", country: "" };
  }

  function firstLocationLine(element, jobTitle = "", companyName = "") {
    return locationInfo(element, jobTitle, companyName).line;
  }

  function hasJobTitleSignal(element) {
    return Boolean(element?.matches(JOB_TITLE_SIGNAL_SELECTOR) || element?.querySelector(JOB_TITLE_SIGNAL_SELECTOR));
  }

  function textIdentity(card) {
    const jobTitle = title(card);
    const foundCompany = company(card, jobTitle);
    if (!jobTitle || !foundCompany) return "";
    return [
      VSCMatcher.canonicalize(jobTitle),
      VSCMatcher.canonicalize(foundCompany.text),
      VSCLinkedInExtractor.normalizeText(firstLocationLine(card, jobTitle, foundCompany.text)).toLowerCase()
    ].filter(Boolean).join("|");
  }

  function cardLike(element, expectedId = "") {
    if (!element?.isConnected) return false;
    if (nonJobPanel(element)) return false;
    const ids = collectJobIds(element);
    if (expectedId && !ids.has(expectedId)) return false;
    if (ids.size > 1) return false;
    if (inDetailPanel(element) && !element.closest(LIST_CONTAINER_SELECTOR)) return false;
    if (!visible(element)) return false;
    const rect = element.getBoundingClientRect();
    if (!(rect.width >= 80
      && rect.width <= Math.max(900, window.innerWidth)
      && rect.height >= 25
      && rect.height <= 700
      && lines(element).length >= 2)) return false;

    const jobTitle = title(element);
    const foundCompany = company(element, jobTitle);
    if (!jobTitle || !foundCompany) return false;

    const hasLocation = Boolean(firstLocationLine(element, jobTitle, foundCompany.text));
    const hasTitleSignal = hasJobTitleSignal(element);
    const hasCardSignal = element.matches(JOB_CARD_SELECTOR);
    return ids.size === 1 || (hasLocation && (hasTitleSignal || hasCardSignal)) || (inListContainer(element) && hasTitleSignal);
  }

  function normalizedCard(element, expectedId) {
    let current = element;
    let best = null;
    let bestHasId = false;
    while (current && current !== document.body && current !== document.documentElement) {
      if (current.matches(LIST_CONTAINER_SELECTOR)) break;
      if (cardLike(current, expectedId) && (current.matches(JOB_CARD_SELECTOR) || current.matches("li,article,div"))) {
        const hasId = Boolean(seedJobId(current));
        if (hasId && !bestHasId) {
          best = current;
          bestHasId = true;
        } else if (hasId === bestHasId) {
          best = current;
        }
      }
      current = current.parentElement;
    }
    return best;
  }

  function jobIdentity(card) {
    return seedJobId(card) || textIdentity(card);
  }

  function cards() {
    const found = new Map();
    const addCandidate = (candidate) => {
      if (inDetailPanel(candidate) && !candidate.closest(LIST_CONTAINER_SELECTOR)) return;
      const identity = seedJobId(candidate);
      const card = normalizedCard(candidate, identity);
      if (!card) return;
      const cardIdentity = jobIdentity(card);
      if (!cardIdentity) return;
      const existing = found.get(cardIdentity);
      if (!existing || card.getBoundingClientRect().width < existing.getBoundingClientRect().width) {
        found.set(cardIdentity, card);
      }
    };

    document.querySelectorAll(JOB_SEED_SELECTOR).forEach(addCandidate);
    document.querySelectorAll(ROW_CANDIDATE_SELECTOR).forEach(addCandidate);
    document.querySelectorAll(LIST_CONTAINER_SELECTOR).forEach((container) => {
      container.querySelectorAll("li,article").forEach(addCandidate);
      container.querySelectorAll(ROW_CANDIDATE_SELECTOR).forEach(addCandidate);
    });
    return [...found.values()];
  }

  function countryConfig(country = settings.country) {
    return COUNTRY_CONFIGS[country] || COUNTRY_CONFIGS.GB;
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

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function buildIndexFromCompressedBytes(bytes) {
    if (typeof DecompressionStream !== "function") throw new Error("Chrome cannot decompress the offline sponsor register.");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return VSCMatcher.buildIndex(JSON.parse(await new Response(stream).text()));
  }

  async function loadCachedIndex(country) {
    const response = await sendBackgroundMessage({ type: "GET_SPONSOR_INDEX", country });
    if (!response?.ok || !Array.isArray(response.parts) || !response.parts.length) return null;
    const chunks = response.parts.map(base64ToBytes);
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((chunk) => {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    });
    return buildIndexFromCompressedBytes(bytes);
  }

  async function loadBundledIndex(country) {
    const config = countryConfig(country);
    const metadataResponse = await fetch(chrome.runtime.getURL(config.metadataPath));
    if (!metadataResponse.ok) throw new Error(`Sponsor metadata failed (${metadataResponse.status}).`);
    const metadata = await metadataResponse.json();
    const count = Number(metadata.indexPartCount);
    if (!Number.isInteger(count) || count < 1) throw new Error("The offline sponsor register is incomplete.");

    const responses = await Promise.all(Array.from({ length: count }, (_item, part) =>
      fetch(chrome.runtime.getURL(`${config.partPrefix}${String(part).padStart(2, "0")}`))
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
    return buildIndexFromCompressedBytes(bytes);
  }

  async function loadIndex(country = settings.country) {
    if (sponsorIndexes.has(country)) return sponsorIndexes.get(country);
    if (!sponsorIndexPromises.has(country)) {
      sponsorIndexPromises.set(country, (async () => {
        let cachedIndex = null;
        try {
          cachedIndex = await loadCachedIndex(country);
        } catch (error) {
          console.warn("[Visa Sponsorship Checker] Cached sponsor register is unusable; falling back to bundled data.", error);
        }
        return cachedIndex || loadBundledIndex(country);
      })());
    }
    try {
      const sponsorIndex = await sponsorIndexPromises.get(country);
      sponsorIndexes.set(country, sponsorIndex);
      return sponsorIndex;
    } catch (error) {
      sponsorIndexPromises.delete(country);
      throw error;
    }
  }

  async function loadLocationIndex() {
    if (!locationIndexPromise) {
      locationIndexPromise = (async () => {
        const response = await fetch(chrome.runtime.getURL("data/location-index.json"));
        if (!response.ok) throw new Error(`Location index failed (${response.status}).`);
        const payload = await response.json();
        Object.entries(payload.countries || {}).forEach(([country, terms]) => {
          VSCLinkedInExtractor.addLocationTerms(country, terms);
        });
      })().catch((error) => {
        console.warn("[Visa Sponsorship Checker] Location index unavailable; using built-in location fallback.", error);
      });
    }
    return locationIndexPromise;
  }

  function title(card) {
    for (const selector of TITLE_SELECTORS) {
      for (const element of card.querySelectorAll(selector)) {
        const value = cleanJobTitle(text(element));
        if (value.length >= 2 && value.length <= 220 && !VSCLinkedInExtractor.isNoiseLine(value)) return value;
      }
    }
    return cleanJobTitle(lines(card)[0]) || lines(card)[0] || "";
  }

  function validCompany(value, jobTitle) {
    return value.length >= 2
      && value.length <= 180
      && cleanJobTitle(value).toLowerCase() !== cleanJobTitle(jobTitle).toLowerCase()
      && !VSCLinkedInExtractor.isNoiseLine(value, jobTitle)
      && !VSCLinkedInExtractor.looksLikeLocation(value);
  }

  function textPieces(value) {
    const seen = new Set();
    return [value, ...String(value || "").split(/\s+[|·•]\s+/)]
      .map(clean)
      .filter(Boolean)
      .filter((item) => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function companyCandidates(element) {
    const seen = new Set();
    const candidates = [];
    lines(element).forEach((line) => {
      textPieces(line).forEach((piece) => {
        const key = piece.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push(piece);
        }
      });
    });
    return candidates;
  }

  function exactTextElement(card, target) {
    const key = clean(target).toLowerCase();
    return [...card.querySelectorAll("a,span,p,div")]
      .filter((element) => {
        if (element.closest(".vsc-company-marker")) return false;
        const valueLines = lines(element);
        return valueLines.length === 1 && textPieces(valueLines[0]).some((piece) => piece.toLowerCase() === key);
      })
      .sort((left, right) => left.childElementCount - right.childElementCount || left.textContent.length - right.textContent.length)[0] || null;
  }

  function company(card, jobTitle) {
    for (const selector of COMPANY_SELECTORS) {
      for (const element of card.querySelectorAll(selector)) {
        const value = companyCandidates(element).find((candidate) => validCompany(candidate, jobTitle));
        if (value) return { element, text: value };
      }
    }

    const cardLines = lines(card);
    const titleKey = cleanJobTitle(jobTitle).toLowerCase();
    const titleIndex = cardLines.findIndex((line) => cleanJobTitle(line).toLowerCase() === titleKey);
    const candidates = titleIndex >= 0 ? cardLines.slice(titleIndex + 1) : cardLines.slice(1);
    for (const value of candidates) {
      const candidate = textPieces(value).find((piece) => validCompany(piece, jobTitle));
      if (!candidate) continue;
      const element = exactTextElement(card, candidate);
      if (element) return { element, text: candidate };
    }
    return null;
  }

  function matchCompany(name) {
    const sponsorIndex = sponsorIndexes.get(settings.country);
    if (!sponsorIndex) return { found: false, method: "loading", confidence: 0 };
    const key = `${settings.country}|${VSCMatcher.canonicalize(name)}`;
    if (!matchCache.has(key)) matchCache.set(key, VSCMatcher.matchCompany(sponsorIndex, name));
    return matchCache.get(key);
  }

  function tooltip(name, result) {
    const config = countryConfig();
    if (!result.found) return `${name} was not found in the ${config.missingRegisterText}.`;
    const route = result.skilledWorker ? config.tooltipFound : config.tooltipMissing;
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

  function clearAll() {
    document.querySelectorAll(".vsc-company-marker").forEach((node) => node.remove());
    document.querySelectorAll("[data-vsc-checked]").forEach(restore);
    document.querySelectorAll(".vsc-job-card").forEach(clearCard);
  }

  function badge(name, result) {
    const config = countryConfig();
    const marker = document.createElement("span");
    marker.className = `vsc-company-marker ${result.found ? "vsc-company-marker--licensed" : "vsc-company-marker--unlicensed"}`;
    marker.textContent = result.found ? config.licensedLabel : config.notFoundLabel;
    marker.title = tooltip(name, result);
    return marker;
  }

  function mark(card, foundCompany, result, signature, id) {
    clearCard(card);
    card.dataset.vscSignature = signature;
    card.dataset.vscJobId = id;
    card.classList.add("vsc-job-card", result.found ? "vsc-job-card--licensed" : "vsc-job-card--unlicensed");

    foundCompany.element.classList.add(result.found ? "vsc-company--licensed" : "vsc-company--unlicensed");
    foundCompany.element.dataset.vscChecked = "true";
    foundCompany.element.dataset.vscCompany = foundCompany.text;
    foundCompany.element.dataset.vscOriginalTitle = foundCompany.element.getAttribute("title") || "";
    foundCompany.element.title = tooltip(foundCompany.text, result);
    foundCompany.element.insertAdjacentElement("afterend", badge(foundCompany.text, result));
  }

  function updateStatus(cardList) {
    const results = cardList.map((card) => {
      const element = card.querySelector("[data-vsc-checked][data-vsc-company]");
      if (!element) return null;
      const companyName = element.dataset.vscCompany;
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

    status.companies = results;
    status.checked = results.length;
    status.licensed = results.filter((item) => item.found).length;
    status.unlicensed = results.length - status.licensed;
  }

  async function scan(force = false) {
    if (globalThis.__VSC_JOB_LIST_SCANNER_STATE__ !== runtimeState) return status;
    applyLinkedInTheme();
    if (!settings.enabled || !COUNTRY_CONFIGS[settings.country]) {
      clearAll();
      Object.assign(status, { phase: "disabled", error: null, cardsDetected: 0, companiesExtracted: 0, checked: 0, licensed: 0, unlicensed: 0, companies: [] });
      return status;
    }

    try {
      status.phase = "loading";
      status.error = null;
      await Promise.all([loadIndex(settings.country), loadLocationIndex()]);
      if (force) clearAll();

      document.querySelectorAll("[data-vsc-checked]").forEach((element) => {
        if (element.closest(DETAIL_SELECTOR)) restore(element);
      });
      document.querySelectorAll(".vsc-job-card").forEach((element) => {
        if (!cardLike(element)) clearCard(element);
      });

      const cardList = cards();
      const eligibleCards = [];
      let extracted = 0;

      for (const card of cardList) {
        const jobTitle = title(card);
        const foundCompany = company(card, jobTitle);
        const foundLocation = locationInfo(card, jobTitle, foundCompany?.text || "");
        if (foundLocation.country !== settings.country) {
          clearCard(card);
          continue;
        }
        eligibleCards.push(card);
        if (!foundCompany) {
          clearCard(card);
          continue;
        }
        extracted += 1;

        const id = String(jobIdentity(card));
        const signature = `${id}|${VSCMatcher.canonicalize(foundCompany.text)}`;
        if (card.dataset.vscSignature === signature && card.querySelector(".vsc-company-marker")) continue;
        mark(card, foundCompany, matchCompany(foundCompany.text), signature, id);
      }

      status.cardsDetected = eligibleCards.length;
      status.companiesExtracted = extracted;
      updateStatus(eligibleCards);
      status.phase = "ready";
    } catch (error) {
      status.phase = "error";
      status.error = error instanceof Error ? error.message : String(error);
      console.error("[Visa Sponsorship Checker]", error);
    }
    return status;
  }

  function schedule(force = false) {
    if (globalThis.__VSC_JOB_LIST_SCANNER_STATE__ !== runtimeState) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scan(force), 90);
  }

  function trackListener(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    runtimeState.cleanups.push(() => target.removeEventListener(type, listener, options));
  }

  function handleStorageChanged(changes, area) {
    if (area !== "local") return;
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.country) settings.country = COUNTRY_CONFIGS[changes.country.newValue] ? changes.country.newValue : DEFAULTS.country;
    schedule(true);
  }

  chrome.storage.onChanged.addListener(handleStorageChanged);
  runtimeState.cleanups.push(() => chrome.storage.onChanged.removeListener(handleStorageChanged));

  function handleRuntimeMessage(message, _sender, sendResponse) {
    if (message?.type === "GET_PAGE_STATUS") {
      sendResponse({ supported: VSCUrl.isLinkedInJobsUrl(location.href), connected: true, enabled: settings.enabled, country: settings.country, version: VERSION, ...status });
      return false;
    }
    if (message?.type === "RECHECK_PAGE") {
      if (COUNTRY_CONFIGS[message.country]) settings.country = message.country;
      scan(true).then((result) => sendResponse({ ok: result.phase !== "error", supported: true, connected: true, enabled: settings.enabled, country: settings.country, version: VERSION, ...result }));
      return true;
    }
    return false;
  }

  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  runtimeState.cleanups.push(() => chrome.runtime.onMessage.removeListener(handleRuntimeMessage));

  trackListener(globalThis, "vsc:job-list-rescan", () => schedule(true));
  trackListener(window, "scroll", () => schedule(false), true);
  trackListener(window, "resize", () => schedule(false));
  trackListener(window, "load", () => schedule(false));
  trackListener(document, "visibilitychange", () => {
    if (!document.hidden) schedule(false);
  });

  (async () => {
    settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
    if (!COUNTRY_CONFIGS[settings.country]) settings.country = DEFAULTS.country;
    clearAll();
    observer = new MutationObserver(() => schedule(false));
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    runtimeState.cleanups.push(() => observer?.disconnect());
    await scan(false);
    setTimeout(() => schedule(false), 250);
    setTimeout(() => schedule(false), 900);
    setTimeout(() => schedule(false), 1800);
    setTimeout(() => schedule(false), 3200);
  })();
})();
