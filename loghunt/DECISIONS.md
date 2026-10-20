# LOGHUNT — decisions log

Small choices made while building, with the reason. Architecture and security choices that Eddie
approved are marked **(approved)**. Newest phase last.

## Phase 0 — spike (2026-10-20)

### Execution: v86 running a real Alpine guest **(approved)**
Learners type into a real GNU userland, so behaviour and error messages are genuine. CheerpX/WebVM was
ruled out: it needs cross-origin isolation headers (COOP/COEP) that GitHub Pages cannot send, its licence
is proprietary, and it expects to load from its vendor's CDN.

### Pinned versions
| Component | Version | Why this one |
|---|---|---|
| v86 | 0.5.470 (2026-10-04) | newest release at least two weeks old; 0.5.472 was two days old |
| xterm.js / addon-fit | 6.0.0 / 0.11.0 | newest stable |
| Guest base | `docker.io/i386/alpine:3.21.0`, digest `sha256:fcc4c908760c4f561a5199f2e53576063b1b8eeaa0c41e6432d705aab4389753` | the base v86's own Alpine recipe is tested against |

Provenance and hashes: `vendor/README.md`, `vendor/manifest.json`.

### Guest image: 9p root filesystem + saved snapshot (changed from the plan)
The plan said "one RAM snapshot file". The build instead follows v86's own tested Alpine recipe: the root
filesystem is served as content-addressed zstd files (`image/flat/`, listed in `image/fs.json`) that the
guest fetches **only when it opens them**, plus a snapshot of the booted machine (`image/state.bin.zst`).
Same outcome for the learner (no boot, prompt at once), lower risk, and the browser downloads only the
binaries actually used. Still same-origin, still committed in `loghunt/image/` as approved.

Measured:
| Item | Size | Target |
|---|---|---|
| `state.bin.zst` (always downloaded) | 11.4 MB (35.4 MB raw) | ≤ 25 MB ✅ |
| `flat/` (fetched per file on use) | 12 MB, 649 files | — |
| `fs.json` | 128 KB | — |
| Total committed under `image/` | 24 MB | — |

Trimmed to get there: the kernel module tree (20 MB; the initramfs already holds the virtio and 9p
modules, and nothing loads modules after boot), `System.map`/kernel config, and the kernel + initramfs
themselves, which a restored snapshot never reads (deleted in the guest before saving, pruned from `flat/`).

**Rebuild only when the tool set changes.** Every rebuild commits a new ~11.5 MB snapshot to git history
forever. Level and data changes never touch the image: the arena is generated in JavaScript.

### Time to a ready terminal
Chrome on Eddie's Mac, served from localhost: snapshot fetched and integrity-checked in 36 ms, emulator
ready at 67 ms, first command answered immediately. Target ≤ 5 s ✅. On GitHub Pages the 11.5 MB download
dominates (about 2 s at 50 Mbit/s); the page shows download progress.

### Guest checks (from `tools/make-snapshot.mjs`, re-run on every snapshot build)
GNU Awk 5.3.1 · GNU coreutils 9.5 · GNU grep 3.11 · GNU sed 4.9 · GNU findutils 4.10.0 ·
util-linux 2.40.4 `column` · file 5.46 · kernel 6.12.113-virt. Network interfaces: `lo` only.
`wget http://192.0.2.1/` → "Network unreachable". The build fails if any of these regress.

### Two serial ports
`ttyS0` is the learner's shell (user `analyst`, non-root). `ttyS1` is a hidden root shell the page uses to
seed, reset, and (in the selftest) run reference solutions. Autologin on ttyS1 needs no password.

**Bug found and fixed in the spike:** the first image left root's password empty, and `su -c id` from
`analyst` returned `uid=0`. Now root's password is locked (`passwd -l`), BusyBox's setuid helper
`/bin/bbsuid` has its setuid bit removed, and there is no `sudo`. `tools/make-snapshot.mjs` runs
`su -c id` as `analyst` on every build and fails if it reaches uid 0. (Root inside the guest could never
touch the host. The point is game integrity: root could reset the clock or edit seed internals.)

### Seeding by tar archive
`create_file` in v86 does not create parent directories, and `find -mtime` levels need exact file times.
The generator writes one ustar archive (`tar.js`); tar headers carry modification times, so one file write
plus `tar -x` in the guest reproduces the whole tree with its times. `.gz` files are produced **inside
the guest** with `gzip -n`, so their bytes (and therefore `find -size`/`ls -l` answers) never vary between
browsers. The seed script also sets the guest clock to the story's "now".

Known limit: compressing a file updates its directory's modification time, so no level asks about
directory modification times.

### `LC_ALL=C`, `TZ=UTC` in the learner's shell
Answers must be identical on every run. Set in `/etc/profile.d/loghunt.sh` and repeated in `.bashrc`
because `su -l` did not pick up the profile.d file in testing. Level 4 teaches why RHEL's default
`en_US.UTF-8` sorts differently.

### Content-Security-Policy for the LOGHUNT page (security; for Eddie's review)
The hub's game pages use `script-src 'self'`. LOGHUNT needs two additions, on its own page only:
- `'wasm-unsafe-eval'` in `script-src`: v86 compiles guest code into new WebAssembly at run time.
- `worker-src blob:`: v86 starts two Web Workers from `blob:` URLs (zstd decompression and its timing
  loop). **Found during the spike, not in the plan.** Without it the browser silently blocks both workers
  and the emulator never executes an instruction. `blob:` URLs can only be created by script already
  running on the page, so this does not admit any new script source.

### Build host
The Podman machine on the Mac would not boot (Ignition failed to reach the host over vsock, a leftover from
before the macOS 27 upgrade). Eddie approved recreating it; it now builds `linux/386` images under emulation.

**Approved by Eddie 2026-10-20:** `worker-src blob:` on the LOGHUNT page. `tests/page.test.mjs` pins the
exact policy string, so any later change fails the tests until it is reviewed.

## Phase 1 — page shell (2026-10-20)

### Snapshot download: streamed, then hashed
The page streams `state.bin.zst` itself (for the progress bar) and checks its SHA-256 with
`crypto.subtle` against `image/state-meta.js`, which `tools/make-snapshot.mjs` generates. A mismatch
stops the page with a plain message. Chosen over `fetch(..., { integrity })` because that gives no
progress events in a form the page can rely on.

The URL carries `?v=<first 16 hex of the hash>`. Found in testing: a browser kept the previous build's
snapshot in its cache and the integrity check (correctly) refused it. A per-build URL means a stale
cached copy is never requested again.

Accepted risk: the files in `image/flat/` are fetched by v86 on demand without a hash check. They are
same-origin, in the same commit as the page that loads them; anyone who could alter them could alter
`app.js` too.

### Fork bombs: per-user process cap of 128, set in `inittab`
`ulimit -u 128` wraps the learner's `agetty`, so every process `analyst` starts inherits it. A first
attempt in `/etc/profile.d` was skipped by non-login shells. `make-snapshot.mjs` reads the cap from the
running login shell's `/proc/<pid>/limits` and fails the build if it is not 128. In Chrome a fork bomb
prints `fork: retry: Resource temporarily unavailable`; the page stayed at 60 frames per second.

### Restart = throw the machine away
**Restart terminal** destroys the emulator and starts a fresh one from the downloaded snapshot (kept in
memory). It works even when the guest is wedged. Measured: 652 ms in Chrome after a fork bomb.

### Output flood guard
`output-throttle.js` batches serial output into one xterm write per frame (max 64 KB) and drops anything
past a 512 KB backlog with a one-line notice. Measured in Chrome: `cat /dev/urandom` kept frames at
17 ms median, 70 ms worst; the guard never engaged, because the emulated serial port is slower than the
budget. It stays as a backstop; `tests/output-throttle.test.mjs` covers the overflow path.

xterm.js logs every malformed escape sequence at error level; binary output produced 1,000+ console
errors in seconds. `logLevel: 'off'`, since catting a binary file is a normal learner mistake here.

### Terminal size
The serial line has no size; on every xterm resize the page runs `stty -F /dev/ttyS0 cols C rows R` on
the root channel and sends `SIGWINCH` to the foreground job. Verified: `stty size` reports the real
81 columns after load.

### Phones and tablets
At ≤ 760 px or with a coarse pointer, the mission text renders at once and the 11.5 MB VM downloads
only after **Load the terminal** is tapped. Verified at 390 px: no horizontal scroll.

### Timings (Chrome, Eddie's Mac, localhost)
Page load to connected prompt: 702 ms (snapshot from cache). Restart: 652 ms.

## Phase 2 — generator and story (2026-10-20)

### Generated in JavaScript at load, not baked into the image (approved)
`generator.js` builds the arena from `story.js` in about 25 ms (3.35 MB tar, 37 files). Level and story
edits never touch the 11.5 MB snapshot. Each log source draws from its own seeded stream (mulberry32,
seed mixed with the source name), so adding noise to one source never shifts another source's answers.
A test fails if generation calls `Date.now` or `Math.random`.

`tests/generator.test.mjs` pins a SHA-256 of the whole archive. Any generator edit changes it on purpose;
update the pin and rerun the selftest so stored answers are rechecked.

### Answers are derivable from the shipped code (accepted, per the spec)
The generator runs in the browser and the repository is public, so a determined learner can read
`story.js`. The spec's hashing only discourages casual peeking. The finished answer strings are never
assembled in shipped code (the boss answer is built only in tests).

### The story, by source
| Stage | Where it shows | Trap it teaches |
|---|---|---|
| First probe (Mar 12 19:47:21) | `access_log.2.gz` only | plain `grep` misses compressed rotations; the boss's `first_seen` |
| Recon burst, Nikto user agent | `access_log.1`, `error_log` (403s) | count 404s per IP, not total |
| Brute force, 64 attempts | `secure` | other IPs also fail passwords; filter by IP |
| Login as `svc_backup` | `secure`, `audit.log`, `messages` | three time formats for one event |
| `sudo /bin/bash` | `secure`, `audit.log` (`USER_CMD`) | |
| Dropper download + run | `audit.log` (`EXECVE`, epoch time) | `date -d @epoch` |
| Exfil to port 4444 | `fw.log` | UDP lines carry `LEN=` twice |
| CPU/transmit spike | `node_metrics.csv`, `sar_cpu.txt` | `N/A` row inside the spike; 12-hour sar clock |

### Traps
Empty files (`maillog`, `spooler`, `training/drill/empty.log`), binaries (`wtmp`, `btmp`, the ELF dropper),
a space in a name (`app old.log`), CRLF (`metrics/hosts.csv`), hidden directories (`tmp/.x`,
`opt/app/.cache`), and misleading names: `old_access.txt` is gzip (compressed in the guest, then
renamed; the seed list accepts `path<TAB>final`), and `debug.log.gz` is plain text.

**Found in the guest test:** `file` 5.46 reports `metrics/hosts.csv` as `CSV ASCII text` and does not
mention CRLF. Level 3 teaches `cat -A` (lines end in `^M$`) as the reliable check, and the guest test
asserts that instead.

### Reset vs restart
**Reset files** reseeds `~/arena` in the running VM (shell, history, and background jobs keep running).
**Restart terminal** discards the machine, restores the snapshot, then reseeds.

## Phase 3 — level engine (2026-10-20)

### Level format
`levels/index.json` lists the files in order; each `levels/NN-tool.json` holds briefing, lesson blocks
(`p`, `note`, `code`, `flags`), 3-5 worked examples with their exact expected output, the challenge
(question, answer format, `answerHash`), exactly three hints, and the debrief (reference solution,
alternative, why). `levels.js` validates this at page load, in `tools/lint.mjs`, and in the tests.
Text uses one markup rule, `backticks` for code, rendered by `rich.js` with `createElement` and
`textContent` only.

### Answers
`sha256("loghunt:v1:<level id>:<normalized>")`, where normalized means trimmed, lowercased, and
whitespace runs collapsed to one space. The level id in the hash stops two levels with the same answer
from sharing a hash. A test pins the recipe against Node's own crypto.

### Score
100 per level, minus 10 / 20 / 35 for hint tiers 1 / 2 / 3 (a level solved after all three scores 35),
never below 10. Wrong attempts are counted but cost nothing (a learning game should not punish
experiments). Hints opened after solving are free. Time counts only while the level is open, the tab
is visible, and the level is unsolved.

### Selftest moved from Phase 4 to Phase 3
Expected outputs and answer hashes must come from the real guest, so `tools/selftest.mjs` was built
with the first level. `--print [id]` shows real output for authoring. Commands reach the guest as a
script file, never an interpolated string, so a quote in level JSON cannot break the harness.
Mutation check: corrupting one expected output and one hash made it fail on exactly those three checks.

### Found while testing
- **`find` order depends on the filesystem.** Moving the arena to tmpfs reversed directory order; the
  selftest caught two examples that relied on it. Examples now pipe through `sort`.
- **A name collision shipped past the Node tests.** `vm.seed({ gzip })` shadowed the imported `gzip()`.
  The tests had their own copy of the seeding code, so they never ran the page's. Now `seed.js` is the
  single implementation used by the page, the selftest, and the guest test.
- **The history panel stayed empty.** The snapshot script truncated `~/.bash_history` as root, leaving it
  root-owned, so `history -a` (as analyst) failed silently. Fixed, and the snapshot build now fails if
  the file is not owned by analyst.
- **Two-click reset.** "Reset progress" asks for a second click instead of `confirm()`: a modal dialog
  blocks the page's event loop and the VM with it.

### Performance: what was real and what was the test harness
Measured in Chrome on Eddie's Mac, localhost:

| | Under the browser-automation debugger | Plain tab (what learners get) |
|---|---|---|
| Guest clock vs wall clock | 0.2x | 1.00x |
| Start a process (`echo hi`) | ~250 ms | 2-10 ms |

An attached debugger slows WebAssembly about fivefold. Timings taken through the automation tab are
not representative; the plain-tab numbers were collected by a temporary beacon to the local server log
(removed before commit).

Real costs that remained, and their fixes:
- **Cold first visit: 9.0 s to ready, 3.6 s per reset.** Each file v86 has not fetched yet costs an
  HTTP request and several 9p round trips; the first seed touched ~126 of them. Fix: the snapshot
  build runs the real seed and every learner tool once and keeps the guest page cache (no more
  `drop_caches`). Result, incognito with an empty cache: **2.3 s to ready, 0.6 s per reset, 47
  requests**. Cost: snapshot 11.5 MB → 14.1 MB.
- **`~/arena` on tmpfs** (via `/etc/fstab` + `localmount`) so learner commands never read through 9p;
  the build fails if it is not tmpfs.
- **The seed archive is gzipped in JavaScript** (`CompressionStream`, same in browsers and Node), so
  fewer bytes cross 9p. The guest decompresses to identical bytes; determinism is unaffected.

### Known risk: mixed module versions right after a deploy
GitHub Pages serves files with a 10-minute cache. Just after a push, a returning visitor can get a new
`vm.js` with an old `tar.js` (seen locally: "does not provide an export named 'gzip'"). A reload after
the cache expires fixes it. The hub's other multi-module games share this risk; a hub-wide fix
(versioned file names) is out of scope for this game.

## Phase 4 — levels 2-5 (2026-10-20)

### What each challenge rests on
| Level | Answer comes from | Trap it enforces |
|---|---|---|
| 2 `grep` | Nikto lines across `access_log*`, the `.gz` included | plain `grep` finds 60 of 61; the missing line is the first probe |
| 3 `cut` + `tr` | svc_backup's sudo record in `secure` | three separators on one line (` `, ` ; `, `=`) |
| 4 `sort` + `uniq` | the attacker's `Failed password` lines, per username | two line shapes (`for NAME` / `for invalid user NAME`); check for ties |
| 5 `awk` | rows of `node_metrics.csv` whose field count is not 6 | a blank line (NF = 0) is a bad row too; the `N/A` row is left for Level 6 |

Answer formats follow the tool's own output where they can (`8 ftpuser` is what `uniq -c` prints), so
the learner submits what the pipeline printed instead of rearranging it by hand.

### Found while authoring
- **GNU `zgrep` rejects `-r`** ("option not supported"). The Level 2 lesson says so, and its debrief uses
  `zcat -f var/log/httpd/*` to show how `old_access.txt` double-counts, not `zgrep -r`.
- **The guest has no `locale` command and no locale data** (musl). The Level 4 locale lesson is a note
  about RHEL's `en_US.UTF-8`, not a live demo; `A B a b` under `LC_ALL=C` is shown as checked output.
- Every example output, both reference pipelines, and the debrief numbers (60 vs 61, ties at 7,
  lines 308/1120/1190) were taken from the real guest. The selftest stays the gate: 5 levels, 35 checks.

## Phase 5 — levels 6-10 (2026-10-20)

### What each challenge rests on
| Level | Answer comes from | Trap it enforces |
|---|---|---|
| 6 awk arrays | bastion-7's CPU samples above 85 | `"cpu" > "85"` and `"N/A" > "85"` are TEXT comparisons and pass; without a numeric guard the program prints `host 2 0.0` and `bastion-7 29 90.4` |
| 7 sed | the dropper's EXECVE record (`a0`, `a2` after `--pool`) | greedy `.*` vs `[^"]*` inside quotes |
| 8 sar + date | auditd epoch of the dropper; first sar sample over 50% | 12-hour clock (12 AM = midnight); `date -u` for epochs |
| 9 comm + join | attacker's guessed names ∩ accounts seen in session lines | both sides sorted under the same locale; two real accounts (root, svc_backup) |
| 10 boss | `IP|user|first seen|port` | the first sighting is only in `access_log.2.gz`; four time formats |

### The boss answer is checked twice
The selftest proves two independent guest pipelines reach the stored hash (IP from the user agent vs.
from brute-force volume; port from the firewall vs. the dropper's arguments). A new unit test in
`tests/story.test.mjs` rebuilds the answer from `story.js` and compares it with `answerHash`, so an edit
to the story or to the level file that breaks the other fails without booting the VM. The plaintext
answer exists only in that test.

### Multi-line reference solutions
The boss solution is four shell lines; the debrief renders it in a `<pre>`, and the selftest runs it as a
script, so newlines are fine. Every reference solution must still print exactly one line.

### Found while authoring
- The first boss draft parsed `error_log` with the syslog field order; its `[Fri Mar 13 ...]` format
  made `date` fail on six lines. It now has its own `sed` conversion. The earliest sighting did not
  change, but a pipeline that prints errors and still "works" is not one to teach.
- A top-N example on `training/fw.log` tied on every port, so `head -1` picked one at random. Replaced
  with a two-source corroboration example (auditd epoch vs. sshd syslog line, same second).

## Phase 6 — side quests, hub card, docs (2026-10-20)

### Side quests
| Quest | Answer comes from | Mechanism |
|---|---|---|
| `tail -f` | the attacker's first new attempt in `live/secure` | a background writer, started by the page |
| `xargs -P` | files that pass `gzip -t`, whatever their names | none; the arena as seeded |
| speed round | 404 count and distinct 404 clients in `access_log.1` | none; the lesson times both forms |

Side quests have no `number`: the strip shows ★ and the kicker says "Side quest". They come after the boss.

### The live feed (security; for Eddie's review)
A level names a setup by key (`"setup": "live-feed"`); the shell that runs is fixed in `live.js` and the
validator rejects any other key, so no level file can make the page run a command as root. The root
channel only starts the writer (`su analyst -c 'setsid bash /var/lib/loghunt/loghunt-appender'`); the
writer itself runs as analyst, so it counts against the 128-process cap and cannot touch anything the
learner cannot. Its name matches the `pkill -u analyst -f loghunt-appender` already in the image's seed
script, so every reset and restart stops it. **No image rebuild was needed.**

The feed writes 6 lines at once, then one every 3 seconds; the attacker's first attempt is line 15
(about 27 s after the quest opens) and the feed ends 6 lines later, so a learner who arrives late still
finds it in `tail`'s default last 10 lines. The page restarts the feed when the quest opens and after
every reseed. `tests/live.test.mjs` rebuilds the answer from the feed and checks it against the hash;
`tests/guest.test.mjs` checks the writer runs as analyst, grows the file, and is gone after a reseed.

### Hub card and pages
- Card in Education, after Ansible Command Recall, tag line `Education · Intermediate`, with the same
  Source / VS Code / How It's Built buttons as the other cards.
- `how-it-works.html` follows the shared `how-it-works.css` pattern; the game's nav gets the same
  How It's Built button as the other apps.
- **No analytics beacon.** The Cloudflare beacon is a third-party script; adding it would widen the
  reviewed CSP. The hub's newest apps (Ansible Command Recall and the trainers) ship without it too.
  If wanted later, it is a separate, reviewed change to the pinned policy.

### Abuse checks, re-run on the finished page (Chrome, through the automation debugger)
| Check | Result |
|---|---|
| `while :; do :; done` | page at 16.7 ms median / 17.6 ms worst frame; Ctrl+C recovers |
| `cat /dev/urandom` | 16.7 / 17.6 ms; Ctrl+C recovers |
| fork bomb `:(){ :|:& };:` | `fork: retry: Resource temporarily unavailable`; page at 16.6 / 17.7 ms; Restart terminal recovers |
| `wget http://192.0.2.1/` | "Network unreachable", exit 1 |
| live feed in the browser | `tail -f live/secure \| grep -m1 203.0.113.66` printed the line and exited |

### Gate at the end of Phase 6
`node tools/lint.mjs` ok · `node --test 'tests/*.test.mjs'` 96/96 · `node tools/selftest.mjs`
13 levels, 88 checks, all passed (72 s).
