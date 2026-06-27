const assert = require("node:assert/strict");
const matcher = require("../src/matcher.js");

const index = matcher.buildIndex({
  records: [
    ["Google (UK) Limited", 1],
    ["Westcoast Ltd", 1],
    ["Roofoods Ltd t/a Deliveroo", 1],
    ["Example Charity Trust", 0],
    ["CGG Services (UK) Ltd", 1]
  ],
  aliases: {
    Google: "Google (UK) Limited",
    Viridien: "CGG Services (UK) Ltd"
  }
});

assert.equal(matcher.canonicalize("Westcoast Limited"), "westcoast");
assert.equal(matcher.matchCompany(index, "Westcoast").found, true);
assert.equal(matcher.matchCompany(index, "Google").method, "verified-alias");
assert.equal(matcher.matchCompany(index, "Deliveroo").found, true);
assert.equal(matcher.matchCompany(index, "Viridien").officialName, "CGG Services (UK) Ltd");
assert.equal(matcher.matchCompany(index, "Definitely Not A Sponsor").found, false);
assert.equal(matcher.matchCompany(index, "Example Charity Trust").skilledWorker, false);
console.log("matcher tests passed");
