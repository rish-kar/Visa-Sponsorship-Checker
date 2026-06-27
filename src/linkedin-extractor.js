(function attachLinkedInExtractor(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.VSCLinkedInExtractor = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function linkedInExtractorFactory() {
  "use strict";

  const NOISE_PATTERNS = [
    /\b(?:easy apply|promoted|reposted|sponsored|saved|viewed|applicants?)\b/i,
    /\b(?:actively reviewing applicants|school alumni work here|connections? work here)\b/i,
    /\b(?:hour|hours|day|days|week|weeks|month|months) ago\b/i,
    /\b(?:hybrid|remote|on-site|onsite|full-time|part-time|contract|temporary|internship)\b/i,
    /\b(?:salary|per annum|per year|per hour|gbp|usd|eur)\b/i,
    /^[£$€]\s?\d/i,
    /^\d+[+]?\s+(?:applicants?|results?)$/i,
    /^(?:save|dismiss|message|show all)$/i
  ];

  function normalizeText(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function uniqueLines(value) {
    const seen = new Set();
    return String(value || "")
      .split(/\r?\n/)
      .map(normalizeText)
      .filter((line) => {
        const key = line.toLowerCase();
        if (!line || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function isNoiseLine(line, title = "") {
    const value = normalizeText(line);
    if (!value) return true;
    if (title && value.toLowerCase() === normalizeText(title).toLowerCase()) return true;
    if (value.length > 140) return true;
    return NOISE_PATTERNS.some((pattern) => pattern.test(value));
  }

  function looksLikeLocation(line) {
    const value = normalizeText(line);
    if (!value) return false;
    return /\b(?:united kingdom|england|scotland|wales|northern ireland|london|manchester|birmingham|bristol|leeds|edinburgh|glasgow|cambridge|oxford|reading|remote|hybrid|on-site|onsite)\b/i.test(value)
      && (/[(),·]/.test(value) || /\b(?:area|region|county|kingdom)\b/i.test(value));
  }

  function chooseCompanyLine(lines, title = "") {
    const cleaned = Array.isArray(lines) ? lines.map(normalizeText).filter(Boolean) : uniqueLines(lines);
    const titleKey = normalizeText(title).toLowerCase();
    const titleIndex = cleaned.findIndex((line) => line.toLowerCase() === titleKey);
    const ordered = titleIndex >= 0
      ? [...cleaned.slice(titleIndex + 1), ...cleaned.slice(0, titleIndex)]
      : cleaned;

    for (const line of ordered) {
      if (isNoiseLine(line, title) || looksLikeLocation(line)) continue;
      if (/^\d/.test(line) || line.length < 2) continue;
      return line;
    }
    return "";
  }

  function extractJobId(value) {
    const text = String(value || "");
    const attributeMatch = text.match(/(?:jobId|currentJobId|data-job-id|data-occludable-job-id)[=/"':-]*([0-9]{5,})/i);
    if (attributeMatch) return attributeMatch[1];
    const pathMatch = text.match(/\/jobs\/view\/(?:[^0-9]*)([0-9]{5,})/i);
    return pathMatch ? pathMatch[1] : "";
  }

  return { normalizeText, uniqueLines, isNoiseLine, looksLikeLocation, chooseCompanyLine, extractJobId };
});
