# Ansible Facts Trainer — Design

**Date:** 2026-10-11
**Status:** Built. Revised 2026-10-11 after final review, and again after the owner asked for a playbook editor, a simulated run, and a capstone task
**Location:** `ansible-facts-trainer/` in the App Hub, plus one new card in the hub `index.html`

## 1. Purpose

A browser-based trainer that drills Ansible playbook syntax, using `ansible_facts` as the
subject matter. It follows the exam workflow: the user looks a fact up in a practice
terminal with `ansible servera -m setup`, piped to `less` or `grep`; edits a playbook file in
an editor that looks like one; runs it; and sees the simulated `ansible-playbook` output in
the same terminal, with a separate coach verdict. There is no facts cheat sheet.

- **Primary user:** Eddie, practising for the Red Hat Certified Engineer exam (EX294).
- **Secondary audience:** hiring managers browsing the App Hub, for sysadmin and Information
  System Security Officer roles. The app is evidence of Ansible fluency and of careful
  client-side engineering.

### Success criteria

1. The page loads under the hub's existing Content-Security-Policy with zero console violations.
2. All 26 challenges can be completed, and every model answer passes.
3. Every correct spelling of an answer passes (bracket notation, dot notation, the legacy
   injected variable, short and fully qualified module names, `msg` and `var`).
4. Every wrong answer gets a named, specific error, never a bare "incorrect".
5. No real machine identifier from the source host appears in the published files.
6. The hub shows a 16th card that links to the app.

### Out of scope for version 1

- Executing Ansible, or any server-side component.
- In the 16 fundamentals: `when:` conditionals and loops. (The exam-style scenarios in
  section 10 support them.)
- Jinja2 filters other than `select('match' | 'search', ...)`, `first`, and `list`, which the
  capstone needs. Any other filter gets an explicit "outside this trainer's scope" message
  that names it, not a wrong verdict.
- Real execution. The terminal is labelled "simulated": commands are parsed and answered
  from fixed text in the browser. It supports `ansible HOST -m setup` (with an optional
  `-a filter=PATTERN`), `-m ping`, `ansible-playbook facts.yml`, the pipes `grep`, `less`
  (or `more`), and `head`, and `cat`, `ls`, `pwd`, `clear`, `help`. Anything else answers
  `command not found` or a note that it is outside the practice terminal's scope.
- Publishing the capture's identifying values. The owner asked for the output to be
  identical to his document. It is identical in format, key names, order, and line count
  (788 lines), and 744 lines match character for character. The other 44 carry the
  replacement values from the sanitization table, because the repository is public.
- Accounts, leaderboards, or any network call made by the app.
- Facts from more than one host.

## 2. Approach

**Parse, then evaluate.** A vendored YAML parser turns the answer into data, a structural check
confirms the task shape, and a small hand-written resolver looks up each `{{ ... }}` expression
in the facts capture. The rendered message is compared with the values the challenge requires.

Rejected alternatives:

- **Pattern matching against a model answer.** Brittle: it rejects valid answers that differ in
  spacing, quoting, or notation, and it cannot locate a syntax error.
- **Pyodide with real PyYAML and Jinja2.** True Jinja2 semantics, but a download of 10 MB or
  more and a loosened Content-Security-Policy to allow WebAssembly. Revisit only if
  conditionals and loops are added.

## 3. Files

| File | Responsibility |
|---|---|
| `ansible-facts-trainer/index.html` | Markup and styles. Same policy as `subnet-trainer`: `default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self';` |
| `ansible-facts-trainer/app.js` | Screen logic only: terminal and pager display, command history, editor color layer and line numbers, buttons, coach line, progress |
| `ansible-facts-trainer/shell.js` | Pure: parse a command line into pipeline stages and answer it (`ansible`, `ansible-playbook`, `grep`, `head`, `less`, and a few conveniences) |
| `ansible-facts-trainer/pager.js` | Pure: a state model of `less` (paging, line movement, search, quit) |
| `ansible-facts-trainer/terminal-color.js` | Pure: which parts of Ansible's output are green, red, purple, or cyan |
| `ansible-facts-trainer/setup-output.js` | Generated. The sanitized capture as the text `ansible servera -m setup` prints |
| `ansible-facts-trainer/runner.js` | Pure: check a whole playbook file, call the validator for its task, and produce the simulated terminal text plus the verdict |
| `ansible-facts-trainer/validator.js` | Pure functions with no screen access: parse, structural check, resolve, apply filters, render, judge |
| `ansible-facts-trainer/highlight.js` | Pure: lossless YAML tokenizer for the editor's color layer |
| `ansible-facts-trainer/difficulty.js` | Pure: the reduced starter for a difficulty level, and the rule that moves the level |
| `ansible-facts-trainer/jinja.js` | Pure: a Jinja2 expression evaluator with Python semantics, for the scenarios |
| `ansible-facts-trainer/executor.js` | Pure: a simulated host and the modules that change it; read-only host inspection |
| `ansible-facts-trainer/exam-challenges.js` | The 10 exam-style scenarios as data, with end-state checks and second-host variants |
| `ansible-facts-trainer/challenges.js` | The 16 challenges as data, each with a `starter` and a `solution` playbook |
| `ansible-facts-trainer/facts.js` | The sanitized `servera` capture, exported as a constant |
| `ansible-facts-trainer/vendor/js-yaml.mjs` | `js-yaml` 4.3.2, ES module build (about 104 KB unminified; the package ships no minified module build) |
| `ansible-facts-trainer/vendor/README.md` | Version, source URL, licence, and SHA-256 checksum of the vendored file |
| `ansible-facts-trainer/how-it-works.html` | Derived from `_template/how-it-works.html`, as every sibling app has |
| `ansible-facts-trainer/tests/validator.test.mjs` | Validator tests, run with `node --test`; no packages to install |
| `ansible-facts-trainer/tests/runner.test.mjs` | Playbook-level checks and the simulated terminal text |
| `ansible-facts-trainer/tests/highlight.test.mjs` | Tokenizer classes and the lossless property |
| `ansible-facts-trainer/tests/shell.test.mjs` | Command parsing, grep flags, the setup filter, and the pager |
| `ansible-facts-trainer/tests/scenarios.test.mjs` | Every scenario: model answers pass, plausible wrong answers fail on the right check, alternative right answers pass |
| `ansible-facts-trainer/tests/jinja-differential.test.mjs` | Renders 240 expressions with the evaluator and with the real Ansible engine; any difference fails. Skips, with a stated reason, on a machine without Ansible |
| `ansible-facts-trainer/tests/reference_templar.py` | The oracle the differential test calls: Ansible's own `Templar` |
| `ansible-facts-trainer/tests/sanitizer.test.mjs` | The sanitizer run against an invented capture |
| `ansible-facts-trainer/tests/sanitization.test.mjs` | Allowlist gate: fails unless every MAC, IPv4 address, key, machine id, and account name in `facts.js` is a placeholder or a private value. The test holds no real identifier itself |
| `ansible-facts-trainer/tests/challenges.test.mjs` | Every model answer and notation variant passes against the real capture |
| `ansible-facts-trainer/tools/sanitize_facts.py` | One-off script: raw capture → sanitized `facts.js` |
| `index.html` (hub) | One new card, following the existing card markup; project count 15 → 16 |

Scripts are ES modules (`<script type="module" src="app.js">`), so `validator.js` runs unchanged
in the browser and under Node. Local preview therefore needs a web server
(`python3 -m http.server`), not a `file://` URL.

## 4. Layout

Two panes, stacked on narrow screens.

- **Left: the control node terminal.** Three numbered instructions sit above it: list the
  facts with `ansible servera -m setup`; page with `| less` or search with `| grep -i word`;
  and, inside a playbook, drop the `ansible_` prefix (`ansible_hostname` becomes
  `ansible_facts['hostname']`). The terminal has a title bar, scrollback, and a prompt
  (`[student@ansible my-project-directory]$`) directly under the last line of output. Up and
  Down recall earlier commands. Three example-command buttons serve touch screens.
- **`less`.** A command ending in `| less` opens a 24-row pager in the terminal: Space or `f`
  pages down, `b` pages up, `j`/`k` and the arrow keys move a line, `g`/`G` jump to the ends,
  `/pattern` searches, `n`/`N` repeat it, and `q` quits. Buttons for page down, page up, and
  quit appear while it is open.
- **Right, top: the playbook editor.** A window with a title bar showing `facts.yml`, a
  line-number gutter, syntax color, and a status bar with the cursor position. It holds the
  whole playbook file. The play header (`---`, play name, `hosts: servera`, `tasks:`) is
  pre-written. Tab inserts two spaces, Enter keeps the current indentation, and Ctrl+Enter or
  Cmd+Enter runs the playbook.
- **Buttons:** Run playbook, Hint, Show answer, Reset file. Run playbook types
  `ansible-playbook facts.yml` into the terminal; typing that command there does the same.
- **Run output** appears in the terminal: the `PLAY` banner, `TASK [Gathering Facts]`, the
  task banner and its result, and the `PLAY RECAP`.
- **Failures read like real ones.** A YAML error prints Ansible's two-parser preamble, the
  reason, the file path with line and column, and the offending line with a caret. An
  undefined fact prints one `fatal: [servera]: FAILED! => {"msg": ...}` line carrying Jinja2's
  own wording (`'dict object' has no attribute 'x'`, `list object has no element N`,
  `'name' is undefined`), the task's location, and `failed=1` in the recap. Where real Ansible
  would not fail but the trainer declines the input (an out-of-scope keyword or filter), the
  terminal says "Not run" and the coach explains; it does not invent an Ansible error.
- **Color follows Ansible's:** green for `ok` results and a clean recap, red for `fatal` lines,
  load errors, and a failed recap, purple for warnings, cyan for a skipped play. Output sent
  through a pipe is uncolored, as in a real shell. `terminal-color.js` decides this as a pure,
  lossless function; the page builds the colored lines from text nodes.
- **Right, bottom: the coach line.** The verdict and its explanation. It is separate from the
  terminal on purpose: a task can run cleanly and still read the wrong fact.

### The setup output

`setup-output.js` is written by the sanitizer from the same sanitized data as `facts.js`,
using Python's `json.dumps(indent=4, sort_keys=True, ensure_ascii=False)`, which is how
Ansible prints it. Generating it in Python, not in the browser, keeps details such as `0.0`
that JavaScript would print as `0`. A test parses the text back and requires it to equal
`facts.js`, so the leak gate covers both files. The `-a filter=` argument slices the stored
text into top-level fact blocks and never re-serializes it.

### Syntax color

A textarea cannot color its own text, so the editor stacks a transparent textarea over a
colored copy of the same text with identical font metrics. `highlight.js` splits the text into
tokens (document marker, list dash, key, colon, string, Jinja2 expression, number or boolean,
comment). The tokenizer is lossless, and a test enforces it: joining the tokens must reproduce
the input exactly, or the colors would drift from the characters. The colored layer is built
from text nodes, never from markup.

## 5. Data

### Facts capture

Source: `ansible servera -m setup` against the course lab host (CentOS Stream 9, aarch64),
106 top-level facts. Stored with the `ansible_` prefix stripped from top-level keys, matching
the real `ansible_facts` dictionary. The one exception, as in Ansible itself
(`namespace_facts` in `ansible/vars/clean.py`), is `ansible_local`, which keeps its prefix:
custom facts are read as `ansible_facts['ansible_local'][...]`.

Sanitization before the capture enters the repository:

| Field | Action |
|---|---|
| `machine_id` | Replaced with a dummy 32-character hex string |
| `hostnqn` (NVMe host identifier) | Embedded UUID replaced with a placeholder |
| Filesystem UUIDs, FAT volume ids, LVM volume and physical-volume ids | Replaced with numbered placeholders, consistently across fields |
| Hardware serials, WWNs, iSCSI names, DMI product UUID, `/dev/disk/by-id` names | Blanked or replaced (empty on this capture; covered so a privileged re-capture stays clean) |
| `user_gecos` (full name) | Cleared |
| Global IPv6 addresses | Replaced with a documentation-range address |
| SSH host public keys (ECDSA, Ed25519, RSA) | Replaced with truncated placeholder keys |
| MAC addresses, and IPv6 addresses derived from them | Replaced with documentation-range values |
| Public DNS resolver address | Replaced with a documentation-range address |
| Username and home directory, everywhere they appear (including `env`) | Replaced with `student` and `/home/student` |
| Private lab addresses (`192.168.50.11`, `10.0.2.15`) | Kept: non-routable and realistic |
| Hostname `servera.ytt.lab` | Kept: matches the course naming convention |

The raw capture never enters the repository.

### Challenge record

```js
{
  id: "t2-hostname",
  tier: 2,                       // 1 locate, 2 write a task, 3 combine
  prompt: "Write a task that prints the target host's hostname.",
  hint: "Search the reference panel for 'hostname'.",
  requires: [["hostname"]],      // fact paths whose values must appear in the output
  solution: "- name: Display the hostname\n  ansible.builtin.debug:\n    msg: \"The hostname is {{ ansible_facts['hostname'] }}\"\n"
}
```

### Tiers

Every challenge has a `starter` (what the editor opens with) and a `solution` (a whole
playbook that passes).

- **Tier 1, fill in the fact (5 challenges):** the task is already written with one blank,
  `FACT_GOES_HERE`, inside `{{ }}`. The learner replaces it with an expression such as
  `ansible_facts['hostname']`. It passes if it reads the required fact. A different fact that
  happens to hold the same value on this host is rejected, with a message saying so.
  (Revised after final review: the first draft judged tier 1 by value, which accepted
  `all_ipv4_addresses[0]` for the default-route address.)
- **Equivalent facts:** a challenge may list `equivalents`, parallel to `requires`, for facts
  that are genuinely the same thing, for example `memory_mb.real.total` for `memtotal_mb`.
- **Tier 2, write a task (5):** a full `debug` task that prints one fact.
- **Tier 3, combine (5):** one `msg` that uses two or three facts, including nested paths such
  as `ansible_facts['default_ipv4']['address']`.
- **Exam-style scenarios (10):** described in section 10. They use a different engine and
  are graded on the state left on the host.
- **Capstone (1):** the owner's course task, "Display Ansible Facts": a list-form `msg` with
  five labelled lines (hostname, FQDN, distribution and version, memory, and the IPv4 address
  on the 192.168.50.x lab network). The lab address is not the default-route address, which is
  the NAT interface, so the model answer selects it from `all_ipv4_addresses` with
  `select('match', '192.168.50.') | first`. That requirement is expressed as a value, not a
  path: any fact expression that yields the lab address passes, and a hard-coded address does
  not. Label text and line order are not judged.

One tier-1 challenge is a deliberate trap: "which fact shows this is a Red Hat family host?"
The answer is `os_family` (`RedHat`), not `distribution` (`CentOS`).

### Progress

Completed challenge ids are stored in `localStorage` under one key. Every read and write is
wrapped in `try`/`catch`; the app works fully with storage unavailable.

## 6. Runner and validator

`runner.js` exports `runPlaybook(text, challenge, facts, host)`, which returns
`{ verdict, terminal }`. `validator.js` exports the task-level pieces it uses
(`parseYaml`, `judgeTask`) and `checkTask` for a bare task.

### Pipeline for a playbook

1. **Size guard.** Reject input over 10 KB.
2. **Placeholder guard.** An untouched `FACT_GOES_HERE` is caught before anything runs.
3. **Parse.** `js-yaml` `load` with the default schema. On failure, report line and column,
   counted from the top of the file.
4. **Play structure.** The document must be a list with exactly one play. The play needs
   `hosts`; a stray task key at play level is reported as a bad play attribute; valid play
   keywords beyond `name`, `hosts`, `tasks`, `gather_facts`, and the `become` family are
   reported as out of scope.
5. **Host match.** `hosts` must include `servera`, its FQDN, or `all`. Otherwise the play is
   skipped, as Ansible skips it.
6. **Tasks.** `tasks` must be a list with exactly one task. No task yet is its own verdict.
7. **Task structure.** The task must be a mapping with a `name` and exactly one module key
   (`debug`, `ansible.builtin.debug`, or `ansible.legacy.debug`) whose value is a mapping
   containing `msg` or `var`. Keywords that cannot change the output are ignored; other valid
   keywords are reported as out of scope.
8. **Resolve.** For `msg` (a string or a list of strings), find each `{{ ... }}` span, resolve
   the lookup, and apply any filters. For `var`, resolve the bare expression. With
   `gather_facts: false`, `ansible_facts` is empty.
9. **Judge.** Pass if every requirement is met: a path requirement by reading that fact (or a
   listed equivalent) unfiltered, a value requirement by any fact expression yielding the value.
10. **Simulate.** Produce the terminal text for the outcome.

### Filters

Exactly three, chosen for the capstone:

- `select('match', pattern)` and `select('search', pattern)` on a list of strings. `match` is
  anchored at the start of the string, as Python's `re.match` is; `search` is not. Patterns are
  capped at 200 characters and compiled inside a `try`.
- `first` and `list`.

`select` alone is an error that says so: in Jinja2 it returns a generator, which prints as an
object address, never as the item wanted. `first` on an empty result is undefined, as in
Ansible. A filtered value never satisfies a plain-path requirement.

### Resolver grammar

A hand-written tokenizer. No `eval()`, no `Function()`.

```
expression := root step*
root       := "ansible_facts" | "ansible_" NAME     // legacy injected form
step       := "." NAME | "[" STRING "]" | "[" INTEGER "]"
STRING     := single- or double-quoted
```

`ansible_hostname` is treated as `ansible_facts['hostname']`, and `ansible_local` as
`ansible_facts['ansible_local']`. Anything after a `|` goes to the filter step above.

### Error codes

| Code | Example cause | Message gist |
|---|---|---|
| `TOO_LARGE` | Input over 10 KB | Answer is too long |
| `YAML_SYNTAX` | Unquoted `msg: {{ ... }}` | Line and column; if the line has an unquoted `{{`, add "quote a value that starts with `{{`" |
| `NOT_A_LIST` | Missing leading `-` | Tasks are a list; start the task with a dash |
| `EXTRA_TASKS` | Two tasks submitted | Submit exactly one task |
| `PLAY_NOT_TASK` | A whole play with `hosts:` and `tasks:` | Submit only the task |
| `UNSUPPORTED_KEYWORD` | `when:`, `loop:`, `register:`, `delegate_to:`, `no_log:` | Valid Ansible, outside this trainer's scope |
| `UNSUPPORTED_SYNTAX` | Inline `debug: msg="..."` | Valid Ansible, outside this trainer's scope |
| `MISSING_NAME` | No `name` key | Names the missing key |
| `MISSING_MODULE` | Only `name` present, or `msg` at task level | Shows the expected nesting |
| `UNKNOWN_MODULE` | `debugg` | Expected `debug` or `ansible.builtin.debug` |
| `MISSING_MSG` | `debug:` with neither `msg` nor `var` | Names the two accepted keys |
| `BAD_EXPRESSION` | `{{ ansible_facts[hostname] }}` | Explains that a bare word in brackets is a variable, not a key; quote it |
| `UNDEFINED_FACT` | `ansible_facts['host_name']` | No such fact; suggests the nearest key at that level |
| `UNSUPPORTED_FILTER` | `\| upper` | Valid Jinja2, outside this trainer's scope; names the filter and lists the supported ones |
| `PLACEHOLDER` | `FACT_GOES_HERE` left in place | Replace it, then run |
| `NOT_A_PLAY` | Empty file, play header deleted, or a bare task pasted | A playbook is a list of plays with hosts and tasks |
| `EXTRA_PLAYS` | A second dash at the left margin | The trainer runs one play |
| `BAD_PLAY_KEY` | A task key at play level | Task keys belong under `tasks:` |
| `NO_HOSTS_MATCHED` | `hosts: serverz` | Not in the inventory; the lab host is servera |
| `NO_TASKS` | Header only | Add a task beneath `tasks:` |
| `WRONG_FACT` | Valid task, wrong fact | Shows what the answer printed against what was asked |

A passing answer that uses the short module name `debug` passes with a note recommending the
fully qualified `ansible.builtin.debug`.

## 7. Security

- All dynamic output is written with `textContent`. `innerHTML` is never given user input or
  fact values.
- No inline scripts and no `eval`, so `script-src 'self'` holds.
- `js-yaml` is vendored and pinned, with its checksum recorded; nothing is loaded from a
  content delivery network.
- The app makes no network requests of its own. The hub's Cloudflare analytics beacon is deliberately
  not added: the policy above blocks it, and success criterion 1 requires zero violations.
- Input is size-capped before parsing.
- The sanitization test is the gate that keeps host identifiers out of a public repository.

## 8. Testing

**Automated (`node --test ansible-facts-trainer/tests/`):**

- Every challenge's `solution` passes.
- For a representative challenge in each tier, every notation variant passes: bracket with
  single quotes, bracket with double quotes, dot notation, legacy injected variable, short and
  fully qualified module name, `msg` and `var`.
- Each error code has at least one fixture that triggers exactly that code.
- Resolver unit tests: nested paths, list indexes, unknown keys, malformed expressions.
- Sanitization test, written as an allowlist so no real value is stored in the repository:
  every MAC is in the documentation range, every IPv4 address is private or documentation
  range, and the machine id, SSH keys, and account name are the known placeholders.

**Manual:**

1. `python3 -m http.server` from the hub root; open the app.
2. Complete all 16 challenges; reload and confirm progress persists.
3. Confirm the browser console shows no Content-Security-Policy violations.
4. Check the layout at phone width.
5. Confirm the new hub card renders and links correctly.

## 9. Delivery

Work happens on a feature branch off an up-to-date `main` (fetch and rebase first; the remote
receives daily automated commits). Nothing is pushed without Eddie's explicit approval.

## 10. Exam-style scenarios

Added 2026-10-11 at the owner's request for challenges that resemble RHCE exam tasks.

### What they are, and what they are not

Ten original practice tasks. They are **not** Red Hat exam items, which are confidential.
Their shapes follow the published EX294 objectives, which list facts and variables as core
components, conditionals to control play execution, and loops. Templates (`.j2` files) are in
the objectives and are not covered here. Custom facts are taught in the RH294 course but are
not named in the published objectives; one scenario uses them, as practice, not as a claim
about the exam.

| Scenario | Required end state | Fact skill |
|---|---|---|
| Install httpd by OS family | `httpd` installed only on Red Hat family hosts | `when:` on `os_family` |
| Install php by version | `php` installed only on CentOS 9 or later | a version stored as text: `\| int`, and a list under `when:` |
| Hardware report file | `/root/hwreport.txt` with four lines; `NONE` for a missing disk | nested facts, `\| default('NONE')` |
| Message for a missing disk | a message printed only where `sdb` is absent | `in` / `is defined` on a dictionary fact |
| Low-memory motd | `/etc/motd` only where memory is under 1024 MB | numeric comparison, and the boundary |
| Memory in GB with set_fact | a variable `mem_gb`, then a message using it | `set_fact`, arithmetic, filter precedence |
| Loop over mounts | one message per mounted filesystem | `loop:` over a list of dictionaries |
| Loop over interfaces | one message per interface except `lo` | a variable as a key: `ansible_facts[item]` |
| Hosts-file line | a file with address, FQDN, and hostname | combining facts in file content |
| Owner from a custom fact | a file with the owner, or `unknown` | `ansible_local`, and a fallback |

Every expected value on servera is the real value in the capture; a test asserts each one.

### Grading by end state, on two hosts

A scenario is not judged on which facts it mentions. Every task runs against a model of the
host (`executor.js`): installed packages, files with content and ownership, and services.
Afterwards the grader checks declared expectations: a package is or is not installed, a file
has exact content or does not exist, a message was or was not printed, a variable has a value.

Each scenario also declares one or more **variants**: the same host with a patch applied to
its facts (a Debian family, a 5 GB `sdb`, 4096 MB of memory, no custom facts). The playbook
is run against each variant on a fresh host and graded there too. This is what catches a
hard-coded answer, an unconditional install, `<=` in place of `<`, and a version compared as
text. The variants are synthetic and are labelled as such in the coach's checklist; the
terminal shows only the run on servera.

The coach lists every check with a tick or a cross, and for a failed check shows what the
playbook actually produced.

### The expression evaluator

`jinja.js` is a hand-written evaluator for Jinja2 expressions: tokenizer, parser with
Jinja2's precedence ladder, tree walker. No `eval`, no `Function`. It supports lookups,
slices, comparisons (chained as in Python), `and`/`or`/`not`, `in`, `is` tests, arithmetic,
`~`, the inline `if ... else`, list and dictionary literals, about thirty filters, and a few
string and dictionary methods. `{% %}` statements, `lookup()`, and other function calls are
declined as out of scope.

It follows Python and Ansible, not JavaScript:

- `1 == '1'` is false; comparing text with a number is a type error.
- `/` always yields a float, printed as Python prints it (`4 / 2` is `2.0`).
- `round` uses Python's correctly rounded, ties-to-even rule, computed from the number's exact
  decimal expansion: `round(2.5)` is `2.0` and `round(2.675, 2)` is `2.67`.
- A missing variable, key, or index is an "undefined" value that flows through further lookups
  and only fails when used. That is why `a['b']['c'] | default('NONE')` works.
- Backslashes in a string literal are kept exactly as written, as Ansible keeps them.
- Lists and dictionaries print in Python's `repr` form.

**Output typing follows ansible-core 2.14**, the version on RHEL 9 and in the owner's lab,
with its default settings: a template that is exactly one expression keeps a list, dictionary,
or boolean as that type, and a number becomes text. So `set_fact` with
`"{{ (x / 1024) | round(2) }}"` stores the text `0.55`. This rule was written from knowledge
of the 2.14 source, not verified against a running 2.14, because only 2.20 is installed on the
build machine. It should be confirmed on the lab.

### The differential test

`tests/jinja-differential.test.mjs` renders 240 expressions through `jinja.js` and through
Ansible's own `Templar` (`tests/reference_templar.py`, run with the Python interpreter that
the local `ansible` command uses). Each expression is embedded in text so both sides yield a
string. The rule: if Ansible renders it, the trainer must render the same text or decline it
as out of scope; if Ansible fails, the trainer must fail. The first run found eight
differences, all fixed. The reference on the build machine is ansible-core 2.20, so this test
does not cover the 2.14 output-typing rule above. On a machine without Ansible the test is
skipped and says why; it is a development-time check.

### Supported modules and keywords

- **Modules:** `debug`, `set_fact`, `copy` with `content`, `dnf` (also `yum` and `package`),
  and `service` (also `systemd`), by short or fully qualified name. Parameters are validated,
  and failures use Ansible's wording: an unknown parameter, a bad `state`, a package the
  repositories lack, a service whose package is not installed.
- **Task keywords:** `when` (a string, a boolean, or a list), `loop` and `with_items`,
  `register`, `ignore_errors`, and the `become` family. **Play keywords:** also `vars`.
- **Declined as out of scope, never called invalid:** other real modules such as `template`
  and `lineinfile`, and keywords such as `notify`, `block`, and `delegate_to`.
- **Each run starts from a clean host,** so idempotence (a second run reporting `ok`) is not
  demonstrated.

### Checking your own work

After a run, the terminal can inspect the host the way a candidate would:
`ansible servera -a 'cat /root/hwreport.txt'`, `-a 'rpm -q httpd'`, `-a 'ls PATH'`, and
`-a 'systemctl is-active UNIT'`. Output uses Ansible's ad-hoc format
(`servera | CHANGED | rc=0 >>`).

### Known limits

- The 16 fundamentals still run on the first, narrower resolver. Two evaluators is technical
  debt; moving the fundamentals onto `jinja.js` would remove it.
- A repeated YAML key keeps its last value, as in Ansible, but the trainer does not print
  Ansible's warning about it.

## 11. Progressive difficulty

Added 2026-10-11 at the owner's request: as the player answers correctly, the starting
playbook should supply less, so the player writes more of it.

- **The level** is a whole number from 0 to 7, stored in the browser beside the solved list.
- **It rises by one** each time a challenge is passed for the first time without using Show
  answer. A repeat pass does not raise it.
- **It falls by one** the first time Show answer is used on a challenge. Reset progress sets it
  to 0.
- **At level N, the next challenge's starter has N pre-written rows removed,** from the bottom
  up, so the rows nearest the player's own work go first. For a fill-in challenge the order is
  the `msg:` line, the module line, the task's `- name:` line, then `tasks:`, `hosts:`, the
  play's `- name:` line, and `---`. For every other challenge it is the last four. A starter
  with fewer rows than the level is simply empty.
- **The prompt lists what is missing** in plain words, and at a level where the fill-in
  placeholder is gone it says so, so the instruction never refers to something absent.
- **The level applies to the next challenge shown,** not the one on screen. Reset file restores
  the reduced starter for the current level.
- **Fairness is tested:** every challenge's model answer passes from an empty file, and a
  reduced starter run untouched gets a specific message (no `msg`, no tasks, no hosts), never a
  crash.

The existing verdicts already explain each missing row, because a deleted header was always a
possible input; this feature makes that the normal path at higher levels.
