const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');

function resizeCanvas() {
    const maxW = Math.min(window.innerWidth - 16, 750);
    canvas.width = maxW;
    canvas.height = Math.round(maxW * (9 / 16));
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const GRAVITY = 0.55;
const FRICTION = 0.82;
const WORLD_W = 2700;

// --- Stars ---
const stars = Array.from({ length: 100 }, () => ({
    x: Math.random() * WORLD_W,
    y: Math.random() * 180,
    r: Math.random() * 1.5 + 0.3,
    phase: Math.random() * Math.PI * 2,
    speed: Math.random() * 0.03 + 0.01
}));

// --- Clouds ---
const clouds = [
    { x: 80,   y: 35, w: 130, h: 45, p: 0.15 },
    { x: 380,  y: 55, w: 100, h: 35, p: 0.20 },
    { x: 650,  y: 25, w: 160, h: 55, p: 0.12 },
    { x: 980,  y: 45, w: 110, h: 40, p: 0.18 },
    { x: 1350, y: 30, w: 140, h: 50, p: 0.14 },
    { x: 1750, y: 60, w: 90,  h: 32, p: 0.22 },
    { x: 2100, y: 38, w: 120, h: 42, p: 0.16 },
];

// --- Mountain layers ---
const mtnBack = [
    { x: 0   }, { x: 120 }, { x: 200 }, { x: 310 }, { x: 420 },
    { x: 530 }, { x: 650 }, { x: 770 }, { x: 880 }, { x: 990 },
    { x: 1100}, { x: 1230}, { x: 1360}, { x: 1480}, { x: 1600},
    { x: 1720}, { x: 1850}, { x: 1970}, { x: 2100}, { x: 2250},
    { x: 2400}, { x: 2550}, { x: 2700}
].map((m, i) => ({ ...m, h: 80 + (i % 5) * 28 }));

const mtnFront = [
    { x: 0   }, { x: 90  }, { x: 175 }, { x: 280 }, { x: 370 },
    { x: 470 }, { x: 580 }, { x: 690 }, { x: 800 }, { x: 910 },
    { x: 1020}, { x: 1140}, { x: 1260}, { x: 1380}, { x: 1500},
    { x: 1640}, { x: 1760}, { x: 1900}, { x: 2040}, { x: 2180},
    { x: 2320}, { x: 2460}, { x: 2600}, { x: 2700}
].map((m, i) => ({ ...m, h: 55 + (i % 4) * 20 }));

// --- Particles ---
let particles = [];
function burst(x, y, color, count = 14) {
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 / count) * i + Math.random() * 0.3;
        const spd = 2.5 + Math.random() * 3.5;
        particles.push({
            x, y,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd - 2,
            life: 1,
            decay: 0.03 + Math.random() * 0.03,
            size: 3 + Math.random() * 4,
            color
        });
    }
}

// --- Camera ---
const camera = { x: 0 };

// --- Player ---
const player = {
    x: 50, y: 200,
    w: 22, h: 28,
    speed: 5,
    vx: 0, vy: 0,
    jumping: false,
    grounded: false,
    score: 0,
    facing: 1,
    trail: [],
    runFrame: 0,
    runTimer: 0
};

// --- Goal ---
const goal = {
    x: 2520, y: 50,
    w: 14, h: 230,
    reached: false,
    wave: 0
};

// --- Platforms ---
const platforms = [
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
    { x: 2010, y: 108, w: 65,   h: 12 }
];

// --- Coins ---
let coins = [
    { x: 185, y: 198, collected: false, pulse: 0.0 },
    { x: 335, y: 138, collected: false, pulse: 1.1 },
    { x: 808, y: 198, collected: false, pulse: 0.5 },
    { x: 1008,y: 138, collected: false, pulse: 1.7 },
    { x: 1408,y: 218, collected: false, pulse: 0.3 },
    { x: 2028,y: 78,  collected: false, pulse: 0.9 }
];
const COIN_R = 8;

// --- Input ---
const keys = {};
window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

let touchLeft = false, touchRight = false;

function wire(id, onTrue) {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', e => { e.preventDefault(); onTrue(true); }, { passive: false });
    el.addEventListener('touchend',   () => onTrue(false));
    el.addEventListener('mousedown',  () => onTrue(true));
    el.addEventListener('mouseup',    () => onTrue(false));
    el.addEventListener('mouseleave', () => onTrue(false));
}
wire('left-btn',  v => touchLeft  = v);
wire('right-btn', v => touchRight = v);

function jump() {
    if (!player.jumping && player.grounded) {
        player.jumping = true;
        player.grounded = false;
        player.vy = -player.speed * 2.9;
    }
}
document.getElementById('jump-btn').addEventListener('touchstart', e => { e.preventDefault(); jump(); }, { passive: false });
document.getElementById('jump-btn').addEventListener('mousedown', jump);

// --- State ---
let t = 0;
let shake = 0;

function reset() {
    player.x = 50; player.y = 200;
    player.vx = 0; player.vy = 0;
    player.score = 0; player.jumping = false; player.grounded = false;
    goal.reached = false;
    coins.forEach(c => c.collected = false);
    scoreEl.innerHTML = '<span class="gem">✦</span> 0';
    canvas.onclick = null;
    update();
}

// --- Update ---
function update() {
    if (goal.reached) return;
    t++;
    goal.wave += 0.07;

    if (keys['ArrowUp'] || keys['Space']) jump();

    if (keys['ArrowLeft'] || touchLeft) {
        if (player.vx > -player.speed) player.vx -= 1.3;
        player.facing = -1;
    }
    if (keys['ArrowRight'] || touchRight) {
        if (player.vx < player.speed) player.vx += 1.3;
        player.facing = 1;
    }

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
        player.runTimer++;
        if (player.runTimer > 6) { player.runFrame = (player.runFrame + 1) % 3; player.runTimer = 0; }
    } else if (!player.grounded) {
        player.runFrame = 1;
    }

    // Platform collision
    for (const p of platforms) {
        if (player.x < p.x + p.w && player.x + player.w > p.x &&
            player.y < p.y + p.h && player.y + player.h > p.y) {
            const ox = (player.x + player.w / 2) - (p.x + p.w / 2);
            const oy = (player.y + player.h / 2) - (p.y + p.h / 2);
            if (Math.abs(ox / p.w) > Math.abs(oy / p.h)) {
                player.x = ox > 0 ? p.x + p.w : p.x - player.w;
                player.vx = 0;
            } else {
                if (oy > 0) {
                    player.y = p.y + p.h; player.vy = 0;
                } else {
                    player.y = p.y - player.h;
                    player.jumping = false; player.grounded = true; player.vy = 0;
                }
            }
        }
    }

    player.x += player.vx;
    player.y += player.vy;

    // Goal
    if (player.x < goal.x + goal.w && player.x + player.w > goal.x &&
        player.y < goal.y + goal.h && player.y + player.h > goal.y) {
        goal.reached = true;
        burst(player.x + player.w / 2, player.y, '#ffd700', 24);
    }

    // Camera
    camera.x = Math.max(0, player.x - canvas.width / 2);

    // Pit death
    if (player.y > canvas.height + 120) {
        shake = 14;
        player.x = 50; player.y = 200; player.vx = 0; player.vy = 0;
        burst(player.x, player.y, '#ff4444', 10);
    }

    // Coins
    coins.forEach(c => {
        c.pulse += 0.05;
        if (!c.collected &&
            player.x < c.x + COIN_R && player.x + player.w > c.x - COIN_R &&
            player.y < c.y + COIN_R && player.y + player.h > c.y - COIN_R) {
            c.collected = true;
            player.score++;
            scoreEl.innerHTML = `<span class="gem">✦</span> ${player.score}`;
            burst(c.x, c.y, '#ffd700');
        }
    });

    // Particles
    particles = particles.filter(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.life -= p.decay;
        return p.life > 0;
    });

    if (shake > 0) shake--;

    draw();
    requestAnimationFrame(update);
}

// --- Draw helpers ---
function drawCloud(cx, cy, w, h) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx - w * 0.22, cy + 5, w * 0.28, h * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + w * 0.22, cy + 8, w * 0.3, h * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
}

function drawMtnLayer(peaks, parallax, color) {
    const off = camera.x * parallax;
    const ch = canvas.height;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, ch);
    peaks.forEach(m => {
        ctx.lineTo(m.x - off, ch - m.h);
    });
    ctx.lineTo(canvas.width, ch);
    ctx.closePath();
    ctx.fill();
}

function drawPlatform(p) {
    ctx.shadowColor = '#4af7ff';
    ctx.shadowBlur = 18;
    const g = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
    g.addColorStop(0, '#1e3a6e');
    g.addColorStop(1, '#0d1f3c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(p.x, p.y, p.w, p.h, 5);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Top edge neon strip
    ctx.fillStyle = '#4af7ff';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(p.x + 3, p.y, p.w - 6, 2);
    ctx.globalAlpha = 1;
    // Grid lines
    ctx.strokeStyle = 'rgba(74,247,255,0.1)';
    ctx.lineWidth = 0.5;
    for (let gx = p.x + 12; gx < p.x + p.w; gx += 12) {
        ctx.beginPath(); ctx.moveTo(gx, p.y + 2); ctx.lineTo(gx, p.y + p.h); ctx.stroke();
    }
}

function drawPlayer() {
    const px = player.x - camera.x;
    const py = player.y;
    const f = player.facing;
    const bobY = player.grounded ? Math.sin(t * 0.15) * 1.5 : 0;
    const legOff = [0, 4, -4][player.runFrame];

    ctx.save();
    ctx.translate(px + player.w / 2, py + player.h / 2 + bobY);
    if (f === -1) ctx.scale(-1, 1);

    // Glow aura
    ctx.shadowColor = '#00c3ff';
    ctx.shadowBlur = 20;

    // Cape
    ctx.fillStyle = '#7b2fff';
    ctx.beginPath();
    ctx.moveTo(-4, -4);
    const capeWave = Math.sin(t * 0.18) * 6;
    ctx.quadraticCurveTo(-18 - capeWave, 4, -12, 14);
    ctx.lineTo(-2, 6);
    ctx.closePath();
    ctx.fill();

    // Body
    const bodyG = ctx.createLinearGradient(-10, -8, 10, 12);
    bodyG.addColorStop(0, '#3a9fff');
    bodyG.addColorStop(1, '#1566cc');
    ctx.fillStyle = bodyG;
    ctx.beginPath();
    ctx.roundRect(-10, -8, 20, 18, [4, 4, 2, 2]);
    ctx.fill();

    // Chest emblem
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();

    // Legs
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0a3f80';
    ctx.fillRect(-9, 10, 8, 9 + legOff);
    ctx.fillRect(1, 10, 8, 9 - legOff);

    // Head
    const headG = ctx.createRadialGradient(-2, -18, 2, 0, -16, 9);
    headG.addColorStop(0, '#fce5a0');
    headG.addColorStop(1, '#e8a840');
    ctx.fillStyle = headG;
    ctx.shadowColor = '#00c3ff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, -16, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Helmet visor
    ctx.fillStyle = '#4af7ff';
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.ellipse(1, -17, 6, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Eye
    ctx.fillStyle = '#fff';
    ctx.fillRect(3, -19, 5, 4);
    ctx.fillStyle = '#111';
    ctx.fillRect(5, -18, 2, 3);

    ctx.restore();
}

function drawCoin(c) {
    const pulse = 0.82 + 0.18 * Math.sin(c.pulse * 2);
    const r = COIN_R * pulse;
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 20 * pulse;
    const cg = ctx.createRadialGradient(c.x - 2, c.y - 2, 1, c.x, c.y, r);
    cg.addColorStop(0, '#fffaaa');
    cg.addColorStop(0.5, '#ffd700');
    cg.addColorStop(1, '#b8860b');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `bold ${Math.round(r)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✦', c.x, c.y);
}

// --- Draw ---
function draw() {
    const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    const sy = shake > 0 ? (Math.random() - 0.5) * shake : 0;

    ctx.save();
    ctx.translate(sx, sy);

    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0.0, '#06001a');
    sky.addColorStop(0.45, '#10053a');
    sky.addColorStop(0.75, '#1f0a55');
    sky.addColorStop(1.0, '#3a1272');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Stars
    stars.forEach(s => {
        s.phase += s.speed;
        ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(s.phase));
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(s.x - camera.x * 0.04, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Moon
    const moonX = 120 - camera.x * 0.04;
    ctx.shadowColor = '#e8d5ff';
    ctx.shadowBlur = 40;
    ctx.fillStyle = '#f0e6ff';
    ctx.beginPath();
    ctx.arc(moonX, 60, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#10053a';
    ctx.beginPath();
    ctx.arc(moonX + 10, 55, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Mountains
    drawMtnLayer(mtnBack,  0.35, 'rgba(22, 8, 55, 0.92)');
    drawMtnLayer(mtnFront, 0.58, 'rgba(12, 4, 32, 0.96)');

    // Clouds
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    clouds.forEach(c => drawCloud(c.x - camera.x * c.p, c.y, c.w, c.h));

    // Ground fog
    const fog = ctx.createLinearGradient(0, canvas.height - 50, 0, canvas.height);
    fog.addColorStop(0, 'rgba(74,247,255,0.04)');
    fog.addColorStop(1, 'rgba(74,247,255,0.0)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, canvas.height - 50, canvas.width, 50);

    // ── World-space drawing ──
    ctx.save();
    ctx.translate(-camera.x, 0);

    // Platforms
    platforms.forEach(drawPlatform);

    // Goal pole
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 8;
    const poleG = ctx.createLinearGradient(goal.x, 0, goal.x + goal.w, 0);
    poleG.addColorStop(0, '#ccc');
    poleG.addColorStop(1, '#666');
    ctx.fillStyle = poleG;
    ctx.fillRect(goal.x + 5, goal.y, 3, goal.h);

    // Waving flag
    const wf = Math.sin(goal.wave) * 7;
    ctx.shadowColor = '#ff6b6b';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#ff5555';
    ctx.beginPath();
    ctx.moveTo(goal.x + 8, goal.y + 8);
    ctx.quadraticCurveTo(goal.x + 26 + wf, goal.y + 20, goal.x + 8, goal.y + 32);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    // Star atop pole
    ctx.fillStyle = '#ffd700';
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 12;
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('★', goal.x + 7, goal.y + 6);
    ctx.shadowBlur = 0;

    // Player trail
    player.trail.forEach(tr => {
        ctx.globalAlpha = tr.life * 0.35;
        ctx.fillStyle = '#4af7ff';
        ctx.shadowColor = '#4af7ff';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(tr.x, tr.y, 7 * tr.life, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // Coins
    coins.forEach(c => { if (!c.collected) drawCoin(c); });

    ctx.restore();
    // ── End world-space ──

    // Player (screen-space with camera offset baked into drawPlayer)
    drawPlayer();

    // Particles
    ctx.save();
    particles.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x - camera.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.restore(); // end shake

    // Win screen
    if (goal.reached) {
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 40;
        const wg = ctx.createLinearGradient(0, canvas.height / 2 - 30, 0, canvas.height / 2 + 10);
        wg.addColorStop(0, '#ffe066');
        wg.addColorStop(1, '#ff9900');
        ctx.fillStyle = wg;
        ctx.font = `bold ${Math.round(canvas.width * 0.065)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚡ LEVEL CLEAR! ⚡', canvas.width / 2, canvas.height / 2 - 24);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#e0e0ff';
        ctx.font = `${Math.round(canvas.width * 0.038)}px system-ui`;
        ctx.fillText(`Gems collected: ${player.score} / ${coins.length}`, canvas.width / 2, canvas.height / 2 + 18);
        ctx.fillStyle = '#8888aa';
        ctx.font = `${Math.round(canvas.width * 0.028)}px system-ui`;
        ctx.fillText('Tap to play again', canvas.width / 2, canvas.height / 2 + 56);
        ctx.restore();

        canvas.onclick = reset;
    }
}

update();
