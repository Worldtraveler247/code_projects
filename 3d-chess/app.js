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
    } else if (game.in_check()) {
        statusEl.textContent = name + ' is in check';
        statusEl.className   = 'check';
        highlightKing(turn);
    } else {
        statusEl.textContent = name + "'s Turn";
    }
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
}

function clearHighlights() {
    tileMeshes.forEach(t => t.material.color.setHex(t.userData.baseColor));
    if (game.in_check()) highlightKing(game.turn());
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

function handleSquareClick(square) {
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
        saveToFirebase();
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
function resetGame() {
    game = new Chess();
    selectedSquare = null;
    moveLogEl.textContent = '';
    sync3DWithEngine();
    saveToFirebase();
}

function flipCamera() {
    isWhiteBottom = !isWhiteBottom;
    camera.position.set(0, 10, isWhiteBottom ? 11 : -11);
    controls.target.set(0, 0, 0);
    controls.update();
}

// ─── Panel Toggle ─────────────────────────────────────────────────────────────
function togglePanel() {
    const panel = document.getElementById('ui-container');
    const btn   = document.getElementById('panel-toggle');
    panel.classList.toggle('collapsed');
    btn.textContent = panel.classList.contains('collapsed') ? '☰' : '✕';
    btn.title       = panel.classList.contains('collapsed') ? 'Show controls' : 'Hide controls';
}

// ─── Name Persistence ─────────────────────────────────────────────────────────
function loadNamesFromStorage() {
    const wEl = document.getElementById('name-white');
    const bEl = document.getElementById('name-black');
    const w = localStorage.getItem('chess_name_w');
    const b = localStorage.getItem('chess_name_b');
    if (w) wEl.value = w;
    if (b) bEl.value = b;
}

let nameSaveTimer = null;
function onNameInput(color) {
    const key = color === 'w' ? 'name-white' : 'name-black';
    localStorage.setItem('chess_name_' + color, document.getElementById(key).value);
    updateStatus();
    clearTimeout(nameSaveTimer);
    nameSaveTimer = setTimeout(saveToFirebase, 800);
}

// ─── Firebase ─────────────────────────────────────────────────────────────────
function firebaseReady() {
    return typeof firebase !== 'undefined'
        && firebase.apps.length > 0
        && typeof firebase.auth === 'function'
        && firebase.auth().currentUser !== null;
}
function initFirebaseAuth() {
    if (typeof firebase === 'undefined' || firebase.apps.length === 0) return;
    if (typeof firebase.auth !== 'function') return;
    firebase.auth().signInAnonymously().catch(e => console.warn('Firebase auth:', e.message));
}
function saveToFirebase() {
    if (!firebaseReady()) return;
    const wName = document.getElementById('name-white').value.trim();
    const bName = document.getElementById('name-black').value.trim();
    firebase.database().ref('current_match').set({
        fen: game.fen(),
        nameWhite: wName,
        nameBlack: bName,
        timestamp: Date.now(),
    });
}
function loadFromFirebase() {
    if (typeof firebase === 'undefined' || firebase.apps.length === 0) return;
    if (typeof firebase.auth !== 'function') return;
    firebase.auth().onAuthStateChanged(user => {
        if (!user) return;
        firebase.database().ref('current_match').on('value', snap => {
            const data = snap.val();
            if (!data) return;
            // Populate name fields from remote if local is blank
            const wEl = document.getElementById('name-white');
            const bEl = document.getElementById('name-black');
            if (!wEl.value.trim() && data.nameWhite) {
                wEl.value = data.nameWhite;
                localStorage.setItem('chess_name_w', data.nameWhite);
            }
            if (!bEl.value.trim() && data.nameBlack) {
                bEl.value = data.nameBlack;
                localStorage.setItem('chess_name_b', data.nameBlack);
            }
            if (data.fen && data.fen !== game.fen()) {
                game.load(data.fen);
                sync3DWithEngine();
            } else {
                updateStatus();
            }
        });
    });
}

// ─── Animation ────────────────────────────────────────────────────────────────
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.getElementById('name-white').addEventListener('input', () => onNameInput('w'));
document.getElementById('name-black').addEventListener('input', () => onNameInput('b'));
window.addEventListener('click', onCanvasClick);

// Touch tap detection — distinguish tap from orbit drag
let touchStart = null;
window.addEventListener('touchstart', (e) => {
    if (e.target !== renderer.domElement || e.touches.length !== 1) return;
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
window.addEventListener('touchend', (e) => {
    if (!touchStart || e.changedTouches.length !== 1) { touchStart = null; return; }
    const t  = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.sqrt(dx * dx + dy * dy) > 8) return; // swipe = orbit, ignore
    lastTouchFired = Date.now();
    const sq = pickSquare(t.clientX, t.clientY);
    if (sq) handleSquareClick(sq);
}, { passive: true });

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Collapse panel by default on narrow screens (mobile)
if (window.innerWidth < 600) {
    const panel = document.getElementById('ui-container');
    panel.classList.add('collapsed');
    document.getElementById('panel-toggle').textContent = '☰';
}

loadNamesFromStorage();
createBoard();
sync3DWithEngine();
initFirebaseAuth();
loadFromFirebase();
animate();
