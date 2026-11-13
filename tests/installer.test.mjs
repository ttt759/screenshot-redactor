import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'fflate';

const root = process.env.REDACTOR_PACKAGE_UNDER_TEST;
test('Windows installer and unpacked program each occupy less than 30 MB', { skip: !root }, async () => {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const installer = `screenshot-redactor-setup-${version}-windows-x64.exe`;
  const portable = `screenshot-redactor-portable-${version}-windows-x64.zip`;
  assert.ok((await stat(join(root, installer))).size < 30_000_000, 'Installer exceeds 30 MB');
  assert.ok((await stat(join(root, portable))).size < 30_000_000, 'Portable ZIP exceeds 30 MB');
  const contents = unzipSync(await readFile(join(root, portable)));
  for (const file of ['ScreenshotRedactor.exe', 'WebView2Loader.dll', 'Microsoft.Web.WebView2.Core.dll', 'docs/index.html']) {
    assert.ok(contents[file]?.length, `Portable ZIP missing ${file}`);
  }
  const app = join(root, 'win-unpacked');
  let bytes = 0;
  for (const entry of await readdir(app, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) bytes += (await stat(join(entry.parentPath, entry.name))).size;
  }
  assert.ok(bytes < 30_000_000, `Program occupies ${bytes} bytes`);
});
