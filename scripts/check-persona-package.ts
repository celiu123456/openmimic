#!/usr/bin/env npx tsx
/**
 * Persona package privacy audit: verifies that the `.persona` export does not
 * contain private content that testimony witnesses marked as secret.
 *
 * Uses built-in demo data (limo fixture). No model calls, no network.
 *
 * Usage:
 *   npx tsx scripts/check-persona-package.ts
 *
 * Exit code 0 = clean, 1 = private content found.
 */

import { Store } from '@openmimic/kernel';
import { buildPersonaPackage } from '../server/src/persona-package';
import { seedDemo, DEMO_SUBJECT_ID } from '../fixtures/limo';
import { PRIVATE_MARKERS } from '@openmimic/engine-room';

/* ------------------------------------------------------------------ */
/* Private content search terms (from limo fixture)                    */
/* ------------------------------------------------------------------ */

/**
 * Words and phrases that appear in testimony marked with secrecy markers.
 * If any of these appear in the exported package, the privacy filter failed.
 */
const PRIVATE_SEARCH_TERMS = [
  // From faxiao q1: "借了两万...千万别跟他妈提"
  '两万',
  '手头周转',
  // From faxiao q10: "你可别跟我妈说" about resignation
  '你可别跟我妈说',
  '千万别跟他妈提',
  // Broader markers
  '别告诉',
  '千万别',
  '别外传',
  '你可别',
  '谁都没说',
  '嘱咐我',
];

/* ------------------------------------------------------------------ */
/* Deep text scan                                                      */
/* ------------------------------------------------------------------ */

interface Hit {
  field: string;
  term: string;
  snippet: string;
}

function scanValue(obj: unknown, path: string, term: string, hits: Hit[]): void {
  if (typeof obj === 'string') {
    if (obj.includes(term)) {
      const idx = obj.indexOf(term);
      const start = Math.max(0, idx - 15);
      const end = Math.min(obj.length, idx + term.length + 15);
      hits.push({
        field: path,
        term,
        snippet: (start > 0 ? '...' : '') + obj.substring(start, end) + (end < obj.length ? '...' : ''),
      });
    }
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      scanValue(obj[i], `${path}[${i}]`, term, hits);
    }
  } else if (obj !== null && typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj)) {
      scanValue(val, `${path}.${key}`, term, hits);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function main(): void {
  // Set up in-memory store with demo data
  const store = new Store();
  seedDemo(store);

  // Build persona package
  const pkg = buildPersonaPackage(DEMO_SUBJECT_ID, store, {
    acknowledgeRealPerson: true,
    now: () => new Date('2026-10-06T00:00:00.000Z'),
  });

  if (!pkg) {
    console.error('ERROR: buildPersonaPackage returned undefined');
    process.exit(1);
  }

  console.log(`Persona package for "${pkg.subject.displayName}"`);
  console.log(`  Claims: ${pkg.claims.length}`);
  console.log(`  Style samples: ${pkg.styleSamples.length}`);
  console.log(`  Episodes: ${pkg.episodes?.length ?? 0}`);
  console.log(`  Corpus items: ${pkg.corpus?.length ?? 0}`);
  console.log(`  Divergences: ${pkg.divergences?.length ?? 0}`);
  console.log(`  Witnesses: ${pkg.witnesses.length}`);
  console.log();

  // Scan for private content
  const allHits: Hit[] = [];
  for (const term of PRIVATE_SEARCH_TERMS) {
    scanValue(pkg, 'package', term, allHits);
  }

  // Also scan for PRIVATE_MARKERS themselves
  for (const marker of PRIVATE_MARKERS) {
    if (!PRIVATE_SEARCH_TERMS.includes(marker)) {
      scanValue(pkg, 'package', marker, allHits);
    }
  }

  if (allHits.length === 0) {
    console.log('PASS: No private content found in persona package.');
    console.log();
    console.log('Verified search terms:');
    for (const term of PRIVATE_SEARCH_TERMS) {
      console.log(`  [clean] ${term}`);
    }
    store.close();
    process.exit(0);
  } else {
    console.error(`FAIL: ${allHits.length} private content hit(s) found:\n`);
    for (const hit of allHits) {
      console.error(`  Field: ${hit.field}`);
      console.error(`  Term:  ${hit.term}`);
      console.error(`  Found: ${hit.snippet}`);
      console.error();
    }
    store.close();
    process.exit(1);
  }
}

main();
