(function attachUrlUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.VSCUrl = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function urlUtilsFactory() {
  "use strict";

  function isLinkedInHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return host === "linkedin.com" || host.endsWith(".linkedin.com");
  }

  function isLinkedInJobsUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" && isLinkedInHost(url.hostname) && /^\/jobs(?:\/|$)/.test(url.pathname);
    } catch {
      return false;
    }
  }

  return { isLinkedInHost, isLinkedInJobsUrl };
});
