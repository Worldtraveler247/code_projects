/**
 * main.js — Landing page: role grid, search, filter, particles.
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
    pts = Array.from({length: 100}, () => ({
      x:  Math.random() * W,
      y:  Math.random() * H,
      r:  Math.random() * 1.4 + 0.2,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      a:  Math.random() * 0.65 + 0.08
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
      bx.fillStyle = 'rgba(74,247,255,' + (p.a * 0.45) + ')';
      bx.fill();
    });
    requestAnimationFrame(draw);
  }

  init(); draw();
  window.addEventListener('resize', init);
}

// ── Card gradient palette ────────────────────────────────────────────────────
const CARD_GRADIENTS = {
  'help-desk':            { a: '#04161f', b: '#082c40' },
  'noc-technician':       { a: '#041522', b: '#073048' },
  'cloud-support':        { a: '#081535', b: '#0c2452' },
  'grc-analyst':          { a: '#130826', b: '#200d50' },
  'soc-analyst':          { a: '#18041c', b: '#2c0638' },
  'junior-network-admin': { a: '#04161e', b: '#082636' }
};

// ── State ────────────────────────────────────────────────────────────────────
let activeTrack  = 'all';
let searchQuery  = '';

// ── Grid renderer ────────────────────────────────────────────────────────────
async function renderGrid() {
  const grid = document.getElementById('role-grid');
  if (!grid) return;

  let data;
  try {
    const res = await fetch('data/roles.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch (err) {
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    const msg = document.createElement('p');
    msg.style.cssText = 'color:var(--muted);font-size:0.85rem;';
    msg.textContent = 'Could not load role data. Make sure data/roles.json is present.';
    grid.appendChild(msg);
    return;
  }

  while (grid.firstChild) grid.removeChild(grid.firstChild);

  data.roles.forEach((role, idx) => {
    const grad = CARD_GRADIENTS[role.slug] || { a: '#0a1520', b: '#0d2030' };
    grid.appendChild(buildCard(role, grad, idx));
  });

  setupScrollReveal();
}

function buildCard(role, grad) {
  const a = document.createElement('a');
  a.className = 'role-card';
  a.href = 'role.html?role=' + encodeURIComponent(role.slug);
  a.setAttribute('aria-label', role.title + ' career tree');
  a.dataset.track = role.track || 'all';
  a.dataset.title = (role.title + ' ' + role.tagline).toLowerCase();

  // Visual area
  const visual = document.createElement('div');
  visual.className = 'role-card-visual';
  visual.style.background = 'linear-gradient(145deg, ' + grad.a + ', ' + grad.b + ')';
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

  body.appendChild(tag);
  body.appendChild(h3);
  body.appendChild(p);

  // Entry salary preview
  const entryTier = role.tiers && role.tiers.find(t => t.tier === 'entry');
  if (entryTier && entryTier.salary_range) {
    const salRow = document.createElement('div');
    salRow.className = 'role-card-salary';

    const salLabel = document.createElement('span');
    salLabel.className = 'role-card-salary-label';
    salLabel.textContent = 'Entry salary';

    const salVal = document.createElement('span');
    salVal.className = 'role-card-salary-val';
    const lo = '$' + (entryTier.salary_range.low / 1000).toFixed(0) + 'k';
    const hi = '$' + (entryTier.salary_range.high / 1000).toFixed(0) + 'k';
    salVal.textContent = lo + '–' + hi;

    salRow.appendChild(salLabel);
    salRow.appendChild(salVal);
    body.appendChild(salRow);
  }

  const cta = document.createElement('span');
  cta.className = 'role-card-cta';
  cta.textContent = 'Explore path →';
  body.appendChild(cta);

  a.appendChild(visual);
  a.appendChild(body);
  return a;
}

// ── Scroll reveal ────────────────────────────────────────────────────────────
function setupScrollReveal() {
  const grid = document.getElementById('role-grid');
  if (!grid) return;
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const delay = parseInt(e.target.dataset.delay || '0', 10);
        setTimeout(() => e.target.classList.add('visible'), delay);
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.08 });

  grid.querySelectorAll('.role-card').forEach((c, i) => {
    c.dataset.delay = i * 80;
    io.observe(c);
  });
}

// ── Search + Filter ──────────────────────────────────────────────────────────
function applyFilters() {
  const grid = document.getElementById('role-grid');
  if (!grid) return;

  const cards = grid.querySelectorAll('.role-card');
  let visibleCount = 0;

  cards.forEach(card => {
    const matchTrack  = activeTrack === 'all' || card.dataset.track === activeTrack;
    const matchSearch = searchQuery === '' || card.dataset.title.includes(searchQuery);
    const visible = matchTrack && matchSearch;
    card.classList.toggle('hidden', !visible);
    if (visible) visibleCount++;
  });

  let noRes = grid.querySelector('.no-results');
  if (visibleCount === 0) {
    if (!noRes) {
      noRes = document.createElement('p');
      noRes.className = 'no-results';
      noRes.textContent = 'No roles match your search. Try a different term or filter.';
      grid.appendChild(noRes);
    }
  } else if (noRes) {
    noRes.remove();
  }
}

function setupSearch() {
  const input = document.getElementById('role-search');
  if (input) {
    input.addEventListener('input', () => {
      searchQuery = input.value.trim().toLowerCase();
      applyFilters();
    });
  }

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeTrack = chip.dataset.track;
      applyFilters();
    });
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initParticles();
  if (document.getElementById('role-grid')) {
    renderGrid().then(() => setupSearch());
  }
});
