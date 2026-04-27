// --- Particle background (matches hub aesthetic) ---
const bg = document.getElementById('bg-canvas');
const bx = bg.getContext('2d');
let W, H, pts;
function initBg() {
    W = bg.width = window.innerWidth;
    H = bg.height = window.innerHeight;
    pts = Array.from({length: 60}, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: Math.random() * 1.3 + 0.2,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        a: Math.random() * 0.7 + 0.1
    }));
}
function animBg() {
    bx.clearRect(0, 0, W, H);
    pts.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
        bx.beginPath();
        bx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        bx.fillStyle = `rgba(74,247,255,${p.a * 0.5})`;
        bx.fill();
    });
    requestAnimationFrame(animBg);
}
initBg();
animBg();
window.addEventListener('resize', initBg);

// --- Risk level helpers ---
function levelLabel(score) {
    if (score == null) return 'Unknown';
    if (score >= 80) return 'Critical';
    if (score >= 65) return 'High';
    if (score >= 45) return 'Moderate';
    if (score >= 25) return 'Low';
    return 'Minimal';
}

function levelColor(score) {
    if (score == null) return '#5a607a';
    if (score >= 80) return '#ef4444';
    if (score >= 65) return '#fb923c';
    if (score >= 45) return '#facc15';
    if (score >= 25) return '#a3e635';
    return '#34d399';
}

// --- Composite gauge (semicircle) ---
function drawGauge(score) {
    const c = document.getElementById('gauge');
    if (!c) return;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    const cx = W / 2, cy = H * 0.92;
    const radius = 130;

    ctx.clearRect(0, 0, W, H);

    // Background segment arcs (faint color band)
    const bands = [
        {start: Math.PI,           end: Math.PI * 1.25, color: '#34d399'},
        {start: Math.PI * 1.25,    end: Math.PI * 1.45, color: '#a3e635'},
        {start: Math.PI * 1.45,    end: Math.PI * 1.65, color: '#facc15'},
        {start: Math.PI * 1.65,    end: Math.PI * 1.80, color: '#fb923c'},
        {start: Math.PI * 1.80,    end: Math.PI * 2,    color: '#ef4444'},
    ];
    ctx.lineWidth = 16;
    ctx.lineCap = 'butt';
    bands.forEach(b => {
        ctx.beginPath();
        ctx.strokeStyle = b.color;
        ctx.globalAlpha = 0.18;
        ctx.arc(cx, cy, radius, b.start, b.end);
        ctx.stroke();
    });

    // Active filled arc up to score
    ctx.globalAlpha = 1;
    const target = Math.PI + (score / 100) * Math.PI;
    const color = levelColor(score);

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 16;
    ctx.shadowBlur = 18;
    ctx.shadowColor = color;
    ctx.arc(cx, cy, radius, Math.PI, target);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Tick marks every 10
    ctx.strokeStyle = 'rgba(221, 224, 240, 0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
        const a = Math.PI + (i / 10) * Math.PI;
        const x1 = cx + Math.cos(a) * (radius - 26);
        const y1 = cy + Math.sin(a) * (radius - 26);
        const x2 = cx + Math.cos(a) * (radius - 16);
        const y2 = cy + Math.sin(a) * (radius - 16);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    // Needle
    const nx = cx + Math.cos(target) * (radius - 4);
    const ny = cy + Math.sin(target) * (radius - 4);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
}

// --- Sparkline rendering ---
function renderSparkline(canvas, history) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!history || history.length < 2) return;

    const values = history.map(h => h.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = (max - min) || 1;

    ctx.beginPath();
    history.forEach((h, i) => {
        const x = (i / (history.length - 1)) * W;
        const y = H - ((h.value - min) / range) * H * 0.85 - H * 0.08;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#4af7ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Last-point dot
    const last = history[history.length - 1];
    const lx = W - 1.5;
    const ly = H - ((last.value - min) / range) * H * 0.85 - H * 0.08;
    ctx.fillStyle = '#4af7ff';
    ctx.beginPath();
    ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
    ctx.fill();
}

function formatValue(value, unit) {
    if (unit === 'USD') return '$' + value.toLocaleString(undefined, {maximumFractionDigits: 0});
    if (unit === '%') return value.toFixed(2) + '%';
    if (unit === 'thousands') return value.toLocaleString() + 'K';
    if (unit === 'months') return value.toFixed(1) + ' mo';
    return value.toLocaleString(undefined, {maximumFractionDigits: 1});
}

// --- Indicator card ---
function indicatorCard(ind) {
    const card = document.createElement('button');
    card.className = 'indicator-card';
    card.type = 'button';
    card.setAttribute('aria-label', `${ind.name} — click for details`);
    const color = levelColor(ind.riskScore);
    card.style.borderLeftColor = color;

    const sparklineId = `spark-${ind.id}`;
    const z = ind.zScore != null ? ind.zScore.toFixed(2) : '–';
    const pct = ind.percentile != null ? ind.percentile + 'th pct' : '';
    const score = ind.riskScore != null ? ind.riskScore + '/100' : '–';

    card.innerHTML = `
        <div class="ind-header">
            <h4>${ind.name}</h4>
            <span class="ind-badge" style="background:${color}22;color:${color}">${levelLabel(ind.riskScore)}</span>
        </div>
        <div class="ind-body">
            <div class="ind-meta">
                <span class="ind-current">${formatValue(ind.current, ind.unit)}</span>
                <span class="ind-date">${ind.currentDate}</span>
            </div>
            <canvas id="${sparklineId}" width="160" height="40" class="sparkline"></canvas>
        </div>
        <div class="ind-footer">
            <span>z = ${z}</span>
            <span>${pct}</span>
            <span>risk ${score}</span>
        </div>
        <p class="ind-desc">${ind.description}</p>
        <span class="ind-more">View detail →</span>
    `;

    card.addEventListener('click', () => openModal(ind));

    queueMicrotask(() => {
        const c = document.getElementById(sparklineId);
        if (c) renderSparkline(c, ind.history);
    });

    return card;
}

// --- Key rates strip (featured indicators promoted to top of page) ---
const FEATURED_RATE_IDS = ['fed_funds', 'mortgage_rate', 'unemployment', 'yield_curve'];

function renderKeyRates(indicators) {
    const container = document.getElementById('key-rates');
    if (!container) return;
    const featured = FEATURED_RATE_IDS
        .map(id => indicators.find(i => i.id === id))
        .filter(Boolean);

    if (featured.length === 0) {
        container.innerHTML = '<p class="error">No data yet.</p>';
        return;
    }

    container.innerHTML = '';
    featured.forEach(ind => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'rate-tile';
        const color = levelColor(ind.riskScore);
        tile.style.setProperty('--accent', color);
        tile.innerHTML = `
            <span class="rate-label">${ind.name}</span>
            <span class="rate-value">${formatValue(ind.current, ind.unit)}</span>
            <span class="rate-meta">
                <span class="rate-badge" style="background:${color}22;color:${color}">${levelLabel(ind.riskScore)}</span>
                <span class="rate-date">${ind.currentDate}</span>
            </span>
        `;
        tile.addEventListener('click', () => openModal(ind));
        container.appendChild(tile);
    });
}

// --- Detailed modal ---
function drawDetailChart(canvas, history, ind) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!history || history.length < 2) return;

    const pad = {top: 24, right: 60, bottom: 28, left: 12};
    const innerW = W - pad.left - pad.right;
    const innerH = H - pad.top - pad.bottom;

    const values = history.map(h => h.value);
    const dates = history.map(h => new Date(h.date));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = (max - min) || 1;

    // Crash period shading
    const eras = [
        {start: '1989-01-01', end: '1991-12-31', label: 'S&L', color: 'rgba(251, 146, 60, 0.08)'},
        {start: '2007-12-01', end: '2012-06-30', label: '2008 GFC', color: 'rgba(239, 68, 68, 0.10)'},
        {start: '2020-02-01', end: '2020-08-31', label: 'COVID', color: 'rgba(123, 47, 255, 0.10)'},
    ];

    const dateMin = dates[0].getTime();
    const dateMax = dates[dates.length - 1].getTime();
    const dateRange = dateMax - dateMin || 1;

    function xPos(dt) {
        return pad.left + ((dt - dateMin) / dateRange) * innerW;
    }
    function yPos(v) {
        return pad.top + innerH - ((v - min) / range) * innerH;
    }

    // Era bands
    eras.forEach(era => {
        const startT = new Date(era.start).getTime();
        const endT = new Date(era.end).getTime();
        if (endT < dateMin || startT > dateMax) return;
        const x1 = xPos(Math.max(startT, dateMin));
        const x2 = xPos(Math.min(endT, dateMax));
        ctx.fillStyle = era.color;
        ctx.fillRect(x1, pad.top, x2 - x1, innerH);
        ctx.fillStyle = 'rgba(221, 224, 240, 0.4)';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(era.label, (x1 + x2) / 2, pad.top - 8);
    });

    // Y-axis grid + labels
    ctx.strokeStyle = 'rgba(74, 247, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(221, 224, 240, 0.45)';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    [0, 0.25, 0.5, 0.75, 1].forEach(t => {
        const y = pad.top + innerH - t * innerH;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + innerW, y);
        ctx.stroke();
        const v = min + t * range;
        const formatted = formatValue(v, ind.unit);
        ctx.fillText(formatted, pad.left + innerW + 6, y + 3);
    });

    // X-axis year labels
    const years = [];
    for (let y = dates[0].getFullYear(); y <= dates[dates.length - 1].getFullYear(); y += 5) {
        years.push(y);
    }
    ctx.textAlign = 'center';
    years.forEach(y => {
        const dt = new Date(`${y}-01-01`).getTime();
        if (dt < dateMin || dt > dateMax) return;
        ctx.fillText(y, xPos(dt), H - 8);
    });

    // Line
    ctx.beginPath();
    history.forEach((h, i) => {
        const x = xPos(dates[i].getTime());
        const y = yPos(h.value);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#4af7ff';
    ctx.lineWidth = 1.6;
    ctx.shadowBlur = 6;
    ctx.shadowColor = 'rgba(74, 247, 255, 0.45)';
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Mean reference line
    const mean = values.slice(-240).reduce((a, b) => a + b, 0) / Math.min(240, values.length);
    const my = yPos(mean);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(221, 224, 240, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, my);
    ctx.lineTo(pad.left + innerW, my);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(221, 224, 240, 0.4)';
    ctx.textAlign = 'right';
    ctx.fillText('20yr mean', pad.left + innerW - 4, my - 4);

    // Current value marker
    const last = history[history.length - 1];
    const lx = xPos(new Date(last.date).getTime());
    const ly = yPos(last.value);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(lx, ly, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4af7ff';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function openModal(ind) {
    const modal = document.getElementById('modal');
    const content = document.getElementById('modal-content');
    const detail = (typeof INDICATOR_CONTENT !== 'undefined' && INDICATOR_CONTENT[ind.id]) || null;
    const color = levelColor(ind.riskScore);

    const events = detail?.historicalContext?.map(e => `
        <li>
            <strong>${e.date}</strong> — ${e.label}
            <span class="event-note">${e.note}</span>
        </li>
    `).join('') || '';

    const z = ind.zScore != null ? ind.zScore.toFixed(2) : '–';
    const pct = ind.percentile != null ? ind.percentile + 'th percentile' : '';
    const score = ind.riskScore != null ? `${ind.riskScore}/100` : '–';

    content.innerHTML = `
        <header class="modal-header">
            <div class="modal-title-row">
                <h2 id="modal-title">${ind.name}</h2>
                <span class="ind-badge" style="background:${color}22;color:${color}">${levelLabel(ind.riskScore)}</span>
            </div>
            <div class="modal-stats">
                <div class="modal-stat"><span class="stat-label">Current</span><span class="stat-value">${formatValue(ind.current, ind.unit)}</span></div>
                <div class="modal-stat"><span class="stat-label">As of</span><span class="stat-value">${ind.currentDate}</span></div>
                <div class="modal-stat"><span class="stat-label">Z-score</span><span class="stat-value">${z}</span></div>
                <div class="modal-stat"><span class="stat-label">Percentile</span><span class="stat-value">${pct || '–'}</span></div>
                <div class="modal-stat"><span class="stat-label">Risk</span><span class="stat-value" style="color:${color}">${score}</span></div>
            </div>
        </header>

        <div class="modal-chart-wrap">
            <canvas id="modal-chart" width="780" height="280"></canvas>
        </div>

        ${detail ? `
            <section class="modal-section">
                <h3>What it measures</h3>
                <p>${detail.whatItMeasures}</p>
            </section>
            <section class="modal-section">
                <h3>Why it matters</h3>
                <p>${detail.whyItMatters}</p>
            </section>
            <section class="modal-section">
                <h3>Historical context</h3>
                <ul class="event-list">${events}</ul>
            </section>
            <section class="modal-section">
                <h3>How to interpret today's reading</h3>
                <p>${detail.interpretation}</p>
            </section>
        ` : `
            <section class="modal-section">
                <h3>About this indicator</h3>
                <p>${ind.description}</p>
            </section>
        `}

        <footer class="modal-footer">
            <span>FRED series: <a href="https://fred.stlouisfed.org/series/${ind.fredId}" target="_blank" rel="noopener"><code>${ind.fredId}</code></a></span>
        </footer>
    `;

    modal.hidden = false;
    document.body.style.overflow = 'hidden';

    queueMicrotask(() => {
        const c = document.getElementById('modal-chart');
        if (c) {
            const dpr = window.devicePixelRatio || 1;
            const cssW = c.clientWidth || 780;
            const cssH = 280;
            c.width = cssW * dpr;
            c.height = cssH * dpr;
            c.style.height = cssH + 'px';
            c.getContext('2d').scale(dpr, dpr);
            // Use logical dimensions for drawing
            const drawCanvas = {
                width: cssW,
                height: cssH,
                getContext: () => c.getContext('2d')
            };
            drawDetailChart(drawCanvas, ind.history, ind);
        }
    });
}

function closeModal() {
    const modal = document.getElementById('modal');
    modal.hidden = true;
    document.body.style.overflow = '';
}

// Modal close handlers
document.addEventListener('click', e => {
    if (e.target.matches('[data-close-modal]')) closeModal();
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
});

function categoryCard(catId, catData, indicators) {
    const card = document.createElement('section');
    card.className = 'category-card';
    const color = levelColor(catData.score);

    const inds = indicators.filter(i => i.category === catId);

    card.innerHTML = `
        <header class="cat-header">
            <h3>${catData.name}</h3>
            <span class="cat-score" style="color:${color}">${catData.score}</span>
        </header>
        <div class="cat-indicators"></div>
    `;

    const indContainer = card.querySelector('.cat-indicators');
    inds.forEach(i => indContainer.appendChild(indicatorCard(i)));

    return card;
}

// --- Render entry point ---
function render(data) {
    drawGauge(data.compositeScore);
    document.getElementById('gauge-value').textContent = data.compositeScore;
    const status = document.getElementById('gauge-status');
    status.textContent = levelLabel(data.compositeScore) + ' Risk';
    status.style.color = levelColor(data.compositeScore);

    const updated = new Date(data.lastUpdated);
    document.getElementById('last-updated').textContent =
        `Updated ${updated.toLocaleDateString()} ${updated.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;

    renderKeyRates(data.indicators || []);

    const container = document.getElementById('categories');
    container.innerHTML = '';

    if (!data.categories || Object.keys(data.categories).length === 0) {
        container.innerHTML = '<p class="error">No data yet. The daily fetch workflow has not run successfully — trigger it manually from the GitHub Actions tab to populate.</p>';
        return;
    }

    Object.entries(data.categories).forEach(([catId, catData]) => {
        container.appendChild(categoryCard(catId, catData, data.indicators));
    });
}

async function load() {
    try {
        const res = await fetch('data.json?t=' + Date.now());
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        render(data);
    } catch (err) {
        console.error('Failed to load data.json:', err);
        document.getElementById('categories').innerHTML =
            `<p class="error">Could not load data.json. The daily data refresh may not have run yet — check the <strong>Actions</strong> tab on GitHub and click "Run workflow" on "Fetch housing market data".</p>`;
        document.getElementById('last-updated').textContent = 'No data';
        document.getElementById('gauge-status').textContent = 'No data';
    }
}

load();
