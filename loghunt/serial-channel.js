// A command channel over one v86 serial port. The page uses it on the hidden root port (ttyS1) to seed
// and reset the arena; the selftest uses it to run reference solutions. It never touches the learner's port.
//
// Each command is framed by markers built from \x1e (ASCII record separator), a byte no arena file or
// tool output contains, so the reply can be cut out of the byte stream without a terminal parser.

const RS = 0x1e;
const decoder = new TextDecoder();

export class SerialChannel {
  #emulator;
  #port;
  #bytes = [];
  #waiters = [];
  #seq = 0;
  #queue = Promise.resolve();

  constructor(emulator, port) {
    this.#emulator = emulator;
    this.#port = port;
    emulator.add_listener(`serial${port}-output-byte`, (byte) => this.#onByte(byte));
  }

  #onByte(byte) {
    this.#bytes.push(byte);
    // Bound memory if nothing is waiting (boot noise, or a command that floods).
    if (this.#waiters.length === 0 && this.#bytes.length > 1 << 20) this.#bytes.splice(0, this.#bytes.length - 4096);
    // Re-check waiters only on bytes that can complete a match, so a large reply stays linear.
    if (byte === RS || byte === 0x20 || byte === 0x0a) for (const waiter of [...this.#waiters]) waiter(byte);
  }

  send(text) {
    this.#emulator.serial_send_bytes(this.#port, new TextEncoder().encode(text));
  }

  // Resolve once predicate(text) holds for the output seen so far; `rsOnly` re-checks on marker bytes alone.
  waitFor(predicate, timeoutMs, { rsOnly = false } = {}) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const text = decoder.decode(new Uint8Array(this.#bytes));
        if (!predicate(text)) return false;
        done();
        resolve(text);
        return true;
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error(`serial${this.#port}: timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        this.#waiters = this.#waiters.filter((w) => w !== waiter);
      };
      const waiter = (byte) => { if (!rsOnly || byte === RS) check(); };
      this.#waiters.push(waiter);
      check();
    });
  }

  snapshotText() {
    return decoder.decode(new Uint8Array(this.#bytes));
  }

  clear() {
    this.#bytes = [];
  }

  // Run a shell command; resolve with { status, output } where output is stdout+stderr as bytes.
  // Calls are queued: two commands in flight would clear each other's buffer and cross their replies.
  run(command, options) {
    const result = this.#queue.then(() => this.#run(command, options));
    this.#queue = result.catch(() => {});
    return result;
  }

  async #run(command, { timeoutMs = 30_000 } = {}) {
    const id = ++this.#seq;
    const start = `\x1eS${id}\x1e\n`;
    const endPrefix = `\x1eE${id}:`;
    this.clear();
    this.send(`printf '\\036S${id}\\036\\n'; { ${command}\n} 2>&1; printf '\\036E${id}:%d\\036\\n' "$?"\n`);
    const text = await this.waitFor((t) => {
      const at = t.indexOf(endPrefix);
      return at !== -1 && t.indexOf('\x1e', at + endPrefix.length) !== -1;
    }, timeoutMs, { rsOnly: true });
    const bytes = new Uint8Array(this.#bytes);
    const startAt = indexOfBytes(bytes, start);
    const endAt = indexOfBytes(bytes, endPrefix, startAt + 1);
    const statusEnd = bytes.indexOf(RS, endAt + endPrefix.length);
    const status = Number(decoder.decode(bytes.subarray(endAt + endPrefix.length, statusEnd)));
    return { status, output: bytes.subarray(startAt + start.length, endAt), text };
  }
}

function indexOfBytes(haystack, needle, from = 0) {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = from; i <= haystack.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (haystack[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}
