// Level text formatting. One rule: `backticks` mark code. Everything is built with createElement and
// text nodes, so nothing in a level file is ever parsed as HTML.

export function splitCode(text) {
  const parts = [];
  const re = /`([^`]+)`/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push({ code: false, text: text.slice(last, m.index) });
    parts.push({ code: true, text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ code: false, text: text.slice(last) });
  return parts;
}

export function appendRich(doc, parent, text) {
  for (const part of splitCode(text)) {
    if (part.code) {
      const code = doc.createElement('code');
      code.textContent = part.text;
      parent.append(code);
    } else parent.append(doc.createTextNode(part.text));
  }
  return parent;
}

export function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Lesson blocks: {p}, {note}, {code}, {flags: [[flag, meaning], ...]}.
export function renderBlocks(doc, parent, blocks) {
  for (const block of blocks) {
    if (block.p) parent.append(appendRich(doc, el(doc, 'p'), block.p));
    else if (block.note) parent.append(appendRich(doc, el(doc, 'p', 'note'), block.note));
    else if (block.code) parent.append(el(doc, 'pre', 'code-block', block.code));
    else if (block.flags) {
      const table = el(doc, 'table', 'flags');
      for (const [flag, meaning] of block.flags) {
        const row = el(doc, 'tr');
        const th = el(doc, 'th');
        th.append(el(doc, 'code', '', flag));
        row.append(th, appendRich(doc, el(doc, 'td'), meaning));
        table.append(row);
      }
      const wrap = el(doc, 'div', 'table-scroll');
      wrap.append(table);
      parent.append(wrap);
    }
  }
  return parent;
}
