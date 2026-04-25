const canvas     = document.getElementById('tetris');
const ctx        = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx    = nextCanvas.getContext('2d');

const COLS = 10;
const ROWS = 20;
const CELL = 26;
canvas.width  = COLS * CELL; // 260
canvas.height = ROWS * CELL; // 520

// ── Palette ──
const PAL = [
    null,
    { main: '#e040fb', hi: '#f48cfb', glow: '#e040fb' }, // T  purple
    { main: '#ffea00', hi: '#fff59d', glow: '#ffe000' }, // O  yellow
    { main: '#ff6d00', hi: '#ffab40', glow: '#ff6d00' }, // L  orange
    { main: '#536dfe', hi: '#91a0fe', glow: '#536dfe' }, // J  blue
    { main: '#00e5ff', hi: '#80f0ff', glow: '#00e5ff' }, // I  cyan
    { main: '#00e676', hi: '#69f0ae', glow: '#00e676' }, // S  green
    { main: '#ff1744', hi: '#ff7c7c', glow: '#ff1744' }, // Z  red
];

// ── Pieces ──
const SHAPES = {
    T: [[0,1,0],[1,1,1],[0,0,0]],
    O: [[2,2],[2,2]],
    L: [[0,3,0],[0,3,0],[0,3,3]],
    J: [[0,4,0],[0,4,0],[4,4,0]],
    I: [[0,5,0,0],[0,5,0,0],[0,5,0,0],[0,5,0,0]],
    S: [[0,6,6],[6,6,0],[0,0,0]],
    Z: [[7,7,0],[0,7,7],[0,0,0]],
};
const TYPES = Object.keys(SHAPES);

// ── State ──
let arena, player, particles, popups;
let flashRows, flashTimer, rotFlash;
let dropCounter, lastTime, gameOver;
let dasDir, dasTimer, arrTimer;

const DAS = 155;
const ARR = 28;

function makeArena() {
    return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function init() {
    arena       = makeArena();
    particles   = [];
    popups      = [];
    flashRows   = [];
    flashTimer  = 0;
    rotFlash    = 0;
    dropCounter = 0;
    lastTime    = 0;
    gameOver    = false;
    dasDir = dasTimer = arrTimer = 0;
    player = { pos: { x: 0, y: 0 }, matrix: null, next: null, score: 0, level: 1, lines: 0 };
    spawnPiece();
    updateHUD();
}

// ── Drawing ──

function drawCell(c, x, y, val, alpha = 1, ghost = false) {
    const p  = PAL[val];
    const px = x * CELL, py = y * CELL;
    const g  = 1.5, sz = CELL - g * 2;
    c.save();
    c.globalAlpha = alpha;
    if (ghost) {
        c.strokeStyle = p.main;
        c.lineWidth   = 1.5;
        c.strokeRect(px + g, py + g, sz, sz);
        c.globalAlpha = alpha * 0.1;
        c.fillStyle = p.main;
        c.fillRect(px + g, py + g, sz, sz);
    } else {
        c.shadowColor = p.glow;
        c.shadowBlur  = 12;
        const gr = c.createLinearGradient(px + g, py + g, px + CELL - g, py + CELL - g);
        gr.addColorStop(0, p.hi);
        gr.addColorStop(1, p.main);
        c.fillStyle = gr;
        c.fillRect(px + g, py + g, sz, sz);
        c.shadowBlur = 0;
        // inner bevel highlight
        c.fillStyle = 'rgba(255,255,255,0.3)';
        c.fillRect(px + g, py + g, sz, 3);
        c.fillRect(px + g, py + g, 3, sz);
        // inner bevel shadow
        c.fillStyle = 'rgba(0,0,0,0.22)';
        c.fillRect(px + g, py + CELL - g - 3, sz, 3);
        c.fillRect(px + CELL - g - 3, py + g, 3, sz);
    }
    c.restore();
}

function drawBoard() {
    ctx.fillStyle = '#07010d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(74,247,255,0.05)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= COLS; x++) {
        ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
        ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(canvas.width, y * CELL); ctx.stroke();
    }
}

function drawArena() {
    arena.forEach((row, y) => {
        const isFlash = flashRows.includes(y);
        row.forEach((val, x) => {
            if (!val) return;
            if (isFlash) {
                const pulse = 0.55 + 0.45 * Math.sin(flashTimer * 0.05);
                ctx.save();
                ctx.globalAlpha = pulse;
                ctx.fillStyle = '#fff';
                ctx.shadowColor = '#fff';
                ctx.shadowBlur = 22;
                ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
                ctx.restore();
            } else {
                drawCell(ctx, x, y, val);
            }
        });
    });
}

function ghostY() {
    let gy = player.pos.y;
    while (!collide(arena, { matrix: player.matrix, pos: { x: player.pos.x, y: gy + 1 } })) gy++;
    return gy;
}

function drawPlayer() {
    if (!player.matrix) return;
    const gy = ghostY();
    // Ghost
    if (gy > player.pos.y) {
        player.matrix.forEach((row, y) => row.forEach((v, x) => {
            if (v) drawCell(ctx, x + player.pos.x, y + gy, v, 0.45, true);
        }));
    }
    // Rotation flash
    if (rotFlash > 0) {
        ctx.save();
        ctx.globalAlpha = rotFlash * 0.55;
        player.matrix.forEach((row, y) => row.forEach((v, x) => {
            if (v) {
                ctx.fillStyle = '#fff';
                ctx.shadowColor = PAL[v].glow;
                ctx.shadowBlur = 24;
                ctx.fillRect((x + player.pos.x) * CELL + 1, (y + player.pos.y) * CELL + 1, CELL - 2, CELL - 2);
            }
        }));
        ctx.restore();
        rotFlash = Math.max(0, rotFlash - 0.09);
    }
    // Active piece
    player.matrix.forEach((row, y) => row.forEach((v, x) => {
        if (v) drawCell(ctx, x + player.pos.x, y + player.pos.y, v);
    }));
}

function drawParticles() {
    particles.forEach(p => {
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.col;
        ctx.shadowColor = p.col;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.sz * p.life, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });
}

function drawPopups() {
    popups.forEach(p => {
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.fillStyle = '#ffd700';
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 12;
        ctx.font = 'bold 13px Orbitron, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`+${p.val}`, p.x, p.y);
        ctx.restore();
    });
}

function drawNext() {
    const nc = nextCtx;
    const NW = nextCanvas.width, NH = nextCanvas.height;
    nc.fillStyle = '#07010d';
    nc.fillRect(0, 0, NW, NH);
    if (!player.next) return;
    const m  = player.next;
    const cs = 22;
    const ox = Math.floor((4 - m[0].length) / 2) * cs + 4;
    const oy = Math.floor((4 - m.length)    / 2) * cs + 4;
    m.forEach((row, y) => row.forEach((v, x) => {
        if (!v) return;
        const p = PAL[v], px = ox + x * cs, py = oy + y * cs;
        nc.save();
        nc.shadowColor = p.glow; nc.shadowBlur = 8;
        const g = nc.createLinearGradient(px, py, px + cs, py + cs);
        g.addColorStop(0, p.hi); g.addColorStop(1, p.main);
        nc.fillStyle = g;
        nc.fillRect(px + 1, py + 1, cs - 2, cs - 2);
        nc.fillStyle = 'rgba(255,255,255,0.28)';
        nc.fillRect(px + 1, py + 1, cs - 2, 3);
        nc.fillRect(px + 1, py + 1, 3, cs - 2);
        nc.restore();
    }));
}

function drawGameOver() {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.shadowColor = '#e040fb'; ctx.shadowBlur = 35;
    ctx.fillStyle = '#e040fb';
    ctx.font = 'bold 24px Orbitron, sans-serif';
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 22);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = '13px Orbitron, sans-serif';
    ctx.fillText(`Score: ${player.score}`, canvas.width / 2, canvas.height / 2 + 14);
    ctx.fillStyle = '#888';
    ctx.font = '11px sans-serif';
    ctx.fillText('Tap ↺ or press R to restart', canvas.width / 2, canvas.height / 2 + 44);
    ctx.restore();
}

// ── Logic ──

function collide(ar, pl) {
    const { matrix: m, pos: o } = pl;
    for (let y = 0; y < m.length; y++) {
        for (let x = 0; x < m[y].length; x++) {
            if (!m[y][x]) continue;
            const ny = y + o.y, nx = x + o.x;
            if (ny >= ROWS || nx < 0 || nx >= COLS) return true;
            if (ar[ny]?.[nx]) return true;
        }
    }
    return false;
}

function merge() {
    player.matrix.forEach((row, y) => row.forEach((v, x) => {
        if (v) arena[y + player.pos.y][x + player.pos.x] = v;
    }));
}

function rotateMatrix(m, dir) {
    for (let y = 0; y < m.length; y++)
        for (let x = 0; x < y; x++)
            [m[x][y], m[y][x]] = [m[y][x], m[x][y]];
    if (dir > 0) m.forEach(r => r.reverse()); else m.reverse();
}

function playerRotate(dir) {
    const ox = player.pos.x;
    let off = 1;
    rotateMatrix(player.matrix, dir);
    while (collide(arena, player)) {
        player.pos.x += off;
        off = -(off + (off > 0 ? 1 : -1));
        if (Math.abs(off) > player.matrix[0].length + 1) {
            rotateMatrix(player.matrix, -dir);
            player.pos.x = ox;
            return;
        }
    }
    // Rotation succeeded — fire effects
    rotFlash = 1;
    burst(player.matrix, player.pos, 12);
}

function playerMove(dir) {
    player.pos.x += dir;
    if (collide(arena, player)) player.pos.x -= dir;
}

function playerDrop() {
    player.pos.y++;
    if (collide(arena, player)) { player.pos.y--; land(); }
    dropCounter = 0;
}

function hardDrop() {
    let n = 0;
    while (!collide(arena, { matrix: player.matrix, pos: { x: player.pos.x, y: player.pos.y + 1 } })) {
        player.pos.y++; n++;
    }
    player.score += n * 2;
    burst(player.matrix, player.pos, 20, true);
    land();
}

function land() {
    merge();
    sweep();
    spawnPiece();
}

function sweep() {
    const found = [];
    for (let y = ROWS - 1; y >= 0; y--) {
        if (arena[y].every(v => v !== 0)) found.push(y);
    }
    if (!found.length) return;
    flashRows  = found;
    flashTimer = 0;
    setTimeout(() => {
        found.slice().sort((a, b) => b - a).forEach(y => {
            arena.splice(y, 1);
            arena.unshift(new Array(COLS).fill(0));
        });
        const pts = [0, 100, 300, 500, 800][found.length] * player.level;
        player.score += pts;
        player.lines += found.length;
        player.level  = Math.floor(player.lines / 10) + 1;
        const midY = found[Math.floor(found.length / 2)] * CELL;
        popups.push({ x: canvas.width / 2, y: midY, val: pts, life: 1 });
        // line clear particle spray
        found.forEach(y => {
            for (let x = 0; x < COLS; x++) {
                particles.push({
                    x: (x + 0.5) * CELL, y: (y + 0.5) * CELL,
                    vx: (Math.random() - 0.5) * 7,
                    vy: (Math.random() - 0.5) * 7 - 2,
                    life: 1, decay: 0.022 + Math.random() * 0.02,
                    col: PAL[Math.random() * 7 + 1 | 0].glow,
                    sz: 3 + Math.random() * 3
                });
            }
        });
        flashRows = [];
        updateHUD();
    }, 280);
}

function burst(matrix, pos, n, fromBottom = false) {
    const val = matrix.flat().find(v => v > 0);
    if (!val) return;
    const col = PAL[val].glow;
    const cells = [];
    matrix.forEach((row, y) => row.forEach((v, x) => { if (v) cells.push({ x: pos.x + x, y: pos.y + y }); }));
    for (let i = 0; i < n; i++) {
        const c = cells[Math.random() * cells.length | 0];
        const angle = Math.random() * Math.PI * 2;
        const spd   = 1.8 + Math.random() * 4;
        particles.push({
            x: (c.x + 0.5) * CELL, y: (c.y + (fromBottom ? 1 : 0.5)) * CELL,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd - (fromBottom ? 3.5 : 0),
            life: 1, decay: 0.04 + Math.random() * 0.04,
            col, sz: 2 + Math.random() * 3
        });
    }
}

function spawnPiece() {
    if (!player.next) player.next = SHAPES[TYPES[Math.random() * TYPES.length | 0]];
    player.matrix = player.next;
    player.next   = SHAPES[TYPES[Math.random() * TYPES.length | 0]];
    player.pos.x  = (COLS / 2 | 0) - (player.matrix[0].length / 2 | 0);
    player.pos.y  = 0;
    if (collide(arena, player)) gameOver = true;
    drawNext();
}

function dropInterval() {
    return Math.max(60, 1000 - (player.level - 1) * 90);
}

function updateHUD() {
    document.getElementById('score-val').textContent = player.score;
    document.getElementById('level-val').textContent = player.level;
    document.getElementById('lines-val').textContent = player.lines;
}

// ── Main loop ──

function loop(time = 0) {
    const dt = time - lastTime;
    lastTime = time;
    flashTimer += dt;

    if (!gameOver) {
        // DAS / ARR
        if (dasDir) {
            dasTimer += dt;
            if (dasTimer >= DAS) {
                arrTimer += dt;
                while (arrTimer >= ARR) { playerMove(dasDir); arrTimer -= ARR; }
            }
        }
        // Gravity
        if (flashRows.length === 0) {
            dropCounter += dt;
            if (dropCounter > dropInterval()) playerDrop();
        }
        // Particles
        particles = particles.filter(p => {
            p.x += p.vx; p.y += p.vy; p.vy += 0.14; p.life -= p.decay;
            return p.life > 0;
        });
        // Popups
        popups = popups.filter(p => { p.y -= 1.4; p.life -= 0.018; return p.life > 0; });
    }

    drawBoard();
    drawArena();
    if (!gameOver) { drawPlayer(); drawParticles(); drawPopups(); }
    else drawGameOver();

    requestAnimationFrame(loop);
}

// ── Input ──

document.addEventListener('keydown', e => {
    if (gameOver) { if (e.code === 'KeyR') init(); return; }
    switch (e.code) {
        case 'ArrowLeft':  playerMove(-1); dasDir = -1; dasTimer = arrTimer = 0; e.preventDefault(); break;
        case 'ArrowRight': playerMove(1);  dasDir =  1; dasTimer = arrTimer = 0; e.preventDefault(); break;
        case 'ArrowDown':  playerDrop();   dropCounter = 0; e.preventDefault(); break;
        case 'ArrowUp': case 'KeyW': playerRotate(1);  e.preventDefault(); break;
        case 'KeyQ':                  playerRotate(-1); break;
        case 'Space':                 hardDrop();       e.preventDefault(); break;
        case 'KeyR':                  init();           break;
    }
});
document.addEventListener('keyup', e => {
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { dasDir = dasTimer = arrTimer = 0; }
});

function wireBtn(id, fn, repeat = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', fn);
    if (repeat) {
        let iv = null;
        el.addEventListener('touchstart', e => { e.preventDefault(); fn(); iv = setInterval(fn, ARR); }, { passive: false });
        el.addEventListener('touchend',   () => clearInterval(iv));
        el.addEventListener('mousedown',  () => { fn(); iv = setInterval(fn, ARR); });
        el.addEventListener('mouseup',    () => clearInterval(iv));
        el.addEventListener('mouseleave', () => clearInterval(iv));
    } else {
        el.addEventListener('touchstart', e => { e.preventDefault(); fn(); }, { passive: false });
    }
}

wireBtn('left-btn',      () => playerMove(-1), true);
wireBtn('right-btn',     () => playerMove(1),  true);
wireBtn('down-btn',      () => { playerDrop(); dropCounter = 0; }, true);
wireBtn('rotate-btn',    () => gameOver ? init() : playerRotate(1));
wireBtn('hard-drop-btn', () => !gameOver && hardDrop());

// Tap canvas = rotate
canvas.addEventListener('click', () => { if (!gameOver) playerRotate(1); });

// ── Start ──
init();
loop();
