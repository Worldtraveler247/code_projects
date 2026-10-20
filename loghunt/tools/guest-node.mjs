// Restore the published snapshot under Node, exactly as the page does in a browser (same options,
// same image files). Used by the selftest and by Node-side checks of the guest.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { V86 } from '../vendor/v86/libv86.mjs';
import { SerialChannel } from '../serial-channel.js';
import { guestOptions } from '../guest-options.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function restoreGuest() {
  const state = fs.readFileSync(path.join(root, 'image/state.bin.zst'));
  const emulator = new V86({
    ...guestOptions,
    wasm_path: path.join(root, 'vendor/v86/v86.wasm'),
    bios: { url: path.join(root, 'vendor/v86/seabios.bin') },
    vga_bios: { url: path.join(root, 'vendor/v86/vgabios.bin') },
    filesystem: { baseurl: path.join(root, 'image/flat'), basefs: path.join(root, 'image/fs.json') },
    initial_state: { buffer: state.buffer.slice(state.byteOffset, state.byteOffset + state.byteLength) },
    autostart: true,
  });
  const control = new SerialChannel(emulator, 1);
  const learner = new SerialChannel(emulator, 0);
  await new Promise((resolve) => emulator.add_listener('emulator-ready', resolve));
  return { emulator, control, learner };
}
