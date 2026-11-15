const bridge = globalThis.chrome?.webview;
const header = document.querySelector('.header-actions');

if (bridge && header) {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'desktop-update';
  button.className = 'button subtle compact';
  button.textContent = '检查更新';
  const status = document.createElement('span');
  status.className = 'desktop-update-status';
  status.setAttribute('role', 'status');
  const exportButton = document.getElementById('export-all');
  header.insertBefore(button, exportButton);
  header.append(status);

  let action = 'updates-check';
  button.onclick = () => {
    if (action === 'updates-launch' && document.querySelector('.file-row') && exportButton.disabled) {
      status.textContent = '请等导入或导出完成后再更新。';
      return;
    }
    bridge.postMessage(action);
  };
  bridge.addEventListener('message', ({ data }) => {
    if (typeof data !== 'string' || !data.startsWith('updates|')) return;
    const [, state, version] = data.split('|');
    const labels = {
      checking: '检查中…', available: `更新到 ${version}`, downloading: '正在下载…',
      'installer-ready': '安装并重启', 'portable-ready': '打开新版', 'download-failed': '重试下载',
      'check-failed': '重试检查', current: '已是最新版',
    };
    const messages = {
      available: `发现新版 ${version}。`, current: `当前 ${version} 已是最新版。`,
      'check-failed': '暂时无法检查更新，请稍后重试。', 'download-failed': '下载或校验失败，请重试。',
      'installer-ready': '已校验安装包，可以安装并重启。', 'portable-ready': '已解压并校验新版便携包，可以打开新版。',
    };
    button.textContent = labels[state] ?? '检查更新';
    button.title = messages[state] ?? button.textContent;
    button.disabled = state === 'checking' || state === 'downloading';
    button.classList.toggle('update-available', state === 'available' || state.endsWith('-ready'));
    action = state.endsWith('-ready') ? 'updates-launch'
      : state === 'available' ? 'updates-download' : state === 'download-failed' ? 'updates-retry' : 'updates-check';
    const text = messages[state];
    if (text && typeof window.redactorUpdateStatus === 'function') window.redactorUpdateStatus(text);
    else status.textContent = text ?? '';
  });
  bridge.postMessage('updates-ready');
}
