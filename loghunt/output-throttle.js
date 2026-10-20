// Sits between the guest's serial port and xterm.js. Bytes are batched into one write per animation
// frame, and a runaway command (`cat /dev/urandom`, `yes`) cannot pile up more than maxBacklog bytes:
// the excess is dropped with a one-line notice, so the page keeps rendering and Ctrl+C still gets through.

export class OutputThrottle {
  #write;
  #schedule;
  #perFlush;
  #maxBacklog;
  #buffer;
  #length = 0;
  #dropped = 0;
  #pending = false;

  constructor({ write, schedule = (fn) => requestAnimationFrame(fn), perFlush = 64 * 1024, maxBacklog = 512 * 1024 }) {
    this.#write = write;
    this.#schedule = schedule;
    this.#perFlush = perFlush;
    this.#maxBacklog = maxBacklog;
    this.#buffer = new Uint8Array(maxBacklog);
  }

  push(byte) {
    if (this.#length === this.#maxBacklog) {
      // Drop everything queued; keeping the newest tail would only print more noise.
      this.#dropped += this.#length;
      this.#length = 0;
    }
    this.#buffer[this.#length++] = byte;
    if (!this.#pending) {
      this.#pending = true;
      this.#schedule(() => this.#flush());
    }
  }

  reset() {
    this.#length = 0;
    this.#dropped = 0;
  }

  #flush() {
    this.#pending = false;
    if (this.#dropped) {
      const skipped = this.#dropped + this.#length;
      this.#dropped = 0;
      this.#length = 0;
      this.#write(new TextEncoder().encode(
        `\r\n\x1b[33m[LOGHUNT: output throttled, ${skipped} bytes skipped. Press Ctrl+C to stop the command.]\x1b[0m\r\n`));
      return;
    }
    const n = Math.min(this.#length, this.#perFlush);
    if (n === 0) return;
    // A copy, not a view: xterm.js may queue the array and render it after the buffer is reused.
    this.#write(this.#buffer.slice(0, n));
    this.#buffer.copyWithin(0, n, this.#length);
    this.#length -= n;
    if (this.#length) {
      this.#pending = true;
      this.#schedule(() => this.#flush());
    }
  }
}
