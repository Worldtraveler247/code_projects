const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');

// Set canvas size
canvas.width = 400;
canvas.height = 300;

// Game constants
const gravity = 0.6;
const friction = 0.8;

// Camera object
const camera = {
    x: 0,
    width: canvas.width
};

// Player object
const player = {
    x: 50,
    y: 200,
    width: 20,
    height: 20,
    speed: 4,
    velX: 0,
    velY: 0,
    jumping: false,
    grounded: false,
    color: '#ff0000',
    score: 0
};

// Platforms (A much longer world)
const platforms = [
    { x: 0, y: 280, width: 600, height: 20 },      // Starting floor
    { x: 700, y: 280, width: 500, height: 20 },    // Pit gap!
    { x: 1300, y: 240, width: 200, height: 60 },   // Big step
    { x: 1600, y: 280, width: 1000, height: 20 },  // Long stretch
    
    // Floating platforms
    { x: 150, y: 220, width: 80, height: 10 },
    { x: 300, y: 160, width: 80, height: 10 },
    { x: 750, y: 220, width: 100, height: 10 },
    { x: 950, y: 160, width: 100, height: 10 },
    { x: 1150, y: 120, width: 100, height: 10 },
    { x: 1700, y: 200, width: 60, height: 10 },
    { x: 1850, y: 140, width: 60, height: 10 },
    { x: 2000, y: 100, width: 60, height: 10 }
];

// Coins scattered through the long world
let coins = [
    { x: 170, y: 190, width: 10, height: 10, collected: false },
    { x: 320, y: 130, width: 10, height: 10, collected: false },
    { x: 800, y: 190, width: 10, height: 10, collected: false },
    { x: 1000, y: 130, width: 10, height: 10, collected: false },
    { x: 1400, y: 210, width: 10, height: 10, collected: false },
    { x: 2020, y: 70, width: 10, height: 10, collected: false }
];

// Input handling
const keys = {};
window.addEventListener('keydown', (e) => { keys[e.code] = true; });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

// Touch input
let touchLeft = false;
let touchRight = false;

document.getElementById('left-btn').addEventListener('touchstart', (e) => { e.preventDefault(); touchLeft = true; });
document.getElementById('left-btn').addEventListener('touchend', () => touchLeft = false);
document.getElementById('right-btn').addEventListener('touchstart', (e) => { e.preventDefault(); touchRight = true; });
document.getElementById('right-btn').addEventListener('touchend', () => touchRight = false);
document.getElementById('jump-btn').addEventListener('touchstart', (e) => { 
    e.preventDefault(); 
    if (!player.jumping && player.grounded) {
        player.jumping = true;
        player.grounded = false;
        player.velY = -player.speed * 2.8;
    }
});

// Click fallbacks for desktop testing
document.getElementById('left-btn').addEventListener('mousedown', () => touchLeft = true);
document.getElementById('left-btn').addEventListener('mouseup', () => touchLeft = false);
document.getElementById('right-btn').addEventListener('mousedown', () => touchRight = true);
document.getElementById('right-btn').addEventListener('mouseup', () => touchRight = false);
document.getElementById('jump-btn').addEventListener('mousedown', () => {
    if (!player.jumping && player.grounded) {
        player.jumping = true;
        player.grounded = false;
        player.velY = -player.speed * 2.8;
    }
});

function update() {
    // Movement
    if (keys['ArrowUp'] || keys['Space']) {
        if (!player.jumping && player.grounded) {
            player.jumping = true;
            player.grounded = false;
            player.velY = -player.speed * 2.8;
        }
    }
    if (keys['ArrowLeft'] || touchLeft) {
        if (player.velX > -player.speed) {
            player.velX--;
        }
    }
    if (keys['ArrowRight'] || touchRight) {
        if (player.velX < player.speed) {
            player.velX++;
        }
    }

    player.velX *= friction;
    player.velY += gravity;

    player.grounded = false;

    // Collision with platforms
    for (let i = 0; i < platforms.length; i++) {
        const plat = platforms[i];
        if (player.x < plat.x + plat.width &&
            player.x + player.width > plat.x &&
            player.y < plat.y + plat.height &&
            player.y + player.height > plat.y) {
            
            const oX = (player.x + (player.width / 2)) - (plat.x + (plat.width / 2));
            const oY = (player.y + (player.height / 2)) - (plat.y + (plat.height / 2));
            const minW = (player.width / 2) + (plat.width / 2);
            const minH = (player.height / 2) + (plat.height / 2);

            if (Math.abs(oX / plat.width) > Math.abs(oY / plat.height)) {
                if (oX > 0) {
                    player.x = plat.x + plat.width;
                } else {
                    player.x = plat.x - player.width;
                }
                player.velX = 0;
            } else {
                if (oY > 0) {
                    player.y = plat.y + plat.height;
                    player.velY = 0;
                } else {
                    player.y = plat.y - player.height;
                    player.jumping = false;
                    player.grounded = true;
                    player.velY = 0;
                }
            }
        }
    }

    if (player.grounded) {
        player.velY = 0;
    }

    player.x += player.velX;
    player.y += player.velY;

    // SCROLLING LOGIC: Keep player in the middle of the screen
    camera.x = player.x - canvas.width / 2;
    if (camera.x < 0) camera.x = 0; // Don't scroll past start

    // Pit Death
    if (player.y > canvas.height + 100) {
        player.x = 50;
        player.y = 200;
        player.velX = 0;
        player.velY = 0;
    }

    // Coin collection
    coins.forEach(coin => {
        if (!coin.collected &&
            player.x < coin.x + coin.width &&
            player.x + player.width > coin.x &&
            player.y < coin.y + coin.height &&
            player.y + player.height > coin.y) {
            coin.collected = true;
            player.score++;
            scoreElement.innerText = `Coins: ${player.score}`;
        }
    });

    draw();
    requestAnimationFrame(update);
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    // Move everything by the camera offset
    ctx.translate(-camera.x, 0);

    // Draw platforms
    ctx.fillStyle = '#8B4513';
    platforms.forEach(plat => {
        ctx.fillRect(plat.x, plat.y, plat.width, plat.height);
        // Add grass top
        ctx.fillStyle = '#228B22';
        ctx.fillRect(plat.x, plat.y, plat.width, 5);
        ctx.fillStyle = '#8B4513';
    });

    // Draw coins
    ctx.fillStyle = '#FFD700';
    coins.forEach(coin => {
        if (!coin.collected) {
            ctx.beginPath();
            ctx.arc(coin.x + 5, coin.y + 5, 5, 0, Math.PI * 2);
            ctx.fill();
        }
    });

    // Draw player
    ctx.fillStyle = player.color;
    ctx.fillRect(player.x, player.y, player.width, player.height);
    
    // Eyes for the player
    ctx.fillStyle = 'white';
    ctx.fillRect(player.x + 12, player.y + 4, 4, 4);
    ctx.fillStyle = 'black';
    ctx.fillRect(player.x + 14, player.y + 5, 2, 2);

    ctx.restore();
}

update();