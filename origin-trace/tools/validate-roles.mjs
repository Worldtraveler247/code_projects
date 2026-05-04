#!/usr/bin/env node
/**
 * validate-roles.mjs
 * Validates data/roles.json against the Origin Trace content schema.
 * Run: node tools/validate-roles.mjs
 *
 * Checks:
 *  1. Required top-level fields per role
 *  2. Required fields per tier
 *  3. Lists all verify_before_publish: true flags (BLOCK LAUNCH gate)
 *  4. Warns about any salary/cert entries without a source_url
 *  5. Rejects null salary ranges not flagged as verify_before_publish
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath  = resolve(__dirname, '../data/roles.json');

let raw;
try {
  raw = readFileSync(dataPath, 'utf-8');
} catch (e) {
  console.error('ERROR: Could not read data/roles.json —', e.message);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch (e) {
  console.error('ERROR: data/roles.json is not valid JSON —', e.message);
  process.exit(1);
}

const ROLE_REQUIRED  = ['id', 'slug', 'title', 'icon', 'tiers', 'node_positions'];
const TIER_REQUIRED  = ['tier', 'label', 'typical_titles', 'education_bar', 'salary_range', 'typical_time_in_tier'];
const VALID_TIERS    = new Set(['entry', 'mid', 'senior']);

let errors = 0;
const vbpFlags = [];   // verify_before_publish items to report

function err(msg) {
  console.error('  [ERR]', msg);
  errors++;
}
function warn(msg) {
  console.warn('  [WARN]', msg);
}

console.log('\nValidating', dataPath, '\n');

const { roles } = parsed;
if (!Array.isArray(roles) || roles.length === 0) {
  console.error('ERROR: "roles" must be a non-empty array.');
  process.exit(1);
}

roles.forEach(role => {
  console.log('Role:', role.id || '(no id)');

  // Top-level required fields
  ROLE_REQUIRED.forEach(field => {
    if (role[field] == null) err(field + ' is missing');
  });

  if (!Array.isArray(role.tiers)) { err('tiers is not an array'); return; }

  const tierSlugs = new Set(role.tiers.map(t => t.tier));
  VALID_TIERS.forEach(t => {
    if (!tierSlugs.has(t)) err('missing tier: ' + t);
  });

  role.tiers.forEach(tier => {
    const prefix = '  tier[' + tier.tier + ']';

    TIER_REQUIRED.forEach(field => {
      if (tier[field] == null) err(prefix + ' — ' + field + ' is missing');
    });

    // salary_range checks
    const sal = tier.salary_range;
    if (sal) {
      if (!sal.source_url) err(prefix + ' salary_range has no source_url');
      if (!sal.source_label) warn(prefix + ' salary_range has no source_label');
      if (sal.low == null && !sal.verify_before_publish) {
        err(prefix + ' salary_range.low is null but verify_before_publish is not set');
      }
      if (sal.verify_before_publish) {
        vbpFlags.push(role.id + ' / ' + tier.tier + ' / salary_range');
      }
    }

    // cert checks
    if (Array.isArray(tier.required_certs)) {
      tier.required_certs.forEach((cert, i) => {
        if (!cert.name)       err(prefix + ' cert[' + i + '] has no name');
        if (!cert.source_url) err(prefix + ' cert[' + i + '] has no source_url');
        if (cert.verify_before_publish) {
          vbpFlags.push(role.id + ' / ' + tier.tier + ' / cert: ' + cert.name);
        }
      });
    }

    // typical_titles must be non-empty array
    if (!Array.isArray(tier.typical_titles) || tier.typical_titles.length === 0) {
      err(prefix + ' typical_titles is empty');
    }
  });

  // node_positions
  if (role.node_positions) {
    VALID_TIERS.forEach(t => {
      const pos = role.node_positions[t];
      if (!pos || pos.x == null || pos.y == null) {
        err('node_positions.' + t + ' is missing x/y');
      }
    });
  }

  console.log('');
});

// ── Summary ────────────────────────────────────────────────────────────────────
if (vbpFlags.length > 0) {
  console.log('────────────────────────────────────────────────────────');
  console.log('LAUNCH BLOCKED — ' + vbpFlags.length + ' verify_before_publish flag(s) must be cleared:\n');
  vbpFlags.forEach(f => console.log('  •', f));
  console.log('');
}

if (errors > 0) {
  console.error('────────────────────────────────────────────────────────');
  console.error(errors + ' error(s) found. Fix before publishing.');
  process.exit(1);
} else if (vbpFlags.length > 0) {
  console.log('Schema valid. Clear verify_before_publish flags before launch.');
  process.exit(2);   // Non-zero so CI can distinguish "valid but blocked" from "ready"
} else {
  console.log('All checks passed. Ready to publish.');
  process.exit(0);
}
