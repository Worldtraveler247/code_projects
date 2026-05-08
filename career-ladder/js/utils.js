/**
 * utils.js — shared helpers for the Career Ladder app
 */

const VALID_TRACKS = new Set(['cloud-security', 'cybersecurity', 'devsecops', 'ai-ml']);

export const SALARY_SCALE = 250_000;

/**
 * Returns inline-style values to position a salary range band on a fixed-width bar.
 * Inputs are clamped to [0, scale] so bad data never produces negative widths or overflow.
 *
 * @param {number} salary_min
 * @param {number} salary_max
 * @param {number} scale - right edge of the bar in dollars (default SALARY_SCALE)
 * @returns {{ left: string, width: string }}
 */
export function salaryBarWidth(salary_min, salary_max, scale = SALARY_SCALE) {
  const safeMin = Math.max(0, Math.min(salary_min, scale));
  const safeMax = Math.max(safeMin, Math.min(salary_max, scale));
  const left  = (safeMin / scale) * 100;
  const width = ((safeMax - safeMin) / scale) * 100;
  return { left: `${left.toFixed(1)}%`, width: `${width.toFixed(1)}%` };
}

/**
 * Builds a <span> chip element.
 *
 * @param {string} text
 * @param {'skill'|'cert'} type
 * @returns {HTMLElement}
 */
export function buildChip(text, type = 'skill') {
  const span = document.createElement('span');
  span.className = type === 'cert' ? 'chip chip--cert' : 'chip';
  span.textContent = text;
  return span;
}

/**
 * Reads the active track ID from location.hash.
 * Falls back to "cloud-security" when no hash is present.
 *
 * @returns {string}
 */
export function hashToTrack() {
  const hash = location.hash.replace(/^#/, '').trim();
  return VALID_TRACKS.has(hash) ? hash : 'cloud-security';
}

/**
 * Sets location.hash to the given track ID.
 *
 * @param {string} trackId
 */
export function trackToHash(trackId) {
  location.hash = trackId;
}
