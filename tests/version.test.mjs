import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('package.json uses version 0.2.1 without redundant buildVersion', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, '0.2.1');
  assert.equal('buildVersion' in pkg.build, false);
});

test('local web assets and ESM imports include ?v=0.2.1 cache-busting query', async () => {
  const indexHtml = await readFile(new URL('../docs/index.html', import.meta.url), 'utf8');
  const appMjs = await readFile(new URL('../docs/app.mjs', import.meta.url), 'utf8');
  const imagesMjs = await readFile(new URL('../docs/images.mjs', import.meta.url), 'utf8');

  assert.match(indexHtml, /href="\.\/styles\.css\?v=0\.2\.1"/);
  assert.match(indexHtml, /src="\.\/app\.mjs\?v=0\.2\.1"/);

  for (const source of [appMjs, imagesMjs]) {
    const localImports = [...source.matchAll(/import\s+(?:[^'"]+\s+from\s+)?['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
    assert.ok(localImports.length > 0);
    for (const specifier of localImports) {
      assert.ok(specifier.endsWith('.mjs?v=0.2.1'), `Expected ?v=0.2.1 on ${specifier}`);
    }
  }
});

test('GitHub Actions workflows pin actions to full 40-char commit SHAs', async () => {
  for (const name of ['checks.yml', 'windows-installer.yml']) {
    const content = await readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
    const uses = [...content.matchAll(/uses:\s*([^\s#]+)/g)].map((m) => m[1]);
    assert.ok(uses.length > 0, `${name} should declare actions`);
    for (const ref of uses) {
      assert.match(ref, /^[^@]+@[0-9a-f]{40}$/, `Action ${ref} in ${name} must be pinned to a commit SHA`);
    }
  }
});
