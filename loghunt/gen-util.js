// Deterministic randomness and the timestamp formats of each RHEL log source. Every time is UTC
// seconds since the epoch; nothing here reads the clock or Math.random, so output depends on the seed only.

export function rng(seed) {
  // mulberry32: small, fast, and identical in every JavaScript engine.
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
    // Weighted pick: entries are [value, weight].
    weighted(entries) {
      const total = entries.reduce((n, [, w]) => n + w, 0);
      let r = next() * total;
      for (const [value, w] of entries) if ((r -= w) < 0) return value;
      return entries[entries.length - 1][0];
    },
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n, w = 2) => String(n).padStart(w, '0');
const parts = (ts) => {
  const d = new Date(ts * 1000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
};

// Apache combined log: 13/Mar/2026:22:14:03 +0000
export function apacheTime(ts) {
  const p = parts(ts);
  return `${pad(p.d)}/${MONTHS[p.mo]}/${p.y}:${pad(p.h)}:${pad(p.mi)}:${pad(p.s)} +0000`;
}

// rsyslog traditional format: "Mar 13 22:14:03", day padded with a space ("Mar  3"), no year.
export function syslogTime(ts) {
  const p = parts(ts);
  return `${MONTHS[p.mo]} ${String(p.d).padStart(2, ' ')} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

// ISO 8601 UTC: 2026-03-13T22:14:03Z
export function isoTime(ts) {
  const p = parts(ts);
  return `${p.y}-${pad(p.mo + 1)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}Z`;
}

// Java/logback style: 2026-03-13 22:14:03,117
export function appTime(ts, ms) {
  const p = parts(ts);
  return `${p.y}-${pad(p.mo + 1)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)},${pad(ms, 3)}`;
}

// sar -u with a 12-hour locale: "11:10:01 PM"
export function sarTime(ts) {
  const p = parts(ts);
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${pad(h12)}:${pad(p.mi)}:${pad(p.s)} ${p.h < 12 ? 'AM' : 'PM'}`;
}

// sar header date: 03/13/2026
export function sarDate(ts) {
  const p = parts(ts);
  return `${pad(p.mo + 1)}/${pad(p.d)}/${p.y}`;
}

// auditd: audit(1773443985.123:4512)
export function auditStamp(ts, ms, serial) {
  return `audit(${ts}.${pad(ms, 3)}:${serial})`;
}
