(function attachMatcher(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.VSCMatcher = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function matcherFactory() {
  "use strict";

  const LEGAL_SUFFIXES = new Set([
    "ltd", "limited", "llp", "plc", "sa", "ag", "gmbh", "bv", "nv", "ulc", "lp"
  ]);

  const TOKEN_STOPWORDS = new Set([
    "and", "the", "for", "with", "from", "services", "service", "solutions", "solution",
    "group", "holdings", "holding", "international", "global", "uk", "united", "kingdom",
    "europe", "european", "technologies", "technology", "systems", "system", "partners",
    "consulting", "management", "association", "trust", "foundation", "inc", "incorporated",
    "corp", "corporation", "co", "company", "companies"
  ]);

  const COUNTRY_SUFFIXES = new Set(["uk", "gb", "britain"]);

  // Place names are not distinctive company identifiers on their own
  // (e.g. "Bristol" should not match "H&L Bristol Limited").
  const PLACE_TOKENS = new Set([
    "uk", "gb", "britain", "ireland", "england", "scotland", "wales",
    "london", "manchester", "birmingham", "bristol", "leeds", "edinburgh",
    "glasgow", "cambridge", "oxford", "reading", "liverpool", "sheffield",
    "cardiff", "belfast", "newcastle", "nottingham", "leicester", "coventry",
    "bath", "york", "exeter", "swindon", "slough", "brighton", "southampton",
    "portsmouth", "aberdeen", "dundee", "norwich", "plymouth", "swansea",
    "derby", "hull", "stoke", "sunderland", "preston", "luton", "gloucester",
    "watford", "ipswich", "wolverhampton", "middlesbrough", "blackpool"
  ]);

  // A lone distinctive word only resolves a company when it is genuinely rare
  // in the register (appears in at most this many organisations).
  const SINGLE_TOKEN_DF_CAP = 12;

  function baseNormalize(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/\b(?:t\s*\/\s*a|trading\s+as)\b/gi, " tradingas ")
      .replace(/[’'`]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  }

  function stripLegalSuffixes(tokens) {
    const result = tokens.slice();
    while (result.length > 1 && LEGAL_SUFFIXES.has(result[result.length - 1])) result.pop();
    return result;
  }

  function stripCountrySuffixes(value) {
    const tokens = String(value || "").split(" ").filter(Boolean);
    let changed = false;
    while (tokens.length > 1) {
      const last = tokens[tokens.length - 1];
      if (COUNTRY_SUFFIXES.has(last)) {
        tokens.pop();
        changed = true;
        continue;
      }
      if (tokens.length > 2 && tokens[tokens.length - 2] === "united" && tokens[tokens.length - 1] === "kingdom") {
        tokens.pop();
        tokens.pop();
        changed = true;
        continue;
      }
      break;
    }
    return changed ? tokens.join(" ") : "";
  }

  function canonicalize(value) {
    const normalized = baseNormalize(value);
    if (!normalized) return "";
    let tokens = normalized.split(" ");
    if (tokens[0] === "the" && tokens.length > 1) tokens.shift();
    tokens = stripLegalSuffixes(tokens);
    return tokens.join(" ");
  }

  function significantTokens(value) {
    return canonicalize(value)
      .split(" ")
      .filter((token) => token.length >= 3 && !TOKEN_STOPWORDS.has(token));
  }

  function legalNameKey(value) {
    const normalized = baseNormalize(value);
    const marker = " tradingas ";
    const index = normalized.indexOf(marker);
    return index >= 0 ? canonicalize(normalized.slice(0, index)) : canonicalize(normalized);
  }

  function tradeNameKey(value) {
    const normalized = baseNormalize(value);
    const marker = " tradingas ";
    const index = normalized.indexOf(marker);
    return index >= 0 ? canonicalize(normalized.slice(index + marker.length)) : "";
  }

  function levenshteinRatio(a, b) {
    if (a === b) return 1;
    if (!a || !b) return 0;
    if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) * 0.45) return 0;
    const previous = new Uint16Array(b.length + 1);
    const current = new Uint16Array(b.length + 1);
    for (let j = 0; j <= b.length; j += 1) previous[j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      current[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      }
      previous.set(current);
    }
    return 1 - previous[b.length] / Math.max(a.length, b.length);
  }

  function tokenScore(inputTokens, candidateTokens) {
    if (!inputTokens.length || !candidateTokens.length) return 0;
    const left = new Set(inputTokens);
    const right = new Set(candidateTokens);
    let intersection = 0;
    left.forEach((token) => { if (right.has(token)) intersection += 1; });
    const union = new Set([...left, ...right]).size;
    const jaccard = union ? intersection / union : 0;
    const containment = intersection / Math.min(left.size, right.size);
    return (jaccard * 0.55) + (containment * 0.45);
  }

  function buildIndex(dataset) {
    if (!dataset || !Array.isArray(dataset.records)) throw new Error("Invalid sponsor dataset");

    const records = dataset.records.map((entry, index) => {
      const name = entry[0];
      const canonical = canonicalize(name);
      return {
        id: index,
        name,
        skilledWorker: Boolean(entry[1]),
        canonical,
        tokens: significantTokens(name)
      };
    });

    const legalExact = new Map();
    const brandExact = new Map();
    const tradeExact = new Map();
    const tokenMap = new Map();
    const df = new Map();

    function addExact(map, key, id) {
      if (!key) return;
      const values = map.get(key) || [];
      if (!values.includes(id)) values.push(id);
      map.set(key, values);
    }

    records.forEach((record) => {
      [record.canonical, legalNameKey(record.name)].forEach((key) => {
        addExact(legalExact, key, record.id);
        addExact(brandExact, stripCountrySuffixes(key), record.id);
      });
      addExact(tradeExact, tradeNameKey(record.name), record.id);
      new Set(record.tokens).forEach((token) => {
        df.set(token, (df.get(token) || 0) + 1);
        if (token.length < 3) return;
        const values = tokenMap.get(token) || [];
        values.push(record.id);
        tokenMap.set(token, values);
      });
    });

    const aliases = new Map();
    Object.entries(dataset.aliases || {}).forEach(([alias, officialName]) => {
      const targetKey = canonicalize(officialName);
      const targetIds = legalExact.get(targetKey) || brandExact.get(targetKey);
      if (targetIds && targetIds.length) aliases.set(canonicalize(alias), targetIds[0]);
    });

    return { dataset, records, legalExact, brandExact, tradeExact, tokenMap, aliases, df, recordCount: records.length };
  }

  function chooseExact(index, ids, method, confidence) {
    const preferred = ids
      .map((id) => index.records[id])
      .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))[0];
    return {
      found: true,
      method,
      confidence,
      officialName: preferred.name,
      skilledWorker: preferred.skilledWorker
    };
  }

  function matchCompany(index, companyName) {
    const input = canonicalize(companyName);
    if (!input) return { found: false, method: "invalid", confidence: 0 };

    const exactIds = index.legalExact.get(input);
    if (exactIds?.length) return chooseExact(index, exactIds, "exact", 1);

    const aliasId = index.aliases.get(input);
    if (Number.isInteger(aliasId)) return chooseExact(index, [aliasId], "verified-alias", 0.99);

    const tradeIds = index.tradeExact.get(input);
    if (tradeIds?.length) return chooseExact(index, tradeIds, "trading-name", 0.98);

    const brandIds = index.brandExact?.get(input);
    if (brandIds?.length) return chooseExact(index, brandIds, "country-brand", 0.96);

    if (input.length < 2) return { found: false, method: "invalid", confidence: 0 };

    const inputTokens = significantTokens(companyName);
    if (!inputTokens.length) return { found: false, method: "not-found", confidence: 0 };

    // Distinctive (non-place) tokens are what actually identify a company.
    const distinctiveInput = inputTokens.filter((token) => !PLACE_TOKENS.has(token));
    const idf = (token) => Math.log((index.recordCount + 1) / ((index.df.get(token) || 0) + 1)) + 1;

    const candidateIds = new Set();
    inputTokens.forEach((token) => {
      const ids = index.tokenMap.get(token);
      if (!ids || ids.length > 4000) return;
      ids.forEach((id) => candidateIds.add(id));
    });

    if (!candidateIds.size) return { found: false, method: "not-found", confidence: 0 };

    let best = null;
    let runnerUp = null;
    candidateIds.forEach((id) => {
      const candidate = index.records[id];
      const candidateTokens = new Set(candidate.tokens);

      // Does the candidate contain every distinctive word of the input?
      // (e.g. "expedia" is fully inside "expedia.com ltd".)
      let coversAllDistinctive = distinctiveInput.length > 0;
      let sharedIdf = 0;
      distinctiveInput.forEach((token) => {
        if (candidateTokens.has(token)) sharedIdf += idf(token);
        else coversAllDistinctive = false;
      });

      let candidateIdf = 0;
      candidate.tokens.forEach((token) => { candidateIdf += idf(token); });
      const candidateCoverage = candidateIdf ? sharedIdf / candidateIdf : 0;

      const tokenSimilarity = tokenScore(inputTokens, candidate.tokens);
      const editSimilarity = levenshteinRatio(input, candidate.canonical);
      const score = Math.max(
        (tokenSimilarity * 0.6) + (editSimilarity * 0.4),
        coversAllDistinctive ? (0.9 + (0.1 * candidateCoverage)) : 0
      );

      const item = { candidate, score, coversAllDistinctive, candidateCoverage };
      if (!best || score > best.score ||
        (score === best.score && candidate.canonical.length < best.candidate.canonical.length)) {
        runnerUp = best;
        best = item;
      } else if (!runnerUp || score > runnerUp.score) {
        runnerUp = item;
      }
    });

    if (best) {
      // A brand that is a subset of the registered legal name is a confident
      // match — but a single distinctive word only counts if it is rare enough
      // to point at one organisation rather than hundreds.
      const singleDistinctive = distinctiveInput.length === 1;
      const distinctiveEnough = !singleDistinctive ||
        distinctiveInput.every((token) => (index.df.get(token) || 0) <= SINGLE_TOKEN_DF_CAP);

      if (best.coversAllDistinctive && distinctiveEnough) {
        return {
          found: true,
          method: "brand-name-match",
          confidence: Math.min(0.96, Number((0.86 + (0.1 * best.candidateCoverage)).toFixed(3))),
          officialName: best.candidate.name,
          skilledWorker: best.candidate.skilledWorker
        };
      }

      // Fallback similarity path catches typos and partial overlaps.
      const minimum = singleDistinctive ? 0.93 : 0.86;
      const uniqueEnough = !runnerUp || best.score - runnerUp.score >= 0.03;
      if (best.score >= minimum && uniqueEnough) {
        return {
          found: true,
          method: "strong-name-match",
          confidence: Math.min(0.95, Number(best.score.toFixed(3))),
          officialName: best.candidate.name,
          skilledWorker: best.candidate.skilledWorker
        };
      }
    }

    return { found: false, method: "not-found", confidence: best ? Number(best.score.toFixed(3)) : 0 };
  }

  return { baseNormalize, canonicalize, significantTokens, legalNameKey, tradeNameKey, buildIndex, matchCompany };
});
