// --- 1. Game Logic Setup ---
const game = new Chess();

// --- 2. The Nudge System ---
// This uses built-in browser protocols to open your default mail/text apps
function nudgeFriend(method) {
    const friendEmail = "friend@example.com"; // Replace with friend's email
    const friendPhone = "1234567890";         // Replace with friend's number
    const message = "Hey! I made my move in our chess game. It's your turn!";

    if (method === 'email') {
        window.location.href = `mailto:${friendEmail}?subject=Your turn in Chess!&body=${message}`;
    } else if (method === 'text') {
        // sms protocol works natively on mobile devices and Mac/Windows linked to phones
        window.location.href = `sms:${friendPhone}?body=${message}`; 
    }
}

// --- 3. Three.js 3D Setup (Simplified Board) ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });

renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('canvas-container').appendChild(renderer.domElement);

// Lighting for a stylish look
const ambientLight = new THREE.AmbientLight(0x404040, 2); // Soft white light
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 10, 5);
scene.add(directionalLight);

// Generate the 3D Chess Board
const boardGroup = new THREE.Group();
const tileSize = 1;
for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
        const isBlack = (rank + file) % 2 === 0;
        const geometry = new THREE.BoxGeometry(tileSize, 0.2, tileSize);
        const material = new THREE.MeshStandardMaterial({ 
            color: isBlack ? 0x2c3e50 : 0xecf0f1,
            roughness: 0.2,
            metalness: 0.1
        });
        const tile = new THREE.Mesh(geometry, material);
        tile.position.set(file - 3.5, 0, rank - 3.5);
        boardGroup.add(tile);
    }
}
scene.add(boardGroup);

camera.position.set(0, 6, 6);
camera.lookAt(0, 0, 0);

// Render Loop
function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
animate();

// --- 4. Asynchronous State (Firebase Placeholder) ---
// To make this async, you would sync the 'game.fen()' string to Firebase.
/*
  function saveGameState() {
      const fen = game.fen(); // Gets current board state
      firebase.database().ref('match123').set({ fen: fen });
  }

  function loadGameState() {
      firebase.database().ref('match123').on('value', (snapshot) => {
          const data = snapshot.val();
          if (data && data.fen) {
              game.load(data.fen);
              update3Dpieces(); // Custom function to visually move pieces
          }
      });
  }
*/
