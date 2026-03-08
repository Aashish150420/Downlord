/**
 * Video Downloader — frontend (vanilla JS)
 * Toasts, queue, global Ctrl+V, mobile bottom sheet
 */

(function () {
  const urlInput = document.getElementById('url-input');
  const pasteBtn = document.getElementById('paste-btn');
  const fetchBtn = document.getElementById('fetch-btn');
  const urlError = document.getElementById('url-error');
  const siteBadge = document.getElementById('site-badge');
  const previewCard = document.getElementById('preview-card');
  const previewThumbnail = document.getElementById('preview-thumbnail');
  const previewDuration = document.getElementById('preview-duration');
  const previewTitle = document.getElementById('preview-title');
  const previewUploader = document.getElementById('preview-uploader');
  const formatBtns = document.querySelectorAll('.format-btn');
  const qualityRow = document.getElementById('quality-row');
  const qualitySelect = document.getElementById('quality-select');
  const subtitlesLabel = document.getElementById('subtitles-label');
  const subtitlesCb = document.getElementById('subtitles-cb');
  const watermarkLabel = document.getElementById('watermark-label');
  const watermarkCb = document.getElementById('watermark-cb');
  const playlistLabel = document.getElementById('playlist-label');
  const playlistCb = document.getElementById('playlist-cb');
  const downloadBtn = document.getElementById('download-btn');
  const progressContainer = document.getElementById('progress-container');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  const progressStatus = document.getElementById('progress-status');
  const downloadLabelEl = document.querySelector('.download-label');
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  const historyList = document.getElementById('history-list');
  const historyEmpty = document.getElementById('history-empty');
  const clearHistoryBtn = document.getElementById('clear-history-btn');
  const themeToggle = document.getElementById('theme-toggle');
  const urlDropZone = document.getElementById('url-drop-zone');
  const batchModeCb = document.getElementById('batch-mode-cb');
  const urlBatchInput = document.getElementById('url-batch-input');
  const bitrateRow = document.getElementById('bitrate-row');
  const subtitleLangRow = document.getElementById('subtitle-lang-row');
  const subtitleLangsInput = document.getElementById('subtitle-langs-input');
  const filenameRow = document.getElementById('filename-row');
  const filenameTemplateInput = document.getElementById('filename-template-input');
  const embedSubsRow = document.getElementById('embed-subs-row');
  const embedSubsCb = document.getElementById('embed-subs-cb');
  const clipStartInput = document.getElementById('clip-start');
  const clipEndInput = document.getElementById('clip-end');
  const limitRateSelect = document.getElementById('limit-rate-select');
  const emptyHint = document.getElementById('empty-hint');
  const spotifyCandidatesSection = document.getElementById('spotify-candidates');
  const spotifyCandidateSelect = document.getElementById('spotify-candidate-select');
  const spotifyCustomUrlInput = document.getElementById('spotify-custom-url');
  const spotifyCustomRow = document.querySelector('.spotify-custom-row');
  const queueList = document.getElementById('queue-list');
  const queueEmpty = document.getElementById('queue-empty');
  const queueCountEl = document.getElementById('queue-count');
  const optionsToggleMobile = document.getElementById('options-toggle-mobile');
  const optionsSheetBackdrop = document.getElementById('options-sheet-backdrop');

  let currentInfo = null;
  let autoFetchTimer = null;
  let downloadQueue = [];
  let currentSpotifyCandidates = [];

  const URL_PATTERN = /(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|vm\.tiktok|twitter\.com|x\.com|facebook\.com|fb\.watch|fb\.com|soundcloud\.com|spotify\.com)\S+/gi;
  const isValidUrl = (s) => s && new RegExp(URL_PATTERN.source, 'i').test(s);

  /* ========== Toasts ========== */
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast' + (type === 'success' ? ' success' : type === 'error' ? ' error' : '');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-4px)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  /* ========== Global Ctrl+V ========== */
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      tryPasteFromClipboard().then(() => {
        const url = urlInput.value.trim();
        if (isValidUrl(url)) fetchInfo();
      });
    }
  });

  /* ========== Tab switching ========== */
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.tab + '-tab';
      tabs.forEach((t) => t.classList.remove('active'));
      tabContents.forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById(targetId);
      if (panel) panel.classList.add('active');
      if (tab.dataset.tab === 'history') loadHistory();
      if (tab.dataset.tab === 'queue') renderQueue();
    });
  });

  /* ========== Queue UI ========== */
  function updateQueueBadge() {
    const n = downloadQueue.filter((q) => q.status === 'downloading' || q.status === 'pending').length;
    if (!queueCountEl) return;
    if (n === 0) {
      queueCountEl.classList.add('hidden');
    } else {
      queueCountEl.textContent = n;
      queueCountEl.classList.remove('hidden');
    }
  }

  function renderQueue() {
    if (!queueList || !queueEmpty) return;
    queueEmpty.classList.toggle('hidden', downloadQueue.length > 0);
    queueList.innerHTML = '';
    downloadQueue.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'queue-item';
      const statusClass = item.status === 'done' ? 'done' : item.status === 'error' ? 'error' : item.status === 'downloading' ? 'downloading' : 'pending';
      const statusText = item.status === 'done' ? 'Done' : item.status === 'error' ? 'Failed' : item.status === 'downloading' ? 'Downloading' : 'Pending';
      const pct = item.percent != null ? item.percent : 0;
      li.innerHTML = `
        <span class="queue-item-status ${statusClass}">${statusText}</span>
        <span class="queue-item-title">${escapeHtml(item.title)}</span>
        ${item.status === 'downloading' || item.status === 'pending' ? `<div class="queue-item-progress"><div class="queue-item-progress-fill" style="width:${pct}%"></div></div>` : ''}
      `;
      queueList.appendChild(li);
    });
  }

  /* ========== Clipboard & paste ========== */
  async function tryPasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      const match = text.match(URL_PATTERN);
      if (match && urlInput.value.trim() === '') {
        urlInput.value = match[0];
        urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } catch (_) {}
  }

  pasteBtn.addEventListener('click', tryPasteFromClipboard);
  urlInput.addEventListener('focus', tryPasteFromClipboard);

  urlInput.addEventListener('input', () => {
    clearTimeout(autoFetchTimer);
    if (isValidUrl(urlInput.value.trim())) autoFetchTimer = setTimeout(fetchInfo, 800);
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fetchInfo();
    }
  });

  /* ========== Drag and drop ========== */
  urlDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    urlDropZone.classList.add('drag-over');
  });
  urlDropZone.addEventListener('dragleave', () => urlDropZone.classList.remove('drag-over'));
  urlDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    urlDropZone.classList.remove('drag-over');
    const text = e.dataTransfer?.getData('text');
    if (text) {
      const match = text.match(URL_PATTERN);
      if (match) {
        if (batchModeCb?.checked) {
          urlBatchInput.value = (urlBatchInput.value + '\n' + match[0]).trim();
        } else {
          urlInput.value = match[0];
          fetchInfo();
        }
      }
    }
  });

  /* ========== Batch mode ========== */
  batchModeCb?.addEventListener('change', () => {
    urlBatchInput.classList.toggle('hidden', !batchModeCb.checked);
    if (batchModeCb.checked) {
      urlInput.value = '';
      previewCard.classList.add('hidden');
      siteBadge.classList.add('hidden');
      currentInfo = null;
      downloadBtn.disabled = !urlBatchInput.value.trim();
    } else {
      downloadBtn.disabled = !currentInfo;
    }
  });

  urlBatchInput?.addEventListener('input', () => {
    if (batchModeCb?.checked) downloadBtn.disabled = !urlBatchInput.value.trim();
  });

  /* ========== Mobile options sheet ========== */
  function closeOptionsSheet() {
    document.body.classList.remove('options-sheet-open');
    if (optionsToggleMobile) optionsToggleMobile.textContent = 'Format & quality';
    if (optionsToggleMobile) optionsToggleMobile.setAttribute('aria-expanded', 'false');
  }

  optionsToggleMobile?.addEventListener('click', () => {
    const open = document.body.classList.toggle('options-sheet-open');
    optionsToggleMobile.textContent = open ? 'Close' : 'Format & quality';
    optionsToggleMobile.setAttribute('aria-expanded', open);
  });

  optionsSheetBackdrop?.addEventListener('click', closeOptionsSheet);

  /* ========== Theme ========== */
  const savedTheme = localStorage.getItem('theme') || 'dark';
  if (savedTheme === 'light') document.body.classList.add('light-theme');
  themeToggle?.addEventListener('click', () => {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    themeToggle.querySelector('.theme-icon').textContent = isLight ? '🌙' : '☀️';
  });
  if (themeToggle) themeToggle.querySelector('.theme-icon').textContent = savedTheme === 'light' ? '🌙' : '☀️';

  if (urlInput.value.trim() === '') tryPasteFromClipboard();

  /* ========== Fetch info ========== */
  function showError(msg) {
    urlError.textContent = msg || '';
  }

  async function fetchInfo() {
    const url = urlInput.value.trim();
    if (!url) {
      showError('Enter a URL to continue');
      return;
    }

    showError('');
    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Loading…';

    try {
      const res = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load video info');

      currentInfo = data;
      renderPreview(data);
      updateOptionsVisibility(data.site);
      emptyHint?.classList.add('hidden');
      downloadBtn.disabled = false;

      // Show approximate size if available
      if (data.approxSize) {
        const sizeMb = data.approxSize / (1024 * 1024);
        showToast(`Approx size: ~${sizeMb.toFixed(1)} MB`, 'info');
      }

      if (data.site === 'spotify') {
        loadSpotifyCandidates(url, data);
      } else if (spotifyCandidatesSection) {
        spotifyCandidatesSection.classList.add('hidden');
        currentSpotifyCandidates = [];
        if (spotifyCandidateSelect) {
          spotifyCandidateSelect.innerHTML = '<option value=\"\">Auto (best match)</option>';
        }
      }
    } catch (err) {
      showError(err.message);
      showToast(err.message, 'error');
      currentInfo = null;
      previewCard.classList.add('hidden');
      siteBadge.classList.add('hidden');
      emptyHint?.classList.remove('hidden');
      downloadBtn.disabled = true;
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.textContent = 'Fetch';
    }
  }

  fetchBtn.addEventListener('click', fetchInfo);

  /* ========== Preview ========== */
  function renderPreview(info) {
    previewCard.classList.remove('hidden');
    previewTitle.textContent = info.title || 'Unknown';
    previewUploader.textContent = info.uploader || '—';
    previewDuration.textContent = formatDuration(info.duration);

    if (info.thumbnail) {
      previewThumbnail.src = info.thumbnail;
      previewThumbnail.alt = info.title;
      previewThumbnail.onerror = () => {
        previewThumbnail.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" fill="%2321262d"><rect width="160" height="90"/></svg>';
      };
    } else {
      previewThumbnail.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" fill="%2321262d"><rect width="160" height="90"/></svg>';
    }

    siteBadge.textContent = formatSiteName(info.site);
    siteBadge.className = 'site-badge ' + (info.site || 'unknown');
    siteBadge.classList.remove('hidden');
  }

  /* ========== Spotify candidates (manual selection) ========== */
  async function loadSpotifyCandidates(url, info) {
    if (!spotifyCandidatesSection || !spotifyCandidateSelect) return;
    spotifyCandidatesSection.classList.add('hidden');
    spotifyCandidateSelect.innerHTML = '<option value=\"\">🔍 Auto</option>';
    currentSpotifyCandidates = [];

    try {
      const res = await fetch('/api/spotify/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load matches');

      const list = Array.isArray(data.candidates) ? data.candidates : [];
      currentSpotifyCandidates = list;
      list.forEach((c) => {
        if (!c || !c.url) return;
        const opt = document.createElement('option');
        opt.value = c.url;
        const durText = c.duration ? ` (${formatDuration(c.duration)})` : '';
        opt.textContent = `${c.title || 'Untitled'} — ${c.uploader || 'Unknown'}${durText}`;
        spotifyCandidateSelect.appendChild(opt);
      });
      if (list.length) {
        spotifyCandidatesSection.classList.remove('hidden');
      }
      updateSpotifyCustomUrlVisibility();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  function formatDuration(sec) {
    if (sec == null) return '';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function formatSiteName(site) {
    const names = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', twitter: 'X', facebook: 'Facebook', soundcloud: 'SoundCloud', spotify: 'Spotify' };
    return names[site] || 'Unknown';
  }

  /* ========== Options visibility ========== */
  function updateOptionsVisibility(site) {
    const audioOnly = site === 'spotify' || site === 'soundcloud';
    qualityRow.style.display = audioOnly ? 'none' : 'flex';

    const format = document.querySelector('.format-btn.active')?.dataset.format || 'mp4';
    bitrateRow?.classList.toggle('visible', format === 'mp3');
    subtitleLangRow?.classList.toggle('visible', site === 'youtube' && subtitlesCb.checked);
    if (embedSubsRow) {
      embedSubsRow.style.display = site === 'youtube' && subtitlesCb.checked ? 'flex' : 'none';
    }

    subtitlesLabel.classList.toggle('hidden', site !== 'youtube');
    if (site !== 'youtube') subtitlesCb.checked = false;
    watermarkLabel.classList.toggle('hidden', site !== 'tiktok');
    if (site !== 'tiktok') watermarkCb.checked = false;
    const showPlaylist = site === 'youtube' || site === 'spotify';
    playlistLabel.classList.toggle('hidden', !showPlaylist);
    if (!showPlaylist) playlistCb.checked = false;
  }

  formatBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      formatBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      subtitlesCb.dispatchEvent(new Event('change'));
      if (currentInfo) updateOptionsVisibility(currentInfo.site);
    });
  });

  subtitlesCb.addEventListener('change', () => {
    if (currentInfo) updateOptionsVisibility(currentInfo.site);
  });

  function updateSpotifyCustomUrlVisibility() {
    if (!spotifyCandidateSelect || !spotifyCustomRow) return;
    const isAuto = !spotifyCandidateSelect.value;
    spotifyCustomRow.classList.toggle('hidden-row', isAuto);
  }

  if (spotifyCandidateSelect) {
    spotifyCandidateSelect.addEventListener('change', updateSpotifyCustomUrlVisibility);
    updateSpotifyCustomUrlVisibility();
  }

  /* ========== Download ========== */
  downloadBtn.addEventListener('click', startDownload);

  async function startDownload(options) {
    const isBatch = batchModeCb?.checked && urlBatchInput?.value.trim();
    const urls = isBatch
      ? urlBatchInput.value.trim().split(/\n/).map((u) => u.trim()).filter(Boolean)
      : [urlInput.value.trim()];
    const titles = options?.titles || (currentInfo ? [currentInfo.title] : urls.map(() => 'Unknown'));

    if (urls.length === 0) {
      showError('Enter at least one URL');
      showToast('Enter at least one URL', 'error');
      return;
    }
    if (!isBatch && !currentInfo && urls.length === 1) {
      showError('Fetch info first or use batch mode');
      showToast('Fetch video info first', 'error');
      return;
    }

    const format = document.querySelector('.format-btn.active')?.dataset.format || 'mp4';
    const quality = qualitySelect.value;
    const audioBitrate = document.getElementById('bitrate-select')?.value || '';
    const subtitleLangs = subtitleLangsInput?.value.trim() || 'en,en-US,en-GB';
    const filenameTemplate = filenameTemplateInput?.value.trim() || '';
    const subtitles = subtitlesCb.checked;
    const removeWatermark = watermarkCb.checked;
    const isPlaylist = playlistCb.checked;

    let spotifyYoutubeUrl;
    if (currentInfo && currentInfo.site === 'spotify') {
      const customUrl = spotifyCustomUrlInput?.value.trim();
      if (customUrl) {
        spotifyYoutubeUrl = customUrl;
      } else if (spotifyCandidateSelect) {
        spotifyYoutubeUrl = spotifyCandidateSelect.value || undefined;
      }
    }

    const embedSubtitles = !!embedSubsCb?.checked;
    const startTime = clipStartInput?.value.trim() || '';
    const endTime = clipEndInput?.value.trim() || '';
    const limitRate = limitRateSelect?.value || '';

    downloadBtn.disabled = true;
    downloadBtn.classList.add('downloading');
    downloadBtn.classList.remove('done');
    downloadBtn.style.setProperty('--progress', '0%');
    if (progressStatus) progressStatus.textContent = 'Downloading... 0%';
    if (progressText) progressText.textContent = '0%';

    downloadQueue = urls.map((_, i) => ({
      id: Date.now() + i,
      title: titles[i] || 'Unknown',
      status: i === 0 ? 'downloading' : 'pending',
      percent: 0,
    }));
    updateQueueBadge();
    renderQueue();

    let currentIndex = 0;

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: urls.length > 1 ? urls : undefined,
          url: urls[0],
          format,
          quality,
          audioBitrate: audioBitrate || undefined,
          subtitleLangs,
          filenameTemplate: filenameTemplate || undefined,
          subtitles,
          removeWatermark,
          isPlaylist,
          title: titles[0],
          titles: urls.length > 1 ? titles : undefined,
          spotifyYoutubeUrl,
          embedSubtitles,
          startTime,
          endTime,
          limitRate,
        }),
      });

      if (!res.ok) throw new Error('Download failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'progress') {
              const pct = Math.round(data.percent);
              downloadBtn.style.setProperty('--progress', pct + '%');
              if (progressText) progressText.textContent = pct + '%';
              if (progressStatus) progressStatus.textContent = `Downloading... ${pct}%`;
              if (downloadQueue[currentIndex]) {
                downloadQueue[currentIndex].percent = pct;
                downloadQueue[currentIndex].status = 'downloading';
                renderQueue();
              }
            } else if (data.type === 'done') {
              triggerFileDownload(data.filename);
              if (downloadQueue[currentIndex]) {
                downloadQueue[currentIndex].status = 'done';
                downloadQueue[currentIndex].percent = 100;
              }
              currentIndex++;
              if (currentIndex < downloadQueue.length) {
                downloadQueue[currentIndex].status = 'downloading';
                downloadQueue[currentIndex].percent = 0;
                downloadBtn.style.setProperty('--progress', '0%');
                if (progressText) progressText.textContent = '0%';
              }
              renderQueue();
              updateQueueBadge();
            } else if (data.type === 'error') {
              throw new Error(data.message);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      downloadBtn.classList.remove('downloading');
      downloadBtn.classList.add('done');
      downloadBtn.style.setProperty('--progress', '100%');
      if (downloadLabelEl) downloadLabelEl.textContent = '✓ Done';
      if (progressStatus) progressStatus.textContent = '';
      if (progressText) progressText.textContent = '';
      showToast(downloadQueue.length > 1 ? 'All downloads complete' : 'Download complete', 'success');
      loadHistory();
      setTimeout(() => {
        downloadBtn.classList.remove('done');
        downloadBtn.style.setProperty('--progress', '0%');
        if (downloadLabelEl) downloadLabelEl.textContent = 'Download';
      }, 3000);
      try {
        if ('Notification' in window) {
          if (Notification.permission === 'granted') {
            new Notification('Download complete', { body: titles[0] || 'Your download is ready.' });
          } else if (Notification.permission === 'default') {
            Notification.requestPermission().then((perm) => {
              if (perm === 'granted') {
                new Notification('Download complete', { body: titles[0] || 'Your download is ready.' });
              }
            });
          }
        }
      } catch (_) {}
    } catch (err) {
      downloadBtn.classList.remove('downloading');
      if (progressStatus) progressStatus.textContent = 'Failed';
      if (progressText) progressText.textContent = '—';
      showError(err.message);
      showToast(err.message || 'Download failed', 'error');
      if (downloadQueue[currentIndex]) {
        downloadQueue[currentIndex].status = 'error';
        downloadQueue[currentIndex].error = err.message;
      }
      renderQueue();
      updateQueueBadge();
    } finally {
      downloadBtn.disabled = false;
    }
  }

  async function reDownloadFromHistory(id) {
    try {
      const res = await fetch('/api/history/' + id);
      const entry = await res.json();
      if (!res.ok) throw new Error(entry.error || 'Failed to load');
      document.querySelector('.tab[data-tab="download"]')?.click();
      urlInput.value = entry.url;
      document.querySelector(`[data-format="${entry.format || 'mp4'}"]`)?.click();
      qualitySelect.value = entry.quality || 'best';
      const bitrateSel = document.getElementById('bitrate-select');
      if (bitrateSel) bitrateSel.value = entry.audioBitrate || '';
      if (subtitleLangsInput) subtitleLangsInput.value = entry.subtitleLangs || 'en,en-US,en-GB';
      if (filenameTemplateInput) filenameTemplateInput.value = entry.filenameTemplate || '';
      subtitlesCb.checked = entry.subtitles || false;
      watermarkCb.checked = entry.removeWatermark || false;
      playlistCb.checked = entry.isPlaylist || false;
      currentInfo = { title: entry.title, site: entry.site };
      updateOptionsVisibility(entry.site);
      closeOptionsSheet();
      startDownload({ titles: [entry.title] });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function triggerFileDownload(filename) {
    const a = document.createElement('a');
    a.href = '/api/files/' + encodeURIComponent(filename);
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /* ========== History ========== */
  async function loadHistory() {
    try {
      const res = await fetch('/api/history');
      const entries = await res.json();

      historyEmpty.classList.toggle('hidden', entries.length > 0);
      historyList.innerHTML = '';

      entries.forEach((entry) => {
        const li = document.createElement('li');
        li.className = 'history-item';
        li.innerHTML = `
          <div class="history-item-info">
            <div class="history-item-title">${escapeHtml(entry.title)}</div>
            <div class="history-item-meta">
              ${formatSiteName(entry.site || 'unknown')} · ${entry.format?.toUpperCase() || '—'} · ${formatDate(entry.date)}
            </div>
          </div>
          <div class="history-item-actions">
            <button type="button" class="history-item-redownload btn btn-secondary btn-sm">Re-download</button>
            <button type="button" class="history-item-delete">Delete</button>
          </div>
        `;
        li.querySelector('.history-item-delete').addEventListener('click', () => deleteHistoryEntry(entry.id));
        li.querySelector('.history-item-redownload').addEventListener('click', () => reDownloadFromHistory(entry.id));
        historyList.appendChild(li);
      });
    } catch (err) {
      historyList.innerHTML = '<li class="history-item">Could not load history</li>';
      showToast('Could not load history', 'error');
    }
  }

  async function deleteHistoryEntry(id) {
    try {
      await fetch('/api/history/' + id, { method: 'DELETE' });
      loadHistory();
      showToast('Removed from history', 'success');
    } catch (err) {
      showToast('Could not delete', 'error');
    }
  }

  clearHistoryBtn.addEventListener('click', async () => {
    if (!confirm('Clear all history? This cannot be undone.')) return;
    try {
      await fetch('/api/history', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true }),
      });
      loadHistory();
      showToast('History cleared', 'success');
    } catch (err) {
      showToast('Could not clear history', 'error');
    }
  });

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  loadHistory();
})();
