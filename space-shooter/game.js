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
let screenShake = 0;

// UI Elements
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over');
const scoreEl = document.getElementById('score');
const finalScoreEl = document.getElementById('final-score');
const levelEl = document.getElementById('level');
const healthBar = document.getElementById('health-bar');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');

// Visual Classes
class Star {
    constructor(speedMult) {
        this.x = Math.random() * CANVAS_WIDTH;
        this.y = Math.random() * CANVAS_HEIGHT;
        this.size = Math.random() * 2 + 0.5;
        this.speed = (Math.random() * 2 + 1) * speedMult;
        this.color = `rgba(255, 255, 255, ${Math.random() * 0.5 + 0.2})`;
    }

    update() {
        this.x -= this.speed;
        if (this.x < 0) {
            this.x = CANVAS_WIDTH;
            this.y = Math.random() * CANVAS_HEIGHT;
        }
    }

    draw() {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

class Particle {
    constructor(x, y, color, speedScale = 1) {
        this.x = x;
        this.y = y;
        this.color = color;
        const angle = Math.random() * Math.PI * 2;
        const force = (Math.random() * 5 + 2) * speedScale;
        this.vx = Math.cos(angle) * force;
        this.vy = Math.sin(angle) * force;
        this.life = 1.0;
        this.decay = Math.random() * 0.02 + 0.01;
        this.size = Math.random() * 3 + 1;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
    }

    draw() {
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.fillRect(this.x, this.y, this.size, this.size);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
    }
}

class Player {
    constructor() {
        this.width = 60;
        this.height = 40;
        this.x = 50;
        this.y = CANVAS_HEIGHT / 2 - this.height / 2;
        this.speed = 6;
        this.health = 100;
        this.maxHealth = 100;
        this.color = '#00f2ff';
        this.lastShot = 0;
        this.shotDelay = 180;
        this.powerUpType = null;
        this.powerUpTimer = 0;
        this.enginePulse = 0;
    }

    update(deltaTime) {
        if (KEYS['ArrowUp'] || KEYS['KeyW']) this.y -= this.speed;
        if (KEYS['ArrowDown'] || KEYS['KeyS']) this.y += this.speed;
        if (KEYS['ArrowLeft'] || KEYS['KeyA']) this.x -= this.speed;
        if (KEYS['ArrowRight'] || KEYS['KeyD']) this.x += this.speed;

        this.x = Math.max(0, Math.min(CANVAS_WIDTH - this.width, this.x));
        this.y = Math.max(0, Math.min(CANVAS_HEIGHT - this.height, this.y));

        if (KEYS['Space'] && Date.now() - this.lastShot > this.shotDelay) {
            this.shoot();
            this.lastShot = Date.now();
        }

        if (this.powerUpTimer > 0) {
            this.powerUpTimer -= deltaTime;
            if (this.powerUpTimer <= 0) this.powerUpType = null;
        }

        // Engine particles
        this.enginePulse += 0.2;
        if (Math.random() > 0.3) {
            particles.push(new Particle(this.x, this.y + this.height / 2, '#ffaa00', 0.5));
        }
    }

    shoot() {
        const color = this.powerUpType === 'TRIPLE' ? '#ffff00' : this.color;
        if (this.powerUpType === 'TRIPLE') {
            projectiles.push(new Projectile(this.x + this.width, this.y + this.height / 2, 10, 0, color));
            projectiles.push(new Projectile(this.x + this.width, this.y + this.height / 2, 10, -2, color));
            projectiles.push(new Projectile(this.x + this.width, this.y + this.height / 2, 10, 2, color));
        } else {
            projectiles.push(new Projectile(this.x + this.width, this.y + this.height / 2, 10, 0, color));
        }
    }

    draw() {
        ctx.save();
        ctx.shadowBlur = 15;
        ctx.shadowColor = this.color;
        
        // Ship Body (Vector Style)
        ctx.fillStyle = '#111';
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 2;
        
        ctx.beginPath();
        ctx.moveTo(this.x, this.y + 10);
        ctx.lineTo(this.x + 20, this.y + 10);
        ctx.lineTo(this.x + 30, this.y);
        ctx.lineTo(this.x + 60, this.y + 20); // Tip
        ctx.lineTo(this.x + 30, this.y + 40);
        ctx.lineTo(this.x + 20, this.y + 30);
        ctx.lineTo(this.x, this.y + 30);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Cockpit
        ctx.fillStyle = 'rgba(0, 242, 255, 0.3)';
        ctx.beginPath();
        ctx.moveTo(this.x + 25, this.y + 15);
        ctx.lineTo(this.x + 45, this.y + 20);
        ctx.lineTo(this.x + 25, this.y + 25);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (this.powerUpType === 'SHIELD') {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.arc(this.x + 30, this.y + 20, 45, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.restore();
    }

    takeDamage(amount) {
        if (this.powerUpType === 'SHIELD') {
            createExplosion(this.x + 30, this.y + 20, '#fff', 15);
            this.powerUpType = null;
            this.powerUpTimer = 0;
            return;
        }
        this.health -= amount;
        screenShake = 15;
        createExplosion(this.x + 30, this.y + 20, this.color, 10);
        healthBar.style.width = `${(this.health / this.maxHealth) * 100}%`;
        if (this.health <= 0) endGame();
    }
}

class Projectile {
    constructor(x, y, vx, vy, color) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.width = 15;
        this.height = 4;
        this.color = color;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
    }

    draw() {
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.fillRect(this.x, this.y - this.height / 2, this.width, this.height);
        ctx.shadowBlur = 0;
    }
}

class Enemy {
    constructor(x, y, speed, health, type = 'BASIC') {
        this.x = x;
        this.y = y;
        this.width = 45;
        this.height = 35;
        this.speed = speed;
        this.health = health;
        this.type = type;
        this.color = type === 'BASIC' ? '#ff3366' : '#ffcc00';
    }

    update() {
        this.x -= this.speed;
        if (this.type === 'SINE') {
            this.y += Math.sin(this.x / 50) * 4;
        }
    }

    draw() {
        ctx.save();
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.fillStyle = '#222';
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(this.x + this.width, this.y + this.height / 2);
        ctx.lineTo(this.x + this.width - 15, this.y);
        ctx.lineTo(this.x, this.y + 5);
        ctx.lineTo(this.x + 10, this.y + this.height / 2);
        ctx.lineTo(this.x, this.y + this.height - 5);
        ctx.lineTo(this.x + this.width - 15, this.y + this.height);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }
}

class Boss {
    constructor() {
        this.width = 150;
        this.height = 250;
        this.x = CANVAS_WIDTH + 100;
        this.y = CANVAS_HEIGHT / 2 - this.height / 2;
        this.speed = 1.5;
        this.health = 800;
        this.maxHealth = 800;
        this.color = '#ff00ff';
        this.lastShot = 0;
        this.shotDelay = 800;
        this.direction = 1;
    }

    update() {
        if (this.x > CANVAS_WIDTH - 200) {
            this.x -= this.speed;
        } else {
            this.y += this.speed * this.direction;
            if (this.y <= 50 || this.y >= CANVAS_HEIGHT - this.height - 50) this.direction *= -1;

            if (Date.now() - this.lastShot > this.shotDelay) {
                this.shoot();
                this.lastShot = Date.now();
            }
        }
    }

    shoot() {
        for (let i = -3; i <= 3; i++) {
            projectiles.push(new Projectile(this.x, this.y + this.height / 2, -6, i * 1.5, this.color));
        }
    }

    draw() {
        ctx.save();
        ctx.shadowBlur = 20;
        ctx.shadowColor = this.color;
        ctx.fillStyle = '#111';
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(this.x + this.width, this.y + 20);
        ctx.lineTo(this.x + 30, this.y);
        ctx.lineTo(this.x, this.y + 50);
        ctx.lineTo(this.x + 40, this.y + this.height / 2);
        ctx.lineTo(this.x, this.y + this.height - 50);
        ctx.lineTo(this.x + 30, this.y + this.height);
        ctx.lineTo(this.x + this.width, this.y + this.height - 20);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Health Bar
        ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
        ctx.fillRect(this.x, this.y - 30, this.width, 10);
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(this.x, this.y - 30, this.width * (this.health / this.maxHealth), 10);
        ctx.restore();
    }
}

class PowerUp {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.radius = 18;
        this.type = type;
        this.speed = 2;
        this.pulse = 0;
    }

    update() {
        this.x -= this.speed;
        this.pulse += 0.1;
    }

    draw() {
        const color = this.type === 'REPAIR' ? '#00ff00' : (this.type === 'SHIELD' ? '#ffffff' : '#ffff00');
        ctx.save();
        ctx.shadowBlur = 15 + Math.sin(this.pulse) * 5;
        ctx.shadowColor = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.fillStyle = color;
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(this.type[0], this.x, this.y + 6);
        ctx.restore();
    }
}

// Game Objects
let player;
let stars = [];
let particles = [];
let projectiles = [];
let enemies = [];
let powerUps = [];
let boss = null;
let enemySpawnTimer = 0;

function createExplosion(x, y, color, count = 15, scale = 1) {
    for (let i = 0; i < count; i++) {
        particles.push(new Particle(x, y, color, scale));
    }
}

function init() {
    player = new Player();
    stars = [
        ...Array(50).fill().map(() => new Star(0.2)),
        ...Array(30).fill().map(() => new Star(0.5)),
        ...Array(15).fill().map(() => new Star(1.2))
    ];
    particles = [];
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
    const y = Math.random() * (CANVAS_HEIGHT - 60) + 30;
    const speed = 2.5 + level * 0.4;
    const type = Math.random() > 0.7 ? 'SINE' : 'BASIC';
    enemies.push(new Enemy(CANVAS_WIDTH, y, speed, 1, type));
}

function checkCollisions() {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        if (p.vx > 0) {
            for (let j = enemies.length - 1; j >= 0; j--) {
                const e = enemies[j];
                if (p.x > e.x && p.x < e.x + e.width && p.y > e.y && p.y < e.y + e.height) {
                    createExplosion(e.x + e.width / 2, e.y + e.height / 2, e.color);
                    projectiles.splice(i, 1);
                    enemies.splice(j, 1);
                    score += 150;
                    enemiesDefeated++;
                    updateUI();
                    if (Math.random() > 0.85) {
                        const types = ['TRIPLE', 'SHIELD', 'REPAIR'];
                        powerUps.push(new PowerUp(e.x, e.y, types[Math.floor(Math.random() * types.length)]));
                    }
                    break;
                }
            }
            if (boss && p.x > boss.x && p.x < boss.x + boss.width && p.y > boss.y && p.y < boss.y + boss.height) {
                boss.health -= 15;
                createExplosion(p.x, p.y, boss.color, 5, 0.5);
                projectiles.splice(i, 1);
                if (boss.health <= 0) {
                    createExplosion(boss.x + boss.width / 2, boss.y + boss.height / 2, boss.color, 100, 3);
                    screenShake = 40;
                    score += 10000;
                    boss = null;
                    level++;
                    enemiesDefeated = 0;
                    bossSpawned = false;
                    updateUI();
                }
            }
        } else {
            const dist = Math.hypot(p.x - (player.x + 30), p.y - (player.y + 20));
            if (dist < 25) {
                projectiles.splice(i, 1);
                player.takeDamage(10);
            }
        }
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (player.x < e.x + e.width && player.x + 60 > e.x && player.y < e.y + e.height && player.y + 40 > e.y) {
            createExplosion(e.x + e.width / 2, e.y + e.height / 2, e.color, 20);
            enemies.splice(i, 1);
            player.takeDamage(25);
        }
    }

    for (let i = powerUps.length - 1; i >= 0; i--) {
        const pu = powerUps[i];
        if (Math.hypot(pu.x - (player.x + 30), pu.y - (player.y + 20)) < 35) {
            if (pu.type === 'REPAIR') {
                player.health = Math.min(player.maxHealth, player.health + 40);
                healthBar.style.width = `${(player.health / player.maxHealth) * 100}%`;
            } else {
                player.powerUpType = pu.type;
                player.powerUpTimer = 12000;
            }
            powerUps.splice(i, 1);
        }
    }
}

function gameLoop(timestamp) {
    const deltaTime = timestamp - lastTime;
    lastTime = timestamp;

    ctx.save();
    if (screenShake > 0) {
        ctx.translate(Math.random() * screenShake - screenShake / 2, Math.random() * screenShake - screenShake / 2);
        screenShake *= 0.9;
    }

    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    stars.forEach(s => { s.update(); s.draw(); });

    if (gameState === 'PLAYING') {
        player.update(deltaTime);
        player.draw();

        if (!boss) {
            enemySpawnTimer += deltaTime;
            if (enemySpawnTimer > 1400 - (level * 120)) {
                spawnEnemy();
                enemySpawnTimer = 0;
            }
            if (enemiesDefeated >= 12 && !bossSpawned) {
                boss = new Boss();
                bossSpawned = true;
            }
        }

        for (let i = particles.length - 1; i >= 0; i--) {
            particles[i].update();
            particles[i].draw();
            if (particles[i].life <= 0) particles.splice(i, 1);
        }

        for (let i = projectiles.length - 1; i >= 0; i--) {
            projectiles[i].update();
            projectiles[i].draw();
            if (projectiles[i].x < -50 || projectiles[i].x > CANVAS_WIDTH + 50) projectiles.splice(i, 1);
        }

        for (let i = enemies.length - 1; i >= 0; i--) {
            enemies[i].update();
            enemies[i].draw();
            if (enemies[i].x < -100) enemies.splice(i, 1);
        }

        for (let i = powerUps.length - 1; i >= 0; i--) {
            powerUps[i].update();
            powerUps[i].draw();
            if (powerUps[i].x < -50) powerUps.splice(i, 1);
        }

        if (boss) {
            boss.update();
            boss.draw();
        }

        checkCollisions();
    }
    ctx.restore();
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
