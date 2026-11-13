const paths = {
  shield: '<path d="M12 22s7-3 7-10V6l-7-3-7 3v6c0 7 7 10 7 10Z"/><path d="m9 12 2 2 4-4"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/>',
  upload: '<path d="M12 16V4M8 8l4-4 4 4M5 16v4h14v-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  box: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 10h8v4H8z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 4H6a2 2 0 0 0-2 2v10"/>',
  cursor: '<path d="m5 3 14 10-7 1-3 6L5 3Z"/>',
  hand: '<path d="M8 12V5a1.5 1.5 0 0 1 3 0v6-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v5-3a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.8l-3-4.7a1.7 1.7 0 0 1 2.7-2L8 13"/>',
  undo: '<path d="M9 5 4 10l5 5m-5-5h10a5 5 0 0 1 0 10h-3"/>',
  trash: '<path d="M5 7h14m-9 0V4h4v3m3 0-1 13H8L7 7m3 4v5m4-5v5"/>',
  expand: '<path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-4 3 3 4-5 5 5"/>',
};

for (const element of document.querySelectorAll('[data-icon]')) {
  element.insertAdjacentHTML('afterbegin', `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[element.dataset.icon]}</svg>`);
}
