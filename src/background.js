const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  country: "GB"
});

const SUPPORTED_COUNTRIES = new Set(["GB", "NL"]);
const REMOTE_BASE_URL = "https://raw.githubusercontent.com/rish-kar/Visa-Sponsorship-Checker/main";
const REFRESH_ALARM = "vsc-refresh-sponsor-data";
const REFRESH_PERIOD_MINUTES = 7 * 24 * 60;
const REFRESH_PERIOD_MS = REFRESH_PERIOD_MINUTES * 60 * 1000;
const MIN_RETRY_MS = 12 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 1;
const SPONSOR_DATA_LAST_ATTEMPT = "sponsorDataLastRefreshAttempt";
const SPONSOR_DATA_LAST_SUCCESS = "sponsorDataLastRefreshSuccess";
const COUNTRY_CONFIGS = {
  GB: {
    metadataPath: "data/metadata.json",
    partPrefix: "data/uk-sponsors.index.json.gz.part"
  },
  NL: {
    metadataPath: "data/nl-metadata.json",
    partPrefix: "data/nl-sponsors.index.json.gz.part"
  }
};

function cacheKey(country) {
  return `sponsorDataCache.${country}`;
}

function remoteUrl(path) {
  return `${REMOTE_BASE_URL}/${path}`;
}

function nextSundayRefreshTime() {
  const target = new Date();
  const daysUntilSunday = (7 - target.getDay()) % 7;
  target.setDate(target.getDate() + daysUntilSunday);
  target.setHours(6, 17, 0, 0);
  if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 7);
  return target.getTime();
}

async function ensureRefreshAlarm() {
  await chrome.alarms.create(REFRESH_ALARM, {
    when: nextSundayRefreshTime(),
    periodInMinutes: REFRESH_PERIOD_MINUTES
  });
}

async function fetchJson(path) {
  const response = await fetch(remoteUrl(path), { cache: "no-store" });
  if (!response.ok) throw new Error(`Remote metadata failed (${response.status})`);
  return response.json();
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function fetchPart(path) {
  const response = await fetch(remoteUrl(path), { cache: "no-store" });
  if (!response.ok) throw new Error(`Remote sponsor index failed (${response.status})`);
  return bytesToBase64(await response.arrayBuffer());
}

function validCache(cache, country) {
  const partCount = Number(cache?.metadata?.indexPartCount);
  return cache
    && cache.schemaVersion === CACHE_SCHEMA_VERSION
    && cache.country === country
    && Array.isArray(cache.parts)
    && Number.isInteger(partCount)
    && partCount > 0
    && cache.parts.length === partCount;
}

async function readSponsorCache(country) {
  if (!COUNTRY_CONFIGS[country]) return null;
  const key = cacheKey(country);
  const result = await chrome.storage.local.get({ [key]: null });
  const cache = result[key];
  return validCache(cache, country) ? cache : null;
}

async function refreshCountry(country) {
  const config = COUNTRY_CONFIGS[country];
  if (!config) return { country, status: "unsupported" };

  const metadata = await fetchJson(config.metadataPath);
  const partCount = Number(metadata.indexPartCount);
  if (metadata.country !== country || !Number.isInteger(partCount) || partCount < 1) {
    throw new Error(`Invalid ${country} remote metadata`);
  }

  const existing = await readSponsorCache(country);
  if (existing
    && existing.metadata?.registerUpdated
    && metadata.registerUpdated
    && existing.metadata.registerUpdated > metadata.registerUpdated) {
    return { country, status: "cached-newer" };
  }
  if (existing
    && existing.metadata?.registerUpdated === metadata.registerUpdated
    && Number(existing.metadata?.indexPartCount) === partCount) {
    return { country, status: "current" };
  }

  const parts = await Promise.all(Array.from({ length: partCount }, (_item, part) =>
    fetchPart(`${config.partPrefix}${String(part).padStart(2, "0")}`)
  ));
  await chrome.storage.local.set({
    [cacheKey(country)]: {
      schemaVersion: CACHE_SCHEMA_VERSION,
      country,
      metadata,
      parts,
      fetchedAt: new Date().toISOString(),
      sourceBaseUrl: REMOTE_BASE_URL
    }
  });
  return { country, status: "updated", registerUpdated: metadata.registerUpdated };
}

async function refreshAllCountries({ force = false } = {}) {
  const now = Date.now();
  const timings = await chrome.storage.local.get({
    [SPONSOR_DATA_LAST_ATTEMPT]: 0,
    [SPONSOR_DATA_LAST_SUCCESS]: 0
  });
  if (!force
    && now - Number(timings[SPONSOR_DATA_LAST_SUCCESS] || 0) < REFRESH_PERIOD_MS) {
    return { ok: true, skipped: "fresh" };
  }
  if (!force
    && now - Number(timings[SPONSOR_DATA_LAST_ATTEMPT] || 0) < MIN_RETRY_MS) {
    return { ok: true, skipped: "recent-attempt" };
  }

  await chrome.storage.local.set({ [SPONSOR_DATA_LAST_ATTEMPT]: now });
  const results = [];
  let success = true;
  for (const country of Object.keys(COUNTRY_CONFIGS)) {
    try {
      const result = await refreshCountry(country);
      results.push(result);
    } catch (error) {
      success = false;
      console.error(`[Visa Sponsorship Checker] ${country} data refresh failed`, error);
      results.push({ country, status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (success) await chrome.storage.local.set({ [SPONSOR_DATA_LAST_SUCCESS]: Date.now() });
  return { ok: success, results };
}

function refreshIfDue() {
  refreshAllCountries().catch((error) => {
    console.error("[Visa Sponsorship Checker] Sponsor data refresh failed", error);
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set({
    enabled: typeof existing.enabled === "boolean" ? existing.enabled : true,
    country: SUPPORTED_COUNTRIES.has(existing.country) ? existing.country : "GB"
  });
  await ensureRefreshAlarm();
  refreshIfDue();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureRefreshAlarm();
  refreshIfDue();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) {
    refreshAllCountries({ force: true }).catch((error) => {
      console.error("[Visa Sponsorship Checker] Scheduled sponsor data refresh failed", error);
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_SPONSOR_INDEX") {
    readSponsorCache(message.country).then((cache) => {
      refreshIfDue();
      sendResponse(cache ? {
        ok: true,
        country: cache.country,
        metadata: cache.metadata,
        parts: cache.parts,
        source: "remote-cache"
      } : { ok: false, reason: "no-cache" });
    });
    return true;
  }

  if (message?.type === "GET_SPONSOR_METADATA") {
    readSponsorCache(message.country).then((cache) => {
      refreshIfDue();
      sendResponse(cache ? {
        ok: true,
        country: cache.country,
        metadata: cache.metadata,
        source: "remote-cache"
      } : { ok: false, reason: "no-cache" });
    });
    return true;
  }

  if (message?.type === "REFRESH_SPONSOR_DATA") {
    refreshAllCountries({ force: Boolean(message.force) }).then(sendResponse);
    return true;
  }

  return false;
});
