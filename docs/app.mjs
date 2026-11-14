import './icons.mjs';
import { clamp, moveBox, outputName, pixelBounds, resizeBox } from './geometry.mjs';
import { drawFlattened, exportImages, loadFile, loadImage, maskColors, mosaicTile } from './images.mjs';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const artboard = $('artboard');
const fileList = $('file-list');
const masks = $('masks');
const preview = $('preview');
const source = $('source');
const dialog = $('export-dialog');
const batchDialog = $('batch-dialog');
const removeDialog = $('remove-dialog');
const historyDialog = $('history-dialog');
const hotkeysDialog = $('hotkeys-dialog');
const desktop = globalThis.chrome?.webview;
const corners = ['nw', 'ne', 'sw', 'se'];
const samples = [
  ['account.png', '01-账号信息.png', [
    { id: 'sample-email', x: 446, y: 403, width: 254, height: 28 },
    { id: 'sample-name', x: 378, y: 277, width: 102, height: 40 },
  ]],
  ['checkout.jpg', '02-付款页面.jpg', []],
  ['receipt.png', '03-付款记录.png', []],
  ['account-team.png', '04-账号信息.png', []],
  ['account-studio.png', '05-账号信息.png', []],
];

let entries = [];
let index = 0;
let tool = 'draw';
let maskStyle = 'black';
let view = 'edit';
let selected = null;
let zoom = null;
let gesture = null;
let spacePan = false;
let busy = false;
let importsPending = 0;
let queue = Promise.resolve();
let pendingExport = null;
let pendingBatch = null;
let lastBatch = null;
let toastTimer;
let dragDepth = 0;
let previewEntry = null;
let previewBoxes = null;

const active = () => entries[index];
const setDisabled = (id, disabled) => { $(id).disabled = disabled; };
const openDialog = () => [dialog, batchDialog, removeDialog, historyDialog, hotkeysDialog].find((item) => item.open);
const sameSize = (first, second) => first.width === second.width && first.height === second.height;
const sameBox = (first, second) => (first.style ?? 'black') === (second.style ?? 'black') &&
  ['x', 'y', 'width', 'height'].every((key) => first[key] === second[key]);

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
    if (entry.boxes.length) state.append(` · ${entry.boxes.length} 处遮挡`);
    label.append(name, state);
    row.append(thumb, label);
    row.addEventListener('click', () => goTo(position));
    return row;
  });
  fileList.replaceChildren(...rows);
  if (focusedRow !== null) rows[Number(focusedRow)]?.focus({ preventScroll: true });
  $('file-count').textContent = entries.length;
  $('file-position').textContent = `第 ${index + 1} / ${entries.length} 张`;
  const reviewed = entries.filter((entry) => entry.checked).length;
  $('progress-text').textContent = `${reviewed} / ${entries.length}`;
  $('progress').max = Math.max(1, entries.length);
  $('progress').value = reviewed;
  $('progress').setAttribute('aria-valuenow', reviewed);
  renderReviewStart();
}

function renderReviewStart() {
  const button = $('review-workspace');
  button.hidden = !entries.length || view === 'preview';
  const complete = entries.every((entry) => entry.checked);
  button.disabled = importsPending > 0 || Boolean(gesture);
  button.lastChild.textContent = complete ? '查看成品' : '开始检查';
}

function fittedScale(entry) {
  const padding = parseFloat(getComputedStyle($('stage-inner')).paddingLeft) * 2;
  return Math.min(1, devicePixelRatio * Math.max(1, stage.clientWidth - padding - 1) / entry.width,
    devicePixelRatio * Math.max(1, stage.clientHeight - padding - 1) / entry.height);
}

function layoutArtboard() {
  const entry = active();
  if (!entry) return;
  const scale = zoom ?? fittedScale(entry);
  artboard.style.width = `${entry.width * scale / devicePixelRatio}px`;
  artboard.style.height = `${entry.height * scale / devicePixelRatio}px`;
  $('zoom-level').textContent = `${Math.round(scale * 100)}%`;
  $('actual-size').setAttribute('aria-pressed', String(zoom === 1));
  $('fit').setAttribute('aria-pressed', String(zoom === null));
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
  // Match the export's stacking while keeping file order for keyboard and batch operations.
  masks.replaceChildren(...boxes.map((box) => {
    const node = document.createElement('div');
    const draft = gesture?.mode === 'draw' && box === gesture.draft;
    const display = gesture?.id === box.id && gesture.draft ? gesture.draft : box;
    node.className = draft ? 'mask draft' : 'mask';
    node.dataset.id = box.id;
    positionMask(node, display, entry);
    if (display.style === 'mosaic') {
      node.classList.add('mosaic');
      node.append(mosaicTile(entry.image, display));
    } else {
      node.style.backgroundColor = maskColors[display.style] ?? maskColors.black;
    }
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

function positionMask(node, box, entry) {
  node.style.left = `${box.x / entry.width * 100}%`;
  node.style.top = `${box.y / entry.height * 100}%`;
  node.style.width = `${box.width / entry.width * 100}%`;
  node.style.height = `${box.height / entry.height * 100}%`;
}

function renderEditor() {
  const entry = active();
  const editing = Boolean(entry) && view === 'edit';
  const sameSizeCount = editing ? entries.filter((target) => target !== entry && sameSize(entry, target)).length : 0;
  $('active-name').textContent = entry?.name ?? '编辑区';
  $('active-detail').textContent = entry ? `${entry.width} × ${entry.height} px · ${entry.boxes.length} 处遮挡${entry.demo ? ' · 虚构示例' : ''}` : '';
  $('empty').hidden = Boolean(entry);
  $('stage-inner').hidden = !entry;
  $('toolbar').hidden = !entry;
  $('drawing-tools').hidden = !editing;
  $('editor-foot').hidden = !entry;
  $('file-actions').hidden = !entry;
  const organizingBlocked = !entry || importsPending > 0 || busy || Boolean(gesture);
  setDisabled('move-earlier', organizingBlocked || index === 0);
  setDisabled('move-later', organizingBlocked || index >= entries.length - 1);
  setDisabled('remove-file', organizingBlocked);
  $('edit').setAttribute('aria-pressed', editing);
  $('preview-button').setAttribute('aria-pressed', Boolean(entry) && !editing);
  $('draw').setAttribute('aria-pressed', editing && tool === 'draw');
  $('select').setAttribute('aria-pressed', editing && tool === 'select');
  $('pan').setAttribute('aria-pressed', editing && tool === 'pan');
  renderCanvasTool();
  preview.hidden = !entry || editing;
  source.hidden = !editing;
  masks.hidden = !editing;
  setDisabled('edit', !entry);
  setDisabled('preview-button', !entry);
  setDisabled('draw', !editing);
  setDisabled('mask-style', !editing || Boolean(gesture));
  $('mask-style').value = (entry?.boxes.find((box) => box.id === selected)?.style ?? (selected ? 'black' : maskStyle));
  setDisabled('select', !editing);
  setDisabled('pan', !editing);
  setDisabled('undo', !editing || !entry?.history.length);
  setDisabled('delete', !editing || !selected);
  const canCopy = editing && entry.boxes.length > 0 && sameSizeCount > 0;
  $('batch-bar').hidden = !canCopy && !lastBatch;
  $('copy-mask').hidden = !canCopy;
  $('undo-batch').hidden = !lastBatch;
  setDisabled('undo-batch', Boolean(gesture) || importsPending > 0);
  setDisabled('copy-mask', !canCopy || Boolean(gesture) || importsPending > 0);
  $('batch-hint').textContent = canCopy ? `${sameSizeCount} 张同尺寸截图` : lastBatch ? `上次应用到 ${lastBatch.length} 张` : '';
  setDisabled('review', !entry);
  setDisabled('previous', !entry || index === 0);
  setDisabled('next', !entry || index >= entries.length - 1);
  renderReviewControls();
  renderReviewStart();
  setDisabled('export-one', !entry || busy || importsPending > 0);
  setDisabled('export-all', !entries.length || busy || importsPending > 0);
  setDisabled('fit', !entry);
  setDisabled('actual-size', !entry);
  $('review').checked = entry?.checked ?? false;
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
  revealScreenshot(position);
}

function revealScreenshot(position) {
  const list = fileList.getBoundingClientRect();
  const row = fileList.children[position].getBoundingClientRect();
  fileList.scrollBy({
    left: row.left < list.left ? row.left - list.left : Math.max(0, row.right - list.left - fileList.clientWidth),
    top: row.top < list.top ? row.top - list.top : Math.max(0, row.bottom - list.top - fileList.clientHeight),
  });
}

function changeView(nextView) {
  if (!active()) return;
  gesture = null;
  view = nextView;
  if (view === 'preview') selected = null;
  renderEditor();
}

function moveScreenshot(direction) {
  const entry = active();
  const next = index + direction;
  if (!entry || !entries[next] || busy || importsPending || gesture) return;
  entries[index] = entries[next];
  entries[next] = entry;
  index = next;
  renderRows();
  renderEditor();
  revealScreenshot(index);
  if (document.activeElement === document.body) fileList.children[index].focus({ preventScroll: true });
}

function removeScreenshot() {
  const entry = active();
  if (!entry || busy || importsPending || gesture) return;
  entries.splice(index, 1);
  if (!entry.demo) URL.revokeObjectURL(entry.url);
  if (previewEntry === entry) {
    previewEntry = previewBoxes = null;
    preview.width = preview.height = 0;
  }
  if (lastBatch) {
    lastBatch = lastBatch.filter(({ target }) => target !== entry);
    if (!lastBatch.length) lastBatch = null;
  }
  if (entries.length) {
    goTo(Math.min(index, entries.length - 1));
    fileList.children[index].focus({ preventScroll: true });
  } else {
    index = 0;
    view = 'edit';
    tool = 'draw';
    selected = zoom = null;
    source.removeAttribute('src');
    masks.replaceChildren();
    renderRows();
    renderEditor();
    $('empty-import').focus({ preventScroll: true });
  }
  announce(`已从列表移除 ${entry.name}`);
}

function replaceBoxes(entry, boxes) {
  entry.history.push(entry.boxes);
  if (entry.history.length > 100) entry.history.shift();
  entry.boxes = boxes;
  entry.checked = false;
}

function editBoxes(boxes) {
  replaceBoxes(active(), boxes);
  renderRows();
  renderEditor();
}

function renderReviewControls() {
  const entry = active();
  const next = $('confirm-next');
  next.hidden = !entry || view !== 'preview';
  if (next.hidden) return;
  $('confirm-next-label').textContent = entry.checked ? '下一张待检查' : '确认并继续';
  next.title = `${$('confirm-next-label').textContent} (E)`;
  next.disabled = entry.checked && entries.every((target) => target.checked);
}

function confirmAndContinue() {
  active().checked = true;
  const next = entries.findIndex((target, position) => position > index && !target.checked);
  const position = next >= 0 ? next : entries.findIndex((target) => !target.checked);
  if (position >= 0) {
    goTo(position, 'preview');
  } else {
    renderRows();
    renderEditor();
    announce('已检查全部截图，可以导出 ZIP。');
    $('export-all').focus({ preventScroll: true });
  }
}

function renderBatchSelection() {
  const chosenMasks = [];
  for (const { box, input, overlay, marker } of pendingBatch.masks) {
    overlay.classList.toggle('unselected', !input.checked);
    marker.classList.toggle('unselected', !input.checked);
    if (input.checked && !chosenMasks.some((item) => sameBox(item, box))) chosenMasks.push(box);
  }
  for (const item of pendingBatch.targets) {
    const { target, input, caption, sizeMatches } = item;
    item.missing = sizeMatches ? chosenMasks.filter((box) => !target.boxes.some((existing) => sameBox(existing, box))) : [];
    input.disabled = !item.missing.length;
    const status = !sizeMatches ? '尺寸不同' : !chosenMasks.length ? '请先选择遮挡框'
      : !item.missing.length ? '已有相同遮挡框' : `将添加 ${item.missing.length} 个遮挡框`;
    caption.textContent = `${target.width} × ${target.height} px · ${status}`;
  }
  const available = pendingBatch.targets.filter(({ input }) => !input.disabled);
  const count = available.filter(({ input }) => input.checked).length;
  const all = $('batch-select-all');
  all.disabled = !available.length;
  all.checked = Boolean(count) && count === available.length;
  all.indeterminate = count > 0 && count < available.length;
  $('batch-count').textContent = `已选 ${count} / ${available.length} 张`;
  $('apply-batch').textContent = `应用到 ${count} 张`;
  setDisabled('apply-batch', !count);
}

function renderBatchMasks(entry) {
  const list = $('batch-masks');
  const map = $('batch-mask-map');
  const thumb = document.createElement('img');
  thumb.src = entry.url;
  thumb.alt = '';
  map.style.width = `min(100%, ${entry.width / entry.height * 138}px)`;
  map.replaceChildren(thumb);
  list.replaceChildren();
  return entry.boxes.map((box, position) => {
    const row = document.createElement('li');
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.addEventListener('change', renderBatchSelection);
    const name = document.createElement('span');
    name.textContent = `遮挡框 ${position + 1}`;
    const size = document.createElement('small');
    size.textContent = `${box.width} × ${box.height} px`;
    label.append(input, name, size);
    row.append(label);
    list.append(row);

    const overlay = document.createElement('span');
    overlay.className = 'batch-mask-overlay';
    positionMask(overlay, box, entry);
    overlay.style.backgroundColor = maskColors[box.style] ?? maskColors.black;
    const marker = document.createElement('span');
    marker.className = 'mask-marker';
    marker.textContent = position + 1;
    marker.style.left = `min(${box.x / entry.width * 100}%, calc(100% - 17px))`;
    marker.style.top = `min(${box.y / entry.height * 100}%, calc(100% - 17px))`;
    map.append(overlay, marker);
    return { box, input, overlay, marker };
  });
}

function openBatchPicker() {
  const entry = active();
  if (!entry?.boxes.length || view !== 'edit' || gesture || importsPending) return;
  $('batch-source').textContent = `来自 ${entry.name} · ${entry.width} × ${entry.height} px`;
  const list = $('batch-targets');
  list.replaceChildren();
  const targets = entries.filter((target) => target !== entry).map((target) => {
    const row = document.createElement('li');
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    const sizeMatches = sameSize(entry, target);
    input.addEventListener('change', renderBatchSelection);
    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.alt = '';
    thumb.src = target.url;
    const details = document.createElement('span');
    details.className = 'file-label';
    const name = document.createElement('strong');
    name.className = 'file-name';
    name.textContent = target.name;
    name.title = target.name;
    const caption = document.createElement('small');
    details.append(name, caption);
    label.append(input, thumb, details);
    row.append(label);
    list.append(row);
    return { target, input, caption, sizeMatches };
  });
  pendingBatch = { masks: renderBatchMasks(entry), targets };
  renderBatchSelection();
  batchDialog.showModal();
  $('close-batch').focus({ preventScroll: true });
}

function applyBatch() {
  const chosen = pendingBatch.targets.filter(({ input }) => input.checked && !input.disabled);
  if (!chosen.length) return;
  lastBatch = chosen.map(({ target, missing }) => {
    const copies = missing.map((box) => ({ ...box, id: crypto.randomUUID() }));
    replaceBoxes(target, [...target.boxes, ...copies]);
    return { target, ids: new Set(copies.map((box) => box.id)) };
  });
  batchDialog.close();
  renderRows();
  renderEditor();
  announce(`已应用到 ${chosen.length} 张截图，请逐张预览检查。`);
}

function undoBatch() {
  if (!lastBatch || gesture || importsPending) return;
  let changed = 0;
  for (const { target, ids } of lastBatch) {
    const withoutCopies = (boxes) => boxes.some((box) => ids.has(box.id))
      ? boxes.filter((box) => !ids.has(box.id)) : boxes;
    const remaining = withoutCopies(target.boxes);
    // Strip the copied boxes from later undo snapshots so they cannot reappear.
    target.history = target.history.map(withoutCopies).filter((boxes, position, history) => {
      const after = history[position + 1] ?? remaining;
      return boxes.length !== after.length || boxes.some((box, index) => box.id !== after[index].id || !sameBox(box, after[index]));
    });
    if (target.boxes === remaining) continue;
    target.boxes = remaining;
    target.checked = false;
    if (target === active() && ids.has(selected)) selected = null;
    changed++;
  }
  lastBatch = null;
  renderRows();
  renderEditor();
  announce(changed ? `已撤销 ${changed} 张截图上的批量遮挡，请重新检查。` : '已撤销最近一次批量应用。');
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
  if (tool === 'draw') selected = null;
  renderEditor();
}

function changeZoom(mode, pointer) {
  const entry = active();
  if (!entry || gesture) return;
  const current = zoom ?? fittedScale(entry);
  const frame = stage.getBoundingClientRect();
  const anchorX = pointer?.clientX ?? frame.left + stage.clientWidth / 2;
  const anchorY = pointer?.clientY ?? frame.top + stage.clientHeight / 2;
  const area = artboard.getBoundingClientRect();
  const x = (anchorX - area.left) / area.width;
  const y = (anchorY - area.top) / area.height;
  zoom = mode === 'fit' ? null : mode === 'original' ? 1
    : clamp(current * 1.25 ** mode, Math.min(0.05, fittedScale(entry)), 8);
  layoutArtboard();
  const adjusted = artboard.getBoundingClientRect();
  stage.scrollTo(stage.scrollLeft + adjusted.left + x * adjusted.width - anchorX,
    stage.scrollTop + adjusted.top + y * adjusted.height - anchorY);
}

stage.addEventListener('wheel', (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  if (openDialog() || !event.deltaY) return;
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
  changeZoom(clamp(-pixels / 100, -6, 6), event);
}, { passive: false });

function renderCanvasTool() {
  artboard.dataset.tool = spacePan || gesture?.mode === 'pan' ? 'pan' : view === 'edit' ? tool : 'preview';
  stage.classList.toggle('panning', spacePan || gesture?.mode === 'pan');
}

function stopSpacePan() {
  spacePan = false;
  renderCanvasTool();
}

function point(event, entry) {
  const bounds = artboard.getBoundingClientRect();
  return { x: (event.clientX - bounds.left) * entry.width / bounds.width,
    y: (event.clientY - bounds.top) * entry.height / bounds.height };
}

stage.addEventListener('pointerdown', (event) => {
  const entry = active();
  if (!entry || event.button !== 0 || gesture) return;
  if (spacePan || (view === 'edit' && tool === 'pan')) {
    if (event.pointerType === 'touch') return;
    gesture = { mode: 'pan', pointer: event.pointerId, screenX: event.clientX, screenY: event.clientY,
      left: stage.scrollLeft, top: stage.scrollTop };
    artboard.setPointerCapture(event.pointerId);
    renderCanvasTool();
    event.preventDefault();
    return;
  }
  if (view !== 'edit' || !artboard.contains(event.target)) return;
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
    gesture.draft = dragged && box.width && box.height ? { ...box, id: gesture.id, style: maskStyle } : null;
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
    renderCanvasTool();
    return;
  }
  updateGesture(event);
  const { draft, original, id, mode } = gesture;
  gesture = null;
  if (draft && (!original || !sameBox(draft, original))) {
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
  importsPending++;
  renderEditor();
  announce(`正在读取 ${files.length} 张截图…`);
  enqueue(async () => {
    const imported = [];
    const failures = [];
    for (const file of files) {
      try {
        imported.push(makeEntry(file.name, await loadFile(file)));
      } catch (error) {
        failures.push({ name: file.name, reason: error instanceof Error ? error.message : '无法读取图片' });
      }
    }
    if (imported.length) {
      const modal = openDialog();
      if (modal) await new Promise((resolve) => modal.addEventListener('close', resolve, { once: true }));
      if (entries.every((entry) => entry.demo)) {
        entries = [];
        lastBatch = null;
      }
      const firstNew = entries.length;
      entries.push(...imported);
      tool = 'draw';
      goTo(firstNew, 'edit');
    }
    showImportFailures(failures);
    if (imported.length) announce(`已导入 ${imported.length} 张截图`);
    else $('toast').hidden = true;
  });
  queue = queue.finally(() => {
    importsPending--;
    renderEditor();
  });
}

function showImportFailures(failures) {
  $('import-errors').hidden = !failures.length;
  $('import-summary').textContent = `${failures.length} 张图片无法导入`;
  $('import-failures').replaceChildren(...failures.map(({ name, reason }) => {
    const row = document.createElement('li');
    const file = document.createElement('strong');
    const error = document.createElement('span');
    file.textContent = name;
    error.textContent = reason;
    row.append(file, error);
    return row;
  }));
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
    selected = active().boxes[0]?.id ?? null;
    if (selected) useTool('select');
  });
}

function requestExport(batch) {
  if (busy || importsPending || !active()) return;
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
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'unchecked-image';
    button.textContent = entry.name;
    button.setAttribute('aria-label', entry.name);
    button.onclick = () => {
      dialog.close();
      reviewScreenshot(entry);
    };
    row.append(button);
    return row;
  }));
  pendingExport = { targets, batch, filename, firstUnchecked: missing[0] };
  dialog.showModal();
  $('start-review').focus();
}

function reviewScreenshot(entry) {
  const position = entries.indexOf(entry);
  if (position < 0) return;
  if (position === index) changeView('preview');
  else goTo(position, 'preview');
  const action = $('confirm-next').disabled ? $('preview-button') : $('confirm-next');
  action.focus({ preventScroll: true });
  action.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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

for (const id of ['import', 'empty-import']) $(id).onclick = () => $('file-input').click();
$('dismiss-import-errors').onclick = () => {
  showImportFailures([]);
  $('import').focus({ preventScroll: true });
};
$('file-input').onchange = (event) => {
  addFiles(Array.from(event.target.files));
  event.target.value = '';
};
$('samples').onclick = addSamples;
$('edit').onclick = () => changeView('edit');
$('preview-button').onclick = () => changeView('preview');
$('draw').onclick = () => useTool('draw');
$('mask-style').onchange = (event) => {
  const style = event.target.value;
  maskStyle = style;
  const entry = active();
  const old = entry?.boxes.find((box) => box.id === selected);
  if (old && (old.style ?? 'black') !== style) {
    editBoxes(entry.boxes.map((box) => box === old ? { ...box, style } : box));
  }
  if (style === 'mosaic') announce('马赛克可能保留可辨认轮廓，敏感信息建议用纯色遮挡。');
};

const defaultHotkeys = ['6:120', '6:121'];
const hotkeyLabels = ['截屏', '截图剪贴板'];
const hotkeyInputs = [$('bind-capture'), $('bind-history')];
let savedHotkeys = defaultHotkeys;
let proposedHotkeys = defaultHotkeys.slice();
let recordingHotkey = -1;
let savingHotkeys = false;

function hotkeyText(binding) {
  const [modifiers, key] = binding.split(':').map(Number);
  return [modifiers & 2 && 'Ctrl', modifiers & 4 && 'Shift', modifiers & 1 && 'Alt',
    key >= 112 ? `F${key - 111}` : String.fromCharCode(key)].filter(Boolean).join(' + ');
}

function renderHotkeys() {
  hotkeyInputs.forEach((button, index) => {
    const recording = index === recordingHotkey;
    button.textContent = recording ? '请按组合键…' : hotkeyText(proposedHotkeys[index]);
    button.setAttribute('aria-label', `录入${hotkeyLabels[index]}快捷键（${button.textContent}）`);
    button.setAttribute('aria-pressed', recording);
    button.disabled = savingHotkeys;
  });
  setDisabled('save-hotkeys', savingHotkeys || recordingHotkey >= 0);
  setDisabled('reset-hotkeys', savingHotkeys);
  setDisabled('cancel-hotkeys', savingHotkeys);
}

function hotkeyStatus(message) {
  const status = $('hotkeys-status');
  status.textContent = message;
  status.hidden = !message;
}

function receiveHotkeys(data) {
  const saved = data.startsWith('saved-');
  const [, capture, history] = data.split('|');
  savedHotkeys = [capture, history];
  $('capture-screen').title = `区域截屏（${hotkeyText(capture)}）`;
  $('open-history').title = `截图剪贴板（${hotkeyText(history)}）`;
  if (!saved) return;
  savingHotkeys = false;
  if (hotkeysDialog.open) hotkeysDialog.close();
  announce('快捷键已保存');
}

if (desktop) {
  hotkeysDialog.addEventListener('cancel', (event) => { if (savingHotkeys) event.preventDefault(); });
  hotkeysDialog.addEventListener('close', () => { if (!hotkeysDialog.open) desktop.postMessage('finish-hotkeys'); });
  $('configure-hotkeys').onclick = () => {
    proposedHotkeys = savedHotkeys.slice();
    recordingHotkey = -1;
    hotkeyStatus('');
    renderHotkeys();
    hotkeysDialog.showModal();
    desktop.postMessage('configure-hotkeys');
  };
  hotkeyInputs.forEach((button, index) => {
    button.onclick = () => {
      recordingHotkey = index;
      hotkeyStatus('');
      renderHotkeys();
    };
    button.onblur = () => {
      if (recordingHotkey !== index) return;
      recordingHotkey = -1;
      renderHotkeys();
    };
    button.onkeydown = (event) => {
      if (recordingHotkey !== index || event.key === 'Tab') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        recordingHotkey = -1;
        hotkeyStatus('');
      } else if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(event.key)) return;
      else {
        const key = event.key.toUpperCase();
        const code = /^[A-Z0-9]$/.test(key) ? key.charCodeAt(0) : /^F(?:[1-9]|10|11)$/.test(key) ? 111 + Number(key.slice(1)) : 0;
        if (!code || (!event.ctrlKey && !event.altKey) || event.metaKey || event.getModifierState('AltGraph')) {
          hotkeyStatus('请按 Ctrl 或 Alt，再加字母、数字或 F1–F11。');
          return;
        }
        proposedHotkeys[index] = `${(event.ctrlKey ? 2 : 0) | (event.shiftKey ? 4 : 0) | (event.altKey ? 1 : 0)}:${code}`;
        recordingHotkey = -1;
        hotkeyStatus('');
      }
      renderHotkeys();
    };
  });
  $('reset-hotkeys').onclick = () => { proposedHotkeys = defaultHotkeys.slice(); hotkeyStatus(''); renderHotkeys(); };
  $('cancel-hotkeys').onclick = () => hotkeysDialog.close();
  $('save-hotkeys').onclick = () => {
    if (proposedHotkeys[0] === proposedHotkeys[1]) {
      hotkeyStatus('截屏与截图剪贴板需要使用不同的快捷键。');
      return;
    }
    savingHotkeys = true;
    hotkeyStatus('正在保存…');
    renderHotkeys();
    desktop.postMessage(`save-hotkeys|${proposedHotkeys.join('|')}`);
  };
  $('capture-tools').hidden = false;
  $('capture-screen').onclick = () => desktop.postMessage('capture');
  $('open-history').onclick = openCaptureHistory;
  historyDialog.addEventListener('close', () => { if (!historyDialog.open) historyLoad++; });
  $('close-history').onclick = () => historyDialog.close();
  $('import-captures').onclick = importCaptures;
  $('clear-captures').onclick = () => {
    $('confirm-clear-captures').hidden = false;
    $('cancel-clear-captures').focus();
  };
  $('cancel-clear-captures').onclick = () => {
    $('confirm-clear-captures').hidden = true;
    $('clear-captures').focus();
  };
  $('apply-clear-captures').onclick = () => {
    $('confirm-clear-captures').hidden = true;
    desktop.postMessage('clear-captures');
  };
  desktop.addEventListener('message', ({ data }) => {
    if (typeof data !== 'string') return;
    if (data.startsWith('hotkeys|') || data.startsWith('saved-hotkeys|')) receiveHotkeys(data);
    else if (data.startsWith('recorded-hotkey|')) {
      if (hotkeysDialog.open && recordingHotkey >= 0) {
        proposedHotkeys[recordingHotkey] = data.slice('recorded-hotkey|'.length);
        recordingHotkey = -1;
        hotkeyStatus('');
        renderHotkeys();
      }
    }
    else if (data.startsWith('hotkey-error|')) {
      savingHotkeys = false;
      renderHotkeys();
      if (hotkeysDialog.open) hotkeyStatus(data.slice('hotkey-error|'.length));
      else announce(data.slice('hotkey-error|'.length));
    } else if (data === 'history') openCaptureHistory();
    else if (data === 'captured') {
      announce('截图已存入剪贴板历史');
      if (historyDialog.open) loadCaptureHistory();
    } else if (data === 'history-cleared') {
      if (historyDialog.open) loadCaptureHistory();
    } else if (typeof data === 'string') {
      if (historyDialog.open) $('capture-status').textContent = data;
      else announce(data);
    }
  });
  desktop.postMessage('get-hotkeys');
}

let historyLoad = 0;
async function openCaptureHistory() {
  if (openDialog()) return;
  historyDialog.showModal();
  await loadCaptureHistory();
}

async function loadCaptureHistory() {
  const revision = ++historyLoad;
  const list = $('capture-list');
  list.replaceChildren();
  $('capture-status').textContent = '正在读取截图…';
  $('confirm-clear-captures').hidden = true;
  setDisabled('clear-captures', true);
  setDisabled('import-captures', true);
  try {
    const response = await fetch('./capture-history');
    if (!response.ok) throw new Error('无法读取截屏历史');
    const names = await response.json();
    if (revision !== historyLoad || !historyDialog.open) return;
    setDisabled('clear-captures', !names.length);
    $('capture-status').textContent = names.length ? '' : `还没有截图。按 ${hotkeyText(savedHotkeys[0])} 开始截屏。`;
    list.replaceChildren(...names.map((name) => {
      const row = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.value = name;
      check.onchange = () => setDisabled('import-captures', !list.querySelector(':checked'));
      const thumb = document.createElement('img');
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.src = `./capture/${name}`;
      const label = document.createElement('span');
      label.textContent = `${name.slice(4, 6)}-${name.slice(6, 8)} ${name.slice(9, 11)}:${name.slice(11, 13)}:${name.slice(13, 15)}`;
      row.append(check, thumb, label);
      return row;
    }));
  } catch (error) {
    if (revision === historyLoad) $('capture-status').textContent = '无法读取截屏历史。';
  }
}

async function importCaptures() {
  const revision = historyLoad;
  if ($('import-captures').disabled) return;
  const inputs = Array.from($('capture-list').querySelectorAll('input'));
  const names = inputs.filter((input) => input.checked).map((input) => input.value);
  setDisabled('import-captures', true);
  setDisabled('clear-captures', true);
  for (const input of inputs) input.disabled = true;
  try {
    const files = await Promise.all(names.map(async (name) => {
      const response = await fetch(`./capture/${name}`);
      if (!response.ok) throw new Error('截图已移出历史');
      const blob = await response.blob();
      return new File([blob], `截图-${name}`, { type: 'image/png' });
    }));
    if (historyDialog.open && revision === historyLoad) {
      historyDialog.close();
      addFiles(files);
    }
  } catch {
    if (!historyDialog.open || revision !== historyLoad) return;
    $('capture-status').textContent = '部分截图已移出历史，请重新打开后选择。';
    setDisabled('import-captures', false);
    setDisabled('clear-captures', false);
    for (const input of inputs) input.disabled = false;
  }
}
$('select').onclick = () => useTool('select');
$('pan').onclick = () => useTool('pan');
$('undo').onclick = undo;
$('delete').onclick = deleteBox;
$('zoom-in').onclick = () => changeZoom(1);
$('zoom-out').onclick = () => changeZoom(-1);
$('fit').onclick = () => changeZoom('fit');
$('actual-size').onclick = () => changeZoom('original');
$('review').onchange = (event) => {
  active().checked = event.target.checked;
  renderRows();
  renderReviewControls();
};
$('move-earlier').onclick = () => moveScreenshot(-1);
$('move-later').onclick = () => moveScreenshot(1);
$('remove-file').onclick = () => {
  const entry = active();
  if (entry.boxes.length || entry.history.length || entry.checked) {
    $('remove-note').textContent = `「${entry.name}」将从当前批次移除，该图的编辑和检查记录也会清除。`;
    removeDialog.showModal();
    $('cancel-remove').focus();
  } else {
    removeScreenshot();
  }
};
$('cancel-remove').onclick = () => removeDialog.close();
$('confirm-remove').onclick = () => {
  removeDialog.close();
  removeScreenshot();
};
$('review-workspace').onclick = () => reviewScreenshot(active().checked
  ? entries.find((entry) => !entry.checked) ?? active() : active());
$('previous').onclick = () => goTo(index - 1);
$('next').onclick = () => goTo(index + 1);
$('confirm-next').onclick = confirmAndContinue;
$('copy-mask').onclick = openBatchPicker;
$('undo-batch').onclick = undoBatch;
$('close-batch').onclick = $('cancel-batch').onclick = () => batchDialog.close();
batchDialog.addEventListener('close', () => {
  if (batchDialog.open) return;
  pendingBatch = null;
  for (const id of ['batch-mask-map', 'batch-masks', 'batch-targets']) $(id).replaceChildren();
});
$('batch-select-all').onchange = (event) => {
  for (const { input } of pendingBatch.targets) {
    if (!input.disabled) input.checked = event.target.checked;
  }
  renderBatchSelection();
};
$('apply-batch').onclick = applyBatch;
$('export-one').onclick = () => requestExport(false);
$('export-all').onclick = () => requestExport(true);
$('close-dialog').onclick = () => dialog.close();
dialog.addEventListener('close', () => { pendingExport = null; });
$('start-review').onclick = () => {
  const entry = pendingExport.firstUnchecked;
  dialog.close();
  reviewScreenshot(entry);
};
$('force-export').onclick = () => {
  const job = pendingExport;
  dialog.close();
  runExport(job);
};

document.addEventListener('paste', (event) => {
  if (openDialog()) return;
  const files = Array.from(event.clipboardData?.files ?? []);
  if (!files.length) return;
  event.preventDefault();
  addFiles(files);
});

const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
function clearDropFeedback() {
  dragDepth = 0;
  $('drop-overlay').hidden = true;
}
document.addEventListener('dragenter', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  if (!openDialog()) {
    dragDepth++;
    $('drop-overlay').hidden = false;
  }
});
document.addEventListener('dragover', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = openDialog() ? 'none' : 'copy';
  $('drop-overlay').hidden = Boolean(openDialog());
});
document.addEventListener('dragleave', (event) => {
  if (!hasFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('drop-overlay').hidden = true;
});
document.addEventListener('drop', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  clearDropFeedback();
  if (openDialog()) return;
  const files = Array.from(event.dataTransfer.files);
  if (files.length) addFiles(files);
  else announce('未收到图片文件，请从资源管理器拖入 PNG 或 JPG。');
});

window.addEventListener('blur', () => {
  stopSpacePan();
  clearDropFeedback();
});
document.addEventListener('keyup', (event) => {
  if (event.code === 'Space' && spacePan) {
    event.preventDefault();
    stopSpacePan();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && spacePan) {
    event.preventDefault();
    return;
  }
  if (event.defaultPrevented || event.isComposing || openDialog() || !active() || gesture) return;
  const key = event.key.toLowerCase();
  const plainKey = !event.ctrlKey && !event.metaKey && !event.altKey;
  if (plainKey && !event.shiftKey) {
    if (event.code === 'Space' && (stage.matches(':hover') || stage.contains(document.activeElement)) &&
        !event.target.closest('input, textarea, select, [contenteditable]')) {
      event.preventDefault();
      spacePan = true;
      renderCanvasTool();
      return;
    }
    if (key === '0') {
      event.preventDefault();
      changeZoom('original');
      return;
    }
    if (key === 'w' || key === 's') {
      event.preventDefault();
      (key === 'w' ? $('previous') : $('next')).click();
      return;
    }
    if (key === 'r') {
      event.preventDefault();
      tool = 'draw';
      selected = null;
      changeView('edit');
      return;
    }
    if (key === 'e' && view === 'preview') {
      event.preventDefault();
      if (!event.repeat) $('confirm-next').click();
      return;
    }
  }
  if (view !== 'edit') return;
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === 'z') {
    event.preventDefault();
    undo();
  } else if (plainKey && !event.target.closest('select')) {
    if (key === 'delete' || key === 'backspace') {
      if (selected) event.preventDefault();
      deleteBox();
    } else if (key === 'v' || key === 'h') {
      useTool(key === 'v' ? 'select' : 'pan');
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

function watchDisplayScale() {
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => {
    if (!gesture) layoutArtboard();
    watchDisplayScale();
  }, { once: true });
}

watchDisplayScale();
renderRows();
renderEditor();
