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
    const card = document.createElement('div');
    card.className = 'indicator-card';
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
    `;

    queueMicrotask(() => {
        const c = document.getElementById(sparklineId);
        if (c) renderSparkline(c, ind.history);
    });

    return card;
}

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
