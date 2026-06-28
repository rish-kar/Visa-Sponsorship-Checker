const assert = require("node:assert/strict");
const fs = require("node:fs");
const zlib = require("node:zlib");
const matcher = require("../src/matcher.js");

function readPartedIndex(prefix) {
  const parts = fs.readdirSync("data")
    .filter((name) => name.startsWith(prefix))
    .sort();
  assert.ok(parts.length > 0, `Missing ${prefix} parts`);
  return JSON.parse(zlib.gunzipSync(Buffer.concat(parts.map((name) => fs.readFileSync(`data/${name}`)))).toString("utf8"));
}

const nlMetadata = JSON.parse(fs.readFileSync("data/nl-metadata.json", "utf8"));
const nlDataset = readPartedIndex("nl-sponsors.index.json.gz.part");
assert.equal(nlDataset.country, "NL");
assert.equal(nlDataset.records.length, nlMetadata.organisationCount);

const nlIndex = matcher.buildIndex(nlDataset);
assert.equal(matcher.matchCompany(nlIndex, "Elsevier").found, true);
assert.equal(matcher.matchCompany(nlIndex, "Booking.com").found, true);
assert.equal(matcher.matchCompany(nlIndex, "ASML").found, true);

console.log("country data tests passed");
