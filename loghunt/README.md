# LOGHUNT: Incident at Bastion-7

A game that teaches log analysis with standard Linux tools (`find`, `grep`, `cut`, `tr`, `sort`, `uniq`,
`awk`, `sed`, `date`, `comm`, `join`, `paste`, `xargs`, `tail`). The learner types into a real `bash`
running on an emulated Linux machine (v86) inside the browser tab. Nothing runs on a server.

- 10 levels plus 3 side quests, one invented attacker across web, SSH, auditd, firewall, and metrics logs
- Every example output and answer is taken from the real guest by `tools/selftest.mjs`
- Design decisions and measurements: [`DECISIONS.md`](DECISIONS.md). How the parts fit: [`how-it-works.html`](how-it-works.html)

## Run it

The page uses ES modules and fetches its VM image, so open it over HTTP, not `file://`:

```bash
cd ~/mac-ansible/code_projects
python3 -m http.server 8000 --bind 127.0.0.1
# open http://127.0.0.1:8000/loghunt/
```

On a phone or tablet the lessons load at once and the 14 MB VM downloads only after **Load the terminal**.

## Test

Node only, no packages to install (developed and tested on Node 26):

```bash
cd ~/mac-ansible/code_projects/loghunt
node tools/lint.mjs                   # modules parse; no eval, no innerHTML in app code
node --test 'tests/*.test.mjs'        # unit tests, plus guest tests that boot the snapshot in Node
node tools/selftest.mjs               # every level: examples byte for byte, both solutions vs. the stored hash
```

All three must pass before a commit. The selftest takes about 75 seconds, a third of it waiting on the `tail -f`
side quest's live feed.

## Add a level

1. Create `levels/NN-tool.json` (or `levels/side-name.json` for a side quest, which has no `number`).
   Copy an existing level for the shape. The validator in `levels.js` lists every required field:
   2-3 briefing paragraphs, lesson blocks (`p`, `note`, `code`, `flags`), 3-5 worked examples that use
   files under `training/`, the challenge (`question`, `format`, `answerHash`), exactly three hints, and the
   debrief (`solution`, `alternative`, `why`).
2. Add the file name to `levels/index.json` in play order.
3. Leave every example `output` empty and put 64 zeros in `answerHash`, then get the real values from the guest:
   ```bash
   node tools/selftest.mjs --print your-level-id
   ```
   Copy each example's output exactly as printed, and the solution's hash into `answerHash`. The solution and the
   alternative must print the same answer, on one line.
4. Run lint, the tests, and `node tools/selftest.mjs` until all three pass.

Rules that keep levels correct:

- Pipe `find` output through `sort`. Directory order differs between filesystems.
- Text uses one markup rule: `backticks` for code. Nothing in a level file is parsed as HTML.
- Never put a plain-text answer in a level file or in shipped code. The boss and `tail -f` answers are rebuilt
  only in the tests, from `story.js` and `live.js`.
- A level that needs a background process names a setup by key (`"setup": "live-feed"`). Add new setups to
  `SETUPS` in `live.js`; level files never carry shell commands. Name the process `loghunt-appender` so a reset
  stops it.

## Change the data

`story.js` holds the campaign facts and `generator.js` turns them into the arena, in JavaScript, at page load.
After any change to either, update the pinned digest in `tests/generator.test.mjs` and rerun the selftest: it
rechecks every stored answer against the new data. `training-files.js` holds the small files the worked
examples use; edit them together with the examples.

## Rebuild the VM image (rarely)

Only when the guest's tool set changes. Each rebuild adds a new ~14 MB snapshot to git history.

```bash
tools/build-image.sh               # needs podman with linux/386 emulation and python3.14
node tools/make-snapshot.mjs       # boots once, runs the guest checks, writes image/
```

`make-snapshot.mjs` fails the build if the learner can reach uid 0, if the process cap or the tmpfs arena is
missing, or if the guest can reach the network.

## Layout

| Path | What it is |
|---|---|
| `index.html`, `app.js`, `mission.js`, `rich.js` | page, wiring, level rendering (text only, never HTML) |
| `vm.js`, `serial-channel.js`, `output-throttle.js` | the emulator, its hidden root channel, the output flood guard |
| `story.js`, `generator.js`, `gen-util.js`, `training-files.js`, `tar.js`, `seed.js` | the incident data and how it reaches the guest |
| `levels.js`, `levels/` | level validator and content |
| `checker.js`, `progress.js` | answer hashing; score and progress in local storage |
| `live.js` | side-quest setups (the live `tail -f` feed) |
| `vendor/` | v86 and xterm.js, pinned by SHA-256 (`vendor/README.md`) |
| `image/` | the guest: snapshot plus the root filesystem v86 fetches file by file |
| `tools/` | image build, snapshot, selftest, lint |
| `tests/` | Node tests |
