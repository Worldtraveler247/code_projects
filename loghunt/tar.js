// Minimal POSIX ustar writer: regular files and directories only. The generator hands the arena to the
// guest as one archive because tar headers carry modification times, which `find -mtime` levels need.

const BLOCK = 512;
const encoder = new TextEncoder();

// entries: [{ path, data?: Uint8Array, mtime: epochSeconds, dir?: boolean, mode?: number }]
export function createTar(entries, { uid = 1000, gid = 1000 } = {}) {
  const chunks = [];
  for (const entry of entries) {
    const data = entry.dir ? new Uint8Array(0) : entry.data;
    chunks.push(header(entry, data.length, uid, gid));
    if (data.length) {
      chunks.push(data);
      const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
      if (pad) chunks.push(new Uint8Array(pad));
    }
  }
  chunks.push(new Uint8Array(BLOCK * 2));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

function header(entry, size, uid, gid) {
  const h = new Uint8Array(BLOCK);
  const [prefix, name] = splitPath(entry.dir ? `${entry.path.replace(/\/$/, '')}/` : entry.path);
  put(h, 0, 100, name);
  putOctal(h, 100, 8, entry.mode ?? (entry.dir ? 0o755 : 0o644));
  putOctal(h, 108, 8, uid);
  putOctal(h, 116, 8, gid);
  putOctal(h, 124, 12, size);
  putOctal(h, 136, 12, entry.mtime);
  h.fill(0x20, 148, 156); // checksum is computed with its own field as spaces
  h[156] = entry.dir ? 0x35 : 0x30;
  put(h, 257, 6, 'ustar');
  put(h, 263, 2, '00');
  put(h, 345, 155, prefix);
  const sum = h.reduce((n, b) => n + b, 0);
  putOctal(h, 148, 7, sum);
  h[155] = 0x20;
  return h;
}

function splitPath(path) {
  const bytes = encoder.encode(path);
  if (bytes.length <= 100) return ['', path];
  // Split at a slash so the name part fits in 100 bytes and the prefix in 155.
  for (let i = path.length - 1; i > 0; i--) {
    if (path[i] !== '/') continue;
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (encoder.encode(prefix).length <= 155 && encoder.encode(name).length <= 100) return [prefix, name];
  }
  throw new Error(`tar: path too long for ustar: ${path}`);
}

function put(h, offset, length, text) {
  const bytes = encoder.encode(text);
  if (bytes.length > length) throw new Error(`tar: field overflow: ${text}`);
  h.set(bytes, offset);
}

function putOctal(h, offset, length, value) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`tar: bad numeric field: ${value}`);
  put(h, offset, length, value.toString(8).padStart(length - 1, '0'));
}

// gzip in the page (and in Node) before handing the archive to the guest: fewer bytes cross the 9p
// filesystem, and in a browser each 9p round trip is slow. The guest decompresses to identical bytes.
export async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
