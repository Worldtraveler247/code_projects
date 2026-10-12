// A small modal editor: the subset of Vim needed to write a playbook.
// Pure state and key handling; nothing here touches the page, so it runs under Node tests.

export const SHIFT = 2;
const UNDO_LIMIT = 200;

export function createEditor(text = '') {
  return {
    lines: text.split('\n'),
    row: 0,
    col: 0,
    mode: 'normal',
    pending: '',
    command: '',
    register: null,
    undo: [],
    message: '',
  };
}

export function getText(state) {
  return state.lines.join('\n');
}

// Returns null, or an event the page acts on: { type: 'write' | 'next' | 'prev' | 'help' }.
export function handleKey(state, key) {
  state.message = '';
  if (state.mode === 'insert') return insertKey(state, key);
  if (state.mode === 'command') return commandKey(state, key);
  return normalKey(state, key);
}

// Pasted text goes in as typed, without auto-indent, or every pasted line would be indented twice.
export function insertText(state, text) {
  if (state.mode !== 'insert') {
    snapshot(state);
    state.mode = 'insert';
  }
  const parts = text.replace(/\r\n?/g, '\n').replace(/\t/g, ' '.repeat(SHIFT)).split('\n');
  const line = state.lines[state.row];
  const before = line.slice(0, state.col);
  const after = line.slice(state.col);
  if (parts.length === 1) {
    state.lines[state.row] = before + parts[0] + after;
    state.col += parts[0].length;
    return;
  }
  const last = parts[parts.length - 1];
  const middle = parts.slice(1, -1);
  state.lines.splice(state.row, 1, before + parts[0], ...middle, last + after);
  state.row += parts.length - 1;
  state.col = last.length;
}

function snapshot(state) {
  state.undo.push({ lines: state.lines.slice(), row: state.row, col: state.col });
  if (state.undo.length > UNDO_LIMIT) state.undo.shift();
}

function indentOf(line) {
  return line.match(/^ */)[0];
}

function clamp(state) {
  state.row = Math.max(0, Math.min(state.row, state.lines.length - 1));
  const length = state.lines[state.row].length;
  const max = state.mode === 'insert' ? length : Math.max(0, length - 1);
  state.col = Math.max(0, Math.min(state.col, max));
}

function enterInsert(state) {
  snapshot(state);
  state.mode = 'insert';
}

function firstNonBlank(line) {
  const index = line.search(/\S/);
  return index === -1 ? 0 : index;
}

function wordForward(state) {
  const line = state.lines[state.row];
  for (let i = state.col + 1; i < line.length; i += 1) {
    if (line[i] !== ' ' && line[i - 1] === ' ') {
      state.col = i;
      return;
    }
  }
  if (state.row < state.lines.length - 1) {
    state.row += 1;
    state.col = firstNonBlank(state.lines[state.row]);
  } else {
    state.col = line.length;
  }
}

function wordBackward(state) {
  const line = state.lines[state.row];
  for (let i = Math.min(state.col - 1, line.length - 1); i >= 0; i -= 1) {
    if (line[i] !== ' ' && (i === 0 || line[i - 1] === ' ')) {
      state.col = i;
      return;
    }
  }
  if (state.row > 0) {
    state.row -= 1;
    state.col = state.lines[state.row].length;
  }
}

function put(state, above) {
  const reg = state.register;
  if (!reg) return;
  snapshot(state);
  if (reg.linewise) {
    const at = above ? state.row : state.row + 1;
    state.lines.splice(at, 0, ...reg.lines);
    state.row = at;
    state.col = firstNonBlank(state.lines[at]);
    return;
  }
  const line = state.lines[state.row];
  const at = above || line.length === 0 ? state.col : state.col + 1;
  state.lines[state.row] = line.slice(0, at) + reg.text + line.slice(at);
  state.col = at + reg.text.length - 1;
}

function normalKey(state, key) {
  const pending = state.pending;
  state.pending = '';
  if (pending) {
    const combo = pending + key;
    if (combo === 'dd') {
      snapshot(state);
      state.register = { linewise: true, lines: state.lines.splice(state.row, 1) };
      if (state.lines.length === 0) state.lines.push('');
      clamp(state);
      state.col = firstNonBlank(state.lines[state.row]);
    } else if (combo === 'yy') {
      state.register = { linewise: true, lines: [state.lines[state.row]] };
      state.message = '1 line yanked';
    } else if (combo === 'gg') {
      state.row = 0;
      state.col = 0;
    }
    clamp(state);
    return null;
  }

  const line = state.lines[state.row];
  switch (key) {
    case 'h': case 'ArrowLeft': case 'Backspace': state.col -= 1; break;
    case 'l': case 'ArrowRight': case ' ': state.col += 1; break;
    case 'j': case 'ArrowDown': case 'Enter': state.row += 1; break;
    case 'k': case 'ArrowUp': state.row -= 1; break;
    case '0': case 'Home': state.col = 0; break;
    case '^': state.col = firstNonBlank(line); break;
    case '$': case 'End': state.col = line.length; break;
    case 'w': wordForward(state); break;
    case 'b': wordBackward(state); break;
    case 'G': state.row = state.lines.length - 1; state.col = 0; break;
    case 'g': case 'd': case 'y': state.pending = key; break;
    case 'x':
      if (line.length > 0) {
        snapshot(state);
        state.register = { linewise: false, text: line[state.col] };
        state.lines[state.row] = line.slice(0, state.col) + line.slice(state.col + 1);
      }
      break;
    case 'D':
      if (line.length > 0) {
        snapshot(state);
        state.register = { linewise: false, text: line.slice(state.col) };
        state.lines[state.row] = line.slice(0, state.col);
      }
      break;
    case 'p': put(state, false); break;
    case 'P': put(state, true); break;
    case 'u': {
      const previous = state.undo.pop();
      if (!previous) {
        state.message = 'Already at oldest change';
        break;
      }
      state.lines = previous.lines;
      state.row = previous.row;
      state.col = previous.col;
      break;
    }
    case 'i': enterInsert(state); break;
    case 'I': enterInsert(state); state.col = firstNonBlank(line); break;
    case 'a': enterInsert(state); state.col = Math.min(state.col + 1, line.length); break;
    case 'A': enterInsert(state); state.col = line.length; break;
    case 'o':
      enterInsert(state);
      state.lines.splice(state.row + 1, 0, indentOf(line));
      state.row += 1;
      state.col = state.lines[state.row].length;
      break;
    case 'O':
      enterInsert(state);
      state.lines.splice(state.row, 0, indentOf(line));
      state.col = state.lines[state.row].length;
      break;
    case ':':
      state.mode = 'command';
      state.command = '';
      break;
    default:
      break;
  }
  clamp(state);
  return null;
}

function leaveInsert(state) {
  state.mode = 'normal';
  if (state.col > 0) state.col -= 1;
  // An insert session that changed nothing should not cost the user an undo step.
  const last = state.undo[state.undo.length - 1];
  if (last && last.lines.join('\n') === getText(state)) state.undo.pop();
  clamp(state);
}

function insertKey(state, key) {
  const line = state.lines[state.row];
  const before = line.slice(0, state.col);
  const after = line.slice(state.col);

  switch (key) {
    case 'Escape':
      leaveInsert(state);
      return null;
    case 'Enter': {
      // Auto-indent: the new line starts in the column of the current one.
      const indent = indentOf(line).slice(0, state.col);
      state.lines[state.row] = before.trim() === '' ? '' : before;
      state.lines.splice(state.row + 1, 0, indent + after.trimStart());
      state.row += 1;
      state.col = indent.length;
      return null;
    }
    case 'Backspace':
      if (state.col > 0) {
        // Inside the indentation, Backspace removes one whole step, as Vim does with softtabstop.
        const step = before.trim() === '' && state.col % SHIFT === 0 ? SHIFT : 1;
        state.lines[state.row] = before.slice(0, -step) + after;
        state.col -= step;
      } else if (state.row > 0) {
        const previous = state.lines[state.row - 1];
        state.lines.splice(state.row - 1, 2, previous + line);
        state.row -= 1;
        state.col = previous.length;
      }
      return null;
    case 'Delete':
      if (after.length > 0) {
        state.lines[state.row] = before + after.slice(1);
      } else if (state.row < state.lines.length - 1) {
        state.lines.splice(state.row, 2, line + state.lines[state.row + 1]);
      }
      return null;
    case 'Tab': {
      // Tab inserts spaces up to the next step. YAML rejects real tab characters.
      const count = SHIFT - (state.col % SHIFT);
      state.lines[state.row] = before + ' '.repeat(count) + after;
      state.col += count;
      return null;
    }
    case 'ArrowLeft': state.col -= 1; break;
    case 'ArrowRight': state.col += 1; break;
    case 'ArrowUp': state.row -= 1; break;
    case 'ArrowDown': state.row += 1; break;
    case 'Home': state.col = 0; break;
    case 'End': state.col = line.length; break;
    default:
      if ([...key].length === 1) {
        state.lines[state.row] = before + key + after;
        state.col += key.length;
      }
      return null;
  }
  clamp(state);
  return null;
}

function commandKey(state, key) {
  if (key === 'Escape') {
    state.mode = 'normal';
    state.command = '';
    return null;
  }
  if (key === 'Backspace') {
    if (state.command === '') state.mode = 'normal';
    else state.command = state.command.slice(0, -1);
    return null;
  }
  if (key === 'Enter') {
    const command = state.command.trim();
    state.mode = 'normal';
    state.command = '';
    return runCommand(state, command);
  }
  if ([...key].length === 1) state.command += key;
  return null;
}

function runCommand(state, command) {
  if (command === '') return null;
  if (['w', 'w!', 'wq', 'wq!', 'x'].includes(command)) return { type: 'write' };
  if (['n', 'next'].includes(command)) return { type: 'next' };
  if (['N', 'prev', 'previous'].includes(command)) return { type: 'prev' };
  if (['h', 'help'].includes(command)) return { type: 'help' };
  if (['q', 'q!'].includes(command)) {
    state.message = 'Nothing to quit to. Use :w to check your playbook.';
    return null;
  }
  if (command === '%d') {
    snapshot(state);
    state.lines = [''];
    state.row = 0;
    state.col = 0;
    return null;
  }
  if (/^\d+$/.test(command)) {
    state.row = Number(command) - 1;
    state.col = 0;
    clamp(state);
    return null;
  }
  state.message = `E492: Not an editor command: ${command}`;
  return null;
}
