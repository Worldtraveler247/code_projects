/**
 * tree.js — Role detail page renderer.
 * Draws SVG career tree, role overview panel, next-moves section, and mobile accordion.
 */

// ── SVG constants ─────────────────────────────────────────────────────────────
const SVG_W   = 860;
const SVG_H   = 880;
const NODE_W  = 340;
const NODE_H  = 130;
const BAND_X  = 18;

const DIVIDER_Y = { entry_mid: 295, mid_senior: 580 };

const TIER_COLORS = {
  entry:  '#4af7ff',
  mid:    '#7b2fff',
  senior: '#ff4af7'
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initParticles();

  const params = new URLSearchParams(window.location.search);
  const slug   = params.get('role');
  if (!slug) { showError('No role specified.'); return; }

  let data;
  try {
    const res = await fetch('data/roles.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch (e) {
    showError('Could not load role data.');
    return;
  }

  const role = data.roles.find(r => r.slug === slug);
  if (!role) { showError('Role "' + slug + '" not found.'); return; }

  // Build a lookup map for next-moves
  const roleMap = {};
  data.roles.forEach(r => { roleMap[r.slug] = r; });

  renderHeader(role);
  renderOverview(role);
  renderSVGTree(role);
  renderAccordion(role);
  renderNextMoves(role, roleMap);
});

// ── Header ────────────────────────────────────────────────────────────────────
function renderHeader(role) {
  const hdr = document.getElementById('role-header');
  if (hdr) hdr.style.display = '';

  setText('role-icon',    role.icon);
  setText('nav-title',    role.title);
  document.title = role.title + ' — Origin Trace';
  setText('role-title',   role.title);
  setText('role-tagline', role.tagline);

  if (role.entry_note) {
    const caveat = document.getElementById('role-caveat');
    if (caveat) {
      caveat.style.display = '';
      caveat.textContent = role.entry_note;
    }
  }
}

// ── Overview panel ────────────────────────────────────────────────────────────
function renderOverview(role) {
  const panel = document.getElementById('role-overview');
  const left  = document.getElementById('overview-left');
  const right = document.getElementById('overview-right');
  const label = document.getElementById('tree-section-label');
  if (!panel || !left || !right) return;

  // LEFT: description + what they do
  if (role.description) {
    const h4desc = document.createElement('h4');
    h4desc.textContent = 'What is this role?';
    left.appendChild(h4desc);

    const desc = document.createElement('p');
    desc.textContent = role.description;
    left.appendChild(desc);
  }

  if (role.what_they_do && role.what_they_do.length) {
    const h4wd = document.createElement('h4');
    h4wd.textContent = 'Day-to-Day Responsibilities';
    h4wd.style.marginTop = '20px';
    left.appendChild(h4wd);

    const ul = document.createElement('ul');
    ul.className = 'overview-list';
    role.what_they_do.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    });
    left.appendChild(ul);
  }

  // RIGHT: entry salary highlight + requirements
  const entryTier = role.tiers && role.tiers.find(t => t.tier === 'entry');
  if (entryTier && entryTier.salary_range) {
    const h4sal = document.createElement('h4');
    h4sal.textContent = 'Entry Salary Range';
    right.appendChild(h4sal);

    const salBox = document.createElement('div');
    salBox.className = 'overview-salary-highlight';

    const salRange = document.createElement('span');
    salRange.className = 'sal-range';
    const lo = '$' + (entryTier.salary_range.low / 1000).toFixed(0) + 'k';
    const hi = '$' + (entryTier.salary_range.high / 1000).toFixed(0) + 'k';
    salRange.textContent = lo + ' – ' + hi;

    const salLabel = document.createElement('span');
    salLabel.className = 'sal-label';
    salLabel.textContent = 'US National · BLS 2024';

    salBox.appendChild(salRange);
    salBox.appendChild(salLabel);
    right.appendChild(salBox);
  }

  if (role.requirements && role.requirements.length) {
    const h4req = document.createElement('h4');
    h4req.textContent = 'How to Get This Job';
    h4req.style.marginTop = entryTier ? '24px' : '0';
    right.appendChild(h4req);

    const ul = document.createElement('ul');
    ul.className = 'overview-list';
    role.requirements.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    });
    right.appendChild(ul);
  }

  panel.style.display = '';
  if (label) label.style.display = '';
}

// ── Next Moves ────────────────────────────────────────────────────────────────
function renderNextMoves(role, roleMap) {
  if (!role.next_moves || !role.next_moves.length) return;

  const section = document.getElementById('next-moves');
  const grid    = document.getElementById('next-moves-grid');
  if (!section || !grid) return;

  role.next_moves.forEach(move => {
    const target = roleMap[move.slug];
    if (!target) return;

    const card = document.createElement('a');
    card.className = 'next-move-card';
    card.href = 'role.html?role=' + encodeURIComponent(move.slug);

    const nmIcon = document.createElement('div');
    nmIcon.className = 'nm-icon';
    nmIcon.textContent = target.icon;

    const nmArrow = document.createElement('div');
    nmArrow.className = 'nm-arrow';
    nmArrow.textContent = '→ Next move';

    const nmTitle = document.createElement('h4');
    nmTitle.textContent = move.title;

    const nmWhy = document.createElement('p');
    nmWhy.textContent = move.why;

    card.appendChild(nmIcon);
    card.appendChild(nmArrow);
    card.appendChild(nmTitle);
    card.appendChild(nmWhy);
    grid.appendChild(card);
  });

  section.style.display = '';
}

// ── SVG tree renderer ─────────────────────────────────────────────────────────
function renderSVGTree(role) {
  const svg = document.getElementById('tree-svg');
  if (!svg) return;

  svg.setAttribute('viewBox', '0 0 ' + SVG_W + ' ' + SVG_H);
  svg.setAttribute('width',   SVG_W);
  svg.setAttribute('height',  SVG_H);
  svg.setAttribute('aria-label', role.title + ' career progression tree');
  svg.style.maxWidth = '100%';
  svg.style.height   = 'auto';

  // Tier band fills
  appendBandFill(svg, 0,                      DIVIDER_Y.entry_mid,  'entry');
  appendBandFill(svg, DIVIDER_Y.entry_mid,    DIVIDER_Y.mid_senior, 'mid');
  appendBandFill(svg, DIVIDER_Y.mid_senior,   SVG_H,                'senior');

  // Band dividers
  appendDivider(svg, DIVIDER_Y.entry_mid);
  appendDivider(svg, DIVIDER_Y.mid_senior);

  // Tier band labels
  appendBandLabel(svg, 'ENTRY',  DIVIDER_Y.entry_mid / 2,                                           TIER_COLORS.entry);
  appendBandLabel(svg, 'MID',    DIVIDER_Y.entry_mid + (DIVIDER_Y.mid_senior - DIVIDER_Y.entry_mid) / 2, TIER_COLORS.mid);
  appendBandLabel(svg, 'SENIOR', DIVIDER_Y.mid_senior + (SVG_H - DIVIDER_Y.mid_senior) / 2,         TIER_COLORS.senior);

  // Connectors (drawn before nodes)
  const tiers = ['entry', 'mid', 'senior'];
  for (let i = 0; i < tiers.length - 1; i++) {
    const from = role.node_positions[tiers[i]];
    const to   = role.node_positions[tiers[i + 1]];
    if (from && to) appendElbow(svg, from, to, NODE_W, NODE_H, TIER_COLORS[tiers[i + 1]]);
  }

  // Nodes
  role.tiers.forEach(tierData => {
    const pos = role.node_positions[tierData.tier];
    if (!pos) return;
    appendNode(svg, pos, tierData);
  });
}

function appendBandFill(svg, y1, y2, tier) {
  const fills = {
    entry:  'rgba(74,247,255,0.04)',
    mid:    'rgba(123,47,255,0.06)',
    senior: 'rgba(255,74,247,0.07)'
  };
  const rect = svgEl('rect');
  rect.setAttribute('x',      0);
  rect.setAttribute('y',      y1);
  rect.setAttribute('width',  SVG_W);
  rect.setAttribute('height', y2 - y1);
  rect.setAttribute('fill',   fills[tier]);
  svg.appendChild(rect);
}

function appendDivider(svg, y) {
  const line = svgEl('line');
  line.setAttribute('x1', 0);  line.setAttribute('y1', y);
  line.setAttribute('x2', SVG_W); line.setAttribute('y2', y);
  line.setAttribute('stroke', 'rgba(74,247,255,0.12)');
  line.setAttribute('stroke-width', '1');
  svg.appendChild(line);
}

function appendBandLabel(svg, text, cy, color) {
  const t = svgEl('text');
  t.setAttribute('x', BAND_X);
  t.setAttribute('y', cy);
  t.setAttribute('fill', color);
  t.setAttribute('font-size', 9);
  t.setAttribute('font-family', 'Orbitron, system-ui');
  t.setAttribute('font-weight', '600');
  t.setAttribute('letter-spacing', '3');
  t.setAttribute('opacity', '0.55');
  t.setAttribute('dominant-baseline', 'middle');
  t.setAttribute('text-anchor', 'start');
  t.setAttribute('transform', 'rotate(-90, ' + BAND_X + ', ' + cy + ')');
  t.textContent = text;
  svg.appendChild(t);
}

function appendElbow(svg, from, to, nw, nh, color) {
  const x1  = from.x + nw / 2;
  const y1  = from.y + nh;
  const x2  = to.x   + nw / 2;
  const y2  = to.y;
  const mid = (y1 + y2) / 2;

  const d = ['M', x1, y1, 'L', x1, mid, 'L', x2, mid, 'L', x2, y2].join(' ');
  const path = svgEl('path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-opacity', '0.55');
  path.setAttribute('stroke-dasharray', '6 4');
  svg.appendChild(path);

  appendArrow(svg, x2, y2, color);
}

function appendArrow(svg, x, y, color) {
  const poly = svgEl('polygon');
  const s    = 6;
  poly.setAttribute('points', [(x-s)+','+y, (x+s)+','+y, x+','+(y+s*1.6)].join(' '));
  poly.setAttribute('fill', color);
  poly.setAttribute('opacity', '0.75');
  svg.appendChild(poly);
}

function appendNode(svg, pos, tierData) {
  const color = TIER_COLORS[tierData.tier];
  const x = pos.x;
  const y = pos.y;

  const g = svgEl('g');
  g.setAttribute('class', 'tree-node-group');
  g.setAttribute('role', 'img');
  g.setAttribute('aria-label', tierData.label + ': ' + tierData.typical_titles.join(', '));

  // Shadow / glow
  const glow = svgEl('rect');
  glow.setAttribute('x',      x - 2);
  glow.setAttribute('y',      y - 2);
  glow.setAttribute('width',  NODE_W + 4);
  glow.setAttribute('height', NODE_H + 4);
  glow.setAttribute('rx',     14);
  glow.setAttribute('fill',   'none');
  glow.setAttribute('stroke', color);
  glow.setAttribute('stroke-width', '1');
  glow.setAttribute('opacity', '0.15');
  g.appendChild(glow);

  // Background rect
  const rect = svgEl('rect');
  rect.setAttribute('x',      x);
  rect.setAttribute('y',      y);
  rect.setAttribute('width',  NODE_W);
  rect.setAttribute('height', NODE_H);
  rect.setAttribute('rx',     12);
  rect.setAttribute('fill',   'rgba(7,1,15,0.88)');
  rect.setAttribute('stroke', color);
  rect.setAttribute('stroke-width', '1.5');
  g.appendChild(rect);

  // Top accent bar
  const accent = svgEl('rect');
  accent.setAttribute('x',      x);
  accent.setAttribute('y',      y);
  accent.setAttribute('width',  NODE_W);
  accent.setAttribute('height', 4);
  accent.setAttribute('rx',     12);
  accent.setAttribute('fill',   color);
  accent.setAttribute('opacity', '0.6');
  g.appendChild(accent);

  // Tier label
  const tierLabel = svgEl('text');
  tierLabel.setAttribute('x', x + 16);
  tierLabel.setAttribute('y', y + 24);
  tierLabel.setAttribute('fill', color);
  tierLabel.setAttribute('font-size', '8');
  tierLabel.setAttribute('font-family', 'Orbitron, system-ui');
  tierLabel.setAttribute('font-weight', '600');
  tierLabel.setAttribute('letter-spacing', '3');
  tierLabel.setAttribute('opacity', '0.85');
  tierLabel.textContent = tierData.label;
  g.appendChild(tierLabel);

  // Primary title (larger)
  const primaryTitle = (tierData.typical_titles[0] || '');
  const title = svgEl('text');
  title.setAttribute('x', x + 16);
  title.setAttribute('y', y + 50);
  title.setAttribute('fill', '#ffffff');
  title.setAttribute('font-size', '14');
  title.setAttribute('font-family', 'Inter, system-ui');
  title.setAttribute('font-weight', '600');
  title.textContent = primaryTitle.length > 32 ? primaryTitle.slice(0, 30) + '…' : primaryTitle;
  g.appendChild(title);

  // Secondary titles
  if (tierData.typical_titles.length > 1) {
    const altTitles = tierData.typical_titles.slice(1, 3).join(' · ');
    const alt = svgEl('text');
    alt.setAttribute('x', x + 16);
    alt.setAttribute('y', y + 70);
    alt.setAttribute('fill', '#5a607a');
    alt.setAttribute('font-size', '10');
    alt.setAttribute('font-family', 'Inter, system-ui');
    alt.textContent = altTitles.length > 42 ? altTitles.slice(0, 40) + '…' : altTitles;
    g.appendChild(alt);
  }

  // Salary range
  const sal = tierData.salary_range;
  if (sal) {
    const lo   = sal.low  ? '$' + (sal.low  / 1000).toFixed(0) + 'k' : '?';
    const hi   = sal.high ? '$' + (sal.high / 1000).toFixed(0) + 'k' : '?';

    const salText = svgEl('text');
    salText.setAttribute('x', x + 16);
    salText.setAttribute('y', y + 96);
    salText.setAttribute('fill', '#6a7090');
    salText.setAttribute('font-size', '11');
    salText.setAttribute('font-family', 'Inter, system-ui');
    salText.setAttribute('font-weight', '500');
    salText.textContent = lo + ' – ' + hi;
    g.appendChild(salText);

    // ⓘ tooltip trigger group
    const citeGroup = svgEl('g');
    citeGroup.setAttribute('cursor', 'pointer');

    const hitArea = svgEl('rect');
    hitArea.setAttribute('x',      x + NODE_W - 32);
    hitArea.setAttribute('y',      y + 82);
    hitArea.setAttribute('width',  24);
    hitArea.setAttribute('height', 24);
    hitArea.setAttribute('fill',   'transparent');
    citeGroup.appendChild(hitArea);

    const citeCircle = svgEl('circle');
    citeCircle.setAttribute('cx', x + NODE_W - 20);
    citeCircle.setAttribute('cy', y + 94);
    citeCircle.setAttribute('r',  8);
    citeCircle.setAttribute('fill',   'rgba(74,247,255,0.1)');
    citeCircle.setAttribute('stroke', 'rgba(74,247,255,0.32)');
    citeCircle.setAttribute('stroke-width', '1');
    citeGroup.appendChild(citeCircle);

    const citeLabel = svgEl('text');
    citeLabel.setAttribute('x', x + NODE_W - 20);
    citeLabel.setAttribute('y', y + 98);
    citeLabel.setAttribute('fill', '#4af7ff');
    citeLabel.setAttribute('font-size', '9');
    citeLabel.setAttribute('font-family', 'Inter, system-ui');
    citeLabel.setAttribute('text-anchor', 'middle');
    citeLabel.setAttribute('dominant-baseline', 'middle');
    citeLabel.textContent = 'i';
    citeGroup.appendChild(citeLabel);

    const tooltipData = {
      title:    tierData.label + ' salary',
      body:     lo + ' – ' + hi + ' (US national · BLS May 2024)',
      url:      sal.source_url,
      urlLabel: sal.source_label
    };

    citeGroup.addEventListener('mouseenter', () => Tooltip.show(citeGroup, tooltipData));
    citeGroup.addEventListener('mouseleave', () => Tooltip.hide());
    citeGroup.addEventListener('click', e => { e.stopPropagation(); Tooltip.show(citeGroup, tooltipData); });

    g.appendChild(citeGroup);
  }

  // Cert label
  const cert = tierData.required_certs && tierData.required_certs[0];
  if (cert) {
    const certText = svgEl('text');
    certText.setAttribute('x', x + 16);
    certText.setAttribute('y', y + NODE_H - 12);
    certText.setAttribute('fill', color);
    certText.setAttribute('font-size', '10');
    certText.setAttribute('font-family', 'Inter, system-ui');
    certText.setAttribute('opacity', '0.65');
    const certName = cert.name.length > 42 ? cert.name.slice(0, 40) + '…' : cert.name;
    certText.textContent = '🏅 ' + certName;
    g.appendChild(certText);
  }

  svg.appendChild(g);
}

// ── Accordion (mobile) ────────────────────────────────────────────────────────
function renderAccordion(role) {
  const container = document.getElementById('accordion');
  if (!container) return;

  role.tiers.forEach((tierData, idx) => {
    const section = document.createElement('div');
    section.className = 'accordion-tier';
    section.dataset.tier = tierData.tier;
    if (idx === 0) section.classList.add('open');

    const header = document.createElement('div');
    header.className = 'accordion-header';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', idx === 0 ? 'true' : 'false');

    const label = document.createElement('span');
    label.className = 'accordion-tier-label';
    label.textContent = tierData.label;

    const chevron = document.createElement('span');
    chevron.className = 'accordion-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▾';

    header.appendChild(label);
    header.appendChild(chevron);

    function toggle() {
      const isOpen = section.classList.toggle('open');
      header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });

    const body = document.createElement('div');
    body.className = 'accordion-body';

    appendAccordionField(body, 'Typical Titles', tierData.typical_titles.join(', '));

    if (tierData.required_certs && tierData.required_certs.length) {
      const fieldEl = document.createElement('div');
      fieldEl.className = 'accordion-field';
      const fl = document.createElement('div');
      fl.className = 'accordion-field-label';
      fl.textContent = 'Certifications';
      fieldEl.appendChild(fl);
      const certWrap = document.createElement('div');
      certWrap.className = 'accordion-field-value';
      tierData.required_certs.forEach(cert => {
        const a = document.createElement('a');
        a.className = 'cert-pill';
        a.href = cert.source_url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = cert.name;
        if (cert.cost_usd) a.title = '$' + cert.cost_usd + ' — ' + (cert.cost_note || '');
        certWrap.appendChild(a);
      });
      fieldEl.appendChild(certWrap);
      body.appendChild(fieldEl);
    }

    if (tierData.salary_range) {
      const sal = tierData.salary_range;
      const fieldEl = document.createElement('div');
      fieldEl.className = 'accordion-field';
      const fl = document.createElement('div');
      fl.className = 'accordion-field-label';
      fl.textContent = 'Salary Range';
      fieldEl.appendChild(fl);
      const val = document.createElement('div');
      val.className = 'accordion-field-value';
      const rangeSpan = document.createElement('span');
      rangeSpan.className = 'salary-range';
      const lo = sal.low  ? '$' + sal.low.toLocaleString()  : 'unknown';
      const hi = sal.high ? '$' + sal.high.toLocaleString() : 'unknown';
      rangeSpan.textContent = lo + ' – ' + hi;
      const sourceSpan = document.createElement('span');
      sourceSpan.className = 'salary-source';
      const sourceLink = document.createElement('a');
      sourceLink.href = sal.source_url;
      sourceLink.target = '_blank';
      sourceLink.rel = 'noopener noreferrer';
      sourceLink.textContent = sal.source_label;
      sourceSpan.appendChild(sourceLink);
      val.appendChild(rangeSpan);
      val.appendChild(sourceSpan);
      fieldEl.appendChild(val);
      body.appendChild(fieldEl);
    }

    if (tierData.education_bar)       appendAccordionField(body, 'Education',           tierData.education_bar);
    if (tierData.typical_time_in_tier) appendAccordionField(body, 'Typical Time in Tier', tierData.typical_time_in_tier);
    if (tierData.ai_branch)            appendAccordionField(body, 'AI Branch (senior)', tierData.ai_branch.title + ': ' + tierData.ai_branch.note);

    section.appendChild(header);
    section.appendChild(body);
    container.appendChild(section);
  });
}

function appendAccordionField(parent, label, value) {
  const fieldEl = document.createElement('div');
  fieldEl.className = 'accordion-field';
  const fl = document.createElement('div');
  fl.className = 'accordion-field-label';
  fl.textContent = label;
  const fv = document.createElement('div');
  fv.className = 'accordion-field-value';
  fv.textContent = value;
  fieldEl.appendChild(fl);
  fieldEl.appendChild(fv);
  parent.appendChild(fieldEl);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function svgEl(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function showError(msg) {
  const container = document.getElementById('tree-container');
  if (container) {
    const p = document.createElement('p');
    p.style.cssText = 'color:var(--muted);padding:48px 28px;font-size:0.9rem;';
    p.textContent = msg;
    container.appendChild(p);
  }
}

// ── Particles ─────────────────────────────────────────────────────────────────
function initParticles() {
  const bg = document.getElementById('bg-canvas');
  if (!bg) return;
  const bx = bg.getContext('2d');
  let W, H, pts;
  function init() {
    W = bg.width  = window.innerWidth;
    H = bg.height = window.innerHeight;
    pts = Array.from({length: 70}, () => ({
      x: Math.random()*W, y: Math.random()*H,
      r: Math.random()*1.2+0.2,
      vx: (Math.random()-0.5)*0.18,
      vy: (Math.random()-0.5)*0.18,
      a: Math.random()*0.55+0.08
    }));
  }
  function draw() {
    bx.clearRect(0,0,W,H);
    pts.forEach(p => {
      p.x+=p.vx; p.y+=p.vy;
      if(p.x<0)p.x=W; if(p.x>W)p.x=0;
      if(p.y<0)p.y=H; if(p.y>H)p.y=0;
      bx.beginPath();
      bx.arc(p.x,p.y,p.r,0,Math.PI*2);
      bx.fillStyle='rgba(74,247,255,'+(p.a*0.4)+')';
      bx.fill();
    });
    requestAnimationFrame(draw);
  }
  init(); draw();
  window.addEventListener('resize', init);
}
