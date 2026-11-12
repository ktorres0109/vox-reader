import assert from 'node:assert/strict';
import '../content/lib/text-clean.js';

const { cleanTokens, cleanText, urlToSpoken } = globalThis.VoxTextClean;

// Numeric citation markers, attached or standalone
assert.deepEqual(cleanTokens(['history.[1]', 'Silent']), ['history.', 'Silent']);
assert.deepEqual(cleanTokens(['later.[2][3]']), ['later.']);
assert.deepEqual(cleanTokens(['[12]']), ['']);
assert.deepEqual(cleanTokens(['fact[3–5],', 'then']), ['fact,', 'then']);
assert.deepEqual(cleanTokens(['too.[a]']), ['too.']);
assert.deepEqual(cleanTokens(['Heading[edit]']), ['Heading']);

// Multi-token bracket groups keep a 1:1 mapping
assert.deepEqual(
  cleanTokens(['timeline.[citation', 'needed]', 'Next']),
  ['timeline.', '', 'Next'],
);
assert.deepEqual(
  cleanTokens(['claim', '[according', 'to', 'whom?]', 'ok']),
  ['claim', '', '', '', 'ok'],
);
// Editorial brackets that are real words stay
assert.deepEqual(cleanTokens(['[he]', 'said']), ['[he]', 'said']);
assert.deepEqual(cleanTokens(['[sic]']), ['[sic]']);
// An unclosed bracket is left alone
assert.deepEqual(cleanTokens(['[note', 'that', 'this']), ['[note', 'that', 'this']);

// URLs speak the domain only
assert.equal(urlToSpoken('https://example.com/history/reading.html'), 'example.com');
assert.equal(urlToSpoken('www.wikipedia.org.'), 'wikipedia.org.');
assert.equal(urlToSpoken('(https://sub.example.org/a?b=1),'), 'sub.example.org,');
assert.deepEqual(cleanTokens(['at', 'https://example.com/x', 'or']), ['at', 'example.com', 'or']);

// Footnote superscripts: DOM-flagged tokens and unicode markers
assert.deepEqual(cleanTokens([{ text: 'manuscripts.' }, { text: '2', footnote: true }]), ['manuscripts.', '']);
assert.deepEqual(cleanTokens(['one¹', 'should']), ['one', 'should']);
assert.deepEqual(cleanTokens(['¹']), ['']);
assert.deepEqual(cleanTokens(['end.²']), ['end.']);
// ...but units and formulas keep their exponents
assert.deepEqual(cleanTokens(['m²', 'mc²']), ['m²', 'mc²']);

// Free text: whitespace collapsed, markers removed
assert.equal(
  cleanText('  Reading  aloud was normal.[1]\n\nSilent reading [citation needed] came later. See https://example.com/a  '),
  'Reading aloud was normal. Silent reading came later. See example.com',
);
assert.equal(cleanText(''), '');

console.log('text-clean.test.mjs: ok');
