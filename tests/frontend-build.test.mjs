import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

test('Produkcijski CSS se učitava i kad su inline skripte zabranjene', () => {
  const url = new URL('../frontend/dist/autoskola/browser/index.html', import.meta.url);
  const html = readFileSync(url, 'utf8').replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
  const stylesheet = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .find(tag => /\brel="stylesheet"/i.test(tag) && /\bhref="styles(?:-[^"]+)?\.css"/i.test(tag));

  assert.ok(stylesheet, 'Nedostaje glavni CSS link.');
  assert.doesNotMatch(stylesheet, /\bonload=|\bmedia="print"/i);
  const [, path] = stylesheet.match(/\bhref="([^"]+)"/i);
  assert.match(readFileSync(new URL(path, url), 'utf8'), /\.login-card\{/);
});
