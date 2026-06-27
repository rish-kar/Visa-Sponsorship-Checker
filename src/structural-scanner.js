(() => {
  "use strict";

  const VERSION = "1.3.0";
  if (globalThis.__VSC_LEFT_PANEL_SCANNER__ === VERSION) {
    globalThis.dispatchEvent(new CustomEvent("vsc:left-panel-rescan"));
    return;
  }
  globalThis.__VSC_LEFT_PANEL_SCANNER__ = VERSION;

  const DEFAULTS = { enabled: true, country: "GB" };
  const JOB_LINKS = "a[href*='/jobs/view/'],a[href*='currentJobId=']";
  const LIST_HINTS = [
    ".scaffold-layout__list",
    ".jobs-search-results-list",
    ".jobs-search-results__list",
    "[class*='jobs-search-results-list']",
    "[class*='scaffold-layout__list']"
  ];
  const CARD_HINTS = [
    ".job-card-container",
    ".jobs-search-results__list-item",
    "li.scaffold-layout__list-item",
    "[data-job-id]",
    "[data-occludable-job-id]",
    "[data-view-name*='job-card']",
    "[role='listitem']"
  ];
  const COMPANY_HINTS = [
    ".artdeco-entity-lockup__subtitle",
    ".job-card-container__primary-description",
    ".base-search-card__subtitle",
    "[class*='primary-description']",
    "[class*='subtitle']",
    "a[href*='/company/']"
  ];

  let settings = { ...DEFAULTS };
  let sponsorIndex;
  let sponsorIndexPromise;
  let listRoot;
  let listObserver;
  let pageObserver;
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
    return normalize(value).replace(/\s*[|·•]\s*(?:LinkedIn|Hiring|Careers).*$/i, "").trim();
  }

  function visibleLines(element) {
    if (!element) return [];
    const clone = element.cloneNode(true);
    clone.querySelectorAll?.(".vsc-company-marker,.vsc-detail-status").forEach((node) => node.remove());
    return VSCLinkedInExtractor.uniqueLines(clone.innerText || clone.textContent || "")
      .map(clean)
      .filter(Boolean)
      .filter((line) => !/^(?:licensed|not found|licensed sponsor|sponsor not found)$/i.test(line));
  }

  function uniqueJobLinks(root) {
    const seen = new Set();
    return [...(root?.querySelectorAll(JOB_LINKS) || [])].filter((link) => {
      const id = VSCLinkedInExtractor.extractJobId(link.href || link.getAttribute("href") || "");
      const key = id || link.href || visibleLines(link)[0];
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function isVisible(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
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

  function rootScore(element) {
    if (!isVisible(element)) return -1;
    const links = uniqueJobLinks(element);
    if (links.length < 2) return -1;
    const rect = element.getBoundingClientRect();
    if (rect.width < 250 || rect.width > Math.min(760, window.innerWidth * 0.58) || rect.height < 180) return -1;

    const style = getComputedStyle(element);
    const className = String(element.className || "");
    let score = links.length * 100;
    if (/jobs-search-results|scaffold-layout__list/i.test(className)) score += 500;
    if (/(auto|scroll)/.test(style.overflowY)) score += 250;
    if (rect.left < window.innerWidth * 0.48) score += 200;
    score -= Math.round(rect.width / 10);
    return score;
  }

  function findListRoot() {
    const candidates = new Set();
    LIST_HINTS.forEach((selector) => document.querySelectorAll(selector).forEach((element) => candidates.add(element)));

    document.querySelectorAll(JOB_LINKS).forEach((link) => {
      let current = link.parentElement;
      for (let depth = 0; current && depth < 12; depth += 1, current = current.parentElement) {
        if (uniqueJobLinks(current).length >= 2) candidates.add(current);
      }
    });

    let best;
    let highest = -1;
    candidates.forEach((candidate) => {
      const score = rootScore(candidate);
      if (score > highest) {
        best = candidate;
        highest = score;
      }
    });
    return best || null;
  }

  function cardForLink(link, root) {
    const direct = link.closest(CARD_HINTS.join(","));
    if (direct && root.contains(direct) && uniqueJobLinks(direct).length === 1) {
      return direct.querySelector(".job-card-container") || direct;
    }

    let current = link;
    let best;
    for (let depth = 0; current && current !== root && depth < 12; depth += 1, current = current.parentElement) {
      const count = uniqueJobLinks(current).length;
      const lineCount = visibleLines(current).length;
      if (count === 1 && lineCount >= 2 && lineCount <= 24) best = current;
      if (current.parentElement && uniqueJobLinks(current.parentElement).length > 1) break;
    }
    return best || null;
  }

  function collectCards(root) {
    const cards = new Set();
    uniqueJobLinks(root).forEach((link) => {
      const card = cardForLink(link, root);
      if (card && root.contains(card)) cards.add(card);
    });
    return [...cards].filter(isVisible);
  }

  function findTitle(card) {
    const link = uniqueJobLinks(card)[0];
    const linkTitle = visibleLines(link).find((line) => line.length >= 2 && line.length <= 220 && !VSCLinkedInExtractor.isNoiseLine(line));
    if (linkTitle) return linkTitle;

    for (const selector of ["h1", "h2", "h3", "[class*='job-title']", "[class*='title']"]) {
      for (const element of card.querySelectorAll(selector)) {
        const line = visibleLines(element)[0];
        if (line && line.length <= 220 && !VSCLinkedInExtractor.isNoiseLine(line)) return line;
      }
    }
    return "";
  }

  function validCompany(value, title) {
    return value.length >= 2
      && value.length <= 180
      && value.toLowerCase() !== title.toLowerCase()
      && !VSCLinkedInExtractor.isNoiseLine(value, title)
      && !VSCLinkedInExtractor.looksLikeLocation(value);
  }

  function smallestElement(root, target) {
    const key = clean(target).toLowerCase();
    return [...root.querySelectorAll("a,span,p,div")]
      .filter((element) => {
        if (element.closest(".vsc-company-marker,.vsc-detail-status")) return false;
        const elementLines = visibleLines(element);
        return elementLines.length === 1 && elementLines[0].toLowerCase() === key;
      })
      .sort((left, right) => left.childElementCount - right.childElementCount || left.textContent.length - right.textContent.length)[0] || null;
  }

  function findCompany(card, title) {
    for (const selector of COMPANY_HINTS) {
      for (const element of card.querySelectorAll(selector)) {
        const value = clean(visibleLines(element).join(" "));
        if (validCompany(value, title)) return { element, text: value };
      }
    }

    const cardLines = visibleLines(card);
    const titleIndex = cardLines.findIndex((line) => line.toLowerCase() === title.toLowerCase());
    const possible = titleIndex >= 0 ? cardLines.slice(titleIndex + 1) : cardLines;
    for (const value of possible) {
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
  }

  function clearEverywhere() {
    document.querySelectorAll(".vsc-company-marker,.vsc-detail-status").forEach((node) => node.remove());
    document.querySelectorAll("[data-vsc-checked]").forEach(restore);
    document.querySelectorAll(".vsc-job-card").forEach(clearCard);
  }

  function marker(name, result) {
    const badge = document.createElement("span");
    badge.className = `vsc-company-marker ${result.found ? "vsc-company-marker--licensed" : "vsc-company-marker--unlicensed"}`;
    badge.textContent = result.found ? "Licensed" : "Not found";
    badge.title = tooltip(name, result);
    return badge;
  }

  function mark(card, company, result, signature, jobId) {
    clearCard(card);
    card.dataset.vscSignature = signature;
    card.dataset.vscJobId = jobId;
    card.classList.add("vsc-job-card", result.found ? "vsc-job-card--licensed" : "vsc-job-card--unlicensed");

    company.element.classList.add(result.found ? "vsc-company--licensed" : "vsc-company--unlicensed");
    company.element.dataset.vscChecked = "true";
    company.element.dataset.vscCompany = company.text;
    company.element.dataset.vscOriginalTitle = company.element.getAttribute("title") || "";
    company.element.title = tooltip(company.text, result);
    company.element.insertAdjacentElement("afterend", marker(company.text, result));
  }

  function updateStatus(cards) {
    const results = cards.map((card) => {
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

    pageStatus.companies = results;
    pageStatus.checked = results.length;
    pageStatus.licensed = results.filter((item) => item.found).length;
    pageStatus.unlicensed = results.length - pageStatus.licensed;
  }

  function observeList(root) {
    if (listRoot === root) return;
    listObserver?.disconnect();
    listRoot = root;
    listObserver = new MutationObserver(() => schedule(false));
    listObserver.observe(root, { childList: true, subtree: true, characterData: true });
    root.addEventListener("scroll", () => schedule(false), { passive: true });
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

      const root = findListRoot();
      if (!root) {
        listRoot = null;
        Object.assign(pageStatus, { phase: "ready", cardsDetected: 0, companiesExtracted: 0, checked: 0, licensed: 0, unlicensed: 0, companies: [] });
        return pageStatus;
      }
      observeList(root);

      document.querySelectorAll(".vsc-detail-status").forEach((node) => node.remove());
      document.querySelectorAll("[data-vsc-checked]").forEach((element) => {
        if (!root.contains(element)) restore(element);
      });
      document.querySelectorAll(".vsc-job-card").forEach((element) => {
        if (!root.contains(element)) clearCard(element);
      });

      const cards = collectCards(root);
      pageStatus.cardsDetected = cards.length;
      let extracted = 0;

      for (const card of cards) {
        const jobTitle = findTitle(card);
        const company = findCompany(card, jobTitle);
        if (!company) continue;
        extracted += 1;

        const link = uniqueJobLinks(card)[0];
        const jobId = card.getAttribute("data-job-id")
          || card.getAttribute("data-occludable-job-id")
          || VSCLinkedInExtractor.extractJobId(link?.href || "");
        const signature = `${jobId}|${VSCMatcher.canonicalize(company.text)}`;
        if (card.dataset.vscSignature === signature && card.querySelector(".vsc-company-marker")) continue;
        mark(card, company, matchCompany(company.text), signature, jobId);
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
    scanTimer = setTimeout(() => scan(force), 120);
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
  globalThis.addEventListener("vsc:rescan", () => schedule(true));

  (async () => {
    settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
    clearEverywhere();
    pageObserver = new MutationObserver(() => {
      if (!listRoot?.isConnected) schedule(false);
    });
    pageObserver.observe(document.documentElement, { childList: true, subtree: true });
    await scan(false);
    setTimeout(() => schedule(false), 250);
    setTimeout(() => schedule(false), 800);
  })();
})();
