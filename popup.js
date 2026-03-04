// popup.js — Extension popup logic for Crunchyroll Scene Skip

(function () {
  'use strict';

  const episodeListEl = document.getElementById('episode-list');
  const globalToggle  = document.getElementById('global-skip-toggle');
  const btnExport     = document.getElementById('btn-export');
  const btnImport     = document.getElementById('btn-import');
  const btnClear      = document.getElementById('btn-clear');
  const fileInput     = document.getElementById('file-input');
  const statusMsg     = document.getElementById('status-msg');

  const TAG_LABELS = { sexual: 'Sexual', violence: 'Violence', filler: 'Filler', other: 'Other' };

  // ── Global skip toggle ───────────────────────────────────────

  chrome.storage.local.get('skipEnabled', (res) => {
    globalToggle.checked = res.skipEnabled !== false;
  });

  globalToggle.addEventListener('change', () => {
    chrome.storage.local.set({ skipEnabled: globalToggle.checked });
    showStatus(globalToggle.checked ? 'Auto-skip enabled' : 'Auto-skip disabled');
  });

  // ── Load episodes ────────────────────────────────────────────

  async function loadEpisodes() {
    const data = await getAllData();

    const entries = Object.entries(data).filter(
      ([k, v]) => k.includes('crunchyroll.com') && v && Array.isArray(v.segments) && v.segments.length > 0
    );

    if (entries.length === 0) {
      episodeListEl.innerHTML = '<div class="empty-msg">No episodes saved yet.</div>';
      return;
    }

    episodeListEl.innerHTML = '';
    entries.forEach(([url, val]) => {
      episodeListEl.appendChild(buildEpisodeItem(url, val.segments));
    });
  }

  // ── Episode accordion item ───────────────────────────────────

  function buildEpisodeItem(url, segments) {
    const item = document.createElement('div');
    item.className = 'ep-item';

    const header = document.createElement('div');
    header.className = 'ep-header';
    header.innerHTML = `
      <span class="ep-arrow">&#9658;</span>
      <span class="ep-title">${escapeHtml(parseEpisodeLabel(url))}</span>
      <span class="ep-badge">${segments.length}</span>
    `;

    const segContainer = document.createElement('div');
    segContainer.className = 'ep-segments';

    const sorted = [...segments].sort((a, b) => a.start - b.start);
    sorted.forEach((seg) => {
      segContainer.appendChild(buildSegmentRow(url, seg, segContainer, segments));
    });

    header.addEventListener('click', () => {
      item.classList.toggle('open');
    });

    item.appendChild(header);
    item.appendChild(segContainer);
    return item;
  }

  // ── Segment row + inline edit ────────────────────────────────

  function buildSegmentRow(url, seg, segContainer, allSegments) {
    const wrapper = document.createElement('div');

    // Summary row
    const row = document.createElement('div');
    row.className = 'seg-row';
    row.innerHTML = `
      <span class="seg-times">${formatTime(seg.start)} → ${formatTime(seg.end)}</span>
      <span class="seg-tag ${seg.tag}">${TAG_LABELS[seg.tag] || seg.tag}</span>
      ${seg.note ? `<span class="seg-note">${escapeHtml(seg.note)}</span>` : '<span class="seg-note"></span>'}
      <button class="seg-delete" title="Delete segment">&times;</button>
    `;

    // Inline edit form
    const editForm = document.createElement('div');
    editForm.className = 'seg-edit-form';
    editForm.innerHTML = `
      <div class="edit-row">
        <div class="edit-field">
          <label>Start (sec)</label>
          <input type="number" class="edit-start" step="0.1" min="0" value="${seg.start.toFixed(1)}" />
        </div>
        <div class="edit-field">
          <label>End (sec)</label>
          <input type="number" class="edit-end" step="0.1" min="0" value="${seg.end.toFixed(1)}" />
        </div>
      </div>
      <div class="edit-row">
        <div class="edit-field">
          <label>Tag</label>
          <select class="edit-tag">
            <option value="sexual"   ${seg.tag === 'sexual'   ? 'selected' : ''}>Sexual</option>
            <option value="violence" ${seg.tag === 'violence' ? 'selected' : ''}>Violence</option>
            <option value="filler"   ${seg.tag === 'filler'   ? 'selected' : ''}>Filler</option>
            <option value="other"    ${seg.tag === 'other'    ? 'selected' : ''}>Other</option>
          </select>
        </div>
      </div>
      <div class="edit-note-row">
        <label>Note</label>
        <input type="text" class="edit-note" placeholder="Optional note..." value="${escapeHtml(seg.note || '')}" />
      </div>
      <div class="edit-actions">
        <button class="edit-btn save">Save</button>
        <button class="edit-btn cancel">Cancel</button>
      </div>
    `;

    // Toggle edit on row click (not on delete button)
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('seg-delete')) return;
      row.classList.toggle('active');
      editForm.classList.toggle('open');
    });

    // Delete
    row.querySelector('.seg-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteSegment(url, seg.id);
      loadEpisodes();
      showStatus('Segment deleted.');
    });

    // Save edits
    editForm.querySelector('.edit-btn.save').addEventListener('click', async () => {
      const start = parseFloat(editForm.querySelector('.edit-start').value);
      const end   = parseFloat(editForm.querySelector('.edit-end').value);
      const tag   = editForm.querySelector('.edit-tag').value;
      const note  = editForm.querySelector('.edit-note').value.trim();

      if (isNaN(start) || isNaN(end) || end <= start) {
        showStatus('Invalid start/end times.', true);
        return;
      }

      await saveSegment(url, { ...seg, start, end, tag, note });
      loadEpisodes();
      showStatus('Segment updated.');
    });

    // Cancel
    editForm.querySelector('.edit-btn.cancel').addEventListener('click', () => {
      row.classList.remove('active');
      editForm.classList.remove('open');
    });

    wrapper.appendChild(row);
    wrapper.appendChild(editForm);
    return wrapper;
  }

  // ── Export JSON ──────────────────────────────────────────────

  btnExport.addEventListener('click', async () => {
    const data = await getAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'crunchyroll-skip-data.json'; a.click();
    URL.revokeObjectURL(url);
    showStatus('Exported!');
  });

  // ── Import JSON ──────────────────────────────────────────────

  btnImport.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const crEntries = Object.entries(data).filter(
          ([k, v]) => k.includes('crunchyroll.com') && v && Array.isArray(v.segments)
        );
        if (crEntries.length === 0) { showStatus('No valid data found.', true); return; }
        await Promise.all(crEntries.map(([k, v]) =>
          new Promise((res) => chrome.storage.local.set({ [k]: v }, res))
        ));
        loadEpisodes();
        showStatus(`Imported ${crEntries.length} episode(s).`);
      } catch {
        showStatus('Invalid JSON file.', true);
      }
      fileInput.value = '';
    };
    reader.readAsText(file);
  });

  // ── Clear All ────────────────────────────────────────────────

  btnClear.addEventListener('click', async () => {
    if (!confirm('Delete ALL saved segments? This cannot be undone.')) return;
    const data = await getAllData();
    const keys = Object.keys(data).filter((k) => k.includes('crunchyroll.com'));
    await new Promise((res) => chrome.storage.local.remove(keys, res));
    loadEpisodes();
    showStatus('All data cleared.');
  });

  // ── Helpers ──────────────────────────────────────────────────

  function parseEpisodeLabel(url) {
    const match = url.match(/\/watch\/([^/]+)(?:\/([^/]+))?/);
    if (match) {
      const slug = match[2] ? match[2].replace(/-/g, ' ') : '';
      return slug ? `${slug} (${match[1]})` : match[1];
    }
    return url;
  }

  function formatTime(s) {
    if (isNaN(s) || s < 0) return '0:00';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function showStatus(msg, isError = false) {
    statusMsg.textContent = msg;
    statusMsg.style.color = isError ? '#e74c3c' : '#27ae60';
    setTimeout(() => { statusMsg.textContent = ''; }, 2500);
  }

  loadEpisodes();

})();
