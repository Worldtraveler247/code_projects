// ─── Firebase (modular SDK, pinned) ──────────────────────────────────────────
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {
    getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import {
    getDatabase, ref, set, onValue, serverTimestamp, connectDatabaseEmulator,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

// ─── Game State ───────────────────────────────────────────────────────────────
let game = new Chess();
let selectedSquare = null;
let pieceMeshes   = [];
let tileMeshes    = [];
let isWhiteBottom = true;

const statusEl  = document.getElementById('status');
const moveLogEl = document.getElementById('move-log');

// ─── Renderer ─────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x08080c);
scene.fog = new THREE.FogExp2(0x08080c, 0.016);

const camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 10, 11);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
renderer.outputEncoding    = THREE.sRGBEncoding;
renderer.toneMapping       = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('canvas-container').appendChild(renderer.domElement);

// OrbitControls
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.dampingFactor  = 0.07;
controls.minDistance    = 5;
controls.maxDistance    = 22;
controls.maxPolarAngle  = Math.PI / 2.05;
controls.target.set(0, 0, 0);
controls.update();

// ─── Lighting — three-point studio ───────────────────────────────────────────
const ambient = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xfff4e0, 1.2);
keyLight.position.set(6, 10, 6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left   = -8;
keyLight.shadow.camera.right  =  8;
keyLight.shadow.camera.top    =  8;
keyLight.shadow.camera.bottom = -8;
keyLight.shadow.camera.near   = 0.5;
keyLight.shadow.camera.far    = 30;
keyLight.shadow.bias          = -0.0005;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xc0d0ff, 0.4);
fillLight.position.set(-5, 6, -3);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
rimLight.position.set(0, 4, -8);
scene.add(rimLight);

// ─── Raycaster ────────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();

// ─── Groups ───────────────────────────────────────────────────────────────────
const boardGroup = new THREE.Group();
const pieceGroup = new THREE.Group();
scene.add(boardGroup, pieceGroup);

// ─── Piece materials ──────────────────────────────────────────────────────────
const WHITE_MAT = new THREE.MeshStandardMaterial({ color: 0xf5efd8, roughness: 0.35, metalness: 0.15 });
const BLACK_MAT = new THREE.MeshStandardMaterial({ color: 0x1a1a18, roughness: 0.40, metalness: 0.20 });

// ─── Highlight colors ─────────────────────────────────────────────────────────
const C = {
    SEL:   0xe8c840,  // selected square — gold
    MOVE:  0x7aaa60,  // valid move — sage green
    CHECK: 0xcc3333,  // check — deep red
};

// ─── Board ────────────────────────────────────────────────────────────────────
// Dark squares: tournament green  |  Light squares: near-white
const DARK_COL  = 0x2E5B3E;
const LIGHT_COL = 0xf0ead6;

function createBoard() {
    // Dark ebony border + pedestal
    const pedMat   = new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.88, metalness: 0.02 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.82, metalness: 0.02 });

    const ped = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.4, 10.6), pedMat);
    ped.position.y = -0.25;
    ped.receiveShadow = true;
    boardGroup.add(ped);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(10.0, 0.18, 10.0), frameMat);
    frame.position.y = -0.02;
    frame.receiveShadow = true;
    boardGroup.add(frame);

    // 64 tiles — each gets its own material instance for independent highlighting
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const isDark    = (r + f) % 2 === 0;
            const baseColor = isDark ? DARK_COL : LIGHT_COL;
            const geo  = new THREE.BoxGeometry(0.96, 0.18, 0.96);
            const mat  = new THREE.MeshStandardMaterial({
                color:     baseColor,
                roughness: isDark ? 0.88 : 0.82,
                metalness: 0,
            });
            const tile = new THREE.Mesh(geo, mat);
            const square = String.fromCharCode(97 + f) + (r + 1);
            tile.userData = { square, isDark, baseColor };
            tile.position.set(f - 3.5, 0, (7 - r) - 3.5);
            tile.receiveShadow = true;
            boardGroup.add(tile);
            tileMeshes.push(tile);
        }
    }
}

// ─── Staunton piece builders ──────────────────────────────────────────────────
function lathe(points, material, segments = 48) {
    const vec2s = points.map(([r, y]) => new THREE.Vector2(r, y));
    const geo   = new THREE.LatheGeometry(vec2s, segments);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    m.castShadow = m.receiveShadow = true;
    return m;
}

function basePoints(stemTopY, stemTopR) {
    return [
        [0.00, 0.00], [0.32, 0.00], [0.34, 0.04], [0.32, 0.08],
        [0.26, 0.10], [0.24, 0.14], [0.22, 0.18], [0.18, 0.30],
        [0.16, stemTopY * 0.7], [stemTopR, stemTopY],
    ];
}

function makePawn(mat) {
    const pts = [
        ...basePoints(0.50, 0.14),
        [0.20, 0.55], [0.14, 0.58], [0.20, 0.62], [0.22, 0.70],
        [0.20, 0.78], [0.16, 0.84], [0.10, 0.88], [0.00, 0.90],
    ];
    const g = new THREE.Group();
    g.add(lathe(pts, mat));
    return g;
}

function makeRook(mat) {
    const pts = [
        ...basePoints(0.65, 0.18),
        [0.24, 0.70], [0.26, 0.78], [0.30, 0.82], [0.32, 0.85],
        [0.32, 1.00], [0.20, 1.00], [0.20, 0.90], [0.00, 0.90],
    ];
    const g = new THREE.Group();
    g.add(lathe(pts, mat));
    const crenGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const cren  = new THREE.Mesh(crenGeo, mat);
        cren.position.set(Math.cos(angle) * 0.26, 1.05, Math.sin(angle) * 0.26);
        cren.castShadow = true;
        g.add(cren);
    }
    return g;
}

function makeBishop(mat) {
    const pts = [
        ...basePoints(0.85, 0.16),
        [0.18, 0.95], [0.22, 1.00], [0.18, 1.02], [0.22, 1.06],
        [0.18, 1.10], [0.24, 1.18], [0.22, 1.30], [0.18, 1.42],
        [0.12, 1.52], [0.06, 1.58], [0.00, 1.62],
    ];
    const g = new THREE.Group();
    g.add(lathe(pts, mat));
    const slitMat = new THREE.MeshStandardMaterial({
        color: mat.color.clone().multiplyScalar(0.4), roughness: 0.7,
    });
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.34), slitMat);
    slit.position.y  = 1.32;
    slit.rotation.y  = Math.PI / 4;
    slit.castShadow  = true;
    g.add(slit);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), mat);
    ball.position.y = 1.66;
    ball.castShadow = true;
    g.add(ball);
    return g;
}

function makeQueen(mat) {
    const pts = [
        ...basePoints(0.95, 0.18),
        [0.20, 1.05], [0.24, 1.10], [0.20, 1.14], [0.26, 1.20],
        [0.30, 1.30], [0.32, 1.42], [0.30, 1.50], [0.20, 1.50],
        [0.20, 1.40], [0.00, 1.40],
    ];
    const g = new THREE.Group();
    g.add(lathe(pts, mat));
    const ptGeo = new THREE.SphereGeometry(0.06, 16, 12);
    for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const pt    = new THREE.Mesh(ptGeo, mat);
        pt.position.set(Math.cos(angle) * 0.28, 1.54, Math.sin(angle) * 0.28);
        pt.castShadow = true;
        g.add(pt);
    }
    const center = new THREE.Mesh(new THREE.SphereGeometry(0.08, 20, 16), mat);
    center.position.y = 1.56;
    center.castShadow = true;
    g.add(center);
    return g;
}

function makeKing(mat) {
    const pts = [
        ...basePoints(1.05, 0.18),
        [0.20, 1.15], [0.24, 1.20], [0.20, 1.24], [0.26, 1.30],
        [0.32, 1.42], [0.34, 1.55], [0.32, 1.62], [0.20, 1.62],
        [0.20, 1.52], [0.00, 1.52],
    ];
    const g = new THREE.Group();
    g.add(lathe(pts, mat));
    const bGeo = new THREE.BoxGeometry(0.08, 0.32, 0.08);
    const cv = new THREE.Mesh(bGeo, mat);
    cv.position.y = 1.82; cv.castShadow = true; g.add(cv);
    const ch = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.08), mat);
    ch.position.y = 1.82; ch.castShadow = true; g.add(ch);
    return g;
}

function makeKnight(mat) {
    const g = new THREE.Group();
    const basePts = [
        [0.00, 0.00], [0.32, 0.00], [0.34, 0.04], [0.32, 0.08],
        [0.26, 0.10], [0.24, 0.14], [0.22, 0.20], [0.20, 0.32],
        [0.22, 0.40], [0.20, 0.44], [0.00, 0.44],
    ];
    g.add(lathe(basePts, mat));

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 0.7, 24), mat);
    neck.position.set(0, 0.78, 0.05); neck.rotation.x = -0.35;
    neck.castShadow = true; g.add(neck);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.55), mat);
    head.position.set(0, 1.18, 0.28); head.rotation.x = 0.25;
    head.scale.set(1, 0.85, 1); head.castShadow = true; g.add(head);

    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.20, 0.22), mat);
    muzzle.position.set(0, 1.05, 0.52); muzzle.rotation.x = 0.25;
    muzzle.castShadow = true; g.add(muzzle);

    const brow = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), mat);
    brow.position.set(0, 1.32, 0.12); brow.scale.set(1, 0.7, 1.1);
    brow.castShadow = true; g.add(brow);

    const earGeo = new THREE.ConeGeometry(0.05, 0.16, 12);
    const earL   = new THREE.Mesh(earGeo, mat);
    earL.position.set(-0.10, 1.42, 0.10); earL.rotation.x = -0.2;
    earL.castShadow = true; g.add(earL);
    const earR = earL.clone(); earR.position.x = 0.10; g.add(earR);

    const mane = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.08), mat);
    mane.position.set(0, 1.0, -0.18); mane.rotation.x = 0.4;
    mane.castShadow = true; g.add(mane);

    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0a08, roughness: 0.3 });
    const eyeGeo = new THREE.SphereGeometry(0.035, 12, 10);
    const eyeL   = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.16, 1.20, 0.32); g.add(eyeL);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.16; g.add(eyeR);

    return g;
}

function createPieceMesh(type, color) {
    const mat = color === 'w' ? WHITE_MAT : BLACK_MAT;
    switch (type) {
        case 'p': return makePawn(mat);
        case 'r': return makeRook(mat);
        case 'b': return makeBishop(mat);
        case 'q': return makeQueen(mat);
        case 'k': return makeKing(mat);
        case 'n': return makeKnight(mat);
        default:  return new THREE.Group();
    }
}

// ─── Board ↔ Engine Sync ──────────────────────────────────────────────────────
// game.board() rows: r=0 → rank 8, r=7 → rank 1
// Tile z mapping: rank 1 is at z=+3.5 (near camera), rank 8 at z=-3.5
// Piece placement mirrors: board[r][f] → z = r - 3.5
function sync3DWithEngine() {
    while (pieceGroup.children.length) pieceGroup.remove(pieceGroup.children[0]);
    pieceMeshes = [];

    const board = game.board();
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const piece = board[r][f];
            if (!piece) continue;
            const m = createPieceMesh(piece.type, piece.color);
            m.position.set(f - 3.5, 0.09, r - 3.5);
            if (piece.type === 'n') {
                m.rotation.y = piece.color === 'w' ? 0 : Math.PI;
            }
            pieceGroup.add(m);
            pieceMeshes.push(m);
        }
    }
    updateStatus();
    clearHighlights();
}

// ─── Status ───────────────────────────────────────────────────────────────────
function playerName(color) {
    const id = color === 'w' ? 'name-white' : 'name-black';
    return document.getElementById(id).value.trim() || (color === 'w' ? 'White' : 'Black');
}

function updateStatus() {
    const turn    = game.turn();
    const name    = playerName(turn);
    const oppName = playerName(turn === 'w' ? 'b' : 'w');
    statusEl.className = '';

    if (game.in_checkmate()) {
        statusEl.textContent = oppName + ' wins — checkmate';
        statusEl.className   = 'gameover';
    } else if (game.in_draw()) {
        statusEl.textContent = 'Draw';
        statusEl.className   = 'gameover';
    } else if (isOnline() && mySeat === turn) {
        statusEl.textContent = game.in_check() ? 'Your move — you are in check' : 'Your move';
        statusEl.className   = game.in_check() ? 'check' : 'yours';
    } else if (isOnline() && mySeat) {
        statusEl.textContent = 'Waiting for ' + name;
    } else if (game.in_check()) {
        statusEl.textContent = name + ' is in check';
        statusEl.className   = 'check';
    } else {
        statusEl.textContent = name + "'s Turn";
    }
    if (game.in_check()) highlightKing(turn);
    updateTitle();
}

// ─── Highlights ───────────────────────────────────────────────────────────────
function squareOfKing(color) {
    const b = game.board();
    for (let r = 0; r < 8; r++)
        for (let f = 0; f < 8; f++) {
            const p = b[r][f];
            if (p && p.type === 'k' && p.color === color)
                return String.fromCharCode(97 + f) + (8 - r);
        }
    return null;
}

function highlightKing(color) {
    const sq   = squareOfKing(color);
    const tile = tileMeshes.find(t => t.userData.square === sq);
    if (tile) tile.material.color.setHex(C.CHECK);
}

function highlightLegalMoves(from) {
    clearHighlights();
    const moves = game.moves({ square: from, verbose: true });
    const start = tileMeshes.find(t => t.userData.square === from);
    if (start) start.material.color.setHex(C.SEL);
    moves.forEach(m => {
        const tile = tileMeshes.find(t => t.userData.square === m.to);
        if (tile) tile.material.color.setHex(C.MOVE);
    });
    render2D(from);
}

function clearHighlights() {
    tileMeshes.forEach(t => t.material.color.setHex(t.userData.baseColor));
    if (game.in_check()) highlightKing(game.turn());
    render2D(null);
}

// ─── 2D View ──────────────────────────────────────────────────────────────────
// DOM board that reads the same chess.js state as the 3D scene. It owns no game
// logic: clicks route through handleSquareClick, so both views stay in lockstep.
const board2dEl = document.getElementById('board-2d');
let viewMode = '3d';

// U+FE0E forces text presentation; without it iOS renders ♟ as a colour emoji.
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const PIECE_NAME = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

function render2D(highlightFrom) {
    if (viewMode !== '2d') return;

    const targets = new Set(
        highlightFrom ? game.moves({ square: highlightFrom, verbose: true }).map(m => m.to) : []
    );
    const checkSq = game.in_check() ? squareOfKing(game.turn()) : null;

    const ranks = isWhiteBottom ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
    const files = isWhiteBottom ? 'abcdefgh' : 'hgfedcba';

    const frag = document.createDocumentFragment();
    ranks.forEach((rank, row) => {
        [...files].forEach((file, col) => {
            const sq    = file + rank;
            const piece = game.get(sq);
            const cell  = document.createElement('button');
            cell.type = 'button';
            cell.dataset.square = sq;
            cell.className = 'sq ' + (((file.charCodeAt(0) - 97) + rank) % 2 === 0 ? 'light' : 'dark');
            if (sq === highlightFrom) cell.classList.add('sel');
            if (targets.has(sq))      cell.classList.add(piece ? 'capture' : 'move');
            if (sq === checkSq)       cell.classList.add('check');

            if (piece) {
                const span = document.createElement('span');
                span.className   = 'pc ' + piece.color;
                span.textContent = GLYPH[piece.type] + '︎';
                cell.appendChild(span);
            }
            if (col === 0) cell.dataset.rank = rank;
            if (row === 7) {
                const lbl = document.createElement('span');
                lbl.className   = 'coord-file';
                lbl.textContent = file;
                cell.appendChild(lbl);
            }
            cell.setAttribute('aria-label',
                sq + (piece ? ' ' + (piece.color === 'w' ? 'white' : 'black') + ' ' + PIECE_NAME[piece.type] : ' empty'));
            frag.appendChild(cell);
        });
    });
    board2dEl.replaceChildren(frag);
}

board2dEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.sq');
    if (cell) handleSquareClick(cell.dataset.square);
});

function setView(mode) {
    viewMode = mode;
    const is2d = mode === '2d';
    document.getElementById('canvas-container').hidden = is2d;
    board2dEl.hidden   = !is2d;
    controls.enabled   = !is2d;

    const btn = document.getElementById('view-toggle');
    btn.textContent = is2d ? '◈ \u00A03D View' : '▦ \u00A02D View';
    btn.setAttribute('aria-pressed', String(is2d));
    document.getElementById('controls-hint').textContent =
        is2d ? 'Click a piece, then a square' : 'Drag to rotate · Scroll to zoom';

    try { localStorage.setItem('chess_view', mode); } catch (_) { /* private mode: non-fatal */ }
    render2D(selectedSquare);
}

function toggleView() {
    setView(viewMode === '2d' ? '3d' : '2d');
}

// ─── Input Handling ───────────────────────────────────────────────────────────
function pickSquare(clientX, clientY) {
    mouse.x =  (clientX / window.innerWidth)  * 2 - 1;
    mouse.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(boardGroup.children, false);
    const hit  = hits.find(i => i.object.userData.square);
    return hit ? hit.object.userData.square : null;
}

let lastTouchFired = 0;
function onCanvasClick(event) {
    if (event.target !== renderer.domElement) return;
    if (Date.now() - lastTouchFired < 500) return; // skip synthetic click fired after touchend
    const sq = pickSquare(event.clientX, event.clientY);
    if (sq) handleSquareClick(sq);
}

// Client-side gate only — the database rules are the real enforcement.
function canMoveNow() {
    if (!isOnline()) return true;               // local pass-and-play
    return remote !== null && mySeat === game.turn();
}

function handleSquareClick(square) {
    if (!canMoveNow()) {
        selectedSquare = null;
        clearHighlights();
        return;
    }
    if (!selectedSquare) {
        const piece = game.get(square);
        if (piece && piece.color === game.turn()) {
            selectedSquare = square;
            highlightLegalMoves(square);
        }
        return;
    }
    const move = game.move({ from: selectedSquare, to: square, promotion: 'q' });
    if (move) {
        selectedSquare = null;
        moveLogEl.textContent = 'Last move: ' + move.san;
        sync3DWithEngine();
        if (isOnline()) commitMove(move);
    } else {
        const piece = game.get(square);
        if (piece && piece.color === game.turn()) {
            selectedSquare = square;
            highlightLegalMoves(square);
        } else {
            selectedSquare = null;
            clearHighlights();
        }
    }
}

// ─── Board Controls ───────────────────────────────────────────────────────────
function resetLocalBoard() {
    game = new Chess();
    selectedSquare = null;
    moveLogEl.textContent = '';
    sync3DWithEngine();
}

function flipCamera() {
    isWhiteBottom = !isWhiteBottom;
    camera.position.set(0, 10, isWhiteBottom ? 11 : -11);
    controls.target.set(0, 0, 0);
    controls.update();
    render2D(selectedSquare);
}

function togglePanel() {
    const panel = document.getElementById('ui-container');
    const btn   = document.getElementById('panel-toggle');
    panel.classList.toggle('collapsed');
    btn.textContent = panel.classList.contains('collapsed') ? '☰' : '✕';
    btn.title       = panel.classList.contains('collapsed') ? 'Show controls' : 'Hide controls';
}

// ─── Storage helpers (localStorage can throw in private mode) ─────────────────
function store(key, val) { try { localStorage.setItem(key, val); } catch (_) { /* non-fatal */ } }
function load(key)       { try { return localStorage.getItem(key); } catch (_) { return null; } }

// ─── Online Game: identity, seats, sync ───────────────────────────────────────
// Data model (enforced by database.rules.json):
//   games/{id}/players/{w|b}  = auth uid, claim-once
//   games/{id}/state          = { fen, turn, lastMove, updatedAt } — writable only by the side to move
//   games/{id}/names|comments/{w|b} — writable only by that seat's owner
const GAME_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const START_FEN  = new Chess().fen();
const SEAT_KEY   = { w: 'white', b: 'black' };
const BASE_TITLE = document.title;

const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
const db    = getDatabase(fbApp);

// Local emulator only: requires BOTH a loopback host and ?emu=1, so a crafted
// link can never redirect a production visitor's writes somewhere else.
const params = new URLSearchParams(location.search);
if (['127.0.0.1', 'localhost'].includes(location.hostname) && params.get('emu') === '1') {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectDatabaseEmulator(db, '127.0.0.1', 9000);
}

let gameId  = GAME_ID_RE.test(params.get('g') || '') ? params.get('g') : null;
let uid     = null;
let mySeat  = null;   // 'w' | 'b' | null (spectator or not yet joined)
let remote  = null;   // last server snapshot of games/{gameId}
let stopListening = null;

function isOnline() { return gameId !== null; }
function $(id)      { return document.getElementById(id); }

function newGameId() {
    // 128 bits from the CSPRNG → 22-char base64url. The ID is the invite
    // capability, so it must be unguessable (push IDs are time-prefixed).
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function gameUrl(id) {
    const u = new URL(location.href);
    u.search = '';
    u.searchParams.set('g', id);
    if (params.get('emu') === '1') u.searchParams.set('emu', '1');
    return u.toString();
}

let noticeTimer = null;
function showNotice(msg) {
    const el = $('notice');
    el.textContent = msg;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { el.textContent = ''; }, 6000);
}

function myName() { return (load('chess_my_name') || '').trim().slice(0, 24); }

async function createOnlineGame() {
    if (!uid) return showNotice('Still connecting — try again in a moment.');
    const id   = newGameId();
    const data = {
        players:   { w: uid },
        state:     { fen: START_FEN, turn: 'w', updatedAt: serverTimestamp() },
        createdAt: serverTimestamp(),
    };
    if (myName()) data.names = { w: myName() };
    try {
        await set(ref(db, `games/${id}`), data);
    } catch (e) {
        return showNotice('Could not create game: ' + e.message);
    }
    store('chess_last_game', id);
    history.pushState(null, '', gameUrl(id));
    openGame(id);
}

function openGame(id) {
    if (stopListening) stopListening();
    gameId = id;
    remote = null;
    mySeat = null;
    selectedSquare = null;
    document.body.classList.add('online');
    stopListening = onValue(
        ref(db, `games/${id}`),
        onGameSnapshot,
        (err) => showNotice('Cannot load game: ' + err.message),
    );
    renderOnlinePanel();
}

function onGameSnapshot(snap) {
    const data = snap.val();
    if (!data) { showNotice('Game not found — check the link.'); return; }
    remote = data;
    const players = data.players || {};
    mySeat = players.w === uid ? 'w' : players.b === uid ? 'b' : null;
    if (mySeat) store('chess_last_game', gameId);

    // Default the camera to the player's own side the first time we learn it.
    if (mySeat && (mySeat === 'w') !== isWhiteBottom && !onGameSnapshot.oriented) flipCamera();
    if (mySeat) onGameSnapshot.oriented = true;

    syncNamesAndComments(data);
    if (data.state.fen !== game.fen()) {
        game.load(data.state.fen);
        selectedSquare = null;
        moveLogEl.textContent = data.state.lastMove ? 'Last move: ' + data.state.lastMove : '';
        sync3DWithEngine();
    } else {
        updateStatus();
    }
    renderOnlinePanel();
}

async function commitMove(move) {
    const before = remote?.state?.fen;
    try {
        await set(ref(db, `games/${gameId}/state`), {
            fen: game.fen(), turn: game.turn(), lastMove: move.san, updatedAt: serverTimestamp(),
        });
        renderOnlinePanel();
    } catch (e) {
        // RTDB already reverted its optimistic local event; resync the board to match.
        showNotice('Move rejected by the server — board restored.');
        if (before) { game.load(before); sync3DWithEngine(); }
    }
}

async function joinAsBlack() {
    try {
        await set(ref(db, `games/${gameId}/players/b`), uid);
        if (myName()) await set(ref(db, `games/${gameId}/names/b`), myName());
    } catch (_) {
        showNotice('That seat was just taken.');
    }
}

function syncNamesAndComments(data) {
    const names = data.names || {}, comments = data.comments || {}, players = data.players || {};
    for (const seat of ['w', 'b']) {
        const key   = SEAT_KEY[seat];
        const mine  = seat === mySeat;
        const input = $('name-' + key);
        input.disabled    = !mine;
        input.placeholder = players[seat] ? (seat === 'w' ? 'White player' : 'Black player') : 'Seat open';
        if (document.activeElement !== input) input.value = names[seat] || '';

        const box = $('comment-' + key);
        box.contentEditable     = String(mine);
        box.dataset.placeholder = mine ? 'Leave a message…' : 'No message yet';
        if (document.activeElement !== box) {
            const v = comments[seat] || '';
            if (box.textContent !== v) box.textContent = v;
        }
    }
}

// ─── Online panel + nudges ────────────────────────────────────────────────────
function opponentSeat() { return mySeat === 'w' ? 'b' : 'w'; }

function renderOnlinePanel() {
    const online   = isOnline();
    const players  = remote?.players || {};
    const gameOver = game.game_over();
    $('offline-controls').hidden = online;
    $('online-panel').hidden     = !online;

    const last = load('chess_last_game');
    $('resume-btn').hidden = online || !last || !GAME_ID_RE.test(last);
    if (!online) return;

    const seatInfo = $('seat-info');
    if (!remote)            seatInfo.textContent = 'Connecting…';
    else if (mySeat)        seatInfo.textContent = 'You are ' + (mySeat === 'w' ? 'White' : 'Black');
    else if (!players.b)    seatInfo.textContent = 'Black seat is open';
    else                    seatInfo.textContent = 'Spectating — both seats taken';

    $('join-btn').hidden   = !remote || mySeat !== null || Boolean(players.b);
    $('invite-row').hidden = mySeat !== 'w' || Boolean(players.b);

    const oppSeated = Boolean(players[opponentSeat()]);
    const nudge = $('nudge-btn');
    nudge.hidden = !mySeat || !oppSeated || gameOver || game.turn() === mySeat;
    nudge.textContent = '💬  Nudge ' + playerName(opponentSeat()) + ' on WhatsApp';
}

function whatsappShare(text) {
    // No phone number in the URL: WhatsApp opens its own contact picker, so this
    // app never sees, stores, or transmits anyone's number.
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
}

function nudgeOpponent() {
    whatsappShare(`♟ Your move in our chess game, ${playerName(opponentSeat())}. ${gameUrl(gameId)}`);
}

function inviteOnWhatsApp() {
    whatsappShare(`♟ Join my chess game — you're Black. Play a move whenever you have a minute: ${gameUrl(gameId)}`);
}

async function copyInvite() {
    try {
        await navigator.clipboard.writeText(gameUrl(gameId));
        showNotice('Invite link copied. Send it privately — the first person to open it gets the Black seat.');
    } catch (_) {
        showNotice('Copy failed — copy the address bar instead.');
    }
}

function updateTitle() {
    const myTurn = isOnline() && mySeat !== null && game.turn() === mySeat && !game.game_over();
    document.title = myTurn ? '● Your move — ' + BASE_TITLE : BASE_TITLE;
}

// ─── Names ────────────────────────────────────────────────────────────────────
let nameSaveTimer = null;
function onNameInput(color) {
    const value = $(color === 'w' ? 'name-white' : 'name-black').value;
    updateStatus();
    renderOnlinePanel();
    if (!isOnline()) { store('chess_name_' + color, value); return; }
    if (color !== mySeat) return;
    store('chess_my_name', value);
    clearTimeout(nameSaveTimer);
    nameSaveTimer = setTimeout(() => {
        set(ref(db, `games/${gameId}/names/${color}`), value.trim().slice(0, 24))
            .catch(e => showNotice('Name not saved: ' + e.message));
    }, 800);
}

function loadLocalNames() {
    const w = load('chess_name_w'), b = load('chess_name_b');
    if (w) $('name-white').value = w;
    if (b) $('name-black').value = b;
}

// ─── Comments ─────────────────────────────────────────────────────────────────
const commentTimers = { w: null, b: null };

function showSaved(seat) {
    const el = $('comment-' + SEAT_KEY[seat]), badge = $('saved-' + SEAT_KEY[seat]);
    el.classList.add('flash-saved');
    badge.classList.add('visible');
    setTimeout(() => el.classList.remove('flash-saved'), 600);
    setTimeout(() => badge.classList.remove('visible'), 1800);
}

function saveComment(seat) {
    if (!isOnline() || seat !== mySeat) return;
    const text = $('comment-' + SEAT_KEY[seat]).textContent.trim().slice(0, 500);
    set(ref(db, `games/${gameId}/comments/${seat}`), text)
        .then(() => showSaved(seat))
        .catch(e => showNotice('Message not saved: ' + e.message));
}

// ─── Animation ────────────────────────────────────────────────────────────────
function animate() {
    requestAnimationFrame(animate);
    if (viewMode === '2d') return; // canvas hidden — don't burn GPU on an invisible frame
    controls.update();
    renderer.render(scene, camera);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
$('panel-toggle').addEventListener('click', togglePanel);
$('reset-btn').addEventListener('click', resetLocalBoard);
$('new-online-btn').addEventListener('click', createOnlineGame);
$('new-online-btn-2').addEventListener('click', createOnlineGame);
$('resume-btn').addEventListener('click', () => {
    const id = load('chess_last_game');
    if (id && GAME_ID_RE.test(id)) { history.pushState(null, '', gameUrl(id)); openGame(id); }
});
$('flip-btn').addEventListener('click', flipCamera);
$('view-toggle').addEventListener('click', toggleView);
$('join-btn').addEventListener('click', joinAsBlack);
$('invite-wa-btn').addEventListener('click', inviteOnWhatsApp);
$('invite-copy-btn').addEventListener('click', copyInvite);
$('nudge-btn').addEventListener('click', nudgeOpponent);
window.addEventListener('popstate', () => location.reload());

$('name-white').addEventListener('input', () => onNameInput('w'));
$('name-black').addEventListener('input', () => onNameInput('b'));

for (const seat of ['w', 'b']) {
    const el = $('comment-' + SEAT_KEY[seat]);
    el.addEventListener('input', () => {
        clearTimeout(commentTimers[seat]);
        commentTimers[seat] = setTimeout(() => saveComment(seat), 700);
    });
    el.addEventListener('blur', () => { clearTimeout(commentTimers[seat]); saveComment(seat); });
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); }
    });
}

window.addEventListener('click', onCanvasClick);

// Touch tap detection — distinguish tap from orbit drag
let touchStart = null;
window.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { touchStart = null; return; }
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
window.addEventListener('touchend', (e) => {
    if (!touchStart || e.changedTouches.length !== 1) { touchStart = null; return; }
    const t  = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    // In 2D the camera still exists behind the hidden canvas; raycasting here
    // would select a square the user never tapped. The DOM board handles its own clicks.
    if (viewMode === '2d') return;
    if (Math.sqrt(dx * dx + dy * dy) > 10) return; // drag = orbit, ignore
    lastTouchFired = Date.now();
    const sq = pickSquare(t.clientX, t.clientY);
    if (sq) handleSquareClick(sq);
}, { passive: true });

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

if (window.innerWidth < 600) {
    $('ui-container').classList.add('collapsed');
    $('panel-toggle').textContent = '☰';
}

createBoard();
if (load('chess_view') === '2d') setView('2d');
if (isOnline()) {
    document.body.classList.add('online');
} else {
    loadLocalNames();
}
sync3DWithEngine();
renderOnlinePanel();

onAuthStateChanged(auth, (user) => {
    if (!user || uid === user.uid) return;
    uid = user.uid;
    if (gameId) openGame(gameId);
});
signInAnonymously(auth).catch(e => showNotice('Sign-in failed: ' + e.message));

animate();
