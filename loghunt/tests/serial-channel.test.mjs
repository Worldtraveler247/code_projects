import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SerialChannel } from '../serial-channel.js';

// A fake emulator that answers each framed command after a random delay, the way a shell would.
function fakeEmulator() {
  const listeners = [];
  return {
    add_listener: (_event, fn) => listeners.push(fn),
    serial_send_bytes(_port, bytes) {
      const text = new TextDecoder().decode(bytes);
      const id = text.match(/\\036S(\d+)/)?.[1];
      const body = text.match(/\{ (.*)\n\}/s)?.[1];
      if (!id) return;
      const emit = (s) => [...new TextEncoder().encode(s)].forEach((b) => listeners.forEach((fn) => fn(b)));
      setTimeout(() => emit(`\x1eS${id}\x1e\nout:${body}\n\x1eE${id}:${body === 'false' ? 1 : 0}\x1e\n`), Math.random() * 20);
    },
  };
}

test('returns the command output and exit status', async () => {
  const channel = new SerialChannel(fakeEmulator(), 1);
  const { status, output } = await channel.run('echo hi');
  assert.equal(status, 0);
  assert.equal(new TextDecoder().decode(output), 'out:echo hi\n');
  assert.equal((await channel.run('false')).status, 1);
});

test('concurrent calls are queued and each gets its own reply', async () => {
  const channel = new SerialChannel(fakeEmulator(), 1);
  const commands = Array.from({ length: 8 }, (_, i) => `cmd-${i}`);
  const replies = await Promise.all(commands.map((c) => channel.run(c)));
  assert.deepEqual(replies.map((r) => new TextDecoder().decode(r.output)), commands.map((c) => `out:${c}\n`));
});

test('a timed-out command does not block the queue', async () => {
  const silent = { add_listener: () => {}, serial_send_bytes: () => {} };
  const channel = new SerialChannel(silent, 1);
  await assert.rejects(channel.run('hang', { timeoutMs: 30 }), /timed out/);
  await assert.rejects(channel.run('next', { timeoutMs: 30 }), /timed out/);
});
