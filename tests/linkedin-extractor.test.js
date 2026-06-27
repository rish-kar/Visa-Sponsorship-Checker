const assert = require('node:assert/strict');
const extractor = require('../src/linkedin-extractor.js');

const first = ['Intermediate Java Developer (Big Data)', 'Global Relay', 'Loddon (Hybrid)', '12 school alumni work here', '2 weeks ago · Easy Apply'];
const second = ['Generative AI Engineer', 'Bridewell', 'London (Hybrid)', 'Actively reviewing applicants', '1 week ago · Easy Apply'];

assert.equal(extractor.chooseCompanyLine(first, first[0]), 'Global Relay');
assert.equal(extractor.chooseCompanyLine(second, second[0]), 'Bridewell');
assert.equal(extractor.extractJobId('/jobs/view/4414577869/'), '4414577869');
assert.equal(extractor.looksLikeLocation('London Area, United Kingdom (On-site)'), true);
assert.equal(extractor.isNoiseLine('Actively reviewing applicants'), true);
console.log('linkedin extractor tests passed');
