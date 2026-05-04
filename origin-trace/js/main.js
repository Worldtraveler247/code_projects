/**
 * main.js
 * Landing page — fetches data/roles.json and renders the 6-card role grid.
 * Also exports the shared particle-background initializer used by other pages.
 */

// ── Particle background ──────────────────────────────────────────────────────
function initParticles() {
  const bg = document.getElementById('bg-canvas');
  if (!bg) return;
  const bx = bg.getContext('2d');
  let W, H, pts;

  function init() {
    W = bg.width  = window.innerWidth;
    H = bg.height = window.innerHeight;
    pts = Array.from({length: 90}, () => ({
      x:  Math.random() * W,
      y:  Math.random() * H,
      r:  Math.random() * 1.3 + 0.2,
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.22,
      a:  Math.random() * 0.7 + 0.1
    }));
  }

  function draw() {
    bx.clearRect(0, 0, W, H);
    pts.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      bx.beginPath();
      bx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      bx.fillStyle = 'rgba(74,247,255,' + (p.a * 0.5) + ')';
      bx.fill();
    });
    requestAnimationFrame(draw);
  }

  init();
  draw();
  window.addEventListener('resize', init);
}

// ── Role card gradients (one per role, keyed by slug) ────────────────────────
const CARD_GRADIENTS = {
  'help-desk':             { a: '#051a26', b: '#0a3040' },
  'noc-technician':        { a: '#051a2a', b: '#083550' },
  'cloud-support':         { a: '#0a1a3d', b: '#0d2a5a' },
  'grc-analyst':           { a: '#160a30', b: '#281060' },
  'soc-analyst':           { a: '#1a0520', b: '#30083a' },
  'junior-network-admin':  { a: '#051825', b: '#08283d' }
};

// ── Render landing grid ───────────────────────────────────────────────────────
async function renderGrid() {
  const grid = document.getElementById('role-grid');
  if (!grid) return;

  let data;
  try {
    const res = await fetch('data/roles.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch (err) {
    grid.textContent = 'Could not load role data. Make sure data/roles.json is present.';
    return;
  }

  // Clear loading placeholder
  while (grid.firstChild) grid.removeChild(grid.firstChild);

  data.roles.forEach((role, idx) => {
    const grad = CARD_GRADIENTS[role.slug] || { a: '#0a1520', b: '#0d2030' };
    const card = buildCard(role, grad, idx);
    grid.appendChild(card);
  });

  // Scroll-reveal animation
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const delay = parseInt(e.target.dataset.delay || '0', 10);
        setTimeout(() => e.target.classList.add('visible'), delay);
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });

  grid.querySelectorAll('.role-card').forEach((c, i) => {
    c.dataset.delay = i * 90;
    io.observe(c);
  });
}

function buildCard(role, grad, idx) {
  // <a class="role-card" href="role.html?role=...">
  const a = document.createElement('a');
  a.className = 'role-card';
  a.href = 'role.html?role=' + encodeURIComponent(role.slug);
  a.setAttribute('aria-label', role.title + ' career tree');

  // Visual area
  const visual = document.createElement('div');
  visual.className = 'role-card-visual';
  visual.style.background = 'linear-gradient(135deg, ' + grad.a + ', ' + grad.b + ')';

  const icon = document.createElement('span');
  icon.textContent = role.icon;
  icon.setAttribute('aria-hidden', 'true');
  visual.appendChild(icon);

  // Body
  const body = document.createElement('div');
  body.className = 'role-card-body';

  const tag = document.createElement('div');
  tag.className = 'role-card-tag';
  tag.textContent = 'Entry Root';

  const h3 = document.createElement('h3');
  h3.textContent = role.title;

  const p = document.createElement('p');
  p.textContent = role.tagline;

  const cta = document.createElement('span');
  cta.className = 'role-card-cta';
  cta.textContent = 'Explore path →';

  body.appendChild(tag);
  body.appendChild(h3);
  body.appendChild(p);
  body.appendChild(cta);

  a.appendChild(visual);
  a.appendChild(body);

  return a;
}

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initParticles();
  // Only render grid if the role-grid element exists (index.html only)
  if (document.getElementById('role-grid')) {
    renderGrid();
  }
});
