const form = document.querySelector('#download-form');
const urlInput = document.querySelector('#url-input');
const inputWrap = document.querySelector('#url-input-wrap');
const pasteButton = document.querySelector('#paste-button');
const submitButton = document.querySelector('#submit-button');
const errorMessage = document.querySelector('#error-message');
const errorText = document.querySelector('#error-text');
const resultPanel = document.querySelector('#result-panel');
const resultTitle = document.querySelector('#result-title');
const resultMeta = document.querySelector('#result-meta');
const resultCaption = document.querySelector('#result-caption');
const mediaGrid = document.querySelector('#media-grid');
const clearResult = document.querySelector('#clear-result');
const downloadAll = document.querySelector('#download-all');
const historyList = document.querySelector('#history-list');
const clearHistory = document.querySelector('#clear-history');
const toast = document.querySelector('#toast');
const toastText = document.querySelector('#toast-text');

const HISTORY_KEY = 'snapp-recent-links';
let currentMedia = [];
let toastTimer;

function isInstagramUrl(value) {
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase();
    const validHost = host === 'instagram.com' || host === 'www.instagram.com' || host === 'm.instagram.com';
    const parts = parsed.pathname.split('/').filter(Boolean);
    const kind = parts[0] === 'share' ? parts[1] : parts[0];
    return validHost && ['p', 'reel', 'reels', 'tv'].includes(kind) && parts.length >= (parts[0] === 'share' ? 3 : 2);
  } catch {
    return false;
  }
}

function setLoading(loading) {
  submitButton.disabled = loading;
  submitButton.classList.toggle('loading', loading);
  urlInput.disabled = loading;
  pasteButton.disabled = loading;
}

function showError(message) {
  errorText.textContent = message;
  errorMessage.hidden = false;
  inputWrap.classList.add('invalid');
}

function clearError() {
  errorMessage.hidden = true;
  inputWrap.classList.remove('invalid');
}

function showToast(message, isError = false) {
  toastText.textContent = message;
  toast.querySelector('.toast-icon').textContent = isError ? '!' : '✓';
  toast.querySelector('.toast-icon').style.background = isError ? '#e96d7f' : '';
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2800);
}

function formatKind(kind, count) {
  if (count > 1) return `${count} files · carousel`;
  if (kind === 'reel') return 'Reel · MP4 or image';
  if (kind === 'tv') return 'Video · public link';
  return 'Post · public media';
}

function iconMarkup(name) {
  if (name === 'download') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></svg>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></svg>';
}

function renderMediaCard(item, index, total) {
  const card = document.createElement('article');
  card.className = 'media-card';

  const preview = document.createElement('div');
  preview.className = 'media-preview';
  const kind = document.createElement('span');
  kind.className = 'media-kind';
  kind.textContent = item.type === 'video' ? 'Video' : 'Photo';

  if (item.type === 'video') {
    const video = document.createElement('video');
    video.src = item.previewUrl;
    video.poster = item.thumbnailUrl || '';
    video.controls = true;
    video.preload = 'metadata';
    video.playsInline = true;
    video.setAttribute('aria-label', `Preview video ${index + 1}`);
    preview.append(video, kind);
  } else {
    const image = document.createElement('img');
    image.src = item.previewUrl;
    image.alt = `Instagram photo ${index + 1}`;
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      image.style.display = 'none';
      preview.classList.add('preview-unavailable');
      const fallback = document.createElement('span');
      fallback.textContent = 'Preview unavailable';
      fallback.style.cssText = 'color:#8f899b;font-size:11px;position:absolute;inset:0;display:grid;place-items:center;';
      preview.prepend(fallback);
    }, { once: true });
    preview.append(image, kind);
  }

  const footer = document.createElement('div');
  footer.className = 'media-footer';
  const label = document.createElement('span');
  label.className = 'media-label';
  label.textContent = total > 1 ? `File ${index + 1} of ${total}` : item.filename;
  label.title = item.filename;
  const download = document.createElement('a');
  download.className = 'media-download';
  download.href = item.downloadUrl;
  download.setAttribute('download', item.filename);
  download.setAttribute('aria-label', `Download ${item.type} ${index + 1}`);
  download.innerHTML = iconMarkup('download');
  footer.append(label, download);
  card.append(preview, footer);
  return card;
}

function renderResult(data) {
  currentMedia = Array.isArray(data.media) ? data.media : [];
  resultTitle.textContent = data.title || 'Instagram media';
  resultMeta.textContent = [data.author, formatKind(data.kind, currentMedia.length)].filter(Boolean).join(' · ');
  resultCaption.textContent = data.description || '';
  resultCaption.hidden = !data.description;
  mediaGrid.replaceChildren();
  currentMedia.forEach((item, index) => mediaGrid.append(renderMediaCard(item, index, currentMedia.length)));
  downloadAll.hidden = currentMedia.length < 2;
  resultPanel.hidden = false;
  resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  saveToHistory(data);
}

function clearResultPanel() {
  currentMedia = [];
  resultPanel.hidden = true;
  mediaGrid.replaceChildren();
}

function readHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function saveToHistory(data) {
  const history = readHistory().filter((item) => item.url !== data.sourceUrl);
  history.unshift({
    url: data.sourceUrl,
    title: data.title,
    kind: data.kind,
    count: data.media?.length || 0,
    at: Date.now()
  });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 6)));
  renderHistory();
}

function relativeTime(timestamp) {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function renderHistory() {
  const history = readHistory();
  clearHistory.hidden = history.length === 0;
  if (!history.length) {
    historyList.innerHTML = '<div class="empty-history"><span class="empty-icon">⌁</span><div><strong>Your recent links will show up here.</strong><p>History stays in this browser and never leaves your device.</p></div></div>';
    return;
  }
  historyList.replaceChildren();
  history.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'history-item';
    const info = document.createElement('div');
    info.className = 'history-info';
    const symbol = document.createElement('span');
    symbol.className = 'history-symbol';
    symbol.textContent = item.kind === 'reel' ? '▶' : '◫';
    const text = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'history-name';
    name.textContent = item.title || 'Instagram media';
    const url = document.createElement('div');
    url.className = 'history-url';
    url.textContent = item.url;
    text.append(name, url);
    info.append(symbol, text);
    const time = document.createElement('span');
    time.className = 'history-time';
    time.textContent = relativeTime(item.at);
    row.append(info, time);
    row.addEventListener('click', () => {
      urlInput.value = item.url;
      urlInput.focus();
      document.querySelector('#download')?.scrollIntoView({ behavior: 'smooth' });
    });
    row.style.cursor = 'pointer';
    historyList.append(row);
  });
}

async function submitUrl(url) {
  clearError();
  if (!isInstagramUrl(url)) {
    showError('Paste a valid public Instagram post, Reel, or video link.');
    urlInput.focus();
    return;
  }

  setLoading(true);
  clearResultPanel();
  try {
    const response = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to fetch that Instagram link.');
    renderResult(data);
  } catch (error) {
    showError(error.message || 'Something went wrong. Please try again.');
  } finally {
    setLoading(false);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitUrl(urlInput.value.trim());
});

urlInput.addEventListener('input', clearError);

pasteButton.addEventListener('click', async () => {
  try {
    const clipboardText = await navigator.clipboard.readText();
    if (!clipboardText) throw new Error('empty');
    urlInput.value = clipboardText.trim();
    clearError();
    urlInput.focus();
    showToast('Link pasted');
  } catch {
    urlInput.focus();
    showToast('Paste the link into the field', true);
  }
});

inputWrap.addEventListener('dragover', (event) => {
  event.preventDefault();
  inputWrap.style.borderColor = '#a984ed';
});
inputWrap.addEventListener('dragleave', () => { inputWrap.style.borderColor = ''; });
inputWrap.addEventListener('drop', (event) => {
  event.preventDefault();
  inputWrap.style.borderColor = '';
  const droppedText = event.dataTransfer?.getData('text').trim();
  if (droppedText) {
    urlInput.value = droppedText;
    clearError();
    urlInput.focus();
  }
});

clearResult.addEventListener('click', clearResultPanel);

downloadAll.addEventListener('click', () => {
  currentMedia.forEach((item, index) => {
    window.setTimeout(() => {
      const link = document.createElement('a');
      link.href = item.downloadUrl;
      link.download = item.filename;
      document.body.append(link);
      link.click();
      link.remove();
    }, index * 400);
  });
  showToast(`Saving ${currentMedia.length} files`);
});

clearHistory.addEventListener('click', () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  showToast('History cleared');
});

renderHistory();
setInterval(renderHistory, 60_000);
