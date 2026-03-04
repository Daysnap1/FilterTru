// content.js — Core logic for Crunchyroll Scene Skip

(function () {
  'use strict';

  const IS_PLAYER = location.hostname === 'static.crunchyroll.com';

  if (IS_PLAYER) {
    initPlayerFrame();
  } else {
    initMainFrame();
  }

  // ── PLAYER FRAME (static.crunchyroll.com) ────────────────────

  function initPlayerFrame() {
    let videoEl = null;
    let segments = [];
    let skipEnabled = true;
    let enabledTags = ['sexual', 'violence', 'filler', 'other'];
    let skipCooldowns = {};
    const COOLDOWN_MS = 1500;
    let currentUrl = null;
    let markerRetryTimer = null;

    chrome.storage.local.get(['skipEnabled', 'skipTags'], (res) => {
      skipEnabled = res.skipEnabled !== false;
      if (res.skipTags) enabledTags = res.skipTags;
    });

    // Messages from main frame
    window.addEventListener('message', (e) => {
      if (!e.data || e.data.source !== 'cr-skip') return;
      if (e.data.type === 'url') { currentUrl = e.data.url; loadSegments(); }
      if (e.data.type === 'skip-enabled') { skipEnabled = e.data.value; }
      if (e.data.type === 'skip-tags') { enabledTags = e.data.value; }
      if (e.data.type === 'reload-segments') { loadSegments(); }
    });

    // Relay keyboard shortcuts to main frame
    document.addEventListener('keydown', (e) => {
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      if (e.altKey && e.code === 'KeyQ') { e.preventDefault(); postToParent({ type: 'hotkey', key: 'alt-q' }); return; }
      if (e.altKey && e.code === 'KeyW') { e.preventDefault(); postToParent({ type: 'hotkey', key: 'alt-w' }); return; }
      if (inInput) return;
      if (e.code === 'KeyS') postToParent({ type: 'hotkey', key: 's' });
      if (e.code === 'KeyE') postToParent({ type: 'hotkey', key: 'e' });
      if (e.code === 'Enter') postToParent({ type: 'hotkey', key: 'enter' });
    });

    function postToParent(msg) {
      window.parent.postMessage(Object.assign({ source: 'cr-skip' }, msg), '*');
    }

    // Video detection
    function findVideo() { return document.querySelector('video'); }

    function onVideoFound(video) {
      if (videoEl === video) return;
      videoEl = video;
      video.addEventListener('timeupdate', onTimeUpdate);
      video.addEventListener('loadedmetadata', () => injectSeekBarMarkers(segments));
      postToParent({ type: 'video-ready' });
    }

    const observer = new MutationObserver(() => {
      const v = findVideo();
      if (v && v !== videoEl) onVideoFound(v);
      if (videoEl && !document.contains(videoEl)) videoEl = null;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const existing = findVideo();
    if (existing) onVideoFound(existing);

    // Time update + auto-skip
    function onTimeUpdate() {
      if (!videoEl) return;
      const time = videoEl.currentTime;
      postToParent({ type: 'time', time });

      if (!skipEnabled || segments.length === 0) return;
      const wallNow = Date.now();
      for (const seg of segments) {
        if (!enabledTags.includes(seg.tag)) continue;
        if (time >= seg.start && time < seg.end) {
          const lastSkip = skipCooldowns[seg.id] || 0;
          if (wallNow - lastSkip > COOLDOWN_MS) {
            skipCooldowns[seg.id] = wallNow;
            videoEl.currentTime = seg.end;
            showToast(`\u23ed Skipped: ${seg.tag}`);
          }
          break;
        }
      }
    }

    async function loadSegments() {
      if (!currentUrl) return;
      segments = await getSegments(currentUrl);
      injectSeekBarMarkers(segments);
    }

    // ── Seek Bar Markers ──────────────────────────────────────

    const TAG_COLORS = { sexual: '#e74c3c', violence: '#e67e22', filler: '#3498db', other: '#95a5a6' };

    function findProgressBar() {
      const selectors = [
        '.vjs-progress-holder',
        '.vjs-slider[aria-label*="seek" i]',
        '.vjs-slider[aria-label*="progress" i]',
        '.vjs-slider',
        '[class*="ProgressBar"]',
        '[class*="progressBar"]',
        '[class*="progress-bar"]',
        '[class*="timeline" i]',
        '[class*="seekbar" i]',
        '[class*="scrubber" i]',
      ];
      for (const sel of selectors) {
        try { const el = document.querySelector(sel); if (el) return el; } catch (_) {}
      }
      return null;
    }

    function injectSeekBarMarkers(segs) {
      if (markerRetryTimer) clearTimeout(markerRetryTimer);
      if (!videoEl) return;
      const duration = videoEl.duration;
      if (!duration || isNaN(duration) || segs.length === 0) return;

      const bar = findProgressBar();
      if (!bar) {
        markerRetryTimer = setTimeout(() => injectSeekBarMarkers(segs), 2000);
        return;
      }

      // Ensure bar can host absolute children
      const pos = window.getComputedStyle(bar).position;
      if (pos === 'static') bar.style.position = 'relative';

      bar.querySelectorAll('.cr-skip-seek-marker').forEach(m => m.remove());

      segs.forEach((seg) => {
        const marker = document.createElement('div');
        marker.className = 'cr-skip-seek-marker';
        marker.style.left = (seg.start / duration * 100) + '%';
        marker.style.width = Math.max((seg.end - seg.start) / duration * 100, 0.4) + '%';
        marker.style.background = TAG_COLORS[seg.tag] || '#fff';
        marker.title = `${seg.tag}: ${fmtTime(seg.start)} → ${fmtTime(seg.end)}`;
        bar.appendChild(marker);
      });
    }

    // ── Toast Notification ────────────────────────────────────

    let toastEl = null;
    let toastTimeout = null;

    function getToastParent() {
      // Use the fullscreen element as parent so toast appears in fullscreen
      return document.fullscreenElement || document.body;
    }

    function showToast(msg) {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.id = 'cr-skip-toast';
      }
      // Re-attach to current fullscreen container every time
      const parent = getToastParent();
      if (toastEl.parentElement !== parent) parent.appendChild(toastEl);

      toastEl.textContent = msg;
      toastEl.classList.add('visible');
      clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => toastEl.classList.remove('visible'), 2500);
    }

    // Move toast when fullscreen state changes
    document.addEventListener('fullscreenchange', () => {
      if (toastEl) {
        const parent = getToastParent();
        if (toastEl.parentElement !== parent) parent.appendChild(toastEl);
      }
    });

    function fmtTime(s) {
      return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    }
  }

  // ── MAIN FRAME (www.crunchyroll.com) ─────────────────────────

  function initMainFrame() {
    let currentUrl = normalizeUrl(location.href);
    let lastUrl = currentUrl;

    // Messages from player iframe
    window.addEventListener('message', (e) => {
      if (!e.data || e.data.source !== 'cr-skip') return;
      if (e.data.type === 'time' && window.crSkipOverlay) window.crSkipOverlay.updateTime(e.data.time);
      if (e.data.type === 'video-ready') sendToPlayer({ type: 'url', url: currentUrl });
      if (e.data.type === 'hotkey' && window.crSkipOverlay) window.crSkipOverlay.triggerHotkey(e.data.key);
    });

    // Forward overlay events to player iframe
    window.addEventListener('crSkipToggle', (e) => sendToPlayer({ type: 'skip-enabled', value: e.detail.skipEnabled }));
    window.addEventListener('crSkipTagsUpdated', (e) => sendToPlayer({ type: 'skip-tags', value: e.detail.skipTags }));
    window.addEventListener('crSkipSegmentUpdated', () => sendToPlayer({ type: 'reload-segments' }));

    function sendToPlayer(msg) {
      document.querySelectorAll('iframe').forEach((iframe) => {
        try { iframe.contentWindow.postMessage(Object.assign({ source: 'cr-skip' }, msg), '*'); } catch (_) {}
      });
    }

    // SPA navigation
    function patchHistory(method) {
      const orig = history[method];
      history[method] = function (...args) {
        const r = orig.apply(this, args);
        window.dispatchEvent(new Event('cr-urlchange'));
        return r;
      };
    }
    patchHistory('pushState');
    patchHistory('replaceState');
    window.addEventListener('popstate', () => window.dispatchEvent(new Event('cr-urlchange')));
    window.addEventListener('cr-urlchange', handleUrlChange);

    setInterval(() => {
      const u = normalizeUrl(location.href);
      if (u !== lastUrl) { lastUrl = u; window.dispatchEvent(new Event('cr-urlchange')); }
    }, 1000);

    function handleUrlChange() {
      const newUrl = normalizeUrl(location.href);
      if (newUrl === currentUrl) return;
      currentUrl = newUrl; lastUrl = newUrl;
      sendToPlayer({ type: 'url', url: currentUrl });
      if (window.crSkipOverlay) window.crSkipOverlay.refresh(currentUrl);
    }

    if (window.crSkipOverlay) window.crSkipOverlay.setUrl(currentUrl);
    setTimeout(() => sendToPlayer({ type: 'url', url: currentUrl }), 1500);
  }

  function normalizeUrl(url) {
    try { const u = new URL(url); return u.origin + u.pathname.replace(/\/$/, ''); }
    catch { return url.split('?')[0].replace(/\/$/, ''); }
  }

})();
