// Where the caret sits in the editor text, for the status bar and for the cursorline,
// cursorcolumn and block cursor drawn beneath the textarea.

const TAB_SIZE = 2; // must match tab-size on the editor in index.html

/**
 * Locate a caret offset within text.
 * line and column are 1-based, as the status bar shows them. cell is the 0-based
 * screen column, which differs from column only when the line holds a tab.
 */
export function locateCaret(text, offset) {
  const source = String(text);
  const at = Math.max(0, Math.min(Number.isFinite(offset) ? Math.trunc(offset) : 0, source.length));
  const lineStart = source.lastIndexOf('\n', at - 1) + 1;
  let line = 1;
  for (let i = source.indexOf('\n'); i !== -1 && i < at; i = source.indexOf('\n', i + 1)) line += 1;
  let cell = 0;
  for (let i = lineStart; i < at; i += 1) cell = source[i] === '\t' ? cell + TAB_SIZE - (cell % TAB_SIZE) : cell + 1;
  return { line, column: at - lineStart + 1, cell };
}
