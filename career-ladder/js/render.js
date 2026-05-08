/**
 * render.js — builds and injects level cards into #ladder-container
 */

import { salaryBarWidth, buildChip } from './utils.js';

/**
 * Formats a salary integer as a compact string like "$65K" or "$220K".
 *
 * @param {number} n
 * @returns {string}
 */
function fmtSalary(n) {
  return `$${Math.round(n / 1_000)}K`;
}

/**
 * Clears #ladder-container and renders one card per level.
 *
 * @param {object} data  - parsed JSON (has .track and .levels)
 * @param {'civ'|'gov'} mode
 */
export function renderTrack(data, mode) {
  const container = document.getElementById('ladder-container');
  // Safe clear — replaceChildren with no args removes all children without XSS risk
  container.replaceChildren();

  if (!data.levels || data.levels.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'placeholder-msg';
    msg.textContent = 'No levels found for this track.';
    container.appendChild(msg);
    return;
  }

  for (const level of data.levels) {
    const modeData = level[mode]; // civ or gov sub-object

    const article = document.createElement('article');
    article.className = 'level-card';
    article.dataset.levelId = level.id;

    // ── Header row ────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'level-card__header';

    const title = document.createElement('h2');
    title.className = 'level-card__title';
    title.textContent = level.title;

    const badge = document.createElement('span');
    badge.className = 'level-card__years-badge';
    badge.textContent = `${level.years_exp} yrs`;

    header.appendChild(title);
    header.appendChild(badge);
    article.appendChild(header);

    // ── Salary bar ────────────────────────────────────────────────────────────
    const { left, width } = salaryBarWidth(modeData.salary_min, modeData.salary_max);

    const barWrap = document.createElement('div');
    barWrap.className = 'salary-bar';

    const fill = document.createElement('span');
    fill.className = 'salary-bar__fill';
    fill.style.left = left;
    fill.style.width = width;

    const label = document.createElement('span');
    label.className = 'salary-bar__label';
    label.textContent = `${fmtSalary(modeData.salary_min)}–${fmtSalary(modeData.salary_max)}`;

    barWrap.appendChild(fill);
    barWrap.appendChild(label);
    article.appendChild(barWrap);

    // ── Gov-only fields ───────────────────────────────────────────────────────
    if (mode === 'gov') {
      const govMeta = document.createElement('div');
      govMeta.className = 'level-card__gov-meta';

      const gsSpan = document.createElement('span');
      gsSpan.className = 'level-card__gs-range';
      gsSpan.textContent = `GS Range: ${modeData.gs_range}`;

      const clearSpan = document.createElement('span');
      clearSpan.className = 'level-card__clearance';
      clearSpan.textContent = `Clearance: ${modeData.clearance}`;

      govMeta.appendChild(gsSpan);
      govMeta.appendChild(clearSpan);
      article.appendChild(govMeta);
    }

    // ── Skills ────────────────────────────────────────────────────────────────
    if (level.skills && level.skills.length > 0) {
      const skillsSection = document.createElement('div');
      skillsSection.className = 'level-card__section';

      const skillsLabel = document.createElement('h3');
      skillsLabel.className = 'level-card__section-label';
      skillsLabel.textContent = 'Skills';

      const skillsChips = document.createElement('div');
      skillsChips.className = 'chip-group';

      for (const skill of level.skills) {
        skillsChips.appendChild(buildChip(skill, 'skill'));
      }

      skillsSection.appendChild(skillsLabel);
      skillsSection.appendChild(skillsChips);
      article.appendChild(skillsSection);
    }

    // ── Certs ─────────────────────────────────────────────────────────────────
    if (level.certs && level.certs.length > 0) {
      const certsSection = document.createElement('div');
      certsSection.className = 'level-card__section';

      const certsLabel = document.createElement('h3');
      certsLabel.className = 'level-card__section-label';
      certsLabel.textContent = 'Certifications';

      const certsChips = document.createElement('div');
      certsChips.className = 'chip-group';

      for (const cert of level.certs) {
        certsChips.appendChild(buildChip(cert, 'cert'));
      }

      certsSection.appendChild(certsLabel);
      certsSection.appendChild(certsChips);
      article.appendChild(certsSection);
    }

    // ── Example roles & orgs ──────────────────────────────────────────────────
    if (modeData.example_roles || modeData.example_orgs) {
      const exSection = document.createElement('div');
      exSection.className = 'level-card__section';

      const exLabel = document.createElement('h3');
      exLabel.className = 'level-card__section-label';
      exLabel.textContent = 'Example Roles & Orgs';
      exSection.appendChild(exLabel);

      if (modeData.example_roles && modeData.example_roles.length > 0) {
        const rolesP = document.createElement('p');
        rolesP.className = 'level-card__example-roles';
        rolesP.textContent = modeData.example_roles.join(', ');
        exSection.appendChild(rolesP);
      }

      if (modeData.example_orgs && modeData.example_orgs.length > 0) {
        const orgsP = document.createElement('p');
        orgsP.className = 'level-card__example-orgs';
        orgsP.textContent = modeData.example_orgs.join(', ');
        exSection.appendChild(orgsP);
      }

      article.appendChild(exSection);
    }

    // ── Callout: next_steps + milestone ───────────────────────────────────────
    const callout = document.createElement('div');
    callout.className = 'level-callout';

    if (level.next_steps) {
      const nextP = document.createElement('p');
      nextP.className = 'level-callout__next-steps';
      nextP.textContent = level.next_steps;
      callout.appendChild(nextP);
    }

    if (level.milestone) {
      const mileP = document.createElement('p');
      mileP.className = 'level-callout__milestone';
      mileP.textContent = `Milestone: ${level.milestone}`;
      callout.appendChild(mileP);
    }

    article.appendChild(callout);
    container.appendChild(article);
  }
}
