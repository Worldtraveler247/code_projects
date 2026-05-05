/**
 * dag.js — Cross-role directed acyclic graph for the Career DAG page.
 * Reads roles.json and renders an SVG DAG showing all 6 roles
 * and the documented cross-role transition edges.
 * Nodes are clickable, linking to role.html?role=<slug>.
 */

// ── Layout constants ──────────────────────────────────────────────────────────
const W      = 960;
const H      = 560;
const NW     = 210;
const NH     = 80;
const R      = 12;

// Hand-authored node positions for a clean layout:
//   Row 1 (col 0):  Help Desk
//   Row 2 (col 1):  NOC Technician  |  Cloud Support
//   Row 3 (col 2):  Jr Network Admin | GRC Analyst | SOC Analyst
const LAYOUT = {
  'help-desk':            { x: 375,  y: 30  },
  'noc-technician':       { x: 150,  y: 190 },
  'cloud-support':        { x: 600,  y: 190 },
  'junior-network-admin': { x: 60,   y: 390 },
  'grc-analyst':          { x: 375,  y: 390 },
  'soc-analyst':          { x: 690,  y: 390 }
};

const COLORS = {
  'help-desk':            '#4af7ff',
  'noc-technician':       '#4af7ff',
  'cloud-support':        '#4affdc',
  'grc-analyst':          '#7b2fff',
  'soc-analyst':          '#ff4af7',
  'junior-network-admin': '#4af7ff'
};

// Explicit edges (from → to) sourced from roles.json next_moves + branches_into
const EDGES = [
  { from: 'help-desk',            to: 'noc-technician' },
  { from: 'help-desk',            to: 'cloud-support' },
  { from: 'help-desk',            to: 'grc-analyst' },
  { from: 'noc-technician',       to: 'junior-network-admin' },
  { from: 'noc-technician',       to: 'soc-analyst' },
  { from: 'cloud-support',        to: 'soc-analyst' },
  { from: 'cloud-support',        to: 'grc-analyst' },
  { from: 'junior-network-admin', to: 'noc-technician' },
  { from: 'junior-network-admin', to: 'soc-analyst' },
  { from: 'grc-analyst',          to: 'soc-analyst' },
  { from: 'soc-analyst',          to: 'grc-analyst' }
];

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initParticles();

  let data;
  try {
    const res = await fetch('data/roles.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch (e) {
    const svg = document.getElementById('dag-svg');
    if (svg) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', 40); t.setAttribute('y', 60);
      t.setAttribute('fill', '#5a607a'); t.setAttribute('font-size', '14');
      t.textContent = 'Could not load role data.';
      svg.appendChild(t);
    }
    return;
  }

  const roleMap = {};
  data.roles.forEach(r => { roleMap[r.slug] = r; });

  renderDAG(roleMap);
});

// ── Renderer ──────────────────────────────────────────────────────────────────
function renderDAG(roleMap) {
  const svg = document.getElementById('dag-svg');
  if (!svg) return;

  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('width',   W);
  svg.setAttribute('height',  H);
  svg.style.maxWidth  = '100%';
  svg.style.height    = 'auto';

  // Defs: arrowhead marker per color group
  const defs = svgEl('defs');
  const markerColors = { cyan: '#4af7ff', purple: '#7b2fff', magenta: '#ff4af7', teal: '#4affdc' };
  Object.entries(markerColors).forEach(([name, color]) => {
    const marker = svgEl('marker');
    marker.setAttribute('id',          'arrow-' + name);
    marker.setAttribute('markerWidth',  '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX',         '7');
    marker.setAttribute('refY',         '4');
    marker.setAttribute('orient',       'auto');
    const poly = svgEl('polygon');
    poly.setAttribute('points', '0,0 8,4 0,8');
    poly.setAttribute('fill', color);
    poly.setAttribute('opacity', '0.7');
    marker.appendChild(poly);
    defs.appendChild(marker);
  });
  svg.appendChild(defs);

  // Edges first (behind nodes)
  EDGES.forEach(edge => {
    const fromPos = LAYOUT[edge.from];
    const toPos   = LAYOUT[edge.to];
    if (!fromPos || !toPos) return;

    // Pick marker based on source color
    const srcColor = COLORS[edge.from] || '#4af7ff';
    const markerName = srcColor === '#7b2fff' ? 'purple'
                     : srcColor === '#ff4af7' ? 'magenta'
                     : srcColor === '#4affdc' ? 'teal'
                     : 'cyan';

    // Connect bottom-center of from node to top-center of to node
    const x1 = fromPos.x + NW / 2;
    const y1 = fromPos.y + NH;
    const x2 = toPos.x   + NW / 2;
    const y2 = toPos.y;

    // Curved path using quadratic bezier
    const mx  = (x1 + x2) / 2;
    const my  = (y1 + y2) / 2;
    // Slight horizontal offset for parallel edges
    const cx  = mx + (x2 - x1) * 0.05;
    const cy  = my;

    const path = svgEl('path');
    path.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' Q ' + cx + ' ' + cy + ' ' + x2 + ' ' + y2);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', srcColor);
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-opacity', '0.4');
    path.setAttribute('stroke-dasharray', '5 4');
    path.setAttribute('marker-end', 'url(#arrow-' + markerName + ')');
    svg.appendChild(path);
  });

  // Nodes
  Object.entries(LAYOUT).forEach(([slug, pos]) => {
    const role = roleMap[slug];
    if (!role) return;
    const color = COLORS[slug] || '#4af7ff';
    appendDagNode(svg, pos, role, color);
  });
}

function appendDagNode(svg, pos, role, color) {
  const g = svgEl('g');
  g.setAttribute('class', 'dag-node-group');
  g.setAttribute('cursor', 'pointer');
  g.setAttribute('role', 'link');
  g.setAttribute('aria-label', role.title + ' — click to explore');
  g.addEventListener('click', () => {
    window.location.href = 'role.html?role=' + encodeURIComponent(role.slug);
  });

  const x = pos.x;
  const y = pos.y;

  // Glow halo
  const halo = svgEl('rect');
  halo.setAttribute('x',      x - 4);
  halo.setAttribute('y',      y - 4);
  halo.setAttribute('width',  NW + 8);
  halo.setAttribute('height', NH + 8);
  halo.setAttribute('rx',     R + 4);
  halo.setAttribute('fill',   'none');
  halo.setAttribute('stroke', color);
  halo.setAttribute('stroke-width', '1');
  halo.setAttribute('opacity', '0.12');
  g.appendChild(halo);

  // Background
  const rect = svgEl('rect');
  rect.setAttribute('x',      x);
  rect.setAttribute('y',      y);
  rect.setAttribute('width',  NW);
  rect.setAttribute('height', NH);
  rect.setAttribute('rx',     R);
  rect.setAttribute('fill',   'rgba(7,1,15,0.9)');
  rect.setAttribute('stroke', color);
  rect.setAttribute('stroke-width', '1.5');
  g.appendChild(rect);

  // Top accent bar
  const bar = svgEl('rect');
  bar.setAttribute('x',      x);
  bar.setAttribute('y',      y);
  bar.setAttribute('width',  NW);
  bar.setAttribute('height', 3);
  bar.setAttribute('rx',     R);
  bar.setAttribute('fill',   color);
  bar.setAttribute('opacity', '0.7');
  g.appendChild(bar);

  // Icon
  const iconText = svgEl('text');
  iconText.setAttribute('x', x + 18);
  iconText.setAttribute('y', y + 36);
  iconText.setAttribute('font-size', '22');
  iconText.setAttribute('dominant-baseline', 'middle');
  iconText.textContent = role.icon;
  g.appendChild(iconText);

  // Title
  const titleText = svgEl('text');
  titleText.setAttribute('x', x + 50);
  titleText.setAttribute('y', y + 28);
  titleText.setAttribute('fill', '#ffffff');
  titleText.setAttribute('font-size', '11');
  titleText.setAttribute('font-family', 'Orbitron, system-ui');
  titleText.setAttribute('font-weight', '600');
  const titleStr = role.title.length > 22 ? role.title.slice(0, 20) + '…' : role.title;
  titleText.textContent = titleStr;
  g.appendChild(titleText);

  // Entry salary
  const entryTier = role.tiers && role.tiers.find(t => t.tier === 'entry');
  if (entryTier && entryTier.salary_range) {
    const lo = '$' + (entryTier.salary_range.low  / 1000).toFixed(0) + 'k';
    const hi = '$' + (entryTier.salary_range.high / 1000).toFixed(0) + 'k';
    const salText = svgEl('text');
    salText.setAttribute('x', x + 50);
    salText.setAttribute('y', y + 48);
    salText.setAttribute('fill', color);
    salText.setAttribute('font-size', '10');
    salText.setAttribute('font-family', 'Inter, system-ui');
    salText.setAttribute('opacity', '0.75');
    salText.textContent = lo + ' – ' + hi + ' entry';
    g.appendChild(salText);
  }

  // Track label
  const trackText = svgEl('text');
  trackText.setAttribute('x', x + 50);
  trackText.setAttribute('y', y + 65);
  trackText.setAttribute('fill', '#5a607a');
  trackText.setAttribute('font-size', '9');
  trackText.setAttribute('font-family', 'Inter, system-ui');
  trackText.setAttribute('letter-spacing', '1');
  trackText.textContent = (role.track || 'general').toUpperCase();
  g.appendChild(trackText);

  svg.appendChild(g);
}

// ── SVG helper ────────────────────────────────────────────────────────────────
function svgEl(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

// ── Particles ─────────────────────────────────────────────────────────────────
function initParticles() {
  const bg = document.getElementById('bg-canvas');
  if (!bg) return;
  const bx = bg.getContext('2d');
  let W2, H2, pts;
  function init() {
    W2 = bg.width  = window.innerWidth;
    H2 = bg.height = window.innerHeight;
    pts = Array.from({length: 60}, () => ({
      x: Math.random()*W2, y: Math.random()*H2,
      r: Math.random()*1.2+0.2,
      vx: (Math.random()-0.5)*0.18,
      vy: (Math.random()-0.5)*0.18,
      a: Math.random()*0.5+0.08
    }));
  }
  function draw() {
    bx.clearRect(0,0,W2,H2);
    pts.forEach(p => {
      p.x+=p.vx; p.y+=p.vy;
      if(p.x<0)p.x=W2; if(p.x>W2)p.x=0;
      if(p.y<0)p.y=H2; if(p.y>H2)p.y=0;
      bx.beginPath();
      bx.arc(p.x,p.y,p.r,0,Math.PI*2);
      bx.fillStyle='rgba(74,247,255,'+(p.a*0.38)+')';
      bx.fill();
    });
    requestAnimationFrame(draw);
  }
  init(); draw();
  window.addEventListener('resize', init);
}
