/**
 * tree.js
 * Renders the per-role career tree on role.html.
 *
 * Desktop: orthogonal-elbow SVG with tier bands.
 * Mobile (<600px): HTML accordion (tree-container hidden by CSS).
 *
 * No graph library. All node positions are hand-authored in roles.json
 * under node_positions: { entry:{x,y}, mid:{x,y}, senior:{x,y} }.
 */

// ── SVG constants ─────────────────────────────────────────────────────────────
const SVG_W     = 660;   // viewBox width
const SVG_H     = 620;   // viewBox height
const NODE_W    = 220;   // node rectangle width
const NODE_H    = 78;    // node rectangle height
const BAND_X    = 16;    // left margin for tier band labels
const BAND_FONT = 9;     // px

// Tier band horizontal divider Y values (between entry/mid and mid/senior)
const DIVIDER_Y = {
  entry_mid:   215,
  mid_senior:  415
};

// Tier accent colors
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
  if (!slug) { showError('No role specified. '); return; }

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

  renderHeader(role);
  renderSVGTree(role);
  renderAccordion(role);
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

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ── SVG tree renderer ─────────────────────────────────────────────────────────
function renderSVGTree(role) {
  const svg = document.getElementById('tree-svg');
  if (!svg) return;

  svg.setAttribute('viewBox', '0 0 ' + SVG_W + ' ' + SVG_H);
  svg.setAttribute('width',   SVG_W);
  svg.setAttribute('height',  SVG_H);
  svg.setAttribute('aria-label', role.title + ' career progression tree');

  // Tier band fills
  appendBandFill(svg, 0,                 DIVIDER_Y.entry_mid,  'entry');
  appendBandFill(svg, DIVIDER_Y.entry_mid, DIVIDER_Y.mid_senior, 'mid');
  appendBandFill(svg, DIVIDER_Y.mid_senior, SVG_H,             'senior');

  // Band dividers
  appendDivider(svg, DIVIDER_Y.entry_mid);
  appendDivider(svg, DIVIDER_Y.mid_senior);

  // Tier band labels (left margin)
  appendBandLabel(svg, 'ENTRY',  (DIVIDER_Y.entry_mid) / 2,                        TIER_COLORS.entry);
  appendBandLabel(svg, 'MID',    DIVIDER_Y.entry_mid + (DIVIDER_Y.mid_senior - DIVIDER_Y.entry_mid) / 2, TIER_COLORS.mid);
  appendBandLabel(svg, 'SENIOR', DIVIDER_Y.mid_senior + (SVG_H - DIVIDER_Y.mid_senior) / 2,             TIER_COLORS.senior);

  // Orthogonal elbow connectors (drawn first — behind nodes)
  const tiers = ['entry', 'mid', 'senior'];
  for (let i = 0; i < tiers.length - 1; i++) {
    const from = role.node_positions[tiers[i]];
    const to   = role.node_positions[tiers[i + 1]];
    if (from && to) {
      appendElbow(svg, from, to, NODE_W, NODE_H, TIER_COLORS[tiers[i + 1]]);
    }
  }

  // Nodes
  role.tiers.forEach(tierData => {
    const pos = role.node_positions[tierData.tier];
    if (!pos) return;
    appendNode(svg, pos, tierData, role.slug);
  });
}

function appendBandFill(svg, y1, y2, tier) {
  const rect = svgEl('rect');
  rect.setAttribute('x',      0);
  rect.setAttribute('y',      y1);
  rect.setAttribute('width',  SVG_W);
  rect.setAttribute('height', y2 - y1);
  const alpha = { entry: '0.04', mid: '0.055', senior: '0.07' };
  const color = TIER_COLORS[tier].replace('#', '');
  // Use rgba equivalent
  const fills = {
    entry:  'rgba(74,247,255,0.04)',
    mid:    'rgba(123,47,255,0.055)',
    senior: 'rgba(255,74,247,0.07)'
  };
  rect.setAttribute('fill', fills[tier]);
  svg.appendChild(rect);
}

function appendDivider(svg, y) {
  const line = svgEl('line');
  line.setAttribute('x1', 0);
  line.setAttribute('y1', y);
  line.setAttribute('x2', SVG_W);
  line.setAttribute('y2', y);
  line.setAttribute('stroke', 'rgba(74,247,255,0.1)');
  line.setAttribute('stroke-width', '1');
  svg.appendChild(line);
}

function appendBandLabel(svg, text, cy, color) {
  const t = svgEl('text');
  t.setAttribute('x', BAND_X);
  t.setAttribute('y', cy);
  t.setAttribute('fill', color);
  t.setAttribute('font-size', BAND_FONT);
  t.setAttribute('font-family', 'Orbitron, system-ui');
  t.setAttribute('font-weight', '600');
  t.setAttribute('letter-spacing', '3');
  t.setAttribute('opacity', '0.55');
  t.setAttribute('dominant-baseline', 'middle');
  t.setAttribute('text-anchor', 'start');
  // Rotate 90deg around the label's center
  t.setAttribute('transform', 'rotate(-90, ' + BAND_X + ', ' + cy + ')');
  t.textContent = text;
  svg.appendChild(t);
}

/**
 * Orthogonal elbow connector: from bottom-center of upper node
 * to top-center of lower node, with a right-angle mid-step.
 */
function appendElbow(svg, from, to, nw, nh, color) {
  const x1 = from.x + nw / 2;
  const y1 = from.y + nh;
  const x2 = to.x   + nw / 2;
  const y2 = to.y;
  const mid = (y1 + y2) / 2;

  // Path: go down to midpoint, then horizontal, then down to target
  const d = [
    'M', x1, y1,
    'L', x1, mid,
    'L', x2, mid,
    'L', x2, y2
  ].join(' ');

  const path = svgEl('path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-opacity', '0.55');
  path.setAttribute('stroke-dasharray', '4 3');
  svg.appendChild(path);

  // Arrowhead at y2
  appendArrow(svg, x2, y2, color);
}

function appendArrow(svg, x, y, color) {
  const poly = svgEl('polygon');
  const s = 5;
  // Downward triangle
  const pts = [
    (x - s) + ',' + (y),
    (x + s) + ',' + (y),
    x       + ',' + (y + s * 1.5)
  ].join(' ');
  poly.setAttribute('points', pts);
  poly.setAttribute('fill', color);
  poly.setAttribute('opacity', '0.7');
  svg.appendChild(poly);
}

function appendNode(svg, pos, tierData, roleSlug) {
  const color = TIER_COLORS[tierData.tier];
  const x = pos.x;
  const y = pos.y;

  const g = svgEl('g');
  g.setAttribute('class', 'tree-node-group');
  g.setAttribute('role', 'img');
  g.setAttribute('aria-label', tierData.label + ' tier: ' + tierData.typical_titles.join(', '));

  // Background rect
  const rect = svgEl('rect');
  rect.setAttribute('x',      x);
  rect.setAttribute('y',      y);
  rect.setAttribute('width',  NODE_W);
  rect.setAttribute('height', NODE_H);
  rect.setAttribute('rx',     10);
  rect.setAttribute('fill',   'rgba(7,1,15,0.82)');
  rect.setAttribute('stroke', color);
  rect.setAttribute('stroke-width', '1.5');
  g.appendChild(rect);

  // Tier label (small)
  const tierLabel = svgEl('text');
  tierLabel.setAttribute('x', x + 12);
  tierLabel.setAttribute('y', y + 18);
  tierLabel.setAttribute('fill', color);
  tierLabel.setAttribute('font-size', '7');
  tierLabel.setAttribute('font-family', 'Orbitron, system-ui');
  tierLabel.setAttribute('font-weight', '600');
  tierLabel.setAttribute('letter-spacing', '2.5');
  tierLabel.setAttribute('opacity', '0.8');
  tierLabel.textContent = tierData.label;
  g.appendChild(tierLabel);

  // Primary title
  const title = svgEl('text');
  title.setAttribute('x', x + 12);
  title.setAttribute('y', y + 34);
  title.setAttribute('fill', '#ffffff');
  title.setAttribute('font-size', '11');
  title.setAttribute('font-family', 'Inter, system-ui');
  title.setAttribute('font-weight', '600');
  // Truncate long titles
  const primaryTitle = tierData.typical_titles[0] || '';
  title.textContent = primaryTitle.length > 28 ? primaryTitle.slice(0, 26) + '…' : primaryTitle;
  g.appendChild(title);

  // Salary range (if available)
  const sal = tierData.salary_range;
  if (sal) {
    const salText = svgEl('text');
    salText.setAttribute('x', x + 12);
    salText.setAttribute('y', y + 52);
    salText.setAttribute('fill', '#5a607a');
    salText.setAttribute('font-size', '9.5');
    salText.setAttribute('font-family', 'Inter, system-ui');
    const low  = sal.low  ? '$' + (sal.low  / 1000).toFixed(0) + 'k' : '?';
    const high = sal.high ? '$' + (sal.high / 1000).toFixed(0) + 'k' : '?';
    salText.textContent = low + ' – ' + high;
    g.appendChild(salText);

    // ⓘ icon for salary cite
    const citeCircle = svgEl('circle');
    citeCircle.setAttribute('cx', x + NODE_W - 16);
    citeCircle.setAttribute('cy', y + 49);
    citeCircle.setAttribute('r',  7);
    citeCircle.setAttribute('fill', 'rgba(74,247,255,0.1)');
    citeCircle.setAttribute('stroke', 'rgba(74,247,255,0.3)');
    citeCircle.setAttribute('stroke-width', '0.8');
    citeCircle.setAttribute('cursor', 'pointer');
    citeCircle.dataset = {};
    g.appendChild(citeCircle);

    const citeText = svgEl('text');
    citeText.setAttribute('x', x + NODE_W - 16);
    citeText.setAttribute('y', y + 53);
    citeText.setAttribute('fill', '#4af7ff');
    citeText.setAttribute('font-size', '8');
    citeText.setAttribute('font-family', 'Inter, system-ui');
    citeText.setAttribute('text-anchor', 'middle');
    citeText.setAttribute('dominant-baseline', 'middle');
    citeText.setAttribute('cursor', 'pointer');
    citeText.setAttribute('pointer-events', 'all');
    citeText.textContent = 'i';
    g.appendChild(citeText);

    // Tooltip trigger on the ⓘ group
    const citeGroup = svgEl('g');
    citeGroup.setAttribute('cursor', 'pointer');
    citeGroup.setAttribute('data-cite', 'true');

    // Invisible hit area (larger than the visible circle)
    const hit = svgEl('rect');
    hit.setAttribute('x',      x + NODE_W - 26);
    hit.setAttribute('y',      y + 40);
    hit.setAttribute('width',  20);
    hit.setAttribute('height', 18);
    hit.setAttribute('fill',   'transparent');
    citeGroup.appendChild(hit);

    const tooltipData = {
      title:    tierData.label + ' salary',
      body:     low + ' – ' + high + ' (US national median)',
      url:      sal.source_url,
      urlLabel: sal.source_label,
      warn:     sal.verify_before_publish
    };

    citeGroup.addEventListener('mouseenter', (e) => {
      Tooltip.show(citeGroup, tooltipData);
    });
    citeGroup.addEventListener('mouseleave', () => Tooltip.hide());
    citeGroup.addEventListener('click', (e) => {
      e.stopPropagation();
      Tooltip.show(citeGroup, tooltipData);
    });

    g.appendChild(citeGroup);
  }

  // Cert pill at bottom
  const cert = tierData.required_certs && tierData.required_certs[0];
  if (cert) {
    const certText = svgEl('text');
    certText.setAttribute('x', x + 12);
    certText.setAttribute('y', y + NODE_H - 8);
    certText.setAttribute('fill', color);
    certText.setAttribute('font-size', '8.5');
    certText.setAttribute('font-family', 'Inter, system-ui');
    certText.setAttribute('opacity', '0.75');
    const certName = cert.name.length > 34 ? cert.name.slice(0, 32) + '…' : cert.name;
    certText.textContent = certName;
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

    // Header (toggle button)
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

    // Toggle handler
    function toggle() {
      const isOpen = section.classList.toggle('open');
      header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });

    // Body
    const body = document.createElement('div');
    body.className = 'accordion-body';

    // Titles
    appendAccordionField(body, 'Typical Titles', tierData.typical_titles.join(', '));

    // Certs
    if (tierData.required_certs && tierData.required_certs.length) {
      const fieldEl = document.createElement('div');
      fieldEl.className = 'accordion-field';
      const fieldLabel = document.createElement('div');
      fieldLabel.className = 'accordion-field-label';
      fieldLabel.textContent = 'Certifications';
      fieldEl.appendChild(fieldLabel);
      const certWrap = document.createElement('div');
      certWrap.className = 'accordion-field-value';
      tierData.required_certs.forEach(cert => {
        const a = document.createElement('a');
        a.className = 'cert-pill';
        a.href = cert.source_url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = cert.name;
        if (cert.cost_usd) {
          a.title = '$' + cert.cost_usd + ' — ' + (cert.cost_note || '');
        }
        if (cert.verify_before_publish) {
          const badge = document.createElement('span');
          badge.className = 'vbp-badge';
          badge.textContent = 'verify';
          certWrap.appendChild(a);
          certWrap.appendChild(badge);
        } else {
          certWrap.appendChild(a);
        }
      });
      fieldEl.appendChild(certWrap);
      body.appendChild(fieldEl);
    }

    // Salary
    if (tierData.salary_range) {
      const sal = tierData.salary_range;
      const fieldEl = document.createElement('div');
      fieldEl.className = 'accordion-field';
      const fieldLabel = document.createElement('div');
      fieldLabel.className = 'accordion-field-label';
      fieldLabel.textContent = 'Salary Range';
      fieldEl.appendChild(fieldLabel);
      const val = document.createElement('div');
      val.className = 'accordion-field-value';

      const rangeSpan = document.createElement('span');
      rangeSpan.className = 'salary-range';
      const low  = sal.low  ? '$' + sal.low.toLocaleString()  : 'unknown';
      const high = sal.high ? '$' + sal.high.toLocaleString() : 'unknown';
      rangeSpan.textContent = low + ' – ' + high;

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

      if (sal.verify_before_publish) {
        const badge = document.createElement('span');
        badge.className = 'vbp-badge';
        badge.textContent = 'verify';
        val.appendChild(badge);
      }

      fieldEl.appendChild(val);
      body.appendChild(fieldEl);
    }

    // Education
    if (tierData.education_bar) {
      appendAccordionField(body, 'Education', tierData.education_bar);
    }

    // Time in tier
    if (tierData.typical_time_in_tier) {
      appendAccordionField(body, 'Typical Time in Tier', tierData.typical_time_in_tier);
    }

    // AI branch (senior only)
    if (tierData.ai_branch) {
      appendAccordionField(body, 'AI Branch (senior-only)', tierData.ai_branch.title + ': ' + tierData.ai_branch.note);
    }

    section.appendChild(header);
    section.appendChild(body);
    container.appendChild(section);
  });
}

function appendAccordionField(parent, label, value) {
  const fieldEl = document.createElement('div');
  fieldEl.className = 'accordion-field';
  const fieldLabel = document.createElement('div');
  fieldLabel.className = 'accordion-field-label';
  fieldLabel.textContent = label;
  const fieldValue = document.createElement('div');
  fieldValue.className = 'accordion-field-value';
  fieldValue.textContent = value;
  fieldEl.appendChild(fieldLabel);
  fieldEl.appendChild(fieldValue);
  parent.appendChild(fieldEl);
}

// ── SVG helper ────────────────────────────────────────────────────────────────
function svgEl(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

// ── Error display ─────────────────────────────────────────────────────────────
function showError(msg) {
  const container = document.getElementById('tree-container');
  if (container) {
    const p = document.createElement('p');
    p.style.cssText = 'color:var(--muted);padding:40px 24px;font-size:0.9rem;';
    p.textContent = msg;
    container.appendChild(p);
  }
}

// ── Particles (re-used) ───────────────────────────────────────────────────────
function initParticles() {
  const bg = document.getElementById('bg-canvas');
  if (!bg) return;
  const bx = bg.getContext('2d');
  let W, H, pts;
  function init() {
    W = bg.width  = window.innerWidth;
    H = bg.height = window.innerHeight;
    pts = Array.from({length: 70}, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.2 + 0.2,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      a: Math.random() * 0.6 + 0.1
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
