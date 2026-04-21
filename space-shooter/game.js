/** @type {HTMLCanvasElement} */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game Constants
const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 600;
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

const KEYS = {};
window.addEventListener('keydown', (e) => KEYS[e.code] = true);
window.addEventListener('keyup', (e) => KEYS[e.code] = false);

// Game State
let gameState = 'START'; // START, PLAYING, GAMEOVER
let score = 0;
let level = 1;
let enemiesDefeated = 0;
let lastTime = 0;
let bossSpawned = false;

// UI Elements
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over');
const scoreEl = document.getElementById('score');
const finalScoreEl = document.getElementById('final-score');
const levelEl = document.getElementById('level');
const healthBar = document.getElementById('health-bar');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');

// Classes
class Player {
    constructor() {
        this.width = 50;
        this.height = 30;
        this.x = 50;
        this.y = CANVAS_HEIGHT / 2 - this.height / 2;
        this.speed = 5;
        this.health = 100;
        this.maxHealth = 100;
        this.color = '#00f2ff';
        this.lastShot = 0;
        this.shotDelay = 200; // ms
        this.powerUpType = null;
        this.powerUpTimer = 0;
    }

    update(deltaTime) {
        if (KEYS['ArrowUp'] || KEYS['KeyW']) this.y -= this.speed;
        if (KEYS['ArrowDown'] || KEYS['KeyS']) this.y += this.speed;
        if (KEYS['ArrowLeft'] || KEYS['KeyA']) this.x -= this.speed;
        if (KEYS['ArrowRight'] || KEYS['KeyD']) this.x += this.speed;

        // Boundaries
        this.x = Math.max(0, Math.min(CANVAS_WIDTH - this.width, this.x));
        this.y = Math.max(0, Math.min(CANVAS_HEIGHT - this.height, this.y));

        // Shooting
        if (KEYS['Space'] && Date.now() - this.lastShot > this.shotDelay) {
            this.shoot();
            this.lastShot = Date.now();
        }

        if (this.powerUpTimer > 0) {
            this.powerUpTimer -= deltaTime;
            if (this.powerUpTimer <= 0) this.powerUpType = null;
        }
    }

    shoot() {
        if (this.powerUpType === 'TRIPLE') {
            projectiles.push(new Projectile(this.x + this.width, this.y + this.height / 2, 8, 0, this.color));
            projectiles.push(new Projectile(this.x + this.width, this.y + this.height / 2, 8, -2, this.color));
            projectiles.push(new Projectile(this.x + this.width, this.y + this.height / 2, 8, 2, this.color));
        } else {
            projectiles.push(new Projectile(this.x + this.width, this.y + this.height / 2, 8, 0, this.color));
        }
    }

    draw() {
        ctx.fillStyle = this.color;
        // Simple ship shape
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x + this.width, this.y + this.height / 2);
        ctx.lineTo(this.x, this.y + this.height);
        ctx.closePath();
        ctx.fill();

        // Glow
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Shield indicator
        if (this.powerUpType === 'SHIELD') {
            ctx.strokeStyle = '#fff';
            ctx.beginPath();
            ctx.arc(this.x + this.width / 2, this.y + this.height / 2, 40, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    takeDamage(amount) {
        if (this.powerUpType === 'SHIELD') {
            this.powerUpType = null;
            this.powerUpTimer = 0;
            return;
        }
        this.health -= amount;
        healthBar.style.width = `${(this.health / this.maxHealth) * 100}%`;
        if (this.health <= 0) {
            endGame();
        }
    }
}

class Projectile {
    constructor(x, y, vx, vy, color) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.radius = 4;
        this.color = color;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
    }

    draw() {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

class Enemy {
    constructor(x, y, speed, health, type = 'BASIC') {
        this.x = x;
        this.y = y;
        this.width = 40;
        this.height = 40;
        this.speed = speed;
        this.health = health;
        this.type = type;
        this.color = type === 'BASIC' ? '#ff3333' : '#ff9900';
    }

    update() {
        this.x -= this.speed;
        if (this.type === 'SINE') {
            this.y += Math.sin(this.x / 50) * 3;
        }
    }

    draw() {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.width, this.height);
        
        // Add "eyes" to make them look like ships
        ctx.fillStyle = 'black';
        ctx.fillRect(this.x + 5, this.y + 10, 10, 5);
        ctx.fillRect(this.x + 5, this.y + 25, 10, 5);
    }
}

class Boss {
    constructor() {
        this.width = 120;
        this.height = 200;
        this.x = CANVAS_WIDTH + 100;
        this.y = CANVAS_HEIGHT / 2 - this.height / 2;
        this.speed = 2;
        this.health = 500;
        this.maxHealth = 500;
        this.color = '#ff00ff';
        this.lastShot = 0;
        this.shotDelay = 1000;
        this.direction = 1;
    }

    update() {
        // Move into view
        if (this.x > CANVAS_WIDTH - 200) {
            this.x -= this.speed;
        } else {
            // Move up and down
            this.y += this.speed * this.direction;
            if (this.y <= 50 || this.y >= CANVAS_HEIGHT - this.height - 50) {
                this.direction *= -1;
            }

            // Shoot
            if (Date.now() - this.lastShot > this.shotDelay) {
                this.shoot();
                this.lastShot = Date.now();
            }
        }
    }

    shoot() {
        for (let i = -2; i <= 2; i++) {
            projectiles.push(new Projectile(this.x, this.y + this.height / 2, -5, i * 2, this.color));
        }
    }

    draw() {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.width, this.height);
        
        // Boss health bar
        ctx.fillStyle = 'red';
        ctx.fillRect(this.x, this.y - 20, this.width * (this.health / this.maxHealth), 10);
    }
}

class PowerUp {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.radius = 15;
        this.type = type; // TRIPLE, SHIELD, REPAIR
        this.speed = 2;
    }

    update() {
        this.x -= this.speed;
    }

    draw() {
        ctx.strokeStyle = this.type === 'REPAIR' ? '#00ff00' : (this.type === 'SHIELD' ? '#ffffff' : '#ffff00');
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillText(this.type[0], this.x - 4, this.y + 4);
    }
}

// Game Objects
let player;
let projectiles = [];
let enemies = [];
let powerUps = [];
let boss = null;
let enemySpawnTimer = 0;

function init() {
    player = new Player();
    projectiles = [];
    enemies = [];
    powerUps = [];
    boss = null;
    score = 0;
    level = 1;
    enemiesDefeated = 0;
    bossSpawned = false;
    updateUI();
}

function updateUI() {
    scoreEl.innerText = `Score: ${score}`;
    levelEl.innerText = `Level: ${level}`;
}

function spawnEnemy() {
    const y = Math.random() * (CANVAS_HEIGHT - 40);
    const speed = 2 + level * 0.5;
    const type = Math.random() > 0.7 ? 'SINE' : 'BASIC';
    enemies.push(new Enemy(CANVAS_WIDTH, y, speed, 1, type));
}

function checkCollisions() {
    // Projectiles vs Enemies
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        
        // If projectile is from player (vx > 0)
        if (p.vx > 0) {
            // Check enemies
            for (let j = enemies.length - 1; j >= 0; j--) {
                const e = enemies[j];
                if (p.x > e.x && p.x < e.x + e.width && p.y > e.y && p.y < e.y + e.height) {
                    projectiles.splice(i, 1);
                    enemies.splice(j, 1);
                    score += 100;
                    enemiesDefeated++;
                    updateUI();
                    
                    // Drop powerup
                    if (Math.random() > 0.9) {
                        const types = ['TRIPLE', 'SHIELD', 'REPAIR'];
                        powerUps.push(new PowerUp(e.x, e.y, types[Math.floor(Math.random() * types.length)]));
                    }
                    break;
                }
            }

            // Check Boss
            if (boss && p.x > boss.x && p.x < boss.x + boss.width && p.y > boss.y && p.y < boss.y + boss.height) {
                projectiles.splice(i, 1);
                boss.health -= 10;
                if (boss.health <= 0) {
                    score += 5000;
                    boss = null;
                    level++;
                    enemiesDefeated = 0;
                    bossSpawned = false;
                    updateUI();
                }
            }
        } else {
            // Projectile is from enemy/boss, check player
            const dist = Math.hypot(p.x - (player.x + player.width / 2), p.y - (player.y + player.height / 2));
            if (dist < 20) {
                projectiles.splice(i, 1);
                player.takeDamage(10);
            }
        }
    }

    // Player vs Enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (player.x < e.x + e.width && player.x + player.width > e.x && player.y < e.y + e.height && player.y + player.height > e.y) {
            enemies.splice(i, 1);
            player.takeDamage(20);
        }
    }

    // Player vs PowerUps
    for (let i = powerUps.length - 1; i >= 0; i--) {
        const pu = powerUps[i];
        const dist = Math.hypot(pu.x - (player.x + player.width / 2), pu.y - (player.y + player.height / 2));
        if (dist < 30) {
            applyPowerUp(pu.type);
            powerUps.splice(i, 1);
        }
    }
}

function applyPowerUp(type) {
    if (type === 'REPAIR') {
        player.health = Math.min(player.maxHealth, player.health + 30);
        healthBar.style.width = `${(player.health / player.maxHealth) * 100}%`;
    } else {
        player.powerUpType = type;
        player.powerUpTimer = 10000; // 10 seconds
    }
}

function gameLoop(timestamp) {
    const deltaTime = timestamp - lastTime;
    lastTime = timestamp;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (gameState === 'PLAYING') {
        player.update(deltaTime);
        player.draw();

        // Spawn logic
        if (!boss) {
            enemySpawnTimer += deltaTime;
            if (enemySpawnTimer > 1500 - (level * 100)) {
                spawnEnemy();
                enemySpawnTimer = 0;
            }

            if (enemiesDefeated >= 10 && !bossSpawned) {
                boss = new Boss();
                bossSpawned = true;
            }
        }

        // Update & Draw Projectiles
        for (let i = projectiles.length - 1; i >= 0; i--) {
            projectiles[i].update();
            projectiles[i].draw();
            if (projectiles[i].x < 0 || projectiles[i].x > CANVAS_WIDTH) projectiles.splice(i, 1);
        }

        // Update & Draw Enemies
        for (let i = enemies.length - 1; i >= 0; i--) {
            enemies[i].update();
            enemies[i].draw();
            if (enemies[i].x < -50) enemies.splice(i, 1);
        }

        // Update & Draw PowerUps
        for (let i = powerUps.length - 1; i >= 0; i--) {
            powerUps[i].update();
            powerUps[i].draw();
            if (powerUps[i].x < -50) powerUps.splice(i, 1);
        }

        // Update & Draw Boss
        if (boss) {
            boss.update();
            boss.draw();
        }

        checkCollisions();
    }

    requestAnimationFrame(gameLoop);
}

function startGame() {
    init();
    gameState = 'PLAYING';
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
}

function endGame() {
    gameState = 'GAMEOVER';
    gameOverScreen.classList.remove('hidden');
    finalScoreEl.innerText = score;
}

startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);

requestAnimationFrame(gameLoop);
