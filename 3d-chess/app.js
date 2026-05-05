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

const labelRenderer = new THREE.CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.id = 'label-container';
document.getElementById('canvas-container').appendChild(labelRenderer.domElement);

// OrbitControls
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.dampingFactor  = 0.07;
controls.minDistance    = 5;
controls.maxDistance    = 22;
controls.maxPolarAngle  = Math.PI / 2.05;
controls.target.set(0, 0, 0);
controls.update();

// ─── Lighting — clean studio ──────────────────────────────────────────────────
const ambient = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(3, 14, 6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left   = keyLight.shadow.camera.bottom = -10;
keyLight.shadow.camera.right  = keyLight.shadow.camera.top   =  10;
keyLight.shadow.camera.near   = 1;
keyLight.shadow.camera.far    = 30;
keyLight.shadow.bias          = -0.001;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x88ccdd, 0.45);
fillLight.position.set(-4, 8, -4);
scene.add(fillLight);

// Cool under-rim to lift the teal resin
const rimLight = new THREE.PointLight(0x44aacc, 0.35, 14);
rimLight.position.set(0, -2, 0);
scene.add(rimLight);

// ─── Raycaster ────────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();

// ─── Groups ───────────────────────────────────────────────────────────────────
const boardGroup = new THREE.Group();
const pieceGroup = new THREE.Group();
scene.add(boardGroup, pieceGroup);

// ─── Unicode piece glyphs (white set / black set) ─────────────────────────────
const GLYPH = {
    w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
    b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

// Cylinder [topRadius, bottomRadius, height] per piece type
const PIECE_DIMS = {
    p: [0.13, 0.20, 0.36],
    n: [0.12, 0.19, 0.46],
    b: [0.11, 0.19, 0.52],
    r: [0.15, 0.21, 0.42],
    q: [0.12, 0.20, 0.58],
    k: [0.12, 0.20, 0.64],
};

// ─── Shared piece materials ───────────────────────────────────────────────────
const W_MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.0 });
const B_MAT = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.28, metalness: 0.05 });

// ─── Highlight colors ─────────────────────────────────────────────────────────
const C = {
    SEL:   0xe8c840,  // selected square — gold
    MOVE:  0x7aaa60,  // valid move — sage green
    CHECK: 0xcc3333,  // check — deep red
};

// ─── Board ────────────────────────────────────────────────────────────────────
// Dark squares: tournament green  |  Light squares: near-white
const DARK_COL  = 0x2E5B3E;
const LIGHT_COL = 0xF0F0F0;

function createBoard() {
    // Dark ebony border + pedestal
    const pedMat   = new THREE.MeshStandardMaterial({ color: 0x1a120b, roughness: 0.88, metalness: 0.02 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x221810, roughness: 0.82, metalness: 0.02 });

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

// Pieces sit 0.12 above y=0 so they clear the tile surface
const BASE_Y = 0.12;

// ─── Pieces: cylinder base + Unicode glyph via CSS2DRenderer ─────────────────
function createPieceMesh(type, color) {
    const isWhite = color === 'w';
    const mat     = isWhite ? W_MAT : B_MAT;
    const group   = new THREE.Group();

    const [rt, rb, h] = PIECE_DIMS[type] || [0.13, 0.19, 0.44];

    // 3D cylinder gives each piece a physical presence and casts shadows
    const body = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 20), mat);
    body.position.y = BASE_Y + h / 2;
    body.castShadow  = true;
    group.add(body);

    // Thin base disc so pieces sit flush on the tile
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(rb + 0.02, rb + 0.02, 0.04, 20), mat);
    disc.position.y = BASE_Y + 0.02;
    disc.castShadow  = true;
    group.add(disc);

    // Unicode glyph label — always faces the camera, immediately recognizable
    const div = document.createElement('div');
    div.className   = `piece-sym piece-sym--${color}`;
    div.textContent = GLYPH[color][type];
    const label = new THREE.CSS2DObject(div);
    label.position.set(0, BASE_Y + h + 0.22, 0);
    group.add(label);

    return group;
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
            m.position.set(f - 3.5, 0, r - 3.5);
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

// ─── Click Handling ───────────────────────────────────────────────────────────
function onCanvasClick(event) {
    if (event.target !== renderer.domElement) return;
    mouse.x =  (event.clientX / window.innerWidth)  * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(boardGroup.children, false);
    const hit  = hits.find(i => i.object.userData.square);
    if (hit) handleSquareClick(hit.object.userData.square);
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
            if (!wEl.value.trim() && data.nameWhite) wEl.value = data.nameWhite;
            if (!bEl.value.trim() && data.nameBlack) bEl.value = data.nameBlack;
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
    labelRenderer.render(scene, camera);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.getElementById('name-white').addEventListener('input', updateStatus);
document.getElementById('name-black').addEventListener('input', updateStatus);
window.addEventListener('click', onCanvasClick);
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

createBoard();
sync3DWithEngine();
initFirebaseAuth();
loadFromFirebase();
animate();
