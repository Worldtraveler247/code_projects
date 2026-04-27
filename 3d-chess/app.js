// --- 1. Game Logic & State ---
let game = new Chess();
let selectedSquare = null;
let pieceMeshes = [];
let tileMeshes = [];

const statusEl = document.getElementById('status');
const debugEl = document.getElementById('debug');

// --- 2. Three.js Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });

renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('canvas-container').appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0x404040, 2);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 10, 5);
scene.add(directionalLight);

// Interaction
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// --- 3. Board & Piece Generation ---
const boardGroup = new THREE.Group();
const pieceGroup = new THREE.Group();
scene.add(boardGroup);
scene.add(pieceGroup);

const COLORS = {
    BLACK: 0x2c3e50,
    WHITE: 0xecf0f1,
    HIGHLIGHT_SELECT: 0x2ecc71,
    HIGHLIGHT_MOVE: 0x3498db,
    PIECE_WHITE: 0xffffff,
    PIECE_BLACK: 0x444444
};

function createBoard() {
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const isBlack = (r + f) % 2 === 0;
            const geo = new THREE.BoxGeometry(0.95, 0.1, 0.95);
            const mat = new THREE.MeshStandardMaterial({ 
                color: isBlack ? COLORS.BLACK : COLORS.WHITE,
                transparent: true,
                opacity: 0.8
            });
            const tile = new THREE.Mesh(geo, mat);
            
            // Map 0-7 to chess coords (a1-h8)
            const square = String.fromCharCode(97 + f) + (r + 1);
            tile.userData = { square: square, originalColor: isBlack ? COLORS.BLACK : COLORS.WHITE };
            tile.position.set(f - 3.5, 0, (7 - r) - 3.5);
            
            boardGroup.add(tile);
            tileMeshes.push(tile);
        }
    }
}

function createPieceMesh(type, color) {
    const isWhite = color === 'w';
    const mat = new THREE.MeshStandardMaterial({ 
        color: isWhite ? COLORS.PIECE_WHITE : COLORS.PIECE_BLACK,
        metalness: 0.5,
        roughness: 0.2
    });
    
    let group = new THREE.Group();
    let geometry;

    switch(type) {
        case 'p': // Pawn
            geometry = new THREE.CylinderGeometry(0.2, 0.3, 0.6, 16);
            const head = new THREE.SphereGeometry(0.15, 16, 16);
            const headMesh = new THREE.Mesh(head, mat);
            headMesh.position.y = 0.4;
            group.add(headMesh);
            break;
        case 'r': // Rook
            geometry = new THREE.BoxGeometry(0.4, 0.8, 0.4);
            break;
        case 'n': // Knight
            geometry = new THREE.ConeGeometry(0.3, 0.8, 4);
            group.rotation.y = Math.PI / 4;
            break;
        case 'b': // Bishop
            geometry = new THREE.CylinderGeometry(0.1, 0.3, 0.9, 16);
            break;
        case 'q': // Queen
            geometry = new THREE.CylinderGeometry(0.2, 0.4, 1.1, 16);
            const crown = new THREE.TorusGeometry(0.15, 0.05, 8, 16);
            const crownMesh = new THREE.Mesh(crown, mat);
            crownMesh.rotation.x = Math.PI / 2;
            crownMesh.position.y = 0.6;
            group.add(crownMesh);
            break;
        case 'k': // King
            geometry = new THREE.BoxGeometry(0.4, 1.2, 0.4);
            const cross = new THREE.BoxGeometry(0.6, 0.1, 0.1);
            const crossMesh = new THREE.Mesh(cross, mat);
            crossMesh.position.y = 0.5;
            group.add(crossMesh);
            break;
    }
    
    const body = new THREE.Mesh(geometry, mat);
    body.position.y = 0.3;
    group.add(body);
    
    return group;
}

function sync3DWithEngine() {
    // Clear old pieces
    while(pieceGroup.children.length > 0) pieceGroup.remove(pieceGroup.children[0]);
    pieceMeshes = [];

    const board = game.board();
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const piece = board[r][f];
            if (piece) {
                const mesh = createPieceMesh(piece.type, piece.color);
                mesh.position.set(f - 3.5, 0, r - 3.5);
                pieceGroup.add(mesh);
            }
        }
    }
    updateStatus();
}

function updateStatus() {
    let status = '';
    let moveColor = game.turn() === 'b' ? 'Black' : 'White';

    if (game.in_checkmate()) status = `Game over, ${moveColor} is in checkmate.`;
    else if (game.in_draw()) status = 'Game over, drawn position';
    else {
        status = `${moveColor}'s Turn`;
        if (game.in_check()) status += ', ' + moveColor + ' is in check';
    }
    statusEl.innerHTML = status;
}

// --- 4. Interaction Logic ---
function onCanvasClick(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(boardGroup.children);

    if (intersects.length > 0) {
        const clickedSquare = intersects[0].object.userData.square;
        handleSquareClick(clickedSquare);
    }
}

function handleSquareClick(square) {
    // If selecting a piece
    if (!selectedSquare) {
        const piece = game.get(square);
        if (piece && piece.color === game.turn()) {
            selectedSquare = square;
            highlightLegalMoves(square);
        }
    } else {
        // Attempting a move
        const move = game.move({
            from: selectedSquare,
            to: square,
            promotion: 'q' // Always promote to queen for simplicity
        });

        if (move) {
            selectedSquare = null;
            clearHighlights();
            sync3DWithEngine();
            saveToFirebase(); // Call sync
        } else {
            // Deselect or switch selection
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
}

function highlightLegalMoves(from) {
    clearHighlights();
    const moves = game.moves({ square: from, verbose: true });
    
    // Highlight start square
    const startTile = tileMeshes.find(t => t.userData.square === from);
    if (startTile) startTile.material.color.set(COLORS.HIGHLIGHT_SELECT);

    moves.forEach(m => {
        const tile = tileMeshes.find(t => t.userData.square === m.to);
        if (tile) tile.material.color.set(COLORS.HIGHLIGHT_MOVE);
    });
    
    debugEl.innerText = `Selected ${from}. ${moves.length} valid moves.`;
}

function clearHighlights() {
    tileMeshes.forEach(t => t.material.color.set(t.userData.originalColor));
}

function resetGame() {
    game = new Chess();
    selectedSquare = null;
    clearHighlights();
    sync3DWithEngine();
    saveToFirebase();
}

// --- 5. Notification & Nudge ---
function nudgeFriend(method) {
    const friendEmail = "friend@example.com";
    const friendPhone = "1234567890";
    const turn = game.turn() === 'w' ? 'White' : 'Black';
    const message = `Chess update: It is now ${turn}'s turn. Make your move!`;

    if (method === 'email') {
        window.location.href = `mailto:${friendEmail}?subject=Your turn in Chess!&body=${message}`;
    } else if (method === 'text') {
        window.location.href = `sms:${friendPhone}?body=${message}`; 
    }
}

// --- 6. Firebase Sync ---
// Database rules in ./database.rules.json require auth != null, so we sign in anonymously
// before any read/write. All Firebase calls are guarded — they no-op until init + auth complete.
function firebaseReady() {
    return typeof firebase !== 'undefined'
        && firebase.apps.length > 0
        && typeof firebase.auth === 'function'
        && firebase.auth().currentUser !== null;
}

function initFirebaseAuth() {
    if (typeof firebase === 'undefined' || firebase.apps.length === 0) return;
    if (typeof firebase.auth !== 'function') {
        console.warn('firebase-auth library not loaded — sync disabled (rules require auth).');
        return;
    }
    firebase.auth().signInAnonymously().catch(err => {
        console.warn('Firebase anonymous sign-in failed:', err.message);
    });
}

function saveToFirebase() {
    if (!firebaseReady()) return;
    const fen = game.fen();
    firebase.database().ref('current_match').set({ fen: fen, timestamp: Date.now() });
}

function loadFromFirebase() {
    if (typeof firebase === 'undefined' || firebase.apps.length === 0) return;
    if (typeof firebase.auth !== 'function') return;
    firebase.auth().onAuthStateChanged(user => {
        if (!user) return;
        firebase.database().ref('current_match').on('value', (snapshot) => {
            const data = snapshot.val();
            if (data && data.fen && data.fen !== game.fen()) {
                game.load(data.fen);
                sync3DWithEngine();
            }
        });
    });
}

// --- 7. Animation Loop ---
function animate() {
    requestAnimationFrame(animate);
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

camera.position.set(0, 8, 8);
camera.lookAt(0, 0, 0);
