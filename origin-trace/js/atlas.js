/**
 * atlas.js
 * Builds the Career Atlas grid on map.html using safe DOM methods only.
 * All content is hardcoded static data — no user input.
 */

// ── Research index: roles with full data linking to role.html ─────────────────
const RESEARCHED = {
  'Help Desk / IT Support':    'role.html?role=help-desk',
  'NOC Technician':            'role.html?role=noc-technician',
  'Cloud Support Associate':   'role.html?role=cloud-support',
  'GRC / IT Audit Analyst T1': 'role.html?role=grc-analyst',
  'SOC Analyst T1':            'role.html?role=soc-analyst',
  'Junior Network Admin':      'role.html?role=junior-network-admin'
};

// ── Taxonomy (sourced verbatim from memory; managerial titles capped at Senior IC)
// families[i] = { name, entry[], mid[], senior[] }
const FAMILIES = [
  {
    name: 'IT Ops',
    entry:  ['Help Desk / IT Support', 'NOC Technician', 'IT Field Technician', 'Data Center Technician'],
    mid:    ['Desktop Support Engineer', 'Network Admin', 'Site IT Lead', 'DC Operations Engineer'],
    senior: ['Sr. Sysadmin', 'Sr. Network Engineer', 'Sr. Field Engineer', 'Sr. DC Engineer']
  },
  {
    name: 'Cloud',
    entry:  ['Cloud Support Associate'],
    mid:    ['Cloud Engineer', 'Cloud Ops / DevOps', 'FinOps Analyst'],
    senior: ['Sr. Cloud Engineer', 'Sr. Platform Engineer', 'Staff SRE', 'Sr. FinOps Engineer', 'Cloud Architect']
  },
  {
    name: 'Software / Platform',
    entry:  ['Jr. Software Engineer', 'Jr. Backend / Frontend'],
    mid:    ['Software Engineer', 'Data Engineer', 'Database Admin (DBA)'],
    senior: ['Sr. SWE', 'Staff / Principal Engineer', 'Sr. Data Engineer', 'Sr. DBA']
  },
  {
    name: 'Security',
    entry:  ['SOC Analyst T1', 'Junior Network Admin'],
    mid:    ['SOC Analyst T2', 'Jr. Pentester', 'Incident Responder', 'Detection Engineer'],
    senior: ['SOC T3 / Threat Hunter', 'Sr. Pentester', 'Cloud Security Engineer', 'AppSec Engineer', 'DevSecOps Engineer', 'IAM Engineer']
  },
  {
    name: 'GRC / Audit',
    entry:  ['GRC / IT Audit Analyst T1'],
    mid:    ['GRC Engineer', 'Compliance Analyst', 'Risk Analyst', 'Privacy Analyst'],
    senior: ['Sr. GRC Engineer', 'Sr. IT Auditor', 'Sr. Compliance Lead', 'Sr. Risk Lead', 'Privacy Engineer']
  },
  {
    name: 'AI / ML',
    // No honest no-IT-background direct entry — reachable only through other tracks
    entry:  [],
    mid:    ['Data Analyst', 'ML Engineer (via SWE)', 'MLOps Engineer (via DevOps)'],
    senior: ['Sr. Data Scientist', 'Sr. MLE', 'AI Security Engineer (via SOC)', 'AI Red Team (via Red Team)']
  },
  {
    name: 'Cross-Track Bridges',
    entry:  ['Help Desk → SOC T1 (Sec+)', 'Help Desk → Cloud Support (CCP)'],
    mid:    ['NOC → Cloud Network Eng', 'Sysadmin → DevOps → SRE', 'IT Auditor → GRC → Cloud Sec'],
    senior: ['SOC T2 → Detection Eng / Threat Hunter', 'Data Engineer → MLOps → AI/ML']
  }
];

const TIERS     = ['entry', 'mid', 'senior'];
const TIER_DISP = { entry: 'ENTRY', mid: 'MID', senior: 'SENIOR' };

// ── Banner ────────────────────────────────────────────────────────────────────
function buildBanner() {
  const banner = document.getElementById('atlas-banner');
  if (!banner) return;

  const strong = document.createElement('strong');
  strong.textContent = 'Heads up:';
  banner.appendChild(strong);

  const rest = document.createTextNode(
    ' Only the 6 highlighted roles (cyan border + ✓ Researched) have cited salary, cert, and timeline data. ' +
    'Everything else is orientation context for the landscape — not career advice.'
  );
  banner.appendChild(rest);
}

// ── Main grid ─────────────────────────────────────────────────────────────────
function buildAtlas() {
  const section = document.getElementById('atlas-section');
  if (!section) return;

  buildBanner();

  const gridWrap = document.createElement('div');
  gridWrap.className = 'atlas-grid';

  // Row 1: family header cells
  FAMILIES.forEach(f => {
    const hdr = document.createElement('div');
    hdr.className = 'atlas-family-header';
    const nameEl = document.createElement('div');
    nameEl.className = 'atlas-family-name';
    nameEl.textContent = f.name;
    hdr.appendChild(nameEl);
    gridWrap.appendChild(hdr);
  });

  // For each tier: full-width label row + one cell per family
  TIERS.forEach(tier => {
    // Tier label row
    const labelRow = document.createElement('div');
    labelRow.className = 'atlas-tier-label-row';
    labelRow.dataset.tier = tier;
    labelRow.style.gridColumn = '1 / -1';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = TIER_DISP[tier];
    labelRow.appendChild(labelSpan);
    gridWrap.appendChild(labelRow);

    // One cell per family
    FAMILIES.forEach(f => {
      const cell = document.createElement('div');
      cell.className = 'atlas-cell';
      cell.dataset.tier = tier;

      const roles = f[tier] || [];

      if (roles.length === 0 && tier === 'entry' && f.name === 'AI / ML') {
        const note = document.createElement('span');
        note.className = 'atlas-pill';
        note.style.fontStyle = 'italic';
        note.textContent = 'No direct entry — reachable via other tracks';
        cell.appendChild(note);
      } else {
        roles.forEach(role => {
          const url = RESEARCHED[role];
          if (url) {
            const a = document.createElement('a');
            a.className = 'atlas-pill researched';
            a.href = url;
            a.textContent = role;
            a.title = 'View researched career tree';
            cell.appendChild(a);
          } else {
            const span = document.createElement('span');
            span.className = 'atlas-pill';
            span.textContent = role;
            cell.appendChild(span);
          }
        });
      }

      gridWrap.appendChild(cell);
    });
  });

  section.appendChild(gridWrap);

  // Cross-track bridge section (standalone list below the grid)
  const bridgeWrap = document.createElement('div');
  bridgeWrap.className = 'bridge-section';

  const bridgeHeading = document.createElement('h3');
  bridgeHeading.textContent = 'Cross-Track Bridges';
  bridgeWrap.appendChild(bridgeHeading);

  const ul = document.createElement('ul');
  ul.className = 'bridge-list';

  const bridges = [
    'Help Desk → SOC T1 (with Sec+) → defensive security track',
    'Help Desk → Cloud Support (with CCP/AZ-900) → cloud track',
    'NOC → Network Engineer → Cloud Network Engineer',
    'Sysadmin → DevOps Engineer → SRE → Platform',
    'SOC T2 → Detection Engineer or Threat Hunter or AI Security',
    'Data Engineer → MLOps → AI/ML track',
    'IT Auditor → GRC Engineer → Cloud Security GRC'
  ];

  bridges.forEach(b => {
    const li = document.createElement('li');
    li.className = 'bridge-item';
    li.textContent = b;
    ul.appendChild(li);
  });

  bridgeWrap.appendChild(ul);
  section.appendChild(bridgeWrap);
}

document.addEventListener('DOMContentLoaded', buildAtlas);
