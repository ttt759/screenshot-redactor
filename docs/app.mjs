import './icons.mjs';
import { clamp, moveBox, outputName, pixelBounds, resizeBox } from './geometry.mjs';
import { drawFlattened, exportImages, loadFile, loadImage } from './images.mjs';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const artboard = $('artboard');
const fileList = $('file-list');
const masks = $('masks');
const preview = $('preview');
const source = $('source');
const dialog = $('export-dialog');
const corners = ['nw', 'ne', 'sw', 'se'];
const samples = [
  ['account.png', '01-账号信息.png', [{ id: 'sample-email', x: 446, y: 403, width: 254, height: 28 }]],
  ['checkout.jpg', '02-付款页面.jpg', []],
  ['receipt.png', '03-付款记录.png', []],
];

let entries = [];
let index = 0;
let tool = 'draw';
let view = 'edit';
let selected = null;
let zoom = null;
let gesture = null;
let busy = false;
let queue = Promise.resolve();
let pendingExport = null;
let toastTimer;
let dragDepth = 0;
let previewEntry = null;
let previewBoxes = null;

const active = () => entries[index];
const setDisabled = (id, disabled) => { $(id).disabled = disabled; };

function makeEntry(name, { image, url }, demo = false, boxes = []) {
  return { name, image, url, demo, width: image.naturalWidth, height: image.naturalHeight, boxes, history: [], checked: false };
}

function announce(message) {
  clearTimeout(toastTimer);
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}

function renderRows() {
  const focusedRow = fileList.contains(document.activeElement) ? document.activeElement.dataset.index : null;
  const rows = entries.map((entry, position) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'file-row';
    row.title = entry.name;
    row.dataset.index = position;
    if (position === index) row.setAttribute('aria-current', 'true');
    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.alt = '';
    thumb.src = entry.url;
    const label = document.createElement('span');
    label.className = 'file-label';
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = entry.name;
    const state = document.createElement('span');
    state.className = entry.checked ? 'file-state checked' : 'file-state';
    state.textContent = entry.checked ? '已检查' : '待检查';
    label.append(name, state);
    row.append(thumb, label);
    row.addEventListener('click', () => goTo(position));
    return row;
  });
  fileList.replaceChildren(...rows);
  if (focusedRow !== null) rows[Number(focusedRow)]?.focus({ preventScroll: true });
  $('file-count').textContent = entries.length;
  const reviewed = entries.filter((entry) => entry.checked).length;
  $('progress-text').textContent = `${reviewed} / ${entries.length}`;
  $('progress').max = Math.max(1, entries.length);
  $('progress').value = reviewed;
  $('progress').setAttribute('aria-valuenow', reviewed);
  $('samples').hidden = entries.length > 0;
}

function fittedScale(entry) {
  const padding = parseFloat(getComputedStyle($('stage-inner')).paddingLeft) * 2;
  return Math.min(1, Math.max(1, stage.clientWidth - padding - 1) / entry.width,
    Math.max(1, stage.clientHeight - padding - 1) / entry.height);
}

function layoutArtboard() {
  const entry = active();
  if (!entry) return;
  const scale = zoom ?? fittedScale(entry);
  artboard.style.width = `${entry.width * scale}px`;
  artboard.style.height = `${entry.height * scale}px`;
  $('zoom-level').textContent = `${Math.round(scale * 100)}%`;
  setDisabled('zoom-out', scale <= Math.min(0.05, fittedScale(entry)));
  setDisabled('zoom-in', scale >= 8);
}

function renderMasks() {
  const entry = active();
  if (!entry) {
    masks.replaceChildren();
    return;
  }
  const boxes = gesture?.mode === 'draw' && gesture.draft ? [...entry.boxes, gesture.draft] : entry.boxes;
  masks.replaceChildren(...boxes.map((box) => {
    const node = document.createElement('div');
    const draft = gesture?.mode === 'draw' && box === gesture.draft;
    const display = gesture?.id === box.id && gesture.draft ? gesture.draft : box;
    node.className = draft ? 'mask draft' : 'mask';
    node.dataset.id = box.id;
    node.style.left = `${display.x / entry.width * 100}%`;
    node.style.top = `${display.y / entry.height * 100}%`;
    node.style.width = `${display.width / entry.width * 100}%`;
    node.style.height = `${display.height / entry.height * 100}%`;
    if (box.id === selected && !draft) {
      node.classList.add('active');
      for (const corner of corners) {
        const handle = document.createElement('span');
        handle.className = 'handle';
        handle.dataset.handle = corner;
        node.append(handle);
      }
    }
    return node;
  }));
}

function renderEditor() {
  const entry = active();
  const editing = Boolean(entry) && view === 'edit';
  $('active-name').textContent = entry?.name ?? '编辑区';
  $('active-detail').textContent = entry ? `${entry.width} × ${entry.height} px${entry.demo ? ' · 虚构示例' : ''}` : '';
  $('empty').hidden = Boolean(entry);
  $('stage-inner').hidden = !entry;
  $('edit').setAttribute('aria-pressed', editing);
  $('preview-button').setAttribute('aria-pressed', Boolean(entry) && !editing);
  $('draw').setAttribute('aria-pressed', editing && tool === 'draw');
  $('select').setAttribute('aria-pressed', editing && tool === 'select');
  $('pan').setAttribute('aria-pressed', editing && tool === 'pan');
  artboard.dataset.tool = editing ? tool : 'preview';
  preview.hidden = !entry || editing;
  source.hidden = !editing;
  masks.hidden = !editing;
  setDisabled('edit', !entry);
  setDisabled('preview-button', !entry);
  setDisabled('draw', !editing);
  setDisabled('select', !editing);
  setDisabled('pan', !editing);
  setDisabled('undo', !editing || !entry?.history.length);
  setDisabled('delete', !editing || !selected);
  setDisabled('review', !entry);
  setDisabled('next', !entry || index >= entries.length - 1);
  setDisabled('export-one', !entry || busy);
  setDisabled('export-all', !entries.length || busy);
  setDisabled('fit', !entry);
  $('review').checked = entry?.checked ?? false;
  $('mask-count').textContent = entry ? `${entry.boxes.length} 处遮挡` : '';
  $('mode-hint').textContent = !entry ? '可以拖入多张截图，或直接粘贴剪贴板中的图片。'
    : !editing ? '检查遮挡范围，确认后标记为已检查。'
      : tool === 'draw' ? '在敏感信息上拖动鼠标，画出黑色遮挡框。' : '拖动遮挡框可移动，拖动四角可调整大小。';
  if (editing && tool === 'pan') $('mode-hint').textContent = '拖动画布查看放大后超出视野的区域。';
  if (!entry) return;
  if (source.getAttribute('src') !== entry.url) source.src = entry.url;
  layoutArtboard();
  if (editing) {
    renderMasks();
  } else if (previewEntry !== entry || previewBoxes !== entry.boxes) {
    drawFlattened(preview, entry);
    previewEntry = entry;
    previewBoxes = entry.boxes;
  }
}

function goTo(position, nextView = view) {
  if (!entries[position]) return;
  gesture = null;
  selected = null;
  zoom = null;
  index = position;
  view = nextView;
  stage.scrollTo(0, 0);
  renderRows();
  renderEditor();
  fileList.children[position]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function changeView(nextView) {
  if (!active()) return;
  gesture = null;
  view = nextView;
  if (view === 'preview') selected = null;
  renderEditor();
}

function editBoxes(boxes) {
  const entry = active();
  entry.history.push(entry.boxes);
  if (entry.history.length > 100) entry.history.shift();
  entry.boxes = boxes;
  entry.checked = false;
  renderRows();
  renderEditor();
}

function undo() {
  const entry = active();
  if (!entry?.history.length || view !== 'edit' || gesture) return;
  entry.boxes = entry.history.pop();
  entry.checked = false;
  selected = null;
  renderRows();
  renderEditor();
}

function deleteBox() {
  if (!selected || gesture || view !== 'edit') return;
  const remaining = active().boxes.filter((box) => box.id !== selected);
  selected = null;
  editBoxes(remaining);
}

function useTool(nextTool) {
  if (!active() || view !== 'edit') return;
  tool = nextTool;
  renderEditor();
}

function changeZoom(direction) {
  const entry = active();
  if (!entry || gesture) return;
  const current = zoom ?? fittedScale(entry);
  const inner = $('stage-inner').getBoundingClientRect();
  const area = artboard.getBoundingClientRect();
  const x = (stage.clientWidth / 2 + stage.scrollLeft - (area.left - inner.left)) / area.width;
  const y = (stage.clientHeight / 2 + stage.scrollTop - (area.top - inner.top)) / area.height;
  zoom = direction ? clamp(current * 1.25 ** direction, Math.min(0.05, fittedScale(entry)), 8) : null;
  layoutArtboard();
  const adjusted = artboard.getBoundingClientRect();
  const currentInner = $('stage-inner').getBoundingClientRect();
  stage.scrollTo(adjusted.left - currentInner.left + x * adjusted.width - stage.clientWidth / 2,
    adjusted.top - currentInner.top + y * adjusted.height - stage.clientHeight / 2);
}

function point(event, entry) {
  const bounds = artboard.getBoundingClientRect();
  return { x: (event.clientX - bounds.left) * entry.width / bounds.width,
    y: (event.clientY - bounds.top) * entry.height / bounds.height };
}

artboard.addEventListener('pointerdown', (event) => {
  const entry = active();
  if (!entry || view !== 'edit' || event.button !== 0 || gesture) return;
  if (tool === 'pan') {
    if (event.pointerType === 'touch') return;
    gesture = { mode: 'pan', pointer: event.pointerId, screenX: event.clientX, screenY: event.clientY,
      left: stage.scrollLeft, top: stage.scrollTop };
    artboard.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  const start = point(event, entry);
  const mask = event.target.closest('.mask');
  const handle = event.target.dataset.handle;
  const original = mask && entry.boxes.find((box) => box.id === mask.dataset.id);
  if (original && (tool === 'select' || handle)) {
    selected = original.id;
    gesture = { mode: handle ? 'resize' : 'move', id: original.id, original, handle, start, pointer: event.pointerId };
  } else {
    selected = null;
    if (tool === 'draw') {
      gesture = { mode: 'draw', id: crypto.randomUUID(), start, screenX: event.clientX, screenY: event.clientY, pointer: event.pointerId };
    }
  }
  artboard.focus({ preventScroll: true });
  event.preventDefault();
  if (gesture) artboard.setPointerCapture(event.pointerId);
  renderEditor();
});

function updateGesture(event) {
  if (gesture?.pointer !== event.pointerId) return;
  const entry = active();
  const end = point(event, entry);
  const dx = end.x - gesture.start.x;
  const dy = end.y - gesture.start.y;
  if (gesture.mode === 'draw') {
    const box = pixelBounds(gesture.start, end, entry);
    const dragged = Math.hypot(event.clientX - gesture.screenX, event.clientY - gesture.screenY) >= 3;
    gesture.draft = dragged && box.width && box.height ? { ...box, id: gesture.id } : null;
  } else {
    gesture.draft = gesture.mode === 'move' ? moveBox(gesture.original, dx, dy, entry)
      : resizeBox(gesture.original, gesture.handle, dx, dy, entry);
  }
}

artboard.addEventListener('pointermove', (event) => {
  if (gesture?.pointer !== event.pointerId) return;
  if (gesture.mode === 'pan') {
    stage.scrollTo(gesture.left + gesture.screenX - event.clientX, gesture.top + gesture.screenY - event.clientY);
    return;
  }
  updateGesture(event);
  renderMasks();
});

artboard.addEventListener('pointerup', (event) => {
  if (gesture?.pointer !== event.pointerId) return;
  if (gesture.mode === 'pan') {
    gesture = null;
    return;
  }
  updateGesture(event);
  const { draft, original, id, mode } = gesture;
  gesture = null;
  if (draft && (!original || ['x', 'y', 'width', 'height'].some((key) => draft[key] !== original[key]))) {
    selected = id;
    if (mode === 'draw') tool = 'select';
    editBoxes(original ? active().boxes.map((box) => box.id === id ? draft : box) : [...active().boxes, draft]);
  } else {
    renderEditor();
  }
});

for (const eventName of ['pointercancel', 'lostpointercapture']) {
  artboard.addEventListener(eventName, (event) => {
    if (gesture?.pointer !== event.pointerId) return;
    gesture = null;
    renderEditor();
  });
}

function enqueue(task) {
  queue = queue.then(task).catch(() => announce('无法导入截图，请重试。'));
}

function addFiles(files) {
  if (!files.length) return;
  enqueue(async () => {
    const imported = [];
    let failures = 0;
    let animated = false;
    for (const file of files) {
      try {
        imported.push(makeEntry(file.name, await loadFile(file)));
      } catch (error) {
        failures++;
        animated ||= error.message === '暂不支持动态 PNG';
      }
    }
    if (imported.length) {
      if (entries.every((entry) => entry.demo)) entries = [];
      const firstNew = entries.length;
      entries.push(...imported);
      tool = 'draw';
      goTo(firstNew, 'edit');
    }
    if (failures) announce(`${failures} 张图片无法导入。${animated ? '暂不支持动态 PNG。' : '请使用有效的 PNG 或 JPG 文件。'}`);
    else announce(`已导入 ${imported.length} 张截图`);
  });
}

function addSamples() {
  enqueue(async () => {
    if (entries.length) return;
    const demo = await Promise.all(samples.map(async ([filename, label, boxes]) => {
      const url = new URL(`./samples/${filename}`, import.meta.url).href;
      return makeEntry(label, { url, image: await loadImage(url) }, true, boxes);
    }));
    const position = entries.length;
    entries.push(...demo);
    goTo(position, 'edit');
  });
}

function requestExport(batch) {
  if (busy || !active()) return;
  const targets = batch ? [...entries] : [active()];
  const filename = batch ? 'screenshots-redacted.zip' : outputName(index, entries.length);
  const missing = targets.filter((entry) => !entry.checked);
  if (!missing.length) {
    runExport({ targets, batch, filename });
    return;
  }
  $('dialog-note').textContent = `${missing.length} 张截图还没有标记为已检查。`;
  $('unchecked-list').replaceChildren(...missing.map((entry) => {
    const row = document.createElement('li');
    row.textContent = entry.name;
    return row;
  }));
  pendingExport = { targets, batch, filename, firstUnchecked: missing[0] };
  dialog.showModal();
  $('start-review').focus();
}

async function runExport({ targets, batch, filename }) {
  busy = true;
  renderEditor();
  try {
    // Edits replace the boxes array, so the export stays tied to the reviewed snapshot.
    await exportImages(targets.map((entry) => ({ ...entry })), batch, filename,
      (current, total) => announce(`正在导出 ${current} / ${total}`));
    announce(batch ? `已导出 ${targets.length} 张截图` : `已导出 ${filename}`);
  } catch {
    announce('导出失败。请重试，或先单独导出较大的截图。');
  } finally {
    busy = false;
    renderEditor();
  }
}

for (const id of ['import', 'drop-button', 'empty-import']) $(id).onclick = () => $('file-input').click();
$('file-input').onchange = (event) => {
  addFiles(Array.from(event.target.files));
  event.target.value = '';
};
$('samples').onclick = addSamples;
$('edit').onclick = () => changeView('edit');
$('preview-button').onclick = () => changeView('preview');
$('draw').onclick = () => useTool('draw');
$('select').onclick = () => useTool('select');
$('pan').onclick = () => useTool('pan');
$('undo').onclick = undo;
$('delete').onclick = deleteBox;
$('zoom-in').onclick = () => changeZoom(1);
$('zoom-out').onclick = () => changeZoom(-1);
$('fit').onclick = () => changeZoom(0);
$('review').onchange = (event) => {
  active().checked = event.target.checked;
  renderRows();
};
$('next').onclick = () => goTo(index + 1);
$('export-one').onclick = () => requestExport(false);
$('export-all').onclick = () => requestExport(true);
$('close-dialog').onclick = () => dialog.close();
dialog.addEventListener('close', () => { pendingExport = null; });
$('start-review').onclick = () => {
  const position = entries.indexOf(pendingExport.firstUnchecked);
  dialog.close();
  goTo(position, 'preview');
  $('review').focus({ preventScroll: true });
};
$('force-export').onclick = () => {
  const job = pendingExport;
  dialog.close();
  runExport(job);
};

document.addEventListener('paste', (event) => {
  if (dialog.open) return;
  const files = Array.from(event.clipboardData?.files ?? []);
  if (!files.length) return;
  event.preventDefault();
  addFiles(files);
});

const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
document.addEventListener('dragenter', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  if (!dialog.open) {
    dragDepth++;
    $('drop-overlay').hidden = false;
  }
});
document.addEventListener('dragover', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = dialog.open ? 'none' : 'copy';
});
document.addEventListener('dragleave', (event) => {
  if (!hasFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('drop-overlay').hidden = true;
});
document.addEventListener('drop', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  $('drop-overlay').hidden = true;
  if (!dialog.open) addFiles(Array.from(event.dataTransfer.files));
});

document.addEventListener('keydown', (event) => {
  if (dialog.open || !active() || view !== 'edit' || gesture) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === 'z') {
    event.preventDefault();
    undo();
  } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
    if (key === 'delete' || key === 'backspace') {
      if (selected) event.preventDefault();
      deleteBox();
    } else if (key === 'r' || key === 'v' || key === 'h') {
      useTool({ r: 'draw', v: 'select', h: 'pan' }[key]);
    } else if (selected && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
      event.preventDefault();
      const delta = event.shiftKey ? 10 : 1;
      const [dx, dy] = { arrowleft: [-delta, 0], arrowright: [delta, 0], arrowup: [0, -delta], arrowdown: [0, delta] }[key];
      const entry = active();
      const box = entry.boxes.find((item) => item.id === selected);
      const moved = moveBox(box, dx, dy, entry);
      if (moved.x !== box.x || moved.y !== box.y) editBoxes(entry.boxes.map((item) => item === box ? moved : item));
    }
  }
});

new ResizeObserver(() => { if (!gesture) layoutArtboard(); }).observe(stage);
renderRows();
renderEditor();
addSamples();
