'use strict';

/* ──────────────────────────────────────────────────────────────────────────
 * Subnet Trainer — block-size (magic-number) method, taught + drilled.
 *
 * Math primitives below are derived from cidr-calc/app.js (the calculator).
 * SOURCE OF TRUTH for the bitwise engine is cidr-calc — keep in sync.
 * Divergence: first-usable for /31 is fixed here (net, not net+1) per RFC 3021;
 * cidr-calc returns net+1, which is wrong for point-to-point links.
 * A load-time self-check (bottom of file) fails loud in console if the copied
 * math ever drifts from the known worked examples.
 * ────────────────────────────────────────────────────────────────────────── */

const PLACE_VALUES = [128, 64, 32, 16, 8, 4, 2, 1];
const BEST_KEY = 'subnet-trainer:best';
const STATS_KEY = 'subnet-trainer:stats';   // per-prefix miss tracking for adaptive drilling

// ── Bit-math (authoritative answer engine) ──────────────────────────────────

function octetsToInt(o) { return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0; }
function intToIP(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }

function maskInt(prefix) { return prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0; }

function maskOctets(prefix) {
    const m = maskInt(prefix);
    return [(m >>> 24) & 255, (m >>> 16) & 255, (m >>> 8) & 255, m & 255];
}

/** Authoritative network facts via bitwise AND — never hand-derived. */
function computeFacts(octs, prefix) {
    const ipInt = octetsToInt(octs);
    const mask = maskInt(prefix);
    const net = (ipInt & mask) >>> 0;
    const bcast = (net | (~mask >>> 0)) >>> 0;
    const total = Math.pow(2, 32 - prefix);
    return {
        prefix,
        netInt: net,
        network: intToIP(net),
        broadcast: prefix >= 31 ? null : intToIP(bcast),       // /31, /32 have no broadcast
        first: intToIP(prefix >= 31 ? net : net + 1),          // RFC 3021 fix for /31
        last: intToIP(prefix === 32 ? net : prefix === 31 ? bcast : bcast - 1),
        total,
        usable: prefix >= 31 ? total : Math.max(0, total - 2),
        mask: intToIP(mask),
    };
}

// ── Teaching decomposition (the block-size method, octet by octet) ───────────

/**
 * Returns the human-method breakdown: which octet is "interesting", the block
 * size (256 − mask octet), and the floor-division that lands the network.
 * Generalizes to any prefix, including the prefix % 8 === 0 "clean boundary"
 * case where there is no partial octet and the block size is a full 256.
 */
function decompose(octs, prefix) {
    const mO = maskOctets(prefix);
    const idx = Math.min(Math.floor(prefix / 8), 3);   // boundary / interesting octet
    const block = 256 - mO[idx];                       // the magic number
    const netOctet = Math.floor(octs[idx] / block) * block;
    return {
        idx,
        block,
        clean: prefix % 8 === 0,                       // /8 /16 /24 → mask octet is 0 or 255, no partial
        maskOctetValue: mO[idx],
        ipOctetValue: octs[idx],
        netOctetValue: netOctet,
        hostBitsTotal: 32 - prefix,
    };
}

/** Build the ordered 6-step worked solution as plain data (rendered separately). */
function buildSteps(octs, prefix, facts, d) {
    if (prefix === 32) {
        return [{ n: '—', label: 'Host route', math: `/32 = a single address`, result: facts.network }];
    }
    const ipOct = d.ipOctetValue;
    const blk = d.block;
    const netOct = d.netOctetValue;
    const nextOct = netOct + blk;
    const octetPos = ['1st', '2nd', '3rd', '4th'][d.idx];
    return [
        {
            n: 1, label: 'Block size',
            math: `256 − ${d.maskOctetValue} (mask in the ${octetPos} octet)`,
            result: `${blk}`,
            how: [
                'The block size is how far apart subnets sit inside the one octet the mask cuts through (the “interesting” octet). Take the mask value in that octet and subtract it from 256.',
                'A quick way to know the mask value with no binary: each prefix bit past an octet boundary doubles the leading chunk — /25 → 128, /26 → 192, /27 → 224, /28 → 240, /29 → 248, /30 → 252. Whatever that mask value is, 256 minus it is your block size.',
                { eg: 'For 192.168.1.130/26 the mask is 255.255.255.192. The interesting octet is the 4th, value 192. Block size = 256 − 192 = ', val: '64' },
            ],
        },
        {
            n: 2, label: 'Network',
            math: `⌊${ipOct} ÷ ${blk}⌋ × ${blk} = ${Math.floor(ipOct / blk)} × ${blk}`,
            result: facts.network,
            how: [
                'The network address is the start of the block your IP falls in. In the interesting octet, find the largest multiple of the block size that is still ≤ your IP’s octet. (The “⌊ ⌋” just means round down to a whole number.)',
                'Shortcut: divide the IP octet by the block size, drop the remainder, then multiply back by the block size. Every octet to the right of the interesting one becomes 0.',
                { eg: 'For 192.168.1.130/26 (block 64): 130 ÷ 64 = 2 (drop the remainder), 2 × 64 = 128. So the network is ', val: '192.168.1.128' },
            ],
        },
        {
            n: 3, label: 'Next network',
            math: `${netOct} + ${blk} (in the ${octetPos} octet)`,
            result: `${nextOct > 255 ? 'rolls into next octet' : `…${nextOct}…`}`,
            how: [
                'Subnets are spaced exactly one block size apart, so the next subnet starts one full block above this one. Just add the block size to the network value in the interesting octet.',
                'This value isn’t a usable address — it belongs to the next subnet. You only compute it as a stepping stone to find the broadcast (the address just below it).',
                { eg: 'For 192.168.1.128 (block 64): 128 + 64 = 192. The next subnet starts at ', val: '192.168.1.192' },
            ],
        },
        {
            n: 4, label: 'Broadcast',
            math: `next network − 1`,
            result: facts.broadcast ?? 'N/A (point-to-point)',
            how: [
                'The broadcast is the very last address in your subnet — the one right before the next subnet begins. So take the next network and subtract 1.',
                'It’s reserved (it talks to every host at once), so it isn’t handed to a device. /31 and /32 are special: they’re too small to have a broadcast at all.',
                { eg: 'For next network 192.168.1.192: 192 − 1 = 191. The broadcast is ', val: '192.168.1.191' },
            ],
        },
        {
            n: 5, label: 'First usable',
            math: prefix >= 31 ? 'network itself (RFC 3021)' : 'network + 1',
            result: facts.first,
            how: [
                'The network address itself is reserved, so the first address you can actually assign to a device is one above it: network + 1.',
                'Exception: a /31 has only two addresses and both are usable (point-to-point links, RFC 3021), so its first usable is the network address itself.',
                { eg: 'For network 192.168.1.128: 128 + 1 = 129. First usable host is ', val: '192.168.1.129' },
            ],
        },
        {
            n: 6, label: 'Last usable',
            math: prefix >= 31 ? 'broadcast address' : 'broadcast − 1',
            result: facts.last,
            how: [
                'The broadcast is reserved, so the highest address you can assign sits one below it: broadcast − 1.',
                'First usable through last usable is your full pool of assignable host addresses. (For a /31 there’s no broadcast, so the last usable is simply the higher of its two addresses.)',
                { eg: 'For broadcast 192.168.1.191: 191 − 1 = 190. Last usable host is ', val: '192.168.1.190' },
            ],
        },
    ];
}

// ── Parsing / validation ─────────────────────────────────────────────────────

function parseInput(raw) {
    const m = raw.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
    if (!m) throw new Error('Format must be x.x.x.x/n  (e.g. 192.168.50.247/27)');
    const octs = [+m[1], +m[2], +m[3], +m[4]];
    const prefix = +m[5];
    if (octs.some(o => o > 255)) throw new Error('Each octet must be 0–255');
    if (prefix > 32) throw new Error('Prefix must be 0–32');
    return { octs, prefix };
}

/** Normalize a dotted-decimal answer so equivalent formats compare equal. */
function normalizeIP(raw) {
    const t = raw.trim().toLowerCase();
    if (t === 'n/a' || t === 'na' || t === 'none' || t === '') return 'n/a';
    const m = t.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return null;                                   // unparseable
    const o = [+m[1], +m[2], +m[3], +m[4]];
    if (o.some(x => x > 255)) return null;
    return o.join('.');                                    // strips leading zeros, trailing space
}

// ── DOM helpers (no innerHTML — strict CSP) ──────────────────────────────────

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

/**
 * Render the binary place-value grid for all four octets.
 * Network bits are cyan, host bits purple. The boundary octet is ringed.
 */
function renderGrid(octs, prefix) {
    const wrap = el('div', 'grid-wrap');
    const d = decompose(octs, prefix);

    octs.forEach((octVal, oi) => {
        const octBox = el('div', 'octet' + (oi === d.idx && prefix % 8 !== 0 ? ' octet--boundary' : ''));
        const bits = octVal.toString(2).padStart(8, '0').split('').map(Number);

        const head = el('div', 'place-row');
        const bitRow = el('div', 'bit-row');

        PLACE_VALUES.forEach((pv, bi) => {
            const globalBit = oi * 8 + bi;            // 0..31
            const isNet = globalBit < prefix;
            head.appendChild(el('span', 'place', String(pv)));
            const cell = el('span', 'bit ' + (isNet ? 'bit-net' : 'bit-host'), String(bits[bi]));
            bitRow.appendChild(cell);
        });

        octBox.appendChild(head);
        octBox.appendChild(bitRow);
        octBox.appendChild(el('div', 'octet-val', String(octVal)));
        wrap.appendChild(octBox);
        if (oi < 3) wrap.appendChild(el('span', 'octet-dot', '.'));
    });

    const legend = el('div', 'grid-legend');
    legend.appendChild(el('span', 'lg lg-net', '■'));
    legend.appendChild(el('span', null, ` ${prefix} network bits`));
    legend.appendChild(el('span', 'lg lg-host', '  ■'));
    legend.appendChild(el('span', null, ` ${32 - prefix} host bits`));

    const out = el('div');
    out.appendChild(wrap);
    out.appendChild(legend);
    return out;
}

/**
 * Render a plain-text string into a parent node, turning `backtick` spans into
 * styled <code> elements. No innerHTML — each fragment is a text node, so user
 * input that ever reaches here can't inject markup (strict-CSP discipline).
 */
function appendInlineCode(parent, text) {
    text.split('`').forEach((chunk, i) => {
        if (chunk === '') return;
        parent.appendChild(i % 2 === 1 ? el('code', null, chunk) : document.createTextNode(chunk));
    });
}

/** Build the collapsible "How do I find this?" explainer for one step. */
function renderHow(howParts) {
    const details = el('details', 'step-how');
    details.appendChild(el('summary', null, 'How do I find this?'));
    const body = el('div', 'step-how-body');
    howParts.forEach(part => {
        if (typeof part === 'string') {
            const p = el('p');
            appendInlineCode(p, part);
            body.appendChild(p);
        } else {
            // Worked-example line: lead text + a highlighted result value.
            const p = el('p', 'step-how-eg');
            p.appendChild(document.createTextNode('Example: ' + part.eg));
            p.appendChild(el('strong', null, part.val));
            body.appendChild(p);
        }
    });
    details.appendChild(body);
    return details;
}

/** Render the 6-step worked solution as a list of step cards. */
function renderSteps(octs, prefix, facts) {
    const d = decompose(octs, prefix);
    const steps = buildSteps(octs, prefix, facts, d);
    const list = el('div', 'steps');
    steps.forEach(s => {
        const card = el('div', 'step');
        const head = el('div', 'step-head');
        head.appendChild(el('span', 'step-n', String(s.n)));
        head.appendChild(el('span', 'step-label', s.label));
        card.appendChild(head);
        card.appendChild(el('div', 'step-math', s.math));
        card.appendChild(el('div', 'step-result', s.result));
        if (s.how) card.appendChild(renderHow(s.how));
        list.appendChild(card);
    });
    if (d.clean && prefix !== 32) {
        const note = el('div', 'clean-note',
            `Clean boundary: /${prefix} ends on an octet edge, so there is no partial octet — ` +
            `the mask is 255 (locked) then 0 (free). Network = copy the locked octets, zero the rest.`);
        list.appendChild(note);
    }
    return list;
}

/** Render the final answer table. */
function renderAnswer(facts) {
    const rows = [
        ['Network', facts.network],
        ['Broadcast', facts.broadcast ?? 'N/A (point-to-point)'],
        ['Usable range', facts.usable > 0 ? `${facts.first} – ${facts.last}` : facts.network],
        ['Total addresses', facts.total.toLocaleString()],
        ['Usable hosts', facts.usable.toLocaleString()],
    ];
    const card = el('div', 'answer-card');
    rows.forEach(([k, v]) => {
        const row = el('div', 'answer-row');
        row.appendChild(el('span', 'answer-key', k));
        row.appendChild(el('span', 'answer-val', v));
        card.appendChild(row);
    });
    return card;
}

// ── Learn mode ───────────────────────────────────────────────────────────────

const learnInput = document.getElementById('learn-input');
const learnError = document.getElementById('learn-error');
const learnResults = document.getElementById('learn-results');

function renderLearn() {
    const raw = learnInput.value;
    learnResults.textContent = '';
    if (!raw.trim()) { learnError.hidden = true; learnInput.classList.remove('error'); return; }

    let parsed;
    try {
        parsed = parseInput(raw);
    } catch (e) {
        learnError.textContent = e.message;
        learnError.hidden = false;
        learnInput.classList.add('error');
        return;
    }
    learnError.hidden = true;
    learnInput.classList.remove('error');

    const { octs, prefix } = parsed;
    const facts = computeFacts(octs, prefix);

    learnResults.appendChild(el('p', 'section-title', 'Binary place-value grid'));
    learnResults.appendChild(renderGrid(octs, prefix));
    learnResults.appendChild(el('p', 'section-title', 'The method, step by step'));
    learnResults.appendChild(renderSteps(octs, prefix, facts));
    learnResults.appendChild(el('p', 'section-title', 'Answer'));
    learnResults.appendChild(renderAnswer(facts));
}

learnInput.addEventListener('input', renderLearn);

document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => { learnInput.value = btn.dataset.preset; renderLearn(); });
});

// ── Drill mode ─────────────────────────────────────────────────────────────

const drillEls = {
    question: document.getElementById('drill-question'),
    network: document.getElementById('ans-network'),
    broadcast: document.getElementById('ans-broadcast'),
    first: document.getElementById('ans-first'),
    last: document.getElementById('ans-last'),
    check: document.getElementById('drill-check'),
    skip: document.getElementById('drill-skip'),
    feedback: document.getElementById('drill-feedback'),
    streak: document.getElementById('drill-streak'),
    best: document.getElementById('drill-best'),
    weak: document.getElementById('drill-weak'),
};

const drill = { facts: null, octs: null, prefix: null, streak: 0, startMs: 0, answered: false };

function readBest() {
    try { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; }
    catch { return 0; }                                    // private mode throws
}
function writeBest(v) {
    try { localStorage.setItem(BEST_KEY, String(v)); } catch { /* non-fatal */ }
}

// ── Adaptive drilling: bias question generation toward prefixes you miss ─────
// Stats shape: { "<prefix>": { seen, missed } }. `missed` rises on a wrong
// answer and decays on a correct one, so mastered prefixes drift back to
// baseline weight while weak ones keep resurfacing — lightweight spaced rep.

function loadStats() {
    try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; }
    catch { return {}; }
}
function saveStats(s) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* non-fatal */ }
}
function recordResult(prefix, correct) {
    const s = loadStats();
    const e = s[prefix] || { seen: 0, missed: 0 };
    e.seen += 1;
    e.missed = correct ? Math.max(0, e.missed - 1) : e.missed + 1;
    s[prefix] = e;
    saveStats(s);
}
/** Weighted random over a pool: weight = 1 + 2·misses, so weak prefixes recur. */
function weightedPick(pool, stats) {
    const weights = pool.map(p => 1 + 2 * ((stats[p] && stats[p].missed) || 0));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
        r -= weights[i];
        if (r < 0) return pool[i];
    }
    return pool[pool.length - 1];
}

function difficulty() {
    const btn = document.querySelector('.diff-btn[aria-pressed="true"]');
    return btn ? btn.dataset.diff : 'basic';
}

function randomQuestion() {
    const tier = difficulty();
    // Contiguous prefix coverage so the CIDR suffix doesn't recycle — the host
    // octets are already random over billions of addresses, so the prefix pool
    // was the only thing the user could see repeat. basic: /16–/30 ; advanced: /8–/32.
    const pool = tier === 'advanced'
        ? [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29, 30, 31, 32]
        : [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
    const prefix = weightedPick(pool, loadStats());
    const octs = [
        Math.floor(Math.random() * 223) + 1,               // 1–223, avoid 0/multicast first octet
        Math.floor(Math.random() * 256),
        Math.floor(Math.random() * 256),
        Math.floor(Math.random() * 256),
    ];
    return { octs, prefix, facts: computeFacts(octs, prefix) };
}

function newQuestion() {
    const q = randomQuestion();
    drill.octs = q.octs;
    drill.prefix = q.prefix;
    drill.facts = q.facts;
    drill.answered = false;
    drill.startMs = Date.now();

    drillEls.question.textContent = `${q.octs.join('.')}/${q.prefix}`;
    [drillEls.network, drillEls.broadcast, drillEls.first, drillEls.last].forEach(i => {
        i.value = '';
        i.classList.remove('ok', 'bad');
        i.disabled = false;
    });
    drillEls.feedback.textContent = '';
    drillEls.check.textContent = 'Check answer';
    drillEls.network.focus();
}

function markField(input, userNorm, expectedNorm) {
    const ok = userNorm !== null && userNorm === expectedNorm;
    input.classList.toggle('ok', ok);
    input.classList.toggle('bad', !ok);
    return ok;
}

function checkAnswer() {
    if (drill.answered) { newQuestion(); return; }
    const f = drill.facts;
    const expBcast = f.broadcast === null ? 'n/a' : f.broadcast;

    const results = [
        markField(drillEls.network, normalizeIP(drillEls.network.value), f.network),
        markField(drillEls.broadcast, normalizeIP(drillEls.broadcast.value), expBcast),
        markField(drillEls.first, normalizeIP(drillEls.first.value), f.first),
        markField(drillEls.last, normalizeIP(drillEls.last.value), f.last),
    ];
    const allCorrect = results.every(Boolean);
    const elapsed = ((Date.now() - drill.startMs) / 1000).toFixed(1);

    recordResult(drill.prefix, allCorrect);   // feeds adaptive weighting
    drill.answered = true;
    [drillEls.network, drillEls.broadcast, drillEls.first, drillEls.last].forEach(i => i.disabled = true);

    if (allCorrect) {
        drill.streak += 1;
        if (drill.streak > readBest()) { writeBest(drill.streak); }
        drillEls.feedback.textContent = '';
        drillEls.feedback.appendChild(el('p', 'fb-ok', `✓ Correct in ${elapsed}s — streak ${drill.streak}`));
    } else {
        drill.streak = 0;
        drillEls.feedback.textContent = '';
        drillEls.feedback.appendChild(el('p', 'fb-bad', `✗ Not quite — here's the worked solution:`));
        drillEls.feedback.appendChild(renderGrid(drill.octs, drill.prefix));
        drillEls.feedback.appendChild(renderSteps(drill.octs, drill.prefix, f));
    }
    updateScore();
    drillEls.check.textContent = 'Next question →';
    drillEls.check.focus();
}

function updateScore() {
    drillEls.streak.textContent = String(drill.streak);
    drillEls.best.textContent = String(readBest());
    updateWeak();
}

function updateWeak() {
    const s = loadStats();
    const weak = Object.keys(s)
        .filter(p => s[p].missed > 0)
        .sort((a, b) => s[b].missed - s[a].missed)
        .slice(0, 3);
    drillEls.weak.textContent = '';
    if (weak.length === 0) {
        drillEls.weak.appendChild(document.createTextNode('Adapting to your misses — no weak spots yet.'));
        return;
    }
    drillEls.weak.appendChild(document.createTextNode('Resurfacing your weak prefixes: '));
    weak.forEach((p, i) => {
        drillEls.weak.appendChild(el('strong', null, '/' + p));
        if (i < weak.length - 1) drillEls.weak.appendChild(document.createTextNode('  '));
    });
}

drillEls.check.addEventListener('click', checkAnswer);
drillEls.skip.addEventListener('click', () => { drill.streak = 0; updateScore(); newQuestion(); });

// Enter key in any answer field triggers check / next
[drillEls.network, drillEls.broadcast, drillEls.first, drillEls.last].forEach(i => {
    i.addEventListener('keydown', e => { if (e.key === 'Enter') checkAnswer(); });
});

document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.diff-btn').forEach(b => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
        newQuestion();
    });
});

// ── Mode toggle ──────────────────────────────────────────────────────────────

const modeBtns = document.querySelectorAll('.mode-btn');
const sections = { learn: document.getElementById('learn-mode'), drill: document.getElementById('drill-mode') };

function setMode(mode) {
    modeBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    sections.learn.hidden = mode !== 'learn';
    sections.drill.hidden = mode !== 'drill';
    if (mode === 'drill' && !drill.facts) { newQuestion(); updateScore(); }
}
modeBtns.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

// ── Load-time self-check (fails loud if copied math drifts) ──────────────────

(function selfCheck() {
    const cases = [
        ['192.168.223.15', 30, '192.168.223.12', '192.168.223.15'],
        ['46.28.247.109', 10, '46.0.0.0', '46.63.255.255'],
        ['134.170.185.46', 17, '134.170.128.0', '134.170.255.255'],
        ['192.168.50.247', 27, '192.168.50.224', '192.168.50.255'],
        ['154.24.67.147', 22, '154.24.64.0', '154.24.67.255'],
        ['10.119.136.143', 20, '10.119.128.0', '10.119.143.255'],
        ['192.168.50.247', 24, '192.168.50.0', '192.168.50.255'],   // clean boundary
        ['192.168.50.247', 16, '192.168.0.0', '192.168.255.255'],   // clean boundary
        ['10.0.0.4', 31, '10.0.0.4', null],                          // RFC 3021
    ];
    let failed = 0;
    for (const [ip, p, expNet, expBcast] of cases) {
        const octs = ip.split('.').map(Number);
        const f = computeFacts(octs, p);
        const d = decompose(octs, p);
        const decompNet = (() => {
            const n = octs.slice();
            n[d.idx] = d.netOctetValue;
            for (let i = d.idx + 1; i < 4; i++) n[i] = 0;
            return n.join('.');
        })();
        if (f.network !== expNet || decompNet !== expNet || f.broadcast !== expBcast) {
            failed++;
            console.error(`[self-check FAIL] ${ip}/${p} → net ${f.network}/${decompNet} (exp ${expNet}), bcast ${f.broadcast} (exp ${expBcast})`);
        }
    }
    if (failed === 0) console.info('[subnet-trainer] self-check passed — math engine OK');
    else console.error(`[subnet-trainer] self-check: ${failed} failure(s) — math has drifted from cidr-calc`);
})();

// Boot Learn mode with a worked example.
learnInput.value = '192.168.50.247/27';
renderLearn();
