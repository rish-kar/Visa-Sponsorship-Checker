(function attachLinkedInExtractor(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.VSCLinkedInExtractor = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function linkedInExtractorFactory() {
  "use strict";

  const NOISE_PATTERNS = [
    /\b(?:easy apply|promoted|reposted|sponsored|saved|viewed|applicants?)\b/i,
    /\b(?:actively hiring|actively reviewing applicants|school alumni work here|connections? work here|be an early applicant)\b/i,
    /\b(?:hour|hours|day|days|week|weeks|month|months) ago\b/i,
    /\b(?:hybrid|remote|on-site|onsite|full-time|part-time|contract|temporary|internship)\b/i,
    /\b(?:salary|per annum|per year|per hour|gbp|usd|eur)\b/i,
    /\b(?:are these results helpful|your feedback helps|reactivate premium|top applicant)\b/i,
    /^[£$€]\s?\d/i,
    /^\d+[+]?\s+(?:applicants?|results?)$/i,
    /^(?:save|dismiss|message|show all)$/i
  ];

  const WORK_MODE_TERMS = new Set(["remote", "hybrid", "on site", "onsite", "full time", "part time"]);
  const LOCATION_DESCRIPTORS = /\b(?:area|region|county|province|provincie|municipality|gemeente|city|town|district|borough|metropolitan)\b/g;
  const GB_EXPLICIT_TERMS = termSet("united kingdom|uk|great britain|britain|england|scotland|wales|northern ireland");
  const NL_EXPLICIT_TERMS = termSet("netherlands|the netherlands|nederland|holland|north holland|south holland|noord holland|zuid holland");
  const UNSUPPORTED_COUNTRY_TERMS = termSet([
    "australia", "austria", "belgium", "brazil", "canada", "china", "denmark", "finland", "france",
    "germany", "india", "ireland", "italy", "japan", "luxembourg", "norway", "poland", "portugal",
    "singapore", "spain", "sweden", "switzerland", "united states", "usa", "us", "new zealand"
  ].join("|"));
  const GB_LOCATION_TERMS = termSet([
    "aberdeen", "aberdeenshire", "aldershot", "andover", "armagh", "ashford", "aylesbury", "ayr",
    "bangor", "barnsley", "barrow in furness", "basildon", "basingstoke", "bath", "bedford",
    "belfast", "berkshire", "birkenhead", "birmingham", "blackburn", "blackpool", "bolton",
    "bournemouth", "bracknell", "bradford", "brighton", "brighton and hove", "bristol",
    "buckinghamshire", "burnley", "bury", "caerphilly", "cambridge", "cambridgeshire", "canterbury",
    "cardiff", "carlisle", "chelmsford", "cheltenham", "cheshire", "chester", "chesterfield",
    "chichester", "colchester", "cornwall", "coventry", "crawley", "croydon", "cumbria", "darlington",
    "derby", "derbyshire", "derry", "devon", "doncaster", "dorset", "dundee", "durham", "eastbourne",
    "edinburgh", "essex", "exeter", "falkirk", "fife", "gateshead", "glasgow", "gloucester",
    "gloucestershire", "gravesend", "greater london", "greater manchester", "greenock", "guildford",
    "hampshire", "harrogate", "hartlepool", "hastings", "hemel hempstead", "hereford", "hertfordshire",
    "high wycombe", "huddersfield", "hull", "inverness", "ipswich", "kent", "kilmarnock",
    "kingston upon hull", "kingston upon thames", "kirkcaldy", "lancashire", "leeds", "leicester",
    "leicestershire", "lincoln", "lincolnshire", "liverpool", "loddon", "london", "londonderry",
    "loughborough", "luton", "maidstone", "manchester", "mansfield", "merseyside", "middlesbrough",
    "milton keynes", "newcastle", "newcastle upon tyne", "newcastle under lyme", "newport", "norfolk",
    "northampton", "northamptonshire", "norwich", "nottingham", "nottinghamshire", "oldham", "oxford",
    "oxfordshire", "paisley", "peterborough", "plymouth", "poole", "portsmouth", "preston", "reading",
    "redcar", "renfrewshire", "rochdale", "rotherham", "salford", "salisbury", "scarborough",
    "scunthorpe", "sheffield", "shropshire", "slough", "solihull", "somerset", "southampton",
    "southend on sea", "stafford", "staffordshire", "stirling", "stockport", "stockton on tees",
    "stoke", "stoke on trent", "sunderland", "surrey", "swansea", "swindon", "taunton", "telford",
    "torquay", "truro", "tyne and wear", "wakefield", "walsall", "warrington", "warwickshire",
    "watford", "west bromwich", "west midlands", "west sussex", "west yorkshire", "westminster",
    "wigan", "winchester", "woking", "wolverhampton", "worcester", "worcestershire", "worthing",
    "york", "yorkshire"
  ].join("|"));
  const NL_LOCATION_TERMS = termSet([
    "aalten", "alkmaar", "almelo", "almere", "alphen aan den rijn", "amersfoort", "amstelveen",
    "amsterdam", "apeldoorn", "arnhem", "assen", "barendrecht", "barneveld", "bergen op zoom",
    "berkel en rodenrijs", "best", "beverwijk", "breda", "capelle aan den ijssel", "delft",
    "den bosch", "den haag", "deventer", "diemen", "doetinchem", "dordrecht", "drenthe", "dronten",
    "eindhoven", "emmen", "enschede", "flevoland", "friesland", "gelderland", "goes", "gouda",
    "groningen", "haarlem", "haarlemmermeer", "hardenberg", "harderwijk", "heemskerk", "heemstede",
    "heerlen", "helmond", "hendrik ido ambacht", "hengelo", "hilversum", "hoorn", "hoofddorp",
    "ijmuiden", "ijsselstein", "katwijk", "leeuwarden", "leiden", "leidschendam", "lelystad",
    "limburg", "maastricht", "middelharnis", "middelburg", "nieuwegein", "nijmegen", "noord brabant",
    "noord holland", "noordoostpolder", "oegstgeest", "oisterwijk", "oldenzaal", "ommen", "oss",
    "overijssel", "papendrecht", "purmerend", "rijswijk", "roermond", "roosendaal", "rotterdam",
    "s gravenhage", "s hertogenbosch", "schiedam", "sittard", "smallingerland", "sneek", "soest",
    "spijkenisse", "staphorst", "terneuzen", "tilburg", "utrecht", "utrecht province", "veenendaal",
    "veldhoven", "velsen", "venlo", "vlaardingen", "vlissingen", "voorburg", "wageningen", "weert",
    "wijchen", "winschoten", "woerden", "zaandam", "zaanstad", "zeeland", "zeist", "zoetermeer",
    "zuid holland", "zutphen", "zwolle"
  ].join("|"));
  const LOCATION_TERMS = { GB: GB_LOCATION_TERMS, NL: NL_LOCATION_TERMS };

  function normalizeText(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalizeLocationToken(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/[’'`]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function termSet(value) {
    return new Set(String(value || "").split("|").map(normalizeLocationToken).filter(Boolean));
  }

  function removeWorkModes(value) {
    return normalizeLocationToken(value)
      .split(" ")
      .filter((word, index, words) => {
        const pair = `${word} ${words[index + 1] || ""}`.trim();
        if (WORK_MODE_TERMS.has(word) || WORK_MODE_TERMS.has(pair)) return false;
        return !(index > 0 && WORK_MODE_TERMS.has(`${words[index - 1]} ${word}`));
      })
      .join(" ")
      .trim();
  }

  function locationCandidates(line) {
    const withoutModes = String(line || "").replace(/\([^)]*\)/g, " ");
    const rawParts = [withoutModes, ...withoutModes.split(/\s*(?:,|;|\||\/|·)\s*/)];
    const candidates = new Set();
    rawParts.forEach((part) => {
      const base = removeWorkModes(part);
      if (!base) return;
      candidates.add(base);
      candidates.add(base.replace(LOCATION_DESCRIPTORS, " ").replace(/\s+/g, " ").trim());
      candidates.add(base.replace(/^greater\s+/, "").trim());
      candidates.add(base.replace(/^city\s+of\s+/, "").trim());
    });
    return [...candidates].filter(Boolean).filter((candidate) => !WORK_MODE_TERMS.has(candidate));
  }

  function addLocationTerms(country, terms) {
    const target = LOCATION_TERMS[country];
    if (!target || !Array.isArray(terms)) return;
    terms.forEach((term) => {
      const key = normalizeLocationToken(term);
      if (key) target.add(key);
    });
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

  function classifyLocationCountry(line) {
    const value = normalizeText(line);
    if (!value) return "";
    const candidates = locationCandidates(value);
    if (!candidates.length) return "";
    if (candidates.some((candidate) => UNSUPPORTED_COUNTRY_TERMS.has(candidate))) return "";

    const explicitGB = candidates.some((candidate) => GB_EXPLICIT_TERMS.has(candidate));
    const explicitNL = candidates.some((candidate) => NL_EXPLICIT_TERMS.has(candidate));
    if (explicitGB && !explicitNL) return "GB";
    if (explicitNL && !explicitGB) return "NL";
    if (explicitGB || explicitNL) return "";

    const gb = candidates.some((candidate) => LOCATION_TERMS.GB.has(candidate));
    const nl = candidates.some((candidate) => LOCATION_TERMS.NL.has(candidate));
    if (gb && !nl) return "GB";
    if (nl && !gb) return "NL";
    return "";
  }

  function looksLikeLocation(line) {
    return Boolean(classifyLocationCountry(line));
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

  return { normalizeText, uniqueLines, isNoiseLine, looksLikeLocation, classifyLocationCountry, addLocationTerms, chooseCompanyLine, extractJobId };
});
