/**
 * main.js — entry point for the Career Ladder app
 *
 * Responsibilities:
 *   - Load initial track from URL hash (default: cloud-security)
 *   - Drive tab switching with lazy JSON loading and a Map cache
 *   - Drive civ/gov mode toggle
 *   - Maintain ARIA state (aria-selected, aria-labelledby, aria-pressed)
 *   - Keyboard navigation (ArrowRight / ArrowLeft with wrap-around)
 */

import { renderTrack } from './render.js';
import { hashToTrack, trackToHash } from './utils.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const TRACK_LABELS = {
  'cloud-security': 'Cloud Security',
  'cybersecurity':  'Cybersecurity',
  'devsecops':      'DevSecOps',
  'ai-ml':          'AI-ML',
};

// ── Module-level state ─────────────────────────────────────────────────────────

/** @type {Map<string, object>} */
const trackCache = new Map();

/** @type {'civ'|'gov'} */
let currentMode = 'civ';

/** @type {string} */
let currentTrackId = 'cloud-security';

/** @type {string|null} */
let inflightTrackId = null;

// ── DOM helpers ────────────────────────────────────────────────────────────────

function getAllTabs() {
  return Array.from(document.querySelectorAll('[role="tab"]'));
}

function getContainer() {
  const el = document.getElementById('ladder-container');
  if (!el) throw new Error('[career-ladder] #ladder-container not found in DOM');
  return el;
}

function showError(message) {
  const container = getContainer();
  container.replaceChildren();
  const p = document.createElement('p');
  p.className = 'error-msg';
  p.textContent = message;
  container.appendChild(p);
}

function showPlaceholder(trackId) {
  const container = getContainer();
  container.replaceChildren();
  const label = TRACK_LABELS[trackId] ?? trackId;
  const p = document.createElement('p');
  p.className = 'placeholder-msg';
  p.textContent = `Coming soon — ${label} ladder in Phase 3.`;
  container.appendChild(p);
}

// ── ARIA / roving tabindex ─────────────────────────────────────────────────────

/**
 * Updates aria-selected and roving tabindex across all tabs.
 * Sets aria-labelledby on #tab-panel to the active tab's id.
 *
 * @param {HTMLElement} activeTab
 */
function activateTab(activeTab) {
  const tabs = getAllTabs();
  for (const tab of tabs) {
    const isActive = tab === activeTab;
    tab.setAttribute('aria-selected', String(isActive));
    tab.setAttribute('tabindex', isActive ? '0' : '-1');
    tab.classList.toggle('active', isActive);
  }
  document.getElementById('tab-panel').setAttribute('aria-labelledby', activeTab.id);
}

// ── Track loading ──────────────────────────────────────────────────────────────

/**
 * Fetches a track JSON file, populates the cache, and returns the parsed object.
 * Returns null on network or parse failure (error already displayed).
 *
 * @param {string} trackId
 * @returns {Promise<object|null>}
 */
async function loadTrack(trackId) {
  if (trackCache.has(trackId)) {
    return trackCache.get(trackId);
  }

  try {
    const response = await fetch(`data/${trackId}.json`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    trackCache.set(trackId, data);
    return data;
  } catch (err) {
    console.error(`Failed to load track "${trackId}":`, err);
    showError('Failed to load track data.');
    return null;
  }
}

/**
 * Switches to the given track: fetches/caches JSON, updates ARIA, renders cards,
 * and pushes the hash.
 *
 * @param {string} trackId
 */
async function switchToTrack(trackId) {
  currentTrackId = trackId;
  inflightTrackId = trackId;

  // Find the matching tab button and activate it
  const tabs = getAllTabs();
  const targetTab = tabs.find(t => t.dataset.track === trackId);
  if (targetTab) {
    activateTab(targetTab);
  }

  const data = await loadTrack(trackId);
  if (inflightTrackId !== trackId) return; // a newer switchToTrack superseded this one
  if (!data) return; // error already shown

  // Placeholder check: JSON must have a non-empty levels array
  if (!data.levels || data.levels.length === 0) {
    if (inflightTrackId !== trackId) return;
    showPlaceholder(trackId);
    return;
  }

  renderTrack(data, currentMode);
  trackToHash(trackId);
}

// ── Mode toggle ────────────────────────────────────────────────────────────────

/**
 * Switches between civ / gov modes and re-renders from cache (no re-fetch).
 *
 * @param {'civ'|'gov'} newMode
 */
function switchMode(newMode) {
  currentMode = newMode;

  // Update aria-pressed on both mode buttons
  const modeButtons = document.querySelectorAll('[data-mode]');
  for (const btn of modeButtons) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === newMode));
    btn.classList.toggle('active', btn.dataset.mode === newMode);
  }

  // Re-render from cache — never re-fetch
  const cachedData = trackCache.get(currentTrackId);
  if (cachedData && cachedData.levels && cachedData.levels.length > 0) {
    renderTrack(cachedData, currentMode);
  }
}

// ── Event wiring ───────────────────────────────────────────────────────────────

function wireTabClicks() {
  const tablist = document.querySelector('[role="tablist"]');
  tablist.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (!tab) return;
    const trackId = tab.dataset.track;
    if (trackId && trackId !== currentTrackId) {
      switchToTrack(trackId);
    }
  });
}

function wireModeToggle() {
  const modeGroup = document.querySelector('[role="group"]');
  modeGroup.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-mode]');
    if (!btn) return;
    const newMode = btn.dataset.mode;
    if (newMode && newMode !== currentMode) {
      switchMode(newMode);
    }
  });
}

function wireKeyboard() {
  const tablist = document.querySelector('[role="tablist"]');
  tablist.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;

    const tabs = getAllTabs();
    const currentIndex = tabs.findIndex(t => t.dataset.track === currentTrackId);
    if (currentIndex === -1) return;

    let nextIndex;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length; // wrap forward
    } else {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length; // wrap backward
    }

    const nextTab = tabs[nextIndex];
    nextTab.focus();
    switchToTrack(nextTab.dataset.track);

    event.preventDefault(); // prevent page scroll
  });
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const initialTrackId = hashToTrack(); // read hash or default to "cloud-security"
    wireTabClicks();
    wireModeToggle();
    wireKeyboard();
    await switchToTrack(initialTrackId);
  } catch (err) {
    console.error('[career-ladder] bootstrap failed:', err);
  }
});
