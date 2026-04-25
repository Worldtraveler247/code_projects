'use strict';
// ── Canvas setup ──────────────────────────────────────────────────────────────
const canvas  = document.getElementById('gameCanvas');
const ctx     = canvas.getContext('2d');

canvas.width  = 480;
canvas.height = 310;

function fitCanvas() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const uiH = vw <= 480 ? 172 : 198;
    const pad = vw <= 480 ? 8 : 16;
    const availW = Math.min(vw - pad, 750);
    const availH = vh - uiH;
    const ar = 480 / 310;
    let w = availW, h = w / ar;
    if (h > availH) { h = availH; w = h * ar; }
    canvas.style.width  = Math.floor(w) + 'px';
    canvas.style.height = Math.floor(h) + 'px';
}
fitCanvas();
window.addEventListener('resize', fitCanvas);

// ── Constants ─────────────────────────────────────────────────────────────────
const GRAVITY    = 0.55;
const FRICTION   = 0.82;
const WORLD_W    = 2700;
const COIN_R     = 8;
const INVINC_DUR = 120;

// ── Shared decorative elements ────────────────────────────────────────────────
const stars = Array.from({ length: 110 }, () => ({
    x: Math.random() * WORLD_W,
    y: Math.random() * 200,
    r: Math.random() * 1.5 + 0.3,
    phase: Math.random() * Math.PI * 2,
    speed: Math.random() * 0.03 + 0.01,
}));

const clouds = [
    { x: 80,   y: 35, w: 130, h: 45, p: 0.15 },
    { x: 380,  y: 55, w: 100, h: 35, p: 0.20 },
    { x: 650,  y: 25, w: 160, h: 55, p: 0.12 },
    { x: 980,  y: 45, w: 110, h: 40, p: 0.18 },
    { x: 1350, y: 30, w: 140, h: 50, p: 0.14 },
    { x: 1750, y: 60, w: 90,  h: 32, p: 0.22 },
    { x: 2100, y: 38, w: 120, h: 42, p: 0.16 },
];

const mtnBack = [
    { x: 0 }, { x: 120 }, { x: 200 }, { x: 310 }, { x: 420 },
    { x: 530 }, { x: 650 }, { x: 770 }, { x: 880 }, { x: 990 },
    { x: 1100 }, { x: 1230 }, { x: 1360 }, { x: 1480 }, { x: 1600 },
    { x: 1720 }, { x: 1850 }, { x: 1970 }, { x: 2100 }, { x: 2250 },
    { x: 2400 }, { x: 2550 }, { x: 2700 },
].map((m, i) => ({ ...m, h: 80 + (i % 5) * 28 }));

const mtnFront = [
    { x: 0 }, { x: 90 }, { x: 175 }, { x: 280 }, { x: 370 },
    { x: 470 }, { x: 580 }, { x: 690 }, { x: 800 }, { x: 910 },
    { x: 1020 }, { x: 1140 }, { x: 1260 }, { x: 1380 }, { x: 1500 },
    { x: 1640 }, { x: 1760 }, { x: 1900 }, { x: 2040 }, { x: 2180 },
    { x: 2320 }, { x: 2460 }, { x: 2600 }, { x: 2700 },
].map((m, i) => ({ ...m, h: 55 + (i % 4) * 20 }));

// ── Stage definitions ─────────────────────────────────────────────────────────
const STAGE_DATA = [
    {
        name: 'TWILIGHT VALLEY',
        sky:         ['#06001a', '#10053a', '#1f0a55', '#3a1272'],
        mtnBackCol:  'rgba(22,8,55,0.92)',
        mtnFrontCol: 'rgba(12,4,32,0.96)',
        platGlow:    '#4af7ff',
        enemyCol:    '#ff4040',
        enemyGlow:   '#ff0000',
        flyerCol:    '#e040fb',
        flyerGlow:   '#cc00ff',
        platforms: [
            { x: 0,    y: 290, w: 610,  h: 22 },
            { x: 710,  y: 290, w: 510,  h: 22 },
            { x: 1320, y: 250, w: 200,  h: 62 },
            { x: 1620, y: 290, w: 1020, h: 22 },
            { x: 150,  y: 228, w: 85,   h: 12 },
            { x: 305,  y: 168, w: 85,   h: 12 },
            { x: 760,  y: 228, w: 105,  h: 12 },
            { x: 960,  y: 168, w: 105,  h: 12 },
            { x: 1160, y: 128, w: 105,  h: 12 },
            { x: 1710, y: 208, w: 65,   h: 12 },
            { x: 1860, y: 148, w: 65,   h: 12 },
            { x: 2010, y: 108, w: 65,   h: 12 },
        ],
        coinDefs: [
            { x: 185,  y: 198 }, { x: 335,  y: 138 },
            { x: 808,  y: 198 }, { x: 1008, y: 138 },
            { x: 1408, y: 218 }, { x: 2028, y:  78 },
        ],
        enemyDefs: [
            { type: 'patrol', x: 220,  y: 274, range: 160, speed: 1.0 },
            { type: 'patrol', x: 860,  y: 274, range: 130, speed: 1.2 },
            { type: 'flyer',  x: 1050, y: 188, range: 240, speed: 1.2 },
        ],
        goalX: 2520,
    },
    {
        name: 'VOLCANIC RIDGE',
        sky:         ['#1a0400', '#3a0a00', '#581a00', '#7a2800'],
        mtnBackCol:  'rgba(90,22,6,0.92)',
        mtnFrontCol: 'rgba(45,8,2,0.96)',
        platGlow:    '#ff6d00',
        enemyCol:    '#ff8c00',
        enemyGlow:   '#ff4500',
        flyerCol:    '#ff3300',
        flyerGlow:   '#cc1100',
        platforms: [
            { x: 0,    y: 290, w: 380,  h: 22 },
            { x: 480,  y: 250, w: 110,  h: 12 },
            { x: 670,  y: 200, w: 110,  h: 12 },
            { x: 860,  y: 250, w: 110,  h: 12 },
            { x: 1000, y: 290, w: 320,  h: 22 },
            { x: 1400, y: 260, w: 80,   h: 12 },
            { x: 1550, y: 210, w: 80,   h: 12 },
            { x: 1700, y: 160, w: 80,   h: 12 },
            { x: 1850, y: 210, w: 80,   h: 12 },
            { x: 2000, y: 260, w: 80,   h: 12 },
            { x: 2100, y: 290, w: 500,  h: 22 },
            { x: 2200, y: 215, w: 80,   h: 12 },
            { x: 2350, y: 155, w: 80,   h: 12 },
            { x: 2500, y: 100, w: 80,   h: 12 },
        ],
        coinDefs: [
            { x: 535,  y: 220 }, { x: 725,  y: 170 },
            { x: 915,  y: 220 }, { x: 1455, y: 230 },
            { x: 1755, y: 130 }, { x: 2055, y: 230 },
            { x: 2255, y: 185 }, { x: 2405, y: 125 },
            { x: 2555, y:  70 },
        ],
        enemyDefs: [
            { type: 'patrol', x: 140,  y: 274, range: 150, speed: 1.3 },
            { type: 'patrol', x: 1060, y: 274, range: 190, speed: 1.5 },
            { type: 'patrol', x: 2160, y: 274, range: 220, speed: 1.7 },
            { type: 'flyer',  x: 680,  y: 198, range: 220, speed: 1.5 },
            { type: 'flyer',  x: 1600, y: 168, range: 200, speed: 1.9 },
        ],
        goalX: 2570,
    },
    {
        name: 'COSMIC STATION',
        sky:         ['#000510', '#001028', '#001a42', '#00265a'],
        mtnBackCol:  'rgba(0,22,55,0.92)',
        mtnFrontCol: 'rgba(0,10,30,0.96)',
        platGlow:    '#00e5ff',
        enemyCol:    '#bf00ff',
        enemyGlow:   '#8800cc',
        flyerCol:    '#00b0ff',
        flyerGlow:   '#0070cc',
        platforms: [
            { x: 0,    y: 290, w: 180,  h: 22 },
            { x: 260,  y: 248, w: 90,   h: 12 },
            { x: 430,  y: 200, w: 90,   h: 12 },
            { x: 600,  y: 152, w: 90,   h: 12 },
            { x: 770,  y: 200, w: 90,   h: 12 },
            { x: 940,  y: 248, w: 90,   h: 12 },
            { x: 1100, y: 290, w: 230,  h: 22 },
            { x: 1420, y: 254, w: 75,   h: 12 },
            { x: 1580, y: 205, w: 75,   h: 12 },
            { x: 1740, y: 158, w: 75,   h: 12 },
            { x: 1900, y: 112, w: 75,   h: 12 },
            { x: 2060, y: 158, w: 75,   h: 12 },
            { x: 2220, y: 210, w: 75,   h: 12 },
            { x: 2380, y: 258, w: 75,   h: 12 },
            { x: 2490, y: 290, w: 210,  h: 22 },
        ],
        coinDefs: [
            { x: 305,  y: 218 }, { x: 475,  y: 170 },
            { x: 645,  y: 122 }, { x: 985,  y: 218 },
            { x: 1465, y: 224 }, { x: 1625, y: 175 },
            { x: 1785, y: 128 }, { x: 1945, y:  82 },
            { x: 2105, y: 128 }, { x: 2265, y: 180 },
        ],
        enemyDefs: [
            { type: 'patrol', x: 1150, y: 274, range: 100, speed: 1.7 },
            { type: 'patrol', x: 2540, y: 274, range: 110, speed: 2.0 },
            { type: 'flyer',  x: 380,  y: 175, range: 200, speed: 1.4 },
            { type: 'flyer',  x: 960,  y: 155, range: 200, speed: 1.8 },
            { type: 'flyer',  x: 1800, y: 135, range: 180, speed: 2.1 },
            { type: 'flyer',  x: 2280, y: 185, range: 160, speed: 2.4 },
        ],
        goalX: 2560,
    },
];

// ── Runtime state ─────────────────────────────────────────────────────────────
let currentStage   = 0;
let lives          = 3;
let score          = 0;
let invincTimer    = 0;
let stageClearTimer = 0;
let gameComplete   = false;
let gameOver       = false;
let t              = 0;
let shake          = 0;

let platforms = [];
let coins     = [];
let enemies   = [];
let particles = [];

const camera = { x: 0 };
const goal   = { x: 2520, y: 50, w: 14, h: 230, reached: false, wave: 0 };

const player = {
    x: 50, y: 200,
    w: 22, h: 28,
    speed: 5.2,
    vx: 0, vy: 0,
    jumping: false, grounded: false,
    facing: 1,
    trail: [],
    runFrame: 0, runTimer: 0,
};

// ── HUD ───────────────────────────────────────────────────────────────────────
function updateHUD() {
    document.getElementById('score').innerHTML = `<span class="gem">✦</span> ${score}`;
    const ld = document.getElementById('lives-display');
    if (ld) ld.textContent = '♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, 3 - lives));
    const sl = document.getElementById('stage-label');
    if (sl) sl.textContent = STAGE_DATA[currentStage].name;
}

// ── Stage loader ──────────────────────────────────────────────────────────────
function loadStage(n) {
    const d = STAGE_DATA[n];
    platforms = d.platforms;
    coins = d.coinDefs.map(c => ({
        x: c.x, y: c.y, collected: false, pulse: Math.random() * Math.PI * 2,
    }));
    enemies = d.enemyDefs.map(e => {
        const patrol = e.type === 'patrol';
        return {
            type:    e.type,
            x:       e.x,
            y:       e.y,
            w:       patrol ? 18 : 20,
            h:       patrol ? 16 : 14,
            vx:      e.speed * (Math.random() < 0.5 ? 1 : -1),
            originX: e.x,
            originY: e.y,
            range:   e.range,
            phase:   Math.random() * Math.PI * 2,
            alive:   true,
            col:     patrol ? d.enemyCol  : d.flyerCol,
            glow:    patrol ? d.enemyGlow : d.flyerGlow,
        };
    });
    goal.x       = d.goalX;
    goal.reached = false;
    player.x = 50; player.y = 200;
    player.vx = 0; player.vy = 0;
    player.jumping = false; player.grounded = false;
    player.trail   = [];
    particles      = [];
    camera.x       = 0;
    stageClearTimer = 0;
    updateHUD();
}

// ── Full reset ────────────────────────────────────────────────────────────────
function reset() {
    currentStage = 0;
    lives        = 3;
    score        = 0;
    gameOver     = false;
    gameComplete = false;
    invincTimer  = 0;
    canvas.onclick = null;
    loadStage(0);
}

// ── Particles ─────────────────────────────────────────────────────────────────
function burst(x, y, color, count = 14) {
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 / count) * i + Math.random() * 0.3;
        const spd   = 2.5 + Math.random() * 3.5;
        particles.push({
            x, y,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd - 2,
            life: 1, decay: 0.03 + Math.random() * 0.03,
            size: 3 + Math.random() * 4, color,
        });
    }
}

// ── Input ─────────────────────────────────────────────────────────────────────
const keys = {};
window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

let touchLeft = false, touchRight = false;

const joystickZone = document.getElementById('joystick-zone');
const joystickKnob = document.getElementById('joystick-knob');
const KNOB_RANGE   = 28;
const DEAD_ZONE    = 7;
let joyActive = false, joyPointerId = null, joyOriginX = 0;

function setKnob(dx) {
    joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`;
}
function joyDown(e) {
    e.preventDefault();
    if (joyActive) return;
    joystickZone.setPointerCapture(e.pointerId);
    joyPointerId = e.pointerId; joyActive = true; joyOriginX = e.clientX;
    setKnob(0);
}
function joyMove(e) {
    if (!joyActive || e.pointerId !== joyPointerId) return;
    const dx = Math.max(-KNOB_RANGE, Math.min(KNOB_RANGE, e.clientX - joyOriginX));
    setKnob(dx);
    touchLeft  = dx < -DEAD_ZONE;
    touchRight = dx >  DEAD_ZONE;
}
function joyUp(e) {
    if (e.pointerId !== joyPointerId) return;
    joyActive = false; joyPointerId = null;
    touchLeft = touchRight = false;
    setKnob(0);
}
joystickZone.addEventListener('pointerdown',   joyDown);
joystickZone.addEventListener('pointermove',   joyMove);
joystickZone.addEventListener('pointerup',     joyUp);
joystickZone.addEventListener('pointercancel', joyUp);

function jump() {
    if (!player.jumping && player.grounded) {
        player.jumping = true; player.grounded = false;
        player.vy = -player.speed * 2.9;
    }
}
const jumpBtn = document.getElementById('jump-btn');
jumpBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    jumpBtn.setPointerCapture(e.pointerId);
    jump();
    jumpBtn.classList.add('pressed');
});
jumpBtn.addEventListener('pointerup',     () => jumpBtn.classList.remove('pressed'));
jumpBtn.addEventListener('pointercancel', () => jumpBtn.classList.remove('pressed'));

// ── Collision helper ──────────────────────────────────────────────────────────
function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ── Damage ────────────────────────────────────────────────────────────────────
function takeDamage() {
    if (invincTimer > 0) return;
    lives--;
    invincTimer = INVINC_DUR;
    player.vx   = player.facing * -5;
    player.vy   = -7;
    shake       = 12;
    burst(player.x + player.w / 2, player.y + player.h / 2, '#ff4444', 10);
    updateHUD();
    if (lives <= 0) gameOver = true;
}

// ── Update ────────────────────────────────────────────────────────────────────
function update() {
    t++;
    goal.wave += 0.07;
    if (invincTimer > 0) invincTimer--;
    if (shake > 0) shake--;

    // Always tick particles
    particles = particles.filter(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.life -= p.decay;
        return p.life > 0;
    });

    // Stage-clear countdown
    if (goal.reached) {
        if (stageClearTimer > 0) {
            stageClearTimer--;
            if (stageClearTimer === 0) {
                if (currentStage < STAGE_DATA.length - 1) {
                    currentStage++;
                    loadStage(currentStage);
                } else {
                    gameComplete = true;
                }
            }
        }
        draw();
        requestAnimationFrame(update);
        return;
    }

    if (gameOver || gameComplete) {
        draw();
        requestAnimationFrame(update);
        return;
    }

    // ── Input ──
    if (keys['ArrowUp'] || keys['Space']) jump();
    if (keys['ArrowLeft']  || touchLeft)  { if (player.vx > -player.speed) player.vx -= 1.3; player.facing = -1; }
    if (keys['ArrowRight'] || touchRight) { if (player.vx < player.speed)  player.vx += 1.3; player.facing =  1; }

    player.vx *= FRICTION;
    player.vy += GRAVITY;
    player.grounded = false;

    // Trail
    if (Math.abs(player.vx) > 1 || player.jumping) {
        player.trail.push({ x: player.x + player.w / 2, y: player.y + player.h / 2, life: 1 });
    }
    player.trail = player.trail.filter(tr => { tr.life -= 0.14; return tr.life > 0; });

    // Run animation
    if (player.grounded && Math.abs(player.vx) > 0.5) {
        if (++player.runTimer > 6) { player.runFrame = (player.runFrame + 1) % 3; player.runTimer = 0; }
    } else if (!player.grounded) {
        player.runFrame = 1;
    }

    player.x += player.vx;
    player.y += player.vy;

    // World boundary
    if (player.x < 0) { player.x = 0; player.vx = 0; }

    // Platform collision
    for (const p of platforms) {
        if (!overlap(player.x, player.y, player.w, player.h, p.x, p.y, p.w, p.h)) continue;
        const ox = (player.x + player.w / 2) - (p.x + p.w / 2);
        const oy = (player.y + player.h / 2) - (p.y + p.h / 2);
        if (Math.abs(ox / p.w) > Math.abs(oy / p.h)) {
            player.x  = ox > 0 ? p.x + p.w : p.x - player.w;
            player.vx = 0;
        } else if (oy > 0) {
            player.y  = p.y + p.h; player.vy = 0;
        } else {
            player.y        = p.y - player.h;
            player.vy       = 0;
            player.jumping  = false;
            player.grounded = true;
        }
    }

    // ── Enemy update + collision ──
    for (const e of enemies) {
        if (!e.alive) continue;

        if (e.type === 'patrol') {
            e.x += e.vx;
            if (e.x > e.originX + e.range) { e.x = e.originX + e.range; e.vx *= -1; }
            if (e.x < e.originX)            { e.x = e.originX;            e.vx *= -1; }
        } else {
            e.x += e.vx;
            if (e.x > e.originX + e.range) { e.x = e.originX + e.range; e.vx *= -1; }
            if (e.x < e.originX - e.range) { e.x = e.originX - e.range; e.vx *= -1; }
            e.phase += 0.04;
            e.y = e.originY + Math.sin(e.phase) * 22;
        }

        if (invincTimer > 0) continue;
        if (!overlap(player.x, player.y, player.w, player.h, e.x, e.y, e.w, e.h)) continue;

        // Stomp: player falling, bottom of player is in top half of enemy
        if (player.vy > 0 && (player.y + player.h) < (e.y + e.h * 0.55)) {
            e.alive    = false;
            player.vy  = -10;
            player.jumping = true;
            score++;
            updateHUD();
            burst(e.x + e.w / 2, e.y + e.h / 2, e.glow, 16);
        } else {
            takeDamage();
        }
    }

    // ── Goal ──
    if (overlap(player.x, player.y, player.w, player.h, goal.x, goal.y, goal.w, goal.h)) {
        goal.reached    = true;
        stageClearTimer = 150;
        burst(player.x + player.w / 2, player.y, '#ffd700', 28);
    }

    // ── Camera ──
    camera.x = Math.max(0, Math.min(player.x - canvas.width / 3, WORLD_W - canvas.width));

    // ── Pit death ──
    if (player.y > canvas.height + 100) {
        takeDamage();
        if (!gameOver) { player.x = 50; player.y = 200; player.vx = 0; player.vy = 0; }
    }

    // ── Coins ──
    coins.forEach(c => {
        c.pulse += 0.05;
        if (!c.collected &&
            overlap(player.x, player.y, player.w, player.h, c.x - COIN_R, c.y - COIN_R, COIN_R * 2, COIN_R * 2)) {
            c.collected = true;
            score++;
            updateHUD();
            burst(c.x, c.y, '#ffd700');
        }
    });

    draw();
    requestAnimationFrame(update);
}

// ── Draw helpers ──────────────────────────────────────────────────────────────
function drawCloud(cx, cy, w, h) {
    ctx.beginPath(); ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx - w * 0.22, cy + 5, w * 0.28, h * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + w * 0.22, cy + 8, w * 0.3,  h * 0.38, 0, 0, Math.PI * 2); ctx.fill();
}

function drawMtnLayer(peaks, parallax, color) {
    const off = camera.x * parallax;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    peaks.forEach(m => ctx.lineTo(m.x - off, canvas.height - m.h));
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath(); ctx.fill();
}

function drawPlatform(p, glowColor) {
    ctx.shadowColor = glowColor; ctx.shadowBlur = 18;
    const g = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
    g.addColorStop(0, '#1e3a6e'); g.addColorStop(1, '#0d1f3c');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, p.h, 5); ctx.fill();
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = glowColor; ctx.globalAlpha = 0.85;
    ctx.fillRect(p.x + 3, p.y, p.w - 6, 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 0.5;
    for (let gx = p.x + 12; gx < p.x + p.w; gx += 12) {
        ctx.beginPath(); ctx.moveTo(gx, p.y + 2); ctx.lineTo(gx, p.y + p.h); ctx.stroke();
    }
}

function drawPlayer() {
    if (invincTimer > 0 && Math.floor(invincTimer / 6) % 2 === 0) return;
    const px    = player.x - camera.x;
    const py    = player.y;
    const bobY  = player.grounded ? Math.sin(t * 0.15) * 1.5 : 0;
    const legOff = [0, 4, -4][player.runFrame];

    ctx.save();
    ctx.translate(px + player.w / 2, py + player.h / 2 + bobY);
    if (player.facing === -1) ctx.scale(-1, 1);

    ctx.shadowColor = '#00c3ff'; ctx.shadowBlur = 20;

    // Cape
    ctx.fillStyle = '#7b2fff';
    ctx.beginPath(); ctx.moveTo(-4, -4);
    ctx.quadraticCurveTo(-18 - Math.sin(t * 0.18) * 6, 4, -12, 14);
    ctx.lineTo(-2, 6); ctx.closePath(); ctx.fill();

    // Body
    const bg = ctx.createLinearGradient(-10, -8, 10, 12);
    bg.addColorStop(0, '#3a9fff'); bg.addColorStop(1, '#1566cc');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.roundRect(-10, -8, 20, 18, [4, 4, 2, 2]); ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();

    ctx.shadowBlur = 0; ctx.fillStyle = '#0a3f80';
    ctx.fillRect(-9, 10, 8, 9 + legOff);
    ctx.fillRect( 1, 10, 8, 9 - legOff);

    const hg = ctx.createRadialGradient(-2, -18, 2, 0, -16, 9);
    hg.addColorStop(0, '#fce5a0'); hg.addColorStop(1, '#e8a840');
    ctx.fillStyle = hg;
    ctx.shadowColor = '#00c3ff'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(0, -16, 9, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#4af7ff'; ctx.globalAlpha = 0.75;
    ctx.beginPath(); ctx.ellipse(1, -17, 6, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#fff'; ctx.fillRect(3, -19, 5, 4);
    ctx.fillStyle = '#111'; ctx.fillRect(5, -18, 2, 3);

    ctx.restore();
}

function drawEnemy(e) {
    if (!e.alive) return;
    const sx = e.x - camera.x;
    const sy = e.y;

    ctx.save();
    ctx.shadowColor = e.glow;
    ctx.shadowBlur  = 14;

    if (e.type === 'patrol') {
        // Body
        ctx.fillStyle = e.col;
        ctx.beginPath(); ctx.roundRect(sx, sy, e.w, e.h, 3); ctx.fill();
        // Antenna
        ctx.strokeStyle = e.col; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(sx + e.w / 2, sy); ctx.lineTo(sx + e.w / 2, sy - 6); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(sx + e.w / 2, sy - 7, 2.2, 0, Math.PI * 2); ctx.fill();
        // Eyes
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.fillRect(sx + 2,  sy + 3, 5, 4);
        ctx.fillRect(sx + 11, sy + 3, 5, 4);
        ctx.fillStyle = '#ff0';
        ctx.fillRect(sx + 3,  sy + 4, 3, 2);
        ctx.fillRect(sx + 12, sy + 4, 3, 2);
        // Animated legs
        const lp = Math.sin(t * 0.22) * 2;
        ctx.fillStyle = e.col;
        ctx.fillRect(sx + 2,  sy + e.h, 4, 5 + lp);
        ctx.fillRect(sx + 12, sy + e.h, 4, 5 - lp);
    } else {
        // Diamond body
        ctx.fillStyle = e.col;
        ctx.beginPath();
        ctx.moveTo(sx + e.w / 2, sy);
        ctx.lineTo(sx + e.w,     sy + e.h / 2);
        ctx.lineTo(sx + e.w / 2, sy + e.h);
        ctx.lineTo(sx,           sy + e.h / 2);
        ctx.closePath(); ctx.fill();
        // Flapping wings
        const wp = 0.5 + 0.5 * Math.sin(t * 0.35);
        ctx.globalAlpha = wp * 0.65;
        ctx.beginPath();
        ctx.moveTo(sx + e.w / 2, sy + e.h / 2);
        ctx.lineTo(sx - 11, sy + e.h * 0.2);
        ctx.lineTo(sx - 4,  sy + e.h / 2);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(sx + e.w / 2,      sy + e.h / 2);
        ctx.lineTo(sx + e.w + 11, sy + e.h * 0.2);
        ctx.lineTo(sx + e.w + 4,  sy + e.h / 2);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
        // Core eye
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(sx + e.w / 2, sy + e.h / 2, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.arc(sx + e.w / 2, sy + e.h / 2, 1.8, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
}

function drawCoin(c) {
    const pulse = 0.82 + 0.18 * Math.sin(c.pulse * 2);
    const r     = COIN_R * pulse;
    ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 20 * pulse;
    const cg = ctx.createRadialGradient(c.x - 2, c.y - 2, 1, c.x, c.y, r);
    cg.addColorStop(0, '#fffaaa'); cg.addColorStop(0.5, '#ffd700'); cg.addColorStop(1, '#b8860b');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `bold ${Math.round(r)}px Arial`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('✦', c.x, c.y);
}

// ── Main draw ─────────────────────────────────────────────────────────────────
function draw() {
    const sd = STAGE_DATA[currentStage];
    const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    const sy = shake > 0 ? (Math.random() - 0.5) * shake : 0;

    ctx.save();
    ctx.translate(sx, sy);

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sd.sky.forEach((c, i) => sky.addColorStop(i / (sd.sky.length - 1), c));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Stars
    stars.forEach(s => {
        s.phase += s.speed;
        ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(s.phase));
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(s.x - camera.x * 0.04, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Stage celestial object
    const moonX = 120 - camera.x * 0.04;
    if (currentStage === 0) {
        ctx.shadowColor = '#e8d5ff'; ctx.shadowBlur = 40;
        ctx.fillStyle = '#f0e6ff';
        ctx.beginPath(); ctx.arc(moonX, 60, 26, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = sd.sky[1];
        ctx.beginPath(); ctx.arc(moonX + 10, 55, 20, 0, Math.PI * 2); ctx.fill();
    } else if (currentStage === 1) {
        ctx.shadowColor = '#ff6d00'; ctx.shadowBlur = 55;
        ctx.fillStyle = '#ff4500';
        ctx.beginPath(); ctx.arc(moonX, 55, 24, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffa040'; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.arc(moonX, 55, 13, 0, Math.PI * 2); ctx.fill();
    } else {
        ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 28;
        ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2; ctx.globalAlpha = 0.55;
        ctx.beginPath(); ctx.arc(moonX, 58, 28, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(moonX, 58, 17, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#00e5ff';
        ctx.beginPath(); ctx.arc(moonX, 58, 8, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
    }
    ctx.shadowBlur = 0;

    // Mountains
    drawMtnLayer(mtnBack,  0.35, sd.mtnBackCol);
    drawMtnLayer(mtnFront, 0.58, sd.mtnFrontCol);

    // Atmospheric layer (clouds / embers / nebula)
    const cloudAlpha = currentStage === 0 ? 'rgba(255,255,255,0.06)'
                     : currentStage === 1 ? 'rgba(255,100,10,0.05)'
                     :                      'rgba(40,120,255,0.04)';
    ctx.fillStyle = cloudAlpha;
    clouds.forEach(c => drawCloud(c.x - camera.x * c.p, c.y, c.w, c.h));

    // Ground fog
    const fogColor = currentStage === 1 ? 'rgba(255,80,0,0.06)' : `rgba(74,247,255,0.04)`;
    const fog = ctx.createLinearGradient(0, canvas.height - 50, 0, canvas.height);
    fog.addColorStop(0, fogColor); fog.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, canvas.height - 50, canvas.width, 50);

    // ── World-space ──
    ctx.save();
    ctx.translate(-camera.x, 0);

    platforms.forEach(p => drawPlatform(p, sd.platGlow));

    // Goal pole
    ctx.shadowColor = '#fff'; ctx.shadowBlur = 8;
    const pg = ctx.createLinearGradient(goal.x, 0, goal.x + goal.w, 0);
    pg.addColorStop(0, '#ccc'); pg.addColorStop(1, '#666');
    ctx.fillStyle = pg;
    ctx.fillRect(goal.x + 5, goal.y, 3, goal.h);
    const wf = Math.sin(goal.wave) * 7;
    ctx.shadowColor = '#ff6b6b'; ctx.shadowBlur = 14;
    ctx.fillStyle = '#ff5555';
    ctx.beginPath();
    ctx.moveTo(goal.x + 8, goal.y + 8);
    ctx.quadraticCurveTo(goal.x + 26 + wf, goal.y + 20, goal.x + 8, goal.y + 32);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffd700'; ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 12;
    ctx.font = '14px Arial'; ctx.textAlign = 'center';
    ctx.fillText('★', goal.x + 7, goal.y + 6);
    ctx.shadowBlur = 0;

    // Player trail
    player.trail.forEach(tr => {
        ctx.globalAlpha = tr.life * 0.32;
        ctx.fillStyle   = sd.platGlow;
        ctx.shadowColor = sd.platGlow; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(tr.x, tr.y, 7 * tr.life, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;

    coins.forEach(c => { if (!c.collected) drawCoin(c); });
    enemies.forEach(drawEnemy);

    ctx.restore();
    // ── End world-space ──

    drawPlayer();

    // Particles
    ctx.save();
    particles.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle   = p.color;
        ctx.shadowColor = p.color; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(p.x - camera.x, p.y, p.size * p.life, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    ctx.restore();

    ctx.restore(); // end shake

    // ── Overlays ─────────────────────────────────────────────────────────────

    if (goal.reached) {
        const isLast = currentStage === STAGE_DATA.length - 1;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 40;
        const wg = ctx.createLinearGradient(0, canvas.height / 2 - 30, 0, canvas.height / 2 + 10);
        wg.addColorStop(0, '#ffe066'); wg.addColorStop(1, '#ff9900');
        ctx.fillStyle = wg;
        ctx.font = `bold ${Math.round(canvas.width * 0.062)}px system-ui`;
        ctx.fillText(
            gameComplete ? '🏆 GAME COMPLETE!' : '⚡ STAGE CLEAR!',
            canvas.width / 2, canvas.height / 2 - 24
        );
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#e0e0ff';
        ctx.font = `${Math.round(canvas.width * 0.035)}px system-ui`;
        if (gameComplete) {
            ctx.fillText(`Final Score: ${score}`, canvas.width / 2, canvas.height / 2 + 14);
            ctx.fillStyle = '#888';
            ctx.font = `${Math.round(canvas.width * 0.027)}px system-ui`;
            ctx.fillText('Tap to play again', canvas.width / 2, canvas.height / 2 + 52);
            canvas.onclick = reset;
        } else {
            const nextName = STAGE_DATA[currentStage + 1]?.name ?? '';
            ctx.fillText(`Next → ${nextName}`, canvas.width / 2, canvas.height / 2 + 14);
        }
        ctx.restore();
    }

    if (gameOver) {
        ctx.fillStyle = 'rgba(0,0,0,0.78)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.shadowColor = '#ff4444'; ctx.shadowBlur = 35;
        ctx.fillStyle = '#ff4444';
        ctx.font = `bold ${Math.round(canvas.width * 0.065)}px system-ui`;
        ctx.fillText('💀 GAME OVER', canvas.width / 2, canvas.height / 2 - 22);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#e0e0ff';
        ctx.font = `${Math.round(canvas.width * 0.035)}px system-ui`;
        ctx.fillText(`Score: ${score}  ·  Stage: ${currentStage + 1}`, canvas.width / 2, canvas.height / 2 + 14);
        ctx.fillStyle = '#888';
        ctx.font = `${Math.round(canvas.width * 0.027)}px system-ui`;
        ctx.fillText('Tap to try again', canvas.width / 2, canvas.height / 2 + 52);
        ctx.restore();
        canvas.onclick = reset;
    }
}

// ── Start ─────────────────────────────────────────────────────────────────────
loadStage(0);
update();
