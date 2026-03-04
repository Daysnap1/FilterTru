// overlay.js — Floating UI overlay for Crunchyroll Scene Skip
// Only active on the main crunchyroll.com frame.

(function () {
  'use strict';

  if (location.hostname === 'static.crunchyroll.com') return;

  window.crSkipOverlay = { refresh, updateTime, setUrl, triggerHotkey };

  let currentUrl = null;
  let isExpanded = true;
  let skipEnabled = true;
  let skipTags = ['sexual', 'violence', 'filler', 'other'];
  let hotkeysEnabled = true;
  let pendingStart = null;
  let timeInterval = null;
  let overlayEl = null;
  let segmentListEl = null;
  let timeDisplayEl = null;
  let pendingEl = null;
  let toggleSkipBtn = null;
  let hotkeyIndicatorEl = null;
  let lastKnownTime = 0;

  const ALL_TAGS = ['sexual', 'violence', 'filler', 'other'];
  const TAG_LABELS = { sexual: 'Sexual', violence: 'Violence', filler: 'Filler', other: 'Other' };

  // ── Public API ───────────────────────────────────────────────

  function updateTime(seconds) { lastKnownTime = seconds; }

  function setUrl(url) { currentUrl = url; refresh(url); }

  async function refresh(url) {
    currentUrl = url;
    if (!overlayEl) return;
    const segments = await getSegments(url);
    renderSegmentList(segments);
  }

  // Called by content.js when a hotkey is pressed in the player iframe
  function triggerHotkey(key) {
    if (key === 'alt-q') { toggleHotkeys(); return; }
    if (key === 'alt-w') { onToggleSkip(); return; }
    if (!hotkeysEnabled) return;
    if (key === 's') onMarkStart();
    if (key === 'e') onMarkEnd();
    if (key === 'enter') onSave();
  }

  // ── Init ─────────────────────────────────────────────────────

  buildOverlay();
  makeDraggable(overlayEl, document.getElementById('cr-skip-header'));
  startTimerDisplay();
  loadPreferences();
  attachKeyboardShortcuts();

  document.addEventListener('fullscreenchange', () => {
    if (!overlayEl) return;
    const fsEl = document.fullscreenElement;
    if (fsEl) fsEl.appendChild(overlayEl);
    else document.body.appendChild(overlayEl);
  });

  // ── Build DOM ────────────────────────────────────────────────

  function buildOverlay() {
    overlayEl = document.createElement('div');
    overlayEl.id = 'cr-skip-overlay';

    overlayEl.innerHTML = `
      <div id="cr-skip-header">
        <span id="cr-skip-title">&#9654; Scene Skip</span>
        <div id="cr-skip-header-right">
          <span id="cr-skip-hotkey-indicator" title="Hotkeys: S=Start E=End Enter=Save&#10;Alt+Q=Toggle hotkeys Alt+W=Toggle skip">⌨ ON</span>
          <button id="cr-skip-toggle-skip" class="active">Skip ON</button>
          <button id="cr-skip-collapse-btn" title="Collapse">&#x2212;</button>
        </div>
      </div>
      <div id="cr-skip-body">
        <div id="cr-skip-time-display">0:00</div>
        <div id="cr-skip-pending"></div>
        <div class="cr-skip-btn-row">
          <button class="cr-skip-btn mark-start" id="cr-skip-mark-start">&#9664; Start <kbd>S</kbd></button>
          <button class="cr-skip-btn mark-end" id="cr-skip-mark-end">End &#9654; <kbd>E</kbd></button>
        </div>
        <div id="cr-skip-tag-section">
          <label for="cr-skip-tag-select">Tag</label>
          <select id="cr-skip-tag-select">
            <option value="sexual">Sexual</option>
            <option value="violence">Violence</option>
            <option value="filler">Filler</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div id="cr-skip-note-section">
          <label for="cr-skip-note-input">Note (optional)</label>
          <input type="text" id="cr-skip-note-input" placeholder="Short description..." />
        </div>
        <div class="cr-skip-btn-row">
          <button class="cr-skip-btn save" id="cr-skip-save">Save Segment <kbd>↵</kbd></button>
        </div>
        <hr class="cr-skip-divider" />
        <div id="cr-skip-skip-tags-section">
          <div class="cr-skip-section-label">Skip these tags:</div>
          <div id="cr-skip-tag-toggles"></div>
        </div>
        <hr class="cr-skip-divider" />
        <div id="cr-skip-segment-list"></div>
      </div>
    `;

    document.body.appendChild(overlayEl);

    timeDisplayEl = document.getElementById('cr-skip-time-display');
    pendingEl = document.getElementById('cr-skip-pending');
    segmentListEl = document.getElementById('cr-skip-segment-list');
    toggleSkipBtn = document.getElementById('cr-skip-toggle-skip');
    hotkeyIndicatorEl = document.getElementById('cr-skip-hotkey-indicator');

    document.getElementById('cr-skip-collapse-btn').addEventListener('click', toggleCollapse);
    toggleSkipBtn.addEventListener('click', onToggleSkip);
    document.getElementById('cr-skip-mark-start').addEventListener('click', onMarkStart);
    document.getElementById('cr-skip-mark-end').addEventListener('click', onMarkEnd);
    document.getElementById('cr-skip-save').addEventListener('click', onSave);

    renderTagToggles();
  }

  // ── Preferences ──────────────────────────────────────────────

  function loadPreferences() {
    chrome.storage.local.get(['skipEnabled', 'skipTags'], (res) => {
      skipEnabled = res.skipEnabled !== false;
      if (res.skipTags) skipTags = res.skipTags;

      if (toggleSkipBtn) {
        toggleSkipBtn.textContent = skipEnabled ? 'Skip ON' : 'Skip OFF';
        toggleSkipBtn.classList.toggle('active', skipEnabled);
      }
      updateTagToggleUI();
      dispatchTagsUpdated();
    });
  }

  function renderTagToggles() {
    const container = document.getElementById('cr-skip-tag-toggles');
    if (!container) return;
    container.innerHTML = '';
    ALL_TAGS.forEach((tag) => {
      const label = document.createElement('label');
      label.className = 'cr-skip-tag-toggle';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.tag = tag;
      cb.checked = skipTags.includes(tag);
      cb.addEventListener('change', onTagToggleChange);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + TAG_LABELS[tag]));
      container.appendChild(label);
    });
  }

  function updateTagToggleUI() {
    const container = document.getElementById('cr-skip-tag-toggles');
    if (!container) return;
    container.querySelectorAll('input[data-tag]').forEach((cb) => {
      cb.checked = skipTags.includes(cb.dataset.tag);
    });
  }

  function onTagToggleChange() {
    skipTags = Array.from(
      document.querySelectorAll('#cr-skip-tag-toggles input:checked')
    ).map((cb) => cb.dataset.tag);
    chrome.storage.local.set({ skipTags });
    dispatchTagsUpdated();
  }

  function dispatchTagsUpdated() {
    window.dispatchEvent(new CustomEvent('crSkipTagsUpdated', { detail: { skipTags } }));
  }

  // ── Keyboard Shortcuts ───────────────────────────────────────

  function attachKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);

      if (e.altKey && e.code === 'KeyQ') { e.preventDefault(); toggleHotkeys(); return; }
      if (e.altKey && e.code === 'KeyW') { e.preventDefault(); onToggleSkip(); return; }
      if (inInput || !hotkeysEnabled) return;

      if (e.code === 'KeyS') { e.preventDefault(); onMarkStart(); }
      if (e.code === 'KeyE') { e.preventDefault(); onMarkEnd(); }
      if (e.code === 'Enter') { e.preventDefault(); onSave(); }
    });
  }

  function toggleHotkeys() {
    hotkeysEnabled = !hotkeysEnabled;
    if (hotkeyIndicatorEl) {
      hotkeyIndicatorEl.textContent = hotkeysEnabled ? '⌨ ON' : '⌨ OFF';
      hotkeyIndicatorEl.classList.toggle('disabled', !hotkeysEnabled);
    }
  }

  // ── Event Handlers ───────────────────────────────────────────

  function toggleCollapse() {
    isExpanded = !isExpanded;
    document.getElementById('cr-skip-body').classList.toggle('collapsed', !isExpanded);
    document.getElementById('cr-skip-collapse-btn').textContent = isExpanded ? '\u2212' : '+';
  }

  function onToggleSkip() {
    skipEnabled = !skipEnabled;
    chrome.storage.local.set({ skipEnabled });
    toggleSkipBtn.textContent = skipEnabled ? 'Skip ON' : 'Skip OFF';
    toggleSkipBtn.classList.toggle('active', skipEnabled);
    window.dispatchEvent(new CustomEvent('crSkipToggle', { detail: { skipEnabled } }));
  }

  function onMarkStart() {
    pendingStart = lastKnownTime;
    pendingEl.textContent = `Start: ${formatTime(pendingStart)} — now mark end`;
  }

  function onMarkEnd() {
    if (pendingStart === null) { pendingEl.textContent = 'Mark a start time first.'; return; }
    const end = lastKnownTime;
    if (end <= pendingStart) { pendingEl.textContent = 'End must be after start.'; return; }
    overlayEl.dataset.pendingEnd = end;
    pendingEl.textContent = `${formatTime(pendingStart)} \u2192 ${formatTime(end)} — choose tag & save`;
  }

  async function onSave() {
    if (pendingStart === null || !overlayEl.dataset.pendingEnd) {
      pendingEl.textContent = 'Mark start and end first.';
      return;
    }
    const segment = {
      id: crypto.randomUUID(),
      start: pendingStart,
      end: parseFloat(overlayEl.dataset.pendingEnd),
      tag: document.getElementById('cr-skip-tag-select').value,
      note: document.getElementById('cr-skip-note-input').value.trim(),
    };

    await saveSegment(currentUrl, segment);
    pendingStart = null;
    delete overlayEl.dataset.pendingEnd;
    document.getElementById('cr-skip-note-input').value = '';
    pendingEl.textContent = 'Saved!';
    setTimeout(() => { pendingEl.textContent = ''; }, 2000);

    renderSegmentList(await getSegments(currentUrl));
    window.dispatchEvent(new CustomEvent('crSkipSegmentUpdated'));
  }

  // ── Segment List ─────────────────────────────────────────────

  function renderSegmentList(segments) {
    if (!segmentListEl) return;
    if (!segments || segments.length === 0) {
      segmentListEl.innerHTML = '<div id="cr-skip-no-segments">No segments saved.</div>';
      return;
    }
    segmentListEl.innerHTML = '';
    [...segments].sort((a, b) => a.start - b.start).forEach((seg) => {
      const item = document.createElement('div');
      item.className = 'cr-skip-segment-item';

      const info = document.createElement('div');
      info.className = 'cr-skip-segment-info';
      info.innerHTML = `
        <div class="cr-skip-segment-times">${formatTime(seg.start)} &rarr; ${formatTime(seg.end)}</div>
        <div class="cr-skip-segment-tag">${seg.tag}${seg.note ? ' — ' + escapeHtml(seg.note) : ''}</div>
      `;

      const delBtn = document.createElement('button');
      delBtn.className = 'cr-skip-segment-delete';
      delBtn.textContent = 'Del';
      delBtn.addEventListener('click', async () => {
        await deleteSegment(currentUrl, seg.id);
        renderSegmentList(await getSegments(currentUrl));
        window.dispatchEvent(new CustomEvent('crSkipSegmentUpdated'));
      });

      item.appendChild(info);
      item.appendChild(delBtn);
      segmentListEl.appendChild(item);
    });
  }

  // ── Timer ────────────────────────────────────────────────────

  function startTimerDisplay() {
    if (timeInterval) clearInterval(timeInterval);
    timeInterval = setInterval(() => {
      if (timeDisplayEl) timeDisplayEl.textContent = formatTime(lastKnownTime);
    }, 250);
  }

  // ── Draggable ────────────────────────────────────────────────

  function makeDraggable(el, handle) {
    let startX, startY, startLeft, startTop;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SPAN') return;
      startX = e.clientX; startY = e.clientY;
      const rect = el.getBoundingClientRect();
      startLeft = rect.left; startTop = rect.top;
      el.style.transform = 'none';
      el.style.left = startLeft + 'px';
      el.style.top = startTop + 'px';
      el.classList.add('dragging');
      const onMove = (e2) => {
        el.style.left = (startLeft + e2.clientX - startX) + 'px';
        el.style.top = (startTop + e2.clientY - startY) + 'px';
      };
      const onUp = () => {
        el.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }

  // ── Helpers ──────────────────────────────────────────────────

  function formatTime(s) {
    if (isNaN(s) || s < 0) return '0:00';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

})();
