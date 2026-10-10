// A small model of `less`: pure state transitions, no screen access.

const MISS = 'Pattern not found  (press RETURN)';

export function createPager(lines, height = 24) {
  // One row of the screen is the status line, as in less.
  return { lines, page: Math.max(1, height - 1), top: 0, pattern: null, message: '' };
}

const maxTop = (state) => Math.max(0, state.lines.length - state.page);
const clamp = (state, top) => ({ ...state, top: Math.min(Math.max(0, top), maxTop(state)), message: '' });

function find(state, direction) {
  if (!state.pattern) return { ...state, message: 'No previous regular expression  (press RETURN)' };
  for (let i = state.top + direction; i >= 0 && i < state.lines.length; i += direction) {
    if (state.pattern.test(state.lines[i])) return { ...state, top: i, message: '' };
  }
  return { ...state, message: MISS };
}

/** Start a forward search from the line after the top of the screen. */
export function pagerSearch(state, text) {
  let pattern;
  try {
    pattern = new RegExp(text.slice(0, 200));
  } catch {
    return { ...state, message: 'Invalid pattern  (press RETURN)' };
  }
  return find({ ...state, pattern }, 1);
}

/** Apply one key press. Returns the new state and whether the pager should close. */
export function pagerKey(state, key) {
  switch (key) {
    case 'q': case 'Q': return { state, quit: true };
    case ' ': case 'f': case 'PageDown': return { state: clamp(state, state.top + state.page), quit: false };
    case 'b': case 'PageUp': return { state: clamp(state, state.top - state.page), quit: false };
    case 'j': case 'Enter': case 'ArrowDown': return { state: clamp(state, state.top + 1), quit: false };
    case 'k': case 'ArrowUp': return { state: clamp(state, state.top - 1), quit: false };
    case 'g': case 'Home': return { state: clamp(state, 0), quit: false };
    case 'G': case 'End': return { state: clamp(state, maxTop(state)), quit: false };
    case 'n': return { state: find(state, 1), quit: false };
    case 'N': return { state: find(state, -1), quit: false };
    default: return { state, quit: false };
  }
}

/** The rows to draw and the status line beneath them. */
export function pagerView(state) {
  const rows = state.lines.slice(state.top, state.top + state.page);
  const atEnd = state.top + state.page >= state.lines.length;
  return { rows, status: state.message || (atEnd ? '(END)' : ':') };
}
