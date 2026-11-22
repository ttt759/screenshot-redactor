import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const build = pkg.build.buildVersion ?? pkg.version;

test('local web assets and ESM imports use the current build for cache busting', async () => {
  const indexHtml = await readFile(new URL('../docs/index.html', import.meta.url), 'utf8');
  const appMjs = await readFile(new URL('../docs/app.mjs', import.meta.url), 'utf8');
  const imagesMjs = await readFile(new URL('../docs/images.mjs', import.meta.url), 'utf8');

  assert.ok(indexHtml.includes(`href="./styles.css?v=${build}"`));
  assert.ok(indexHtml.includes(`src="./app.mjs?v=${build}"`));
  assert.ok(indexHtml.includes(`src="./vendor/fflate.js?v=${build}"`));

  for (const source of [appMjs, imagesMjs]) {
    const localImports = [...source.matchAll(/import\s+(?:[^'"]+\s+from\s+)?['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
    assert.ok(localImports.length > 0);
    for (const specifier of localImports) {
      assert.ok(specifier.endsWith(`.mjs?v=${build}`), `Expected ?v=${build} on ${specifier}`);
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
