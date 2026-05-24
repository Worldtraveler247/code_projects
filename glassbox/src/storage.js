// glassbox/src/storage.js
const KEY = "glassbox.progress.v1";

/**
 * Read saved progress. Returns null if absent or storage is unavailable.
 * @returns {{ lessonIndex: number, step: number } | null}
 */
export function loadProgress() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.lessonIndex !== "number" || typeof parsed?.step !== "number") return null;
    return parsed;
  } catch {
    return null; // storage disabled or corrupt — start fresh
  }
}

/**
 * Persist progress. Silently no-ops if storage is unavailable.
 * @param {{ lessonIndex: number, step: number }} progress
 */
export function saveProgress(progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    /* storage disabled — progress simply won't persist */
  }
}
