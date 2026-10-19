// Round rules: which card comes next and what a miss costs. No DOM access.

// A missed card comes back this many cards later, so it is asked again before the round ends.
export const RETRY_GAP = 3;

export function shuffle(list, random = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function newRound(cards, deck, random = Math.random) {
  const pool = deck === 'all' ? cards : cards.filter((card) => card.deck === deck);
  return { queue: shuffle(pool, random).map((card) => card.id), firstTry: 0, total: pool.length, missed: new Set() };
}

// result: 'right' | 'wrong'. Returns a new round; the current card is always queue[0].
export function answer(round, result) {
  const [current, ...rest] = round.queue;
  const missed = new Set(round.missed);
  let firstTry = round.firstTry;
  let queue = rest;
  if (result === 'right') {
    if (!missed.has(current)) firstTry += 1;
  } else {
    missed.add(current);
    const at = Math.min(RETRY_GAP, rest.length);
    queue = [...rest.slice(0, at), current, ...rest.slice(at)];
  }
  return { ...round, queue, firstTry, missed };
}

export function isOver(round) {
  return round.queue.length === 0;
}

// Saved progress per card id: { right, wrong, streak }.
export function record(stats, id, result) {
  const prev = stats[id] ?? { right: 0, wrong: 0, streak: 0 };
  const next = result === 'right'
    ? { right: prev.right + 1, wrong: prev.wrong, streak: prev.streak + 1 }
    : { right: prev.right, wrong: prev.wrong + 1, streak: 0 };
  return { ...stats, [id]: next };
}

// Known = answered right three times in a row, the same three-touch rule as the vocabulary deck.
export const KNOWN_STREAK = 3;

export function known(stats, id) {
  return (stats[id]?.streak ?? 0) >= KNOWN_STREAK;
}
