const { app, BrowserWindow, Menu, net, protocol, session } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const scheme = 'redactor';
const host = 'local';
const home = `${scheme}://${host}/index.html`;
const assets = new Set([
  'index.html', 'app.mjs', 'geometry.mjs', 'icons.mjs', 'images.mjs', 'styles.css', 'favicon.svg',
  'vendor/fflate.js', 'samples/account.png', 'samples/account-team.png', 'samples/account-studio.png',
  'samples/checkout.jpg', 'samples/receipt.png',
]);

protocol.registerSchemesAsPrivileged([
  { scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

async function createWindow() {
  const window = new BrowserWindow({
    title: '截图脱敏助手', width: 1260, height: 860, minWidth: 560, minHeight: 520,
    backgroundColor: '#f6f5f7', show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.once('ready-to-show', () => window.show());
  await window.loadURL(home);
}

app.setAppUserModelId('io.github.ttt759.screenshotredactor');
app.whenReady().then(async () => {
  protocol.handle(scheme, (request) => {
    const url = new URL(request.url);
    const name = url.pathname.slice(1);
    if (url.host !== host || !assets.has(name)) return new Response(null, { status: 404 });
    return net.fetch(pathToFileURL(join(__dirname, '..', 'docs', name)).href);
  });

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => {
    callback({ cancel: true });
  });
  session.defaultSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ defaultPath: join(app.getPath('downloads'), item.getFilename()) });
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'editMenu', label: '编辑' }]));
  await createWindow();
});

app.on('window-all-closed', () => app.quit());
