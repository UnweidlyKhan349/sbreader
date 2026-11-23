const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { build, addressOf } = require('../tools/redirect-site.js');

// Runs a stub's redirect script with the given old address; returns where it sends the browser.
function redirectFrom(html, pathname, search = '', hash = '') {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  let went = null;
  vm.runInNewContext(script, { location: { pathname, search, hash, replace: (u) => { went = u; } } });
  return went;
}

test('addresses of pages, as GitHub Pages serves them', () => {
  assert.equal(addressOf('index.html'), '/');
  assert.equal(addressOf('solo.html'), '/solo');
  assert.equal(addressOf('sets/nosb/index.html'), '/sets/nosb/');
  assert.equal(addressOf('sets/nosb/3.html'), '/sets/nosb/3');
});

test('sbreader.github.io redirects every page to sbreader.org, keeping the rest of the address', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbreader-redirect-'));
  try {
    // A built site: the pages plus one set and one packet page.
    const site = path.join(tmp, 'site');
    fs.mkdirSync(path.join(site, 'sets', 'nosb'), { recursive: true });
    for (const f of ['index.html', 'solo.html', '404.html', 'google253f8e427c6e2761.html', 'sets/nosb/index.html', 'sets/nosb/3.html']) {
      fs.writeFileSync(path.join(site, f), '<!DOCTYPE html>');
    }
    const out = path.join(tmp, 'out');
    build(out, site);
    const read = (f) => fs.readFileSync(path.join(out, f), 'utf8');

    const index = read('index.html');
    assert.match(index, /<meta http-equiv="refresh" content="0; url=https:\/\/sbreader\.org\/" \/>/);
    assert.match(index, /<link rel="canonical" href="https:\/\/sbreader\.org\/" \/>/);
    assert.doesNotMatch(index, /googletagmanager/);
    assert.match(read('solo.html'), /url=https:\/\/sbreader\.org\/solo"/);
    assert.match(read('sets/nosb/index.html'), /url=https:\/\/sbreader\.org\/sets\/nosb\/"/);
    assert.match(read('sets/nosb/3.html'), /url=https:\/\/sbreader\.org\/sets\/nosb\/3"/);

    assert.equal(redirectFrom(index, '/'), 'https://sbreader.org/');
    assert.equal(redirectFrom(read('solo.html'), '/solo', '?x=1', '#y'), 'https://sbreader.org/solo?x=1#y');
    const notFound = read('404.html');
    assert.match(notFound, /noindex/);
    assert.equal(redirectFrom(notFound, '/account.html', '', '#access_token=t'), 'https://sbreader.org/account.html#access_token=t');

    assert.match(read('sw.js'), /registration\.unregister\(\)/);
    assert.ok(!fs.existsSync(path.join(out, 'google253f8e427c6e2761.html')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
