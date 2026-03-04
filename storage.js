// storage.js — Chrome storage utility for Crunchyroll Scene Skip

/**
 * Normalize a URL by stripping query params and trailing slash.
 * Uses the full episode URL path as the storage key.
 */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch {
    return url.split('?')[0].replace(/\/$/, '');
  }
}

/**
 * Get all segments for a given episode URL.
 * @param {string} url
 * @returns {Promise<Array>}
 */
function getSegments(url) {
  const key = normalizeUrl(url);
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve((result[key] && result[key].segments) || []);
    });
  });
}

/**
 * Save (append or update) a segment for a given episode URL.
 * If a segment with the same id exists, it is replaced; otherwise appended.
 * @param {string} url
 * @param {Object} segment - { id, start, end, tag, note }
 * @returns {Promise<void>}
 */
function saveSegment(url, segment) {
  const key = normalizeUrl(url);
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      const entry = result[key] || { segments: [] };
      const idx = entry.segments.findIndex((s) => s.id === segment.id);
      if (idx >= 0) {
        entry.segments[idx] = segment;
      } else {
        entry.segments.push(segment);
      }
      chrome.storage.local.set({ [key]: entry }, resolve);
    });
  });
}

/**
 * Delete a segment by id for a given episode URL.
 * @param {string} url
 * @param {string} segmentId
 * @returns {Promise<void>}
 */
function deleteSegment(url, segmentId) {
  const key = normalizeUrl(url);
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      const entry = result[key] || { segments: [] };
      entry.segments = entry.segments.filter((s) => s.id !== segmentId);
      chrome.storage.local.set({ [key]: entry }, resolve);
    });
  });
}

/**
 * Get all stored data (used by popup).
 * @returns {Promise<Object>}
 */
function getAllData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, resolve);
  });
}
