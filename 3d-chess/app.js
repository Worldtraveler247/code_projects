// --- 1. Game State ---
let game = new Chess();
let selectedSquare = null;
let pieceMeshes   = [];
let tileMeshes    = [];
let isWhiteBottom = true;

const statusEl  = document.getElementById('status');
const moveLogEl = document.getElementById('move-log');

// --- 2. Three.js Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510);
scene.fog = new THREE.Fog(0x050510, 22, 40);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 9, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('canvas-container').appendChild(renderer.domElement);

// Orbit controls — drag to rotate, scroll to zoom
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.dampingFactor  = 0.08;
controls.minDistance    = 5;
controls.maxDistance    = 22;
controls.maxPolarAngle  = Math.PI / 2.1;
controls.target.set(0, 0, 0);
controls.update();

// --- 3. Lighting ---
const ambientLight = new THREE.AmbientLight(0x8090c0, 0.7);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
keyLight.position.set(4, 14, 8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far  = 30;
keyLight.shadow.camera.left = keyLight.shadow.camera.bottom = -8;
keyLight.shadow.camera.right = keyLight.shadow.camera.top   =  8;
scene.add(keyLight);

const cyanLight    = new THREE.PointLight(0x4af7ff, 0.8, 14);
cyanLight.position.set(-5, 5, -4);
scene.add(cyanLight);

const magentaLight = new THREE.PointLight(0xff4af7, 0.5, 12);
magentaLight.position.set(5, 4, 5);
scene.add(magentaLight);

// Raycaster
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();

// --- 4. Groups ---
const boardGroup = new THREE.Group();
const pieceGroup = new THREE.Group();
scene.add(boardGroup);
scene.add(pieceGroup);

// --- 5. Color palette ---
const C = {
    DARK:   0x1a2040,
    LIGHT:  0xccd8f0,
    SEL:    0x4af7ff,   // selected square
    MOVE:   0x7b2fff,   // valid move target
    CHECK:  0xe94560,   // king in check
    W_PIECE: 0xeef2ff,
    B_PIECE: 0x18183a,
    FRAME:  0x0a0e20,
};

// --- 6. Board ---
function createBoard() {
    // Outer frame
    const frameGeo = new THREE.BoxGeometry(9.6, 0.14, 9.6);
    const frameMat = new THREE.MeshStandardMaterial({ color: C.FRAME, metalness: 0.2, roughness: 0.7 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.y = -0.01;
    frame.receiveShadow = true;
    boardGroup.add(frame);

    // Thin emissive border ring
    const glowGeo = new THREE.BoxGeometry(9.6, 0.16, 9.6);
    const glowMat = new THREE.MeshStandardMaterial({
        color: 0x4af7ff, emissive: 0x4af7ff, emissiveIntensity: 0.12,
        transparent: true, opacity: 0.18,
    });
    boardGroup.add(new THREE.Mesh(glowGeo, glowMat));

    // Tiles
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const isDark = (r + f) % 2 === 0;
            const geo = new THREE.BoxGeometry(0.96, 0.1, 0.96);
            const mat = new THREE.MeshStandardMaterial({
                color:     isDark ? C.DARK : C.LIGHT,
                metalness: isDark ? 0.1 : 0.05,
                roughness: isDark ? 0.85 : 0.6,
            });
            const tile = new THREE.Mesh(geo, mat);
            // r=0 → rank 1 (z=+3.5, white side near camera)
            // r=7 → rank 8 (z=-3.5, black side far from camera)
            const square = String.fromCharCode(97 + f) + (r + 1);
            tile.userData = { square, isDark };
            tile.position.set(f - 3.5, 0, (7 - r) - 3.5);
            tile.receiveShadow = true;
            boardGroup.add(tile);
            tileMeshes.push(tile);
        }
    }
}

// --- 7. Pieces ---
// BASE_Y: top of tile is at y=0.05 (tile center y=0, half-height=0.05).
// Add a small gap so pieces sit cleanly on top.
const BASE_Y = 0.08;

// Half-heights of the body cylinder/box for each piece type
const BODY_HALF = { p: 0.275, r: 0.375, n: 0.325, b: 0.44, q: 0.525, k: 0.575 };

function makeMat(color) {
    return new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: color === C.W_PIECE ? 0.06 : 0.02,
        metalness: 0.35,
        roughness: 0.3,
    });
}

function createPieceMesh(type, color) {
    const isWhite = color === 'w';
    const mat   = makeMat(isWhite ? C.W_PIECE : C.B_PIECE);
    const group = new THREE.Group();
    let bodyGeo;

    const bh  = BODY_HALF[type]; // half-height of body
    const top = BASE_Y + bh * 2; // y of top surface of body

    switch (type) {
        case 'p': {
            bodyGeo = new THREE.CylinderGeometry(0.18, 0.25, 0.55, 16);
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), mat);
            head.position.y = top + 0.16; // sit on top of body
            head.castShadow = true;
            group.add(head);
            break;
        }
        case 'r': {
            bodyGeo = new THREE.CylinderGeometry(0.22, 0.28, 0.75, 8);
            const cap = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.2, 0.44), mat);
            cap.position.y = top + 0.1;
            cap.castShadow = true;
            group.add(cap);
            break;
        }
        case 'n': {
            bodyGeo = new THREE.CylinderGeometry(0.18, 0.26, 0.65, 16);
            const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.38, 0.22), mat);
            head.position.y = top + 0.19;
            head.rotation.x = -0.3;
            head.castShadow = true;
            group.add(head);
            break;
        }
        case 'b': {
            bodyGeo = new THREE.CylinderGeometry(0.1, 0.28, 0.88, 16);
            const tip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), mat);
            tip.position.y = top + 0.1;
            tip.castShadow = true;
            group.add(tip);
            break;
        }
        case 'q': {
            bodyGeo = new THREE.CylinderGeometry(0.18, 0.35, 1.05, 16);
            const crown = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 8, 18), mat);
            crown.rotation.x = Math.PI / 2;
            crown.position.y = top;
            crown.castShadow = true;
            group.add(crown);
            const orb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), mat);
            orb.position.y = top + 0.1;
            orb.castShadow = true;
            group.add(orb);
            break;
        }
        case 'k': {
            bodyGeo = new THREE.CylinderGeometry(0.2, 0.36, 1.15, 16);
            const cy  = top + 0.16; // cross center
            const cv  = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.1), mat);
            const ch  = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.1), mat);
            cv.position.y = cy;
            ch.position.y = cy;
            cv.castShadow = true;
            ch.castShadow = true;
            group.add(cv);
            group.add(ch);
            break;
        }
    }

    if (bodyGeo) {
        const body = new THREE.Mesh(bodyGeo, mat);
        body.position.y = BASE_Y + bh; // center of body
        body.castShadow = true;
        group.add(body);
    }

    return group;
}

// --- 8. Board Sync ---
// game.board() rows: r=0 → rank 8, r=7 → rank 1
// Tiles: createBoard r=0 → rank 1 at z=+3.5, r=7 → rank 8 at z=-3.5
// Mapping: board[r][f] piece (r=0=rank8) → tile at square = file+(8-r)
//          tile z for rank N: (N-1 counted from 0 as r_board where r_board=7-r_tile)
//          piece z = tile z = (7 - (8-r-1)) - 3.5 = r - 3.5
function sync3DWithEngine() {
    while (pieceGroup.children.length) pieceGroup.remove(pieceGroup.children[0]);
    pieceMeshes = [];

    const board = game.board();
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const piece = board[r][f];
            if (!piece) continue;
            const mesh = createPieceMesh(piece.type, piece.color);
            // r=0 in board() = rank 8 → z = 0 - 3.5 = -3.5  (far side, black home)
            // r=7 in board() = rank 1 → z = 7 - 3.5 = +3.5  (near side, white home)
            mesh.position.set(f - 3.5, 0, r - 3.5);
            pieceGroup.add(mesh);
            pieceMeshes.push(mesh);
        }
    }

    updateStatus();
    clearHighlights();
}

// --- 9. Status & Highlights ---
function updateStatus() {
    const turn = game.turn() === 'w' ? 'White' : 'Black';
    statusEl.className = '';

    if (game.in_checkmate()) {
        const winner = turn === 'White' ? 'Black' : 'White';
        statusEl.textContent = winner + ' wins — checkmate';
        statusEl.className   = 'gameover';
    } else if (game.in_draw()) {
        statusEl.textContent = 'Draw';
        statusEl.className   = 'gameover';
    } else if (game.in_check()) {
        statusEl.textContent = turn + ' is in check!';
        statusEl.className   = 'check';
        highlightKing(game.turn());
    } else {
        statusEl.textContent = turn + "'s Turn";
    }
}

function squareOfKing(color) {
    const board = game.board();
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const p = board[r][f];
            if (p && p.type === 'k' && p.color === color) {
                return String.fromCharCode(97 + f) + (8 - r);
            }
        }
    }
    return null;
}

function highlightKing(color) {
    const sq   = squareOfKing(color);
    const tile = tileMeshes.find(t => t.userData.square === sq);
    if (tile) tile.material.color.set(C.CHECK);
}

function highlightLegalMoves(from) {
    clearHighlights();
    const moves = game.moves({ square: from, verbose: true });
    const start = tileMeshes.find(t => t.userData.square === from);
    if (start) start.material.color.set(C.SEL);
    moves.forEach(m => {
        const tile = tileMeshes.find(t => t.userData.square === m.to);
        if (tile) tile.material.color.set(C.MOVE);
    });
}

function clearHighlights() {
    tileMeshes.forEach(t => {
        t.material.color.set(t.userData.isDark ? C.DARK : C.LIGHT);
    });
    if (game.in_check()) highlightKing(game.turn());
}

// --- 10. Interaction ---
function onCanvasClick(event) {
    if (event.target !== renderer.domElement) return;
    mouse.x =  (event.clientX / window.innerWidth)  * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    // Only test tiles (boardGroup children that have a square)
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
        // Reselect if clicking own piece
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

// --- 11. Controls ---
function resetGame() {
    game = new Chess();
    selectedSquare = null;
    moveLogEl.textContent = '';
    sync3DWithEngine();
    saveToFirebase();
}

function flipCamera() {
    isWhiteBottom = !isWhiteBottom;
    camera.position.set(0, 9, isWhiteBottom ? 10 : -10);
    controls.target.set(0, 0, 0);
    controls.update();
}

// --- 12. Firebase (disabled until a real project is configured) ---
function firebaseReady() {
    return typeof firebase !== 'undefined'
        && firebase.apps.length > 0
        && typeof firebase.auth === 'function'
        && firebase.auth().currentUser !== null;
}

function initFirebaseAuth() {
    if (typeof firebase === 'undefined' || firebase.apps.length === 0) return;
    if (typeof firebase.auth !== 'function') {
        console.warn('firebase-auth not loaded — sync disabled.');
        return;
    }
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

// --- 13. Animation Loop ---
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    // Subtle neon pulse on accent lights
    const t = Date.now() * 0.001;
    cyanLight.intensity    = 0.7 + Math.sin(t * 0.7)       * 0.15;
    magentaLight.intensity = 0.4 + Math.sin(t * 0.5 + 1.2) * 0.1;
    renderer.render(scene, camera);
}

// --- Init ---
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
