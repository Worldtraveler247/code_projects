'use strict';

// ── Core CIDR math ───────────────────────────────────────────────────────────

function toInt([a, b, c, d]) { return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0; }
function toIP(n)  { return [(n>>>24)&0xff,(n>>>16)&0xff,(n>>>8)&0xff,n&0xff].join('.'); }
function toBin(n) { return (n>>>0).toString(2).padStart(32,'0'); }
function fmt(n)   { return n.toLocaleString(); }

function parseCIDR(input) {
    const m = input.trim().match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/);
    if (!m) throw new Error('Expected x.x.x.x/n');

    const octs   = [+m[1], +m[2], +m[3], +m[4]];
    const prefix = +m[5];

    if (octs.some(o => o < 0 || o > 255)) throw new Error('Each octet must be 0–255');
    if (prefix < 0 || prefix > 32)        throw new Error('Prefix must be 0–32');

    const ipInt  = toInt(octs);
    const mask   = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
    const net    = (ipInt & mask) >>> 0;
    const bcast  = (net | (~mask >>> 0)) >>> 0;
    const total  = Math.pow(2, 32 - prefix);
    const usable = prefix >= 31 ? total : Math.max(0, total - 2);

    return {
        prefix,
        net:     toIP(net),
        netBin:  toBin(net),
        mask:    toIP(mask),
        maskHex: '0x' + mask.toString(16).toUpperCase().padStart(8,'0'),
        wild:    toIP(~mask >>> 0),
        bcast:   toIP(bcast),
        first:   toIP(prefix >= 31 ? net : net + 1),
        last:    toIP(prefix >= 31  ? bcast : bcast - 1),
        total,
        usable,
        cls:     ipClass(octs[0]),
        private: isPrivate(net),
        awsVpc:  prefix >= 16 && prefix <= 28,
        netInt:  net,
        maskInt: mask,
    };
}

function ipClass(first) {
    if (first < 128) return 'A';
    if (first < 192) return 'B';
    if (first < 224) return 'C';
    if (first < 240) return 'D (Multicast)';
    return 'E (Reserved)';
}

function isPrivate(n) {
    return ((n & 0xFF000000) >>> 0) === 0x0A000000
        || ((n & 0xFFF00000) >>> 0) === 0xAC100000
        || ((n & 0xFFFF0000) >>> 0) === 0xC0A80000;
}

// ── Binary row builder (DOM only, no innerHTML) ───────────────────────────────

function makeBinRow(label, binStr, prefix) {
    const row = document.createElement('div');
    row.className = 'bin-line';

    const lbl = document.createElement('span');
    lbl.className   = 'bin-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const bits = document.createElement('span');
    bits.className = 'bin-row';

    binStr.split('').forEach((bit, i) => {
        if (i > 0 && i % 8 === 0) {
            const dot = document.createElement('span');
            dot.className   = 'bin-dot';
            dot.textContent = '.';
            bits.appendChild(dot);
        }
        const s = document.createElement('span');
        s.className   = i < prefix ? 'bit-net' : 'bit-host';
        s.textContent = bit;
        bits.appendChild(s);
    });

    row.appendChild(bits);
    return row;
}

function makeBinLegend(prefix) {
    const wrap = document.createElement('div');
    wrap.className = 'bin-legend';

    const netDot = document.createElement('span');
    netDot.className   = 'bit-net';
    netDot.textContent = '■';

    const netLabel = document.createElement('span');
    netLabel.textContent = ` Network bits (/${prefix})   `;

    const hostDot = document.createElement('span');
    hostDot.className   = 'bit-host';
    hostDot.textContent = '■';

    const hostLabel = document.createElement('span');
    hostLabel.textContent = ` Host bits (${32 - prefix})`;

    wrap.appendChild(netDot);
    wrap.appendChild(netLabel);
    wrap.appendChild(hostDot);
    wrap.appendChild(hostLabel);
    return wrap;
}

// ── Subnet splitter ───────────────────────────────────────────────────────────

function computeSubnets(netInt, parentPrefix, targetPrefix) {
    const count = Math.pow(2, targetPrefix - parentPrefix);
    const size  = Math.pow(2, 32 - targetPrefix);
    const shown = Math.min(count, 64);
    return {
        count,
        shown,
        usable:  targetPrefix >= 31 ? Math.pow(2, 32 - targetPrefix) : Math.max(0, Math.pow(2, 32 - targetPrefix) - 2),
        entries: Array.from({length: shown}, (_, i) => toIP((netInt + i * size) >>> 0) + '/' + targetPrefix),
    };
}

function renderSplit() {
    if (!current) return;
    const target = +splitInput.value;
    splitOut.textContent = '';

    if (target <= current.prefix || target > 32) {
        const err = document.createElement('span');
        err.className   = 'split-err';
        err.textContent = `Target prefix must be greater than /${current.prefix}`;
        splitOut.appendChild(err);
        return;
    }

    const {count, shown, usable, entries} = computeSubnets(current.netInt, current.prefix, target);

    const summary = document.createElement('div');
    summary.className   = 'split-summary';
    summary.textContent = `${fmt(count)} subnet${count !== 1 ? 's' : ''} × ${fmt(usable)} usable host${usable !== 1 ? 's' : ''} each`;
    splitOut.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'split-list';

    entries.forEach(cidr => {
        const row = document.createElement('div');
        row.className = 'split-item';

        const cidrEl = document.createElement('span');
        cidrEl.className   = 'split-cidr';
        cidrEl.textContent = cidr;

        const hostsEl = document.createElement('span');
        hostsEl.className   = 'split-hosts';
        hostsEl.textContent = fmt(usable) + ' hosts';

        row.appendChild(cidrEl);
        row.appendChild(hostsEl);
        list.appendChild(row);
    });

    if (count > 64) {
        const more = document.createElement('div');
        more.className   = 'split-more';
        more.textContent = `… and ${fmt(count - 64)} more`;
        list.appendChild(more);
    }

    splitOut.appendChild(list);
}

// ── Main render ───────────────────────────────────────────────────────────────

const input      = document.getElementById('cidr-input');
const errorEl    = document.getElementById('input-error');
const resultsEl  = document.getElementById('results');
const splitInput = document.getElementById('split-prefix');
const splitOut   = document.getElementById('split-output');

let current = null;

function setField(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function render(c) {
    current = c;

    // Badges
    setField('badge-class', 'Class ' + c.cls);
    document.getElementById('badge-private').hidden   = !c.private;
    document.getElementById('badge-awsvpc').hidden    = !c.awsVpc;
    document.getElementById('badge-awsvpc-no').hidden = c.awsVpc;

    // Info rows — copy-source spans get plain IP text; annotation shown separately
    setField('r-net',    c.net);
    setField('r-mask',   c.mask);
    setField('r-mask-hex', c.maskHex);
    setField('r-wild',   c.wild);
    setField('r-bcast',  c.prefix === 31 ? 'N/A (point-to-point)' : c.prefix === 32 ? 'N/A (host route)' : c.bcast);
    setField('r-first',  c.prefix === 32 ? c.net + ' (host route)' : c.first);
    setField('r-last',   c.last);
    setField('r-total',  fmt(c.total));
    setField('r-usable', fmt(c.usable) + (c.prefix >= 31 ? ' (point-to-point / host)' : ''));

    // Binary breakdown
    const binWrap = document.getElementById('binary-wrap');
    binWrap.textContent = '';
    binWrap.appendChild(makeBinRow('IP     ', c.netBin, c.prefix));
    binWrap.appendChild(makeBinRow('Mask   ', toBin(c.maskInt), c.prefix));
    binWrap.appendChild(makeBinLegend(c.prefix));

    // Subnet splitter
    splitInput.min   = c.prefix + 1;
    splitInput.max   = 32;
    splitInput.value = Math.min(c.prefix + 2, 32);
    renderSplit();

    resultsEl.hidden = false;
}

function calculate() {
    const val = input.value.trim();
    if (!val) { resultsEl.hidden = true; errorEl.hidden = true; current = null; return; }
    try {
        render(parseCIDR(val));
        errorEl.hidden = true;
        input.classList.remove('error');
    } catch (e) {
        errorEl.textContent = e.message;
        errorEl.hidden = false;
        input.classList.add('error');
        resultsEl.hidden = true;
        current = null;
    }
}

input.addEventListener('input', calculate);
splitInput.addEventListener('input', renderSplit);

// Copy to clipboard — reads the data-copy target's textContent
document.addEventListener('click', async e => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const src = document.getElementById(btn.dataset.copy);
    if (!src) return;
    await navigator.clipboard.writeText(src.textContent.trim()).catch(() => {});
    const orig = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = orig; }, 1200);
});

// Presets
document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => { input.value = btn.dataset.preset; calculate(); });
});

// Boot with placeholder value
input.value = '10.0.0.0/16';
calculate();
