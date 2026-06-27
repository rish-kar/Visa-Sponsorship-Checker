(function attachMatcher(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.VSCMatcher = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function matcherFactory() {
  "use strict";

  const LEGAL_SUFFIXES = new Set([
    "ltd", "limited", "llp", "plc", "inc", "incorporated", "corp", "corporation",
    "co", "company", "companies", "sa", "ag", "gmbh", "bv", "nv", "ulc", "lp"
  ]);

  const TOKEN_STOPWORDS = new Set([
    "and", "the", "for", "with", "from", "services", "service", "solutions", "solution",
    "group", "holdings", "holding", "international", "global", "uk", "united", "kingdom",
    "europe", "european", "technologies", "technology", "systems", "system", "partners",
    "consulting", "management", "association", "trust", "foundation"
  ]);

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
    const tradeExact = new Map();
    const tokenMap = new Map();

    function addExact(map, key, id) {
      if (!key) return;
      const values = map.get(key) || [];
      if (!values.includes(id)) values.push(id);
      map.set(key, values);
    }

    records.forEach((record) => {
      addExact(legalExact, record.canonical, record.id);
      addExact(legalExact, legalNameKey(record.name), record.id);
      addExact(tradeExact, tradeNameKey(record.name), record.id);
      new Set(record.tokens).forEach((token) => {
        if (token.length < 4) return;
        const values = tokenMap.get(token) || [];
        values.push(record.id);
        tokenMap.set(token, values);
      });
    });

    const aliases = new Map();
    Object.entries(dataset.aliases || {}).forEach(([alias, officialName]) => {
      const targetKey = canonicalize(officialName);
      const targetIds = legalExact.get(targetKey);
      if (targetIds && targetIds.length) aliases.set(canonicalize(alias), targetIds[0]);
    });

    return { dataset, records, legalExact, tradeExact, tokenMap, aliases };
  }

  function chooseExact(index, ids, method, confidence) {
    const preferred = ids
      .map((id) => index.records[id])
      .sort((a, b) => Number(b.skilledWorker) - Number(a.skilledWorker) || a.name.length - b.name.length)[0];
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
    if (!input || input.length < 2) return { found: false, method: "invalid", confidence: 0 };

    const exactIds = index.legalExact.get(input);
    if (exactIds?.length) return chooseExact(index, exactIds, "exact", 1);

    const aliasId = index.aliases.get(input);
    if (Number.isInteger(aliasId)) return chooseExact(index, [aliasId], "verified-alias", 0.99);

    const tradeIds = index.tradeExact.get(input);
    if (tradeIds?.length) return chooseExact(index, tradeIds, "trading-name", 0.98);

    const inputTokens = significantTokens(companyName);
    if (!inputTokens.length) return { found: false, method: "not-found", confidence: 0 };

    const candidateCounts = new Map();
    inputTokens.forEach((token) => {
      const ids = index.tokenMap.get(token) || [];
      if (ids.length > 900) return;
      ids.forEach((id) => candidateCounts.set(id, (candidateCounts.get(id) || 0) + 1));
    });

    if (!candidateCounts.size) return { found: false, method: "not-found", confidence: 0 };

    const candidates = [...candidateCounts.entries()]
      .filter(([, shared]) => inputTokens.length === 1 ? shared === 1 : shared >= Math.min(2, inputTokens.length))
      .slice(0, 2500)
      .map(([id]) => index.records[id]);

    let best = null;
    let runnerUp = null;
    candidates.forEach((candidate) => {
      const tokenSimilarity = tokenScore(inputTokens, candidate.tokens);
      const editSimilarity = levenshteinRatio(input, candidate.canonical);
      const containment = input.length >= 6 && candidate.canonical.length >= 6 &&
        (candidate.canonical.includes(input) || input.includes(candidate.canonical)) ? 1 : 0;
      const score = Math.max(
        (tokenSimilarity * 0.72) + (editSimilarity * 0.28),
        containment ? (tokenSimilarity * 0.6) + 0.38 : 0
      );
      const item = { candidate, score };
      if (!best || score > best.score) {
        runnerUp = best;
        best = item;
      } else if (!runnerUp || score > runnerUp.score) {
        runnerUp = item;
      }
    });

    const uniqueEnough = !runnerUp || best.score - runnerUp.score >= 0.035;
    const minimum = inputTokens.length === 1 ? 0.965 : 0.88;
    if (best && best.score >= minimum && uniqueEnough) {
      return {
        found: true,
        method: "strong-name-match",
        confidence: Math.min(0.97, Number(best.score.toFixed(3))),
        officialName: best.candidate.name,
        skilledWorker: best.candidate.skilledWorker
      };
    }

    return { found: false, method: "not-found", confidence: best ? Number(best.score.toFixed(3)) : 0 };
  }

  return { baseNormalize, canonicalize, significantTokens, legalNameKey, tradeNameKey, buildIndex, matchCompany };
});
