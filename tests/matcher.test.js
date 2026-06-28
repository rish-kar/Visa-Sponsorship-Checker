const assert = require("node:assert/strict");
const matcher = require("../src/matcher.js");

const index = matcher.buildIndex({
  records: [
    ["Google (UK) Limited", 1],
    ["Westcoast Ltd", 1],
    ["Roofoods Ltd t/a Deliveroo", 1],
    ["Example Charity Trust", 0],
    ["CGG Services (UK) Ltd", 1],
    ["Twitter UK Ltd", 1],
    ["Acer UK Limited", 1],
    ["AMS", 0],
    ["AMS CORPORATION LIMITED", 1],
    ["H&L Bristol Limited", 1]
  ],
  aliases: {
    Google: "Google (UK) Limited",
    Viridien: "CGG Services (UK) Ltd",
    X: "Twitter UK Ltd"
  }
});

assert.equal(matcher.canonicalize("Westcoast Limited"), "westcoast");
assert.equal(matcher.matchCompany(index, "Westcoast").found, true);
assert.equal(matcher.matchCompany(index, "Google").method, "verified-alias");
assert.equal(matcher.matchCompany(index, "Deliveroo").found, true);
assert.equal(matcher.matchCompany(index, "Viridien").officialName, "CGG Services (UK) Ltd");
assert.equal(matcher.matchCompany(index, "X").method, "verified-alias");
assert.equal(matcher.matchCompany(index, "Acer").method, "country-brand");
assert.equal(matcher.matchCompany(index, "AMS").officialName, "AMS");
assert.equal(matcher.matchCompany(index, "AMS").skilledWorker, false);
assert.equal(matcher.matchCompany(index, "Bristol").found, false);
assert.equal(matcher.matchCompany(index, "Definitely Not A Sponsor").found, false);

// Brand names that are a subset of the registered legal name should resolve,
// even when the display name uses a different/extra word (e.g. "Group", "UK").
assert.equal(matcher.matchCompany(index, "CGG").found, true);
assert.equal(matcher.matchCompany(index, "CGG").method, "brand-name-match");
assert.equal(matcher.matchCompany(index, "Westcoast Group").found, true);
// Distinctive word match must still point at the right organisation.
assert.equal(matcher.matchCompany(index, "Westcoast Group").officialName, "Westcoast Ltd");
assert.equal(matcher.matchCompany(index, "Example Charity Trust").skilledWorker, false);
console.log("matcher tests passed");
