// Browser side of the guest: download and verify the snapshot, start v86 from it, wire the learner's
// serial port to the terminal, and drive the hidden root port. Nothing the learner types is ever
// interpreted by the page: keystrokes go to the guest as bytes, output comes back as bytes.

import { V86 } from './vendor/v86/libv86.mjs';
import { seedGuest } from './seed.js';
import { SETUPS } from './live.js';
import { SerialChannel } from './serial-channel.js';
import { guestOptions } from './guest-options.js';
import { STATE_SHA256, STATE_SIZE } from './image/state-meta.js';

const encoder = new TextEncoder();

export class IntegrityError extends Error {}

// Stream the snapshot so the page can show progress, then check its SHA-256 before using a byte of it.
export async function downloadState(url, onProgress = () => {}) {
  // The hash in the query gives every snapshot build its own cache entry; a stale cached copy can't be reused.
  const versioned = new URL(url);
  versioned.searchParams.set('v', STATE_SHA256.slice(0, 16));
  const response = await fetch(versioned);
  if (!response.ok) throw new Error(`could not download the VM image (HTTP ${response.status})`);
  const total = Number(response.headers.get('content-length')) || STATE_SIZE;
  const reader = response.body.getReader();
  const bytes = new Uint8Array(STATE_SIZE);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.length > bytes.length) throw new IntegrityError('VM image is larger than expected');
    bytes.set(value, received);
    received += value.length;
    onProgress(received, total);
  }
  if (received !== STATE_SIZE) throw new IntegrityError('VM image is truncated');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== STATE_SHA256) throw new IntegrityError('VM image failed its integrity check');
  return bytes.buffer;
}

export class GuestVM {
  #state;
  #emulator = null;
  #control = null;
  #onOutput;
  #base;

  // base: URL of the loghunt/ directory; onOutput(byte) receives the learner's terminal output.
  constructor({ state, base, onOutput }) {
    this.#state = state;
    this.#base = base;
    this.#onOutput = onOutput;
  }

  async start() {
    const url = (p) => new URL(p, this.#base).href;
    const emulator = new V86({
      ...guestOptions,
      wasm_path: url('vendor/v86/v86.wasm'),
      bios: { url: url('vendor/v86/seabios.bin') },
      vga_bios: { url: url('vendor/v86/vgabios.bin') },
      filesystem: { baseurl: url('image/flat/'), basefs: url('image/fs.json') },
      // v86 may take ownership of the buffer, so each start gets its own copy for restarts.
      initial_state: { buffer: this.#state.slice(0) },
      autostart: true,
    });
    await new Promise((resolve) => emulator.add_listener('emulator-ready', resolve));
    emulator.add_listener('serial0-output-byte', (byte) => this.#onOutput(byte));
    this.#emulator = emulator;
    this.#control = new SerialChannel(emulator, 1);
    await this.#control.run('stty -echo -onlcr', { timeoutMs: 15_000 });
    // Ctrl+L makes bash clear the screen and draw a fresh prompt.
    this.type('\x0c');
  }

  type(text) {
    this.#emulator?.serial_send_bytes(0, encoder.encode(text));
  }

  async resize(cols, rows) {
    if (!this.#control || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 10 || rows < 3) return;
    // The serial line has no size of its own; tell its tty, then nudge the foreground job to redraw.
    await this.#control.run(`stty -F /dev/ttyS0 cols ${cols} rows ${rows}; pkill -WINCH -t ttyS0 2>/dev/null; true`);
  }

  // Rebuild ~/arena from generateArena() output (see seed.js and tools/image/loghunt-seed).
  seed(arena) {
    return seedGuest(this.#emulator, this.#control, arena);
  }

  // Start a side quest's background writer by its registry key (live.js). Level files name a key only.
  setup(name) {
    return SETUPS[name](this.#emulator, this.#control);
  }

  // The learner's last commands, oldest first. bash appends each one as it runs (PROMPT_COMMAND='history -a').
  async history(count = 15) {
    if (!this.#control) return [];
    const { output } = await this.#control.run(`tail -n ${Math.trunc(count)} /home/analyst/.bash_history 2>/dev/null; true`, { timeoutMs: 5_000 });
    return new TextDecoder().decode(output).split('\n').filter((line) => line.trim() !== '');
  }

  // Throw away the whole machine, hung or not, and start again from the snapshot.
  async restart() {
    await this.stop();
    await this.start();
  }

  async stop() {
    const emulator = this.#emulator;
    this.#emulator = null;
    this.#control = null;
    if (emulator) await emulator.destroy();
  }
}
