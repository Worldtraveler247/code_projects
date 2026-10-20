// Per-level progress: solved, hints used, attempts, active time, score. Stored in localStorage like the
// hub's other games; if storage is unavailable (private window, quota), play continues for this visit.

export const PROGRESS_KEY = 'loghunt:progress:v1';
export const BASE_SCORE = 100;
export const MIN_SCORE = 10;
export const HINT_PENALTY = [10, 20, 35];

export function scoreFor(hintsUsed) {
  const penalty = HINT_PENALTY.slice(0, hintsUsed).reduce((a, b) => a + b, 0);
  return Math.max(MIN_SCORE, BASE_SCORE - penalty);
}

export function browserStorage() {
  return {
    read(key) {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    write(key, value) {
      try { localStorage.setItem(key, value); } catch { /* private window or quota: keep playing */ }
    },
  };
}

export function memoryStorage() {
  const data = new Map();
  return { read: (k) => data.get(k) ?? null, write: (k, v) => { data.set(k, v); } };
}

const fresh = () => ({ solved: false, hintsUsed: 0, attempts: 0, activeMs: 0, score: 0 });

export class Progress {
  #storage;
  #now;
  #levels;
  #open = null;
  #since = null;

  constructor({ storage = browserStorage(), now = () => Date.now() } = {}) {
    this.#storage = storage;
    this.#now = now;
    this.#levels = this.#load();
  }

  #load() {
    try {
      const parsed = JSON.parse(this.#storage.read(PROGRESS_KEY) ?? '{}');
      return parsed && typeof parsed === 'object' && parsed.levels && typeof parsed.levels === 'object' ? parsed.levels : {};
    } catch {
      return {};
    }
  }

  #save() {
    try {
      this.#storage.write(PROGRESS_KEY, JSON.stringify({ levels: this.#levels }));
    } catch { /* see browserStorage */ }
  }

  #entry(id) {
    this.#levels[id] = { ...fresh(), ...this.#levels[id] };
    return this.#levels[id];
  }

  get(id) {
    return { ...fresh(), ...this.#levels[id] };
  }

  // Time: one level is "open" at a time; the clock runs while it is open, visible, and unsolved.
  #flush() {
    if (this.#open && this.#since !== null) {
      const e = this.#entry(this.#open);
      if (!e.solved) e.activeMs += this.#now() - this.#since;
    }
    this.#since = this.#open ? this.#now() : null;
  }

  open(id) {
    this.#flush();
    this.#open = id;
    this.#since = this.#now();
    this.#save();
  }

  pause() {
    this.#flush();
    this.#since = null;
    this.#save();
  }

  resume() {
    if (this.#open) this.#since = this.#now();
  }

  recordAttempt(id, correct) {
    this.#flush();
    const e = this.#entry(id);
    e.attempts += 1;
    if (correct && !e.solved) {
      e.solved = true;
      e.score = scoreFor(e.hintsUsed);
    }
    this.#save();
    return this.get(id);
  }

  // Returns the number of hint tiers now revealed. Hints after solving cost nothing.
  useHint(id) {
    const e = this.#entry(id);
    e.hintsUsed = Math.min(HINT_PENALTY.length, e.hintsUsed + 1);
    this.#save();
    return e.hintsUsed;
  }

  totals(ids) {
    return ids.reduce((t, id) => {
      const s = this.get(id);
      return { solved: t.solved + (s.solved ? 1 : 0), score: t.score + s.score, levels: t.levels + 1 };
    }, { solved: 0, score: 0, levels: 0 });
  }

  reset() {
    this.#levels = {};
    this.#since = this.#open ? this.#now() : null;
    this.#save();
  }
}
