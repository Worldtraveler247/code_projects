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
scene.background = new THREE.Color(0x080604);
scene.fog = new THREE.FogExp2(0x080604, 0.028);

const camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 10, 11);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
renderer.outputEncoding    = THREE.sRGBEncoding;
renderer.toneMapping       = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
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

// ─── Lighting — warm Roman torchlight ────────────────────────────────────────
const ambient = new THREE.AmbientLight(0xfff3d0, 0.5);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffd080, 1.5);
keyLight.position.set(5, 14, 8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left   = keyLight.shadow.camera.bottom = -10;
keyLight.shadow.camera.right  = keyLight.shadow.camera.top   =  10;
keyLight.shadow.camera.near   = 1;
keyLight.shadow.camera.far    = 30;
keyLight.shadow.bias          = -0.001;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xff9955, 0.28);
fillLight.position.set(-5, 6, -5);
scene.add(fillLight);

// Two flickering torches
const torch1 = new THREE.PointLight(0xffaa44, 1.2, 18);
torch1.position.set(-7.5, 5, 1);
scene.add(torch1);

const torch2 = new THREE.PointLight(0xff9933, 0.9, 16);
torch2.position.set(7, 4, -1);
scene.add(torch2);

// Subtle rim light from below
const rimLight = new THREE.PointLight(0xffcc66, 0.25, 10);
rimLight.position.set(0, -3, 0);
scene.add(rimLight);

// ─── Raycaster ────────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();

// ─── Groups ───────────────────────────────────────────────────────────────────
const boardGroup = new THREE.Group();
const pieceGroup = new THREE.Group();
scene.add(boardGroup, pieceGroup);

// ─── Procedural marble texture ────────────────────────────────────────────────
function drawVein(ctx, w, h, color, lw, alpha) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth   = lw;
    ctx.globalAlpha = alpha;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    // Start from a random point near an edge
    let x = Math.random() * w;
    let y = Math.random() < 0.5 ? 0 : h;
    ctx.moveTo(x, y);

    const steps = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < steps; i++) {
        const nx  = x + (Math.random() - 0.42) * w * 0.55;
        const ny  = y + (Math.random() - 0.42) * h * 0.55;
        const cpx = (x + nx) / 2 + (Math.random() - 0.5) * 100;
        const cpy = (y + ny) / 2 + (Math.random() - 0.5) * 100;
        ctx.quadraticCurveTo(cpx, cpy, nx, ny);
        x = nx; y = ny;
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
}

function makeMarbleTex(baseCss, vein1, vein2, w = 512, h = 512) {
    const cv  = document.createElement('canvas');
    cv.width  = w; cv.height = h;
    const ctx = cv.getContext('2d');

    // Base fill
    ctx.fillStyle = baseCss;
    ctx.fillRect(0, 0, w, h);

    // Subtle gradient overlay for depth
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0,   'rgba(255,255,255,0.06)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.04)');
    g.addColorStop(1,   'rgba(255,255,255,0.04)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Primary veins
    for (let i = 0; i < 7;  i++) drawVein(ctx, w, h, vein1, 1.6 + Math.random(), 0.18 + Math.random() * 0.14);
    // Fine veins
    for (let i = 0; i < 18; i++) drawVein(ctx, w, h, vein2, 0.4 + Math.random() * 0.9, 0.06 + Math.random() * 0.09);

    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

// Carrara white marble (light squares)
const lightTex = makeMarbleTex('#e8dece', '#c0b09a', '#b8a890');
// Verde antico / dark marble (dark squares)
const darkTex  = makeMarbleTex('#283530', '#3a4e42', '#2e4038');

// ─── Shared piece materials ───────────────────────────────────────────────────
const W_MAT   = new THREE.MeshStandardMaterial({ color: 0xf0e6d2, roughness: 0.22, metalness: 0.0 });
const B_MAT   = new THREE.MeshStandardMaterial({ color: 0x1a1820, roughness: 0.20, metalness: 0.06 });
const GOLD_MAT = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.28, metalness: 0.85, emissive: 0x7a5800, emissiveIntensity: 0.08 });

// ─── Highlight colors ─────────────────────────────────────────────────────────
const C = {
    SEL:   0xe8c840,  // selected square — gold
    MOVE:  0x7aaa60,  // valid move — sage green
    CHECK: 0xcc3333,  // check — deep red
};

// ─── Board ────────────────────────────────────────────────────────────────────
function createBoard() {
    // Stone pedestal
    const pedMat = new THREE.MeshStandardMaterial({ color: 0x221c14, roughness: 0.9, metalness: 0.05 });
    const ped = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.4, 10.6), pedMat);
    ped.position.y = -0.25;
    ped.receiveShadow = true;
    boardGroup.add(ped);

    // Dark stone frame
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2e2418, roughness: 0.8, metalness: 0.05 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(10.0, 0.16, 10.0), frameMat);
    frame.position.y = -0.02;
    frame.receiveShadow = true;
    boardGroup.add(frame);

    // Thin gold inlay stripe around board edge
    const inlayMat = new THREE.MeshStandardMaterial({
        color: 0xc9a227, emissive: 0xc9a227, emissiveIntensity: 0.12,
        transparent: true, opacity: 0.3, roughness: 0.3, metalness: 0.9,
    });
    boardGroup.add(new THREE.Mesh(new THREE.BoxGeometry(10.0, 0.18, 10.0), inlayMat));

    // 64 marble tiles — each gets its own material for independent highlighting
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const isDark  = (r + f) % 2 === 0;
            const geo     = new THREE.BoxGeometry(0.96, 0.14, 0.96);
            const mat     = new THREE.MeshStandardMaterial({
                map:      isDark ? darkTex : lightTex,
                roughness: isDark ? 0.32 : 0.28,
                metalness: 0,
            });
            const tile    = new THREE.Mesh(geo, mat);
            const square  = String.fromCharCode(97 + f) + (r + 1);
            tile.userData = { square, isDark };
            tile.position.set(f - 3.5, 0, (7 - r) - 3.5);
            tile.receiveShadow = true;
            boardGroup.add(tile);
            tileMeshes.push(tile);
        }
    }
}

// ─── Piece profiles (LatheGeometry — same math as a woodworking lathe) ────────
// Each entry is an array of [radius, height] pairs traced from base to top.
function v2(r, y) { return new THREE.Vector2(r, y); }
const SEGS = 32; // radial segments — higher = smoother

const PROFILES = {
    p: [ // Pawn — round dome head on tapered column
        v2(0, 0),      v2(0.24, 0),    v2(0.28, 0.042), v2(0.26, 0.085),
        v2(0.17, 0.12),v2(0.12, 0.23), v2(0.11, 0.31),  v2(0.12, 0.38),
        v2(0.18, 0.47),v2(0.20, 0.53), v2(0.19, 0.60),  v2(0.13, 0.67),
        v2(0.03, 0.70),v2(0, 0.70),
    ],
    r: [ // Rook body (battlements added as separate geometry)
        v2(0, 0),      v2(0.26, 0),    v2(0.30, 0.042), v2(0.28, 0.085),
        v2(0.20, 0.14),v2(0.18, 0.56), v2(0.22, 0.63),  v2(0.23, 0.80),
    ],
    n: [ // Knight base (head added separately)
        v2(0, 0),      v2(0.26, 0),    v2(0.30, 0.042), v2(0.28, 0.085),
        v2(0.20, 0.14),v2(0.15, 0.36), v2(0.13, 0.52),
    ],
    b: [ // Bishop — tall tapered mitre
        v2(0, 0),      v2(0.26, 0),    v2(0.30, 0.042), v2(0.28, 0.085),
        v2(0.18, 0.14),v2(0.12, 0.36), v2(0.09, 0.58),  v2(0.11, 0.73),
        v2(0.13, 0.79),v2(0.11, 0.87), v2(0.07, 0.97),  v2(0.03, 1.07),
        v2(0, 1.09),
    ],
    q: [ // Queen — wide waist, flared crown
        v2(0, 0),      v2(0.28, 0),    v2(0.32, 0.042), v2(0.30, 0.085),
        v2(0.20, 0.14),v2(0.14, 0.39), v2(0.11, 0.59),  v2(0.16, 0.69),
        v2(0.22, 0.77),v2(0.20, 0.87), v2(0.14, 0.97),  v2(0.10, 1.04),
        v2(0, 1.06),
    ],
    k: [ // King — tallest, receives cross ornament
        v2(0, 0),      v2(0.30, 0),    v2(0.34, 0.042), v2(0.32, 0.085),
        v2(0.22, 0.14),v2(0.15, 0.41), v2(0.12, 0.63),  v2(0.18, 0.73),
        v2(0.24, 0.83),v2(0.22, 0.95), v2(0.16, 1.05),  v2(0.12, 1.13),
    ],
};

// Pieces sit 0.10 above y=0 so they clear the tile surface (tile top ≈ 0.07)
const BASE_Y = 0.10;

function createPieceMesh(type, color) {
    const isWhite = color === 'w';
    const mat     = isWhite ? W_MAT : B_MAT;
    const group   = new THREE.Group();

    function mesh(geo, m) {
        const o = new THREE.Mesh(geo, m || mat);
        o.castShadow = true;
        return o;
    }

    switch (type) {

        case 'p': {
            const body = mesh(new THREE.LatheGeometry(PROFILES.p, SEGS));
            body.position.y = BASE_Y;
            group.add(body);
            break;
        }

        case 'b': {
            const body = mesh(new THREE.LatheGeometry(PROFILES.b, SEGS));
            body.position.y = BASE_Y;
            // Small gold band on bishop's mitre
            const band = mesh(new THREE.TorusGeometry(0.12, 0.025, 8, 24), GOLD_MAT);
            band.rotation.x = Math.PI / 2;
            band.position.y = BASE_Y + 0.79;
            group.add(body, band);
            break;
        }

        case 'r': {
            const body = mesh(new THREE.LatheGeometry(PROFILES.r, SEGS));
            body.position.y = BASE_Y;
            group.add(body);
            // Four battlements at compass points
            const topY    = BASE_Y + 0.80;
            const bW = 0.13, bH = 0.16;
            [[-0.10, -0.10], [0.10, -0.10], [-0.10, 0.10], [0.10, 0.10]].forEach(([dx, dz]) => {
                const t = mesh(new THREE.BoxGeometry(bW, bH, bW));
                t.position.set(dx, topY + bH / 2, dz);
                group.add(t);
            });
            // Gold rim between shaft and battlements
            const rim = mesh(new THREE.TorusGeometry(0.22, 0.02, 8, 24), GOLD_MAT);
            rim.rotation.x = Math.PI / 2;
            rim.position.y = BASE_Y + 0.63;
            group.add(rim);
            break;
        }

        case 'n': {
            // Classical lathe base
            const base = mesh(new THREE.LatheGeometry(PROFILES.n, SEGS));
            base.position.y = BASE_Y;
            group.add(base);
            // Horse head built from tapered boxes
            const neckY  = BASE_Y + 0.52;
            const neck   = mesh(new THREE.BoxGeometry(0.20, 0.30, 0.16));
            const snout  = mesh(new THREE.BoxGeometry(0.24, 0.16, 0.14));
            const poll   = mesh(new THREE.BoxGeometry(0.16, 0.10, 0.10));  // top of head
            neck.position.set(0,     neckY + 0.14, 0.02);
            snout.position.set(0.05, neckY + 0.22, 0.06);
            poll.position.set(0,     neckY + 0.30, -0.03);
            neck.rotation.x   = -0.22;
            snout.rotation.x  = -0.28;
            group.add(base, neck, snout, poll);
            break;
        }

        case 'q': {
            const body = mesh(new THREE.LatheGeometry(PROFILES.q, SEGS));
            body.position.y = BASE_Y;
            // Gold crown ring
            const crown = mesh(new THREE.TorusGeometry(0.175, 0.042, 8, 28), GOLD_MAT);
            crown.rotation.x = Math.PI / 2;
            crown.position.y = BASE_Y + 1.06;
            // Crown orb
            const orb = mesh(new THREE.SphereGeometry(0.075, 16, 12), GOLD_MAT);
            orb.position.y = BASE_Y + 1.06 + 0.12;
            group.add(body, crown, orb);
            break;
        }

        case 'k': {
            const body = mesh(new THREE.LatheGeometry(PROFILES.k, SEGS));
            body.position.y = BASE_Y;
            // Gold cross on top
            const crossY = BASE_Y + 1.13 + 0.15;
            const cv = mesh(new THREE.BoxGeometry(0.08, 0.30, 0.08), GOLD_MAT);
            const ch = mesh(new THREE.BoxGeometry(0.26, 0.08, 0.08), GOLD_MAT);
            cv.position.y = crossY;
            ch.position.y = crossY + 0.06;
            // Base cross in piece color slightly larger for depth
            const cvB = mesh(new THREE.BoxGeometry(0.10, 0.32, 0.10));
            const chB = mesh(new THREE.BoxGeometry(0.28, 0.10, 0.10));
            cvB.position.y = crossY;
            chB.position.y = crossY + 0.06;
            group.add(body, cvB, chB, cv, ch);
            break;
        }
    }

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
function updateStatus() {
    const turn = game.turn() === 'w' ? 'White' : 'Black';
    statusEl.className = '';

    if (game.in_checkmate()) {
        statusEl.textContent = (turn === 'White' ? 'Black' : 'White') + ' wins — checkmate';
        statusEl.className   = 'gameover';
    } else if (game.in_draw()) {
        statusEl.textContent = 'Draw';
        statusEl.className   = 'gameover';
    } else if (game.in_check()) {
        statusEl.textContent = turn + ' is in check';
        statusEl.className   = 'check';
        highlightKing(game.turn());
    } else {
        statusEl.textContent = turn + "'s Turn";
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
    // Reset all tiles to their natural marble color (no tint — map shows true)
    tileMeshes.forEach(t => t.material.color.setHex(0xffffff));
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
    firebase.database().ref('current_match').set({ fen: game.fen(), timestamp: Date.now() });
}
function loadFromFirebase() {
    if (typeof firebase === 'undefined' || firebase.apps.length === 0) return;
    if (typeof firebase.auth !== 'function') return;
    firebase.auth().onAuthStateChanged(user => {
        if (!user) return;
        firebase.database().ref('current_match').on('value', snap => {
            const data = snap.val();
            if (data && data.fen && data.fen !== game.fen()) {
                game.load(data.fen);
                sync3DWithEngine();
            }
        });
    });
}

// ─── Animation ────────────────────────────────────────────────────────────────
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    // Torch flicker — layered sine waves for organic feel
    const t = Date.now() * 0.001;
    torch1.intensity = 1.15 + Math.sin(t * 3.1) * 0.20 + Math.sin(t * 7.4) * 0.08;
    torch2.intensity = 0.90 + Math.sin(t * 2.6 + 1.2) * 0.16 + Math.sin(t * 6.1) * 0.06;
    renderer.render(scene, camera);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('click', onCanvasClick);
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

createBoard();
sync3DWithEngine();
initFirebaseAuth();
loadFromFirebase();
animate();
