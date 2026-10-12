// Syntax colouring for one line of a playbook. Returns a class name per character, so the
// editor can place its cursor on any column and the guide can merge runs into spans.

const KEY = /^[A-Za-z_][\w.-]*(?=:( |$))/;

// Index of the " #" that starts a trailing comment, ignoring any inside quotes.
function commentStart(text, from) {
  let quote = '';
  for (let i = from; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '#' && (i === from || text[i - 1] === ' ')) {
      return i;
    }
  }
  return text.length;
}

function valueClass(value) {
  if (value === '') return '';
  if (/^[|>][+-]?$/.test(value)) return 'tok-pipe';
  if (/^["']/.test(value)) return 'tok-str';
  if (/^(true|false|yes|no)$/i.test(value)) return 'tok-bool';
  if (/^-?\d+(\.\d+)?$/.test(value)) return 'tok-num';
  return 'tok-val';
}

export function charClasses(text) {
  const classes = new Array(text.length).fill('');
  const paint = (from, to, name) => { for (let i = from; i < to; i += 1) classes[i] = name; };

  const lead = text.match(/^ */)[0].length;
  paint(0, lead, 'lead');
  let at = lead;
  const body = text.slice(lead);
  if (body.startsWith('#')) {
    paint(lead, text.length, 'tok-comment');
    return classes;
  }
  if (/^---(\s|$)/.test(body)) {
    paint(at, at + 3, 'tok-dash');
    at += 3;
  } else if (body.startsWith('- ') || body === '-') {
    paint(at, at + 1, 'tok-dash');
    at += 2;
  }
  const key = text.slice(at).match(KEY);
  if (key) {
    paint(at, at + key[0].length, 'tok-key');
    classes[at + key[0].length] = 'tok-punct';
    at += key[0].length + 1;
  }
  const comment = commentStart(text, at);
  const value = text.slice(at, comment);
  const start = at + (value.length - value.trimStart().length);
  const end = at + value.trimEnd().length;
  if (end > start) paint(start, end, valueClass(text.slice(start, end)));
  paint(comment, text.length, 'tok-comment');
  return classes;
}

// Merges equal neighbours: [{ text, cls }].
export function segments(text) {
  const classes = charClasses(text);
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    const last = out[out.length - 1];
    if (last && last.cls === classes[i]) last.text += text[i];
    else out.push({ text: text[i], cls: classes[i] });
  }
  return out;
}
