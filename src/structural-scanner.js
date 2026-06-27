(() => {
  "use strict";

  const VERSION = "1.0.0";
  if (globalThis.__VSC_STRUCTURAL_SCANNER__ === VERSION) {
    globalThis.dispatchEvent(new CustomEvent("vsc:structural-rescan"));
    return;
  }
  globalThis.__VSC_STRUCTURAL_SCANNER__ = VERSION;

  const JOB_LINKS = "a[href*='/jobs/view/'],a[href*='currentJobId=']";
  const CARD_ROOTS = ".job-card-container,.jobs-search-results__list-item,li.scaffold-layout__list-item,[data-job-id],[data-occludable-job-id],[data-view-name*='job-card'],[role='listitem']";
  const COMPANY_SELECTORS = [
    ".artdeco-entity-lockup__subtitle",
    ".job-card-container__primary-description",
    ".base-search-card__subtitle",
    "[class*='primary-description']",
    "[class*='subtitle']",
    "a[href*='/company/']"
  ];

  let enabled = true;
  let country = "GB";
  let index;
  let indexPromise;
  let timer;
  let observer;
  const matchCache = new Map();

  const normalize = (value) => VSCLinkedInExtractor.normalizeText(value);

  function lines(element) {
    return VSCLinkedInExtractor.uniqueLines(element?.innerText || element?.textContent || "")
      .filter((line) => !/^(?:licensed|not found|licensed sponsor|sponsor not found)$/i.test(line));
  }

  function clean(value) {
    return normalize(value).replace(/\s*[|·•]\s*(?:LinkedIn|Hiring|Careers).*$/i, "").trim();
  }

  function cleanElement(element) {
    if (!element) return "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll?.(".vsc-company-marker,.vsc-detail-status").forEach((node) => node.remove());
    return clean(clone.textContent);
  }

  async function loadIndex() {
    if (index) return index;
    if (!indexPromise) {
      indexPromise = (async () => {
        const metadata = await (await fetch(chrome.runtime.getURL("data/metadata.json"))).json();
        const responses = await Promise.all(Array.from({ length: Number(metadata.indexPartCount) }, (_, part) =>
          fetch(chrome.runtime.getURL(`data/uk-sponsors.index.json.gz.part${String(part).padStart(2, "0")}`))
        ));
        if (responses.some((response) => !response.ok)) throw new Error("Sponsor register files are unavailable.");
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
    index = await indexPromise;
    return index;
  }

  function jobLink(root) {
    return [...root.querySelectorAll(JOB_LINKS)].find((link) => lines(link).length) || null;
  }

  function title(root) {
    for (const selector of ["h1", "h2", "h3", "[class*='job-title']", "[class*='title']"]) {
      for (const element of root.querySelectorAll(selector)) {
        const text = clean(lines(element)[0] || cleanElement(element));
        if (text.length >= 2 && text.length <= 220 && !VSCLinkedInExtractor.isNoiseLine(text)) return text;
      }
    }
    return clean(lines(jobLink(root))[0] || "");
  }

  function smallestElement(root, target) {
    const key = clean(target).toLowerCase();
    return [...root.querySelectorAll("a,span,p,div")]
      .filter((element) => {
        if (element.closest(".vsc-company-marker,.vsc-detail-status")) return false;
        const value = cleanElement(element).toLowerCase();
        return value === key || (lines(element).some((line) => clean(line).toLowerCase() === key) && value.length <= key.length + 40);
      })
      .sort((a, b) => a.childElementCount - b.childElementCount || a.textContent.length - b.textContent.length)[0] || null;
  }

  function validCompany(value, jobTitle) {
    return value.length >= 2
      && value.length <= 180
      && !VSCLinkedInExtractor.isNoiseLine(value, jobTitle)
      && !VSCLinkedInExtractor.looksLikeLocation(value);
  }

  function company(root, jobTitle) {
    for (const selector of COMPANY_SELECTORS) {
      for (const element of root.querySelectorAll(selector)) {
        const value = cleanElement(element);
        if (validCompany(value, jobTitle)) return { element, text: value };
      }
    }
    const value = clean(VSCLinkedInExtractor.chooseCompanyLine(lines(root), jobTitle));
    if (!validCompany(value, jobTitle)) return null;
    const element = smallestElement(root, value);
    return element ? { element, text: value } : null;
  }

  function cardScore(element, link) {
    if (!element || element === document.body || !element.contains(link)) return -1;
    const linkCount = element.querySelectorAll(JOB_LINKS).length;
    const textLines = lines(element);
    if (linkCount > 3 || textLines.length < 2 || textLines.length > 30) return -1;
    let score = linkCount === 1 ? 5 : 0;
    if (element.matches("li,[role='listitem']")) score += 8;
    if (element.matches("[data-job-id],[data-occludable-job-id],.job-card-container,.jobs-search-results__list-item")) score += 12;
    return score;
  }

  function cardFor(link) {
    const direct = link.closest(CARD_ROOTS);
    if (direct && cardScore(direct, link) >= 0) return direct.querySelector(".job-card-container") || direct;
    let current = link.parentElement;
    let best;
    let highest = -1;
    for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
      const score = cardScore(current, link);
      if (score > highest) {
        best = current;
        highest = score;
      }
      if (score >= 14) break;
    }
    return best || null;
  }

  function cards() {
    const found = new Set();
    document.querySelectorAll(JOB_LINKS).forEach((link) => {
      const card = cardFor(link);
      if (card) found.add(card);
    });
    document.querySelectorAll(CARD_ROOTS).forEach((element) => {
      if (jobLink(element)) found.add(element.querySelector(".job-card-container") || element);
    });
    return [...found].filter((card) => card.isConnected);
  }

  function match(name) {
    const key = VSCMatcher.canonicalize(name);
    if (!matchCache.has(key)) matchCache.set(key, VSCMatcher.matchCompany(index, name));
    return matchCache.get(key);
  }

  function tooltip(name, result) {
    if (!result.found) return `${name} was not found in the bundled UK sponsor register.`;
    return `Matched to: ${result.officialName}\n${result.skilledWorker ? "Skilled Worker route listed." : "Skilled Worker route is not listed."}`;
  }

  function mark(card, found, result, signature) {
    card.querySelectorAll(".vsc-company-marker[data-vsc-owner='structural']").forEach((node) => node.remove());
    card.classList.remove("vsc-job-card--licensed", "vsc-job-card--unlicensed");
    card.classList.add("vsc-job-card", result.found ? "vsc-job-card--licensed" : "vsc-job-card--unlicensed");
    card.dataset.vscStructuralSignature = signature;

    found.element.classList.remove("vsc-company--licensed", "vsc-company--unlicensed");
    found.element.classList.add(result.found ? "vsc-company--licensed" : "vsc-company--unlicensed");
    found.element.dataset.vscChecked = "true";
    found.element.dataset.vscCompany = found.text;
    found.element.title = tooltip(found.text, result);

    if (!found.element.nextElementSibling?.matches(".vsc-company-marker")) {
      const badge = document.createElement("span");
      badge.className = `vsc-company-marker ${result.found ? "vsc-company-marker--licensed" : "vsc-company-marker--unlicensed"}`;
      badge.dataset.vscOwner = "structural";
      badge.textContent = result.found ? "Licensed" : "Not found";
      badge.title = tooltip(found.text, result);
      found.element.insertAdjacentElement("afterend", badge);
    }
  }

  async function scan() {
    if (!enabled || country !== "GB") return;
    try {
      await loadIndex();
      for (const card of cards()) {
        const jobTitle = title(card);
        const found = company(card, jobTitle);
        if (!found) continue;
        const id = card.getAttribute("data-job-id")
          || card.getAttribute("data-occludable-job-id")
          || VSCLinkedInExtractor.extractJobId(jobLink(card)?.href || "");
        const signature = `${id}|${VSCMatcher.canonicalize(found.text)}`;
        if (card.dataset.vscStructuralSignature === signature && card.querySelector(".vsc-company-marker")) continue;
        mark(card, found, match(found.text), signature);
      }
    } catch (error) {
      console.error("[Visa Sponsorship Checker: structural scanner]", error);
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(scan, 120);
  }

  chrome.storage.local.get({ enabled: true, country: "GB" }).then((values) => {
    enabled = values.enabled;
    country = values.country;
    scan();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.enabled) enabled = changes.enabled.newValue;
    if (changes.country) country = changes.country.newValue;
    schedule();
  });

  observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  globalThis.addEventListener("vsc:structural-rescan", schedule);
  globalThis.addEventListener("vsc:rescan", schedule);
})();
