const assert = require("node:assert/strict");
const zlib = require("node:zlib");

const realSetTimeout = global.setTimeout;
global.setTimeout = (callback, delay, ...args) => {
  const timer = realSetTimeout(callback, delay, ...args);
  timer.unref?.();
  return timer;
};

function splitSelectors(selector) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (char === "[") depth += 1;
    if (char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(selector.slice(start).trim());
  return parts.filter(Boolean);
}

function dataNameToAttribute(name) {
  return `data-${String(name).replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  values() {
    return new Set((this.element.getAttribute("class") || "").split(/\s+/).filter(Boolean));
  }

  write(values) {
    this.element.setAttribute("class", [...values].join(" "));
  }

  add(...names) {
    const values = this.values();
    names.forEach((name) => values.add(name));
    this.write(values);
  }

  remove(...names) {
    const values = this.values();
    names.forEach((name) => values.delete(name));
    this.write(values);
  }

  contains(name) {
    return this.values().has(name);
  }
}

class FakeElement {
  constructor(tagName, attributes = {}, children = []) {
    this.tagName = tagName.toUpperCase();
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.classList = new FakeClassList(this);
    this._text = "";
    this._rect = attributes.__rect || { width: 360, height: 88, left: 0, top: 0, right: 360, bottom: 88 };
    this.dataset = new Proxy({}, {
      get: (_target, property) => this.getAttribute(dataNameToAttribute(property)) || undefined,
      set: (_target, property, value) => {
        this.setAttribute(dataNameToAttribute(property), String(value));
        return true;
      },
      deleteProperty: (_target, property) => {
        this.removeAttribute(dataNameToAttribute(property));
        return true;
      }
    });

    Object.entries(attributes).forEach(([name, value]) => {
      if (name === "text") this.textContent = value;
      else if (name !== "__rect") this.setAttribute(name, value);
    });
    children.forEach((child) => this.appendChild(child));
  }

  get className() {
    return this.getAttribute("class") || "";
  }

  set className(value) {
    this.setAttribute("class", value);
  }

  get href() {
    return this.getAttribute("href") || "";
  }

  get childElementCount() {
    return this.children.length;
  }

  get isConnected() {
    let node = this;
    while (node) {
      if (node.isDocument) return true;
      node = node.parentElement;
    }
    return false;
  }

  get textContent() {
    return [this._text, ...this.children.map((child) => child.textContent)].filter(Boolean).join("\n");
  }

  set textContent(value) {
    this._text = String(value || "");
    this.children = [];
  }

  get innerText() {
    return this.textContent;
  }

  set innerText(value) {
    this.textContent = value;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name).toLowerCase(), String(value));
  }

  getAttribute(name) {
    return this.attributes.get(String(name).toLowerCase()) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(String(name).toLowerCase());
  }

  getBoundingClientRect() {
    return this._rect;
  }

  matches(selector) {
    return splitSelectors(selector).some((part) => this.matchesOne(part));
  }

  matchesOne(selector) {
    const attributeSelectors = selector.match(/\[[^\]]+\]/g) || [];
    const remainder = selector.replace(/\[[^\]]+\]/g, "");
    const pieces = remainder.split(".").filter(Boolean);
    const tag = remainder.startsWith(".") ? "" : pieces.shift();
    if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    if (pieces.some((className) => !this.classList.contains(className))) return false;

    return attributeSelectors.every((attributeSelector) => {
      const body = attributeSelector.slice(1, -1).trim();
      const match = body.match(/^([\w-]+)(?:\s*(\*=|=)\s*['"]?([^'"]*?)['"]?\s*(i)?)?$/);
      if (!match) return false;
      const [, name, operator, expected = "", flag] = match;
      const actual = this.getAttribute(name);
      if (actual === null) return false;
      if (!operator) return true;
      const left = flag === "i" ? actual.toLowerCase() : actual;
      const right = flag === "i" ? expected.toLowerCase() : expected;
      return operator === "*=" ? left.includes(right) : left === right;
    });
  }

  querySelectorAll(selector) {
    const results = [];
    const visit = (node) => {
      node.children.forEach((child) => {
        if (child.matches(selector)) results.push(child);
        visit(child);
      });
    };
    visit(this);
    return results;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches?.(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  insertAdjacentElement(position, element) {
    assert.equal(position, "afterend");
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this) + 1, 0, element);
    element.parentElement = this.parentElement;
  }

  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
}

class FakeDocument extends FakeElement {
  constructor(body) {
    super("document");
    this.isDocument = true;
    this.documentElement = new FakeElement("html");
    this.body = body;
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  addEventListener() {}
  removeEventListener() {}
}

function element(tagName, attributes, children) {
  return new FakeElement(tagName, attributes, children);
}

function jobRow({ id, title, company, location = "", idAttribute = "data-occludable-job-id", href = "", className = "scaffold-layout__list-item" }) {
  const titleAttributes = { "data-view-name": "job-card-title", text: title };
  if (href) titleAttributes.href = href;
  const rowAttributes = {};
  if (className) rowAttributes.class = className;
  if (idAttribute) rowAttributes[idAttribute] = idAttribute.includes("urn") ? `urn:li:fsd_jobPosting:${id}` : id;
  return element("li", rowAttributes, [
    element("div", { class: "job-card-container" }, [
      element(href ? "a" : "span", titleAttributes),
      element("span", { class: "job-card-container__company-name", text: company }),
      location ? element("span", { class: "job-card-container__metadata-item", text: location }) : null
    ].filter(Boolean))
  ]);
}

function componentJobCard({ id, title, company, location }) {
  const companyElement = element("p", { text: company });
  const card = element("div", { componentkey: `job-card-component-ref-${id}` }, [
    element("div", {}, [
      element("p", { text: `Selected, ${title} (Verified job)\n${title}` }),
      element("div", {}, [companyElement]),
      element("p", { text: location }),
      element("p", { text: "Viewed" }),
      element("p", { text: "Posted 2 weeks ago" })
    ])
  ]);
  return { card, companyElement };
}

function installBrowserFakes(document, runtimeListeners, options = {}) {
  global.document = document;
  global.window = {
    innerWidth: 1280,
    addEventListener() {},
    removeEventListener() {}
  };
  global.location = { href: "https://www.linkedin.com/jobs/search/" };
  global.addEventListener = () => {};
  global.removeEventListener = () => {};
  global.dispatchEvent = () => true;
  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };

  const storedSettings = { enabled: true, country: "GB", ...(options.settings || {}) };
  const ukSponsorIndex = {
    records: [
      ["Google (UK) Limited", 1],
      ["Microsoft Limited", 1],
      ["OpenAI UK Ltd", 1],
      ["Netflix Services UK Limited", 1],
      ["Anthropic Limited", 1],
      ["Elsevier Limited", 1]
    ],
    aliases: {
      Google: "Google (UK) Limited",
      Microsoft: "Microsoft Limited",
      OpenAI: "OpenAI UK Ltd",
      Netflix: "Netflix Services UK Limited",
      Anthropic: "Anthropic Limited",
      Elsevier: "Elsevier Limited"
    }
  };
  const nlSponsorIndex = {
    records: [
      ["Booking.com B.V.", 1],
      ["ASML Netherlands B.V.", 1],
      ["Elsevier B.V.", 1]
    ],
    aliases: {
      "Booking.com": "Booking.com B.V.",
      ASML: "ASML Netherlands B.V.",
      Elsevier: "Elsevier B.V."
    }
  };
  const zippedUkIndex = zlib.gzipSync(Buffer.from(JSON.stringify(ukSponsorIndex)));
  const zippedNlIndex = zlib.gzipSync(Buffer.from(JSON.stringify(nlSponsorIndex)));
  const locationIndex = { countries: { GB: ["edinburgh"], NL: ["ede", "veldhoven"] } };
  global.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith("location-index.json")) {
      return new Response(JSON.stringify(locationIndex), { status: 200 });
    }
    if (value.endsWith("nl-metadata.json")) {
      return new Response(JSON.stringify({ indexPartCount: 1 }), { status: 200 });
    }
    if (value.endsWith("metadata.json")) {
      return new Response(JSON.stringify({ indexPartCount: 1 }), { status: 200 });
    }
    if (value.endsWith("uk-sponsors.index.json.gz.part00")) {
      return new Response(zippedUkIndex, { status: 200 });
    }
    if (value.endsWith("nl-sponsors.index.json.gz.part00")) {
      return new Response(zippedNlIndex, { status: 200 });
    }
    return new Response("", { status: 404 });
  };

  global.chrome = {
    runtime: {
      getURL: (path) => `chrome-extension://visa-sponsorship-checker/${path}`,
      lastError: null,
      sendMessage: (message, callback) => {
        const response = message?.type === "GET_SPONSOR_INDEX"
          ? { ok: false, reason: "no-cache" }
          : undefined;
        if (callback) callback(response);
        return Promise.resolve(response);
      },
      onMessage: {
        addListener: (listener) => runtimeListeners.push(listener),
        removeListener: (listener) => {
          const index = runtimeListeners.indexOf(listener);
          if (index >= 0) runtimeListeners.splice(index, 1);
        }
      }
    },
    storage: {
      local: {
        get: async (defaults) => ({ ...defaults, ...storedSettings }),
        set: async (values) => Object.assign(storedSettings, values)
      },
      onChanged: {
        addListener() {},
        removeListener() {}
      }
    }
  };
}

async function sendRuntimeMessage(runtimeListeners, message) {
  assert.equal(runtimeListeners.length, 1);
  return new Promise((resolve) => {
    let settled = false;
    const result = runtimeListeners[0](message, {}, (response) => {
      settled = true;
      resolve(response);
    });
    if (result !== true && !settled) resolve(undefined);
  });
}

async function waitForReady(runtimeListeners) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await sendRuntimeMessage(runtimeListeners, { type: "GET_PAGE_STATUS" });
    if (status.phase === "ready") return status;
    await new Promise((resolve) => realSetTimeout(resolve, 25));
  }
  throw new Error("Scanner did not become ready");
}

(async () => {
  const runtimeListeners = [];
  const elsevier = componentJobCard({
    id: "4426099006",
    title: "AI Engineer",
    company: "Elsevier",
    location: "London"
  });
  const booking = componentJobCard({
    id: "4426099007",
    title: "Frontend Engineer",
    company: "Booking.com",
    location: "Amsterdam"
  });
  const body = element("body", {}, [
    element("ul", { class: "jobs-search-results__list" }, [
      elsevier.card,
      jobRow({
        id: "10001",
        title: "Data Engineer",
        company: "Google",
        location: "London, England, United Kingdom (Hybrid)",
        href: "https://www.linkedin.com/jobs/view/10001/"
      }),
      jobRow({
        id: "10002",
        title: "Cloud Engineer",
        company: "Microsoft",
        location: "Manchester, England, United Kingdom",
        idAttribute: "data-job-id",
        href: "https://www.linkedin.com/jobs/search/?currentJobId=10002"
      }),
      jobRow({
        id: "10003",
        title: "AI Engineer",
        company: "OpenAI",
        location: "Paris, France",
        idAttribute: "data-occludable-entity-urn"
      }),
      jobRow({
        id: "10004",
        title: "Platform Engineer",
        company: "Netflix",
        idAttribute: "data-chameleon-result-urn"
      }),
      jobRow({
        id: "10005",
        title: "Research Engineer",
        company: "Anthropic",
        location: "Edinburgh, Scotland, United Kingdom",
        idAttribute: null,
        className: ""
      }),
      booking.card,
      jobRow({
        id: "10006",
        title: "Machine Learning Engineer",
        company: "ASML",
        location: "Veldhoven, Netherlands",
        href: "https://www.linkedin.com/jobs/view/10006/"
      }),
      element("li", {}, [
        element("span", { text: "Saved search suggestion" }),
        element("span", { text: "Westcoast" }),
        element("span", { text: "London, United Kingdom" })
      ])
    ])
  ]);

  installBrowserFakes(new FakeDocument(body), runtimeListeners);
  global.VSCMatcher = require("../src/matcher.js");
  global.VSCLinkedInExtractor = require("../src/linkedin-extractor.js");
  global.VSCUrl = require("../src/url-utils.js");

  require("../src/job-list-scanner.js");

  const status = await waitForReady(runtimeListeners);
  assert.equal(status.country, "GB");
  assert.equal(status.cardsDetected, 4);
  assert.equal(status.checked, 4);
  assert.deepEqual(status.companies.map((company) => company.companyName), ["Elsevier", "Google", "Microsoft", "Anthropic"]);
  assert.equal(elsevier.card.classList.contains("vsc-job-card"), true);
  assert.equal(booking.card.classList.contains("vsc-job-card"), false);
  assert.equal(elsevier.card.dataset.vscJobId, "4426099006");
  const companySiblings = elsevier.companyElement.parentElement.children;
  const companyIndex = companySiblings.indexOf(elsevier.companyElement);
  assert.equal(companySiblings[companyIndex + 1].classList.contains("vsc-company-marker"), true);
  assert.equal(document.querySelectorAll(".vsc-company-marker").length, 4);

  const nlStatus = await sendRuntimeMessage(runtimeListeners, { type: "RECHECK_PAGE", country: "NL" });
  assert.equal(nlStatus.country, "NL");
  assert.equal(nlStatus.cardsDetected, 2);
  assert.equal(nlStatus.checked, 2);
  assert.deepEqual(nlStatus.companies.map((company) => company.companyName), ["Booking.com", "ASML"]);
  assert.equal(elsevier.card.classList.contains("vsc-job-card"), false);
  assert.equal(booking.card.classList.contains("vsc-job-card"), true);
  assert.equal(document.querySelectorAll(".vsc-company-marker").length, 2);
  global.__VSC_JOB_LIST_SCANNER_STATE__.cleanup();
  global.setTimeout = realSetTimeout;
  console.log("job list scanner tests passed");
})();
