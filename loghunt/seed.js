// Hand a generated arena to the guest. Shared by the page (vm.js), the selftest, and the guest tests,
// so the code under test is the code that ships.
import { arenaTar } from './generator.js';
import { gzip as gzipBytes } from './tar.js';

const encoder = new TextEncoder();
let seq = 0;

// arena: generateArena() output. control: the root SerialChannel. Throws if the guest script fails.
export async function seedGuest(emulator, control, arena) {
  const id = `${Date.now()}-${++seq}`;
  const list = arena.gzip.map(({ path, final }) => (final ? `${path}\t${final}\n` : `${path}\n`)).join('');
  await emulator.create_file(`/var/lib/loghunt/seed-${id}.tar.gz`, await gzipBytes(arenaTar(arena)));
  await emulator.create_file(`/var/lib/loghunt/seed-${id}.gzlist`, encoder.encode(list));
  const { status, output } = await control.run(`loghunt-seed ${id} ${Math.trunc(arena.now)}`, { timeoutMs: 60_000 });
  const text = new TextDecoder().decode(output).trim();
  if (status !== 0) throw new Error(`arena seed failed: ${text}`);
  return text;
}
