const assert = require("node:assert/strict");
const url = require("../src/url-utils.js");

assert.equal(url.isLinkedInJobsUrl("https://www.linkedin.com/jobs/search-results/?keywords=java"), true);
assert.equal(url.isLinkedInJobsUrl("https://linkedin.com/jobs/view/123"), true);
assert.equal(url.isLinkedInJobsUrl("https://uk.linkedin.com/jobs/search-results/"), true);
assert.equal(url.isLinkedInJobsUrl("https://www.linkedin.com/feed/"), false);
assert.equal(url.isLinkedInJobsUrl("https://notlinkedin.com/jobs/"), false);
assert.equal(url.isLinkedInJobsUrl(""), false);
console.log("url utils tests passed");
