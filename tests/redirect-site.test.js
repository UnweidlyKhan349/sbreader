const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { build } = require('../tools/redirect-site.js');

// Runs a stub's redirect script with the given old address; returns where it sends the browser.
function redirectFrom(html, pathname, search = '', hash = '') {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  let went = null;
  vm.runInNewContext(script, { location: { pathname, search, hash, replace: (u) => { went = u; } } });
  return went;
}

test('the old address redirects every page to sbreader.org, keeping the rest of the address', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sbreader-redirect-'));
  try {
    build(out);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.match(index, /<meta http-equiv="refresh" content="0; url=https:\/\/sbreader\.org\/" \/>/);
    assert.match(index, /<link rel="canonical" href="https:\/\/sbreader\.org\/" \/>/);
    assert.doesNotMatch(index, /googletagmanager/);
    const solo = fs.readFileSync(path.join(out, 'solo.html'), 'utf8');
    assert.match(solo, /url=https:\/\/sbreader\.org\/solo"/);

    assert.equal(redirectFrom(index, '/sbreader/'), 'https://sbreader.org/');
    assert.equal(redirectFrom(index, '/sbreader'), 'https://sbreader.org/');
    assert.equal(redirectFrom(solo, '/sbreader/solo', '?x=1', '#y'), 'https://sbreader.org/solo?x=1#y');
    const notFound = fs.readFileSync(path.join(out, '404.html'), 'utf8');
    assert.match(notFound, /noindex/);
    assert.equal(redirectFrom(notFound, '/sbreader/account.html', '', '#access_token=t'), 'https://sbreader.org/account.html#access_token=t');
    assert.equal(redirectFrom(notFound, '/sbreader/sets/nosb/3'), 'https://sbreader.org/sets/nosb/3');

    assert.match(fs.readFileSync(path.join(out, 'sw.js'), 'utf8'), /registration\.unregister\(\)/);
    assert.ok(!fs.existsSync(path.join(out, 'google253f8e427c6e2761.html')));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
