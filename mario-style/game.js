const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');

// Set canvas size
canvas.width = 400;
canvas.height = 300;

// Game constants
const gravity = 0.8;
const friction = 0.8;

// Player object
const player = {
    x: 50,
    y: 200,
    width: 20,
    height: 20,
    speed: 5,
    velX: 0,
    velY: 0,
    jumping: false,
    grounded: false,
    color: '#ff0000', // Mario Red
    score: 0
};

// Platforms
const platforms = [
    { x: 0, y: 280, width: 400, height: 20 }, // Floor
    { x: 100, y: 230, width: 80, height: 10 },
    { x: 250, y: 180, width: 80, height: 10 },
    { x: 150, y: 120, width: 80, height: 10 }
];

// Coins
let coins = [
    { x: 130, y: 200, width: 10, height: 10, collected: false },
    { x: 280, y: 150, width: 10, height: 10, collected: false },
    { x: 180, y: 90, width: 10, height: 10, collected: false }
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
        player.velY = -player.speed * 2.5;
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
        player.velY = -player.speed * 2.5;
    }
});

function update() {
    // Movement
    if (keys['ArrowUp'] || keys['Space']) {
        if (!player.jumping && player.grounded) {
            player.jumping = true;
            player.grounded = false;
            player.velY = -player.speed * 2.5;
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
            
            // Check where we hit the platform
            const oX = (player.x + (player.width / 2)) - (plat.x + (plat.width / 2));
            const oY = (player.y + (player.height / 2)) - (plat.y + (plat.height / 2));
            const minW = (player.width / 2) + (plat.width / 2);
            const minH = (player.height / 2) + (plat.height / 2);

            if (Math.abs(oX) / plat.width > Math.abs(oY) / plat.height) {
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

    // World bounds
    if (player.x >= canvas.width - player.width) {
        player.x = canvas.width - player.width;
    } else if (player.x <= 0) {
        player.x = 0;
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

    // Draw platforms
    ctx.fillStyle = '#8B4513'; // Brown ground
    platforms.forEach(plat => {
        ctx.fillRect(plat.x, plat.y, plat.width, plat.height);
    });

    // Draw coins
    ctx.fillStyle = '#FFD700'; // Gold
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
}

update();