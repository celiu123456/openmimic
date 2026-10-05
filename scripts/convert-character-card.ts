#!/usr/bin/env npx tsx
/**
 * CLI: convert between .persona and SillyTavern Character Card V2.
 *
 * Usage:
 *   # Export .persona → character card JSON
 *   npx tsx scripts/convert-character-card.ts export <persona.json> --acknowledge-real-person [--png] [-o output]
 *
 *   # Import character card → .persona-like JSON (preview, not a real import)
 *   npx tsx scripts/convert-character-card.ts import <card.json|card.png> [-o output]
 *
 * Privacy:
 * - The export path applies private-content filtering (PRIVATE_MARKERS +
 *   CN_AMOUNT_RE) on the .persona package content.
 * - If the package contains synthesis_only witnesses, the CLI refuses and
 *   directs the user to the HTTP API (synthesis_only filtering requires a
 *   live store).
 * - Exporting a real-person persona requires --acknowledge-real-person.
 *
 * The import path parses a V2 card and prints the claim/corpus breakdown;
 * it does not write to any database (use the HTTP route for that).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CharacterCardV2Schema } from '../plugins/bridge-sillytavern/src/character-card';
import { readCharaFromPng, writeCharaToPng, generateMinimalPng } from '../plugins/bridge-sillytavern/src/png';

/* ------------------------------------------------------------------ */
/* Private-content filtering (same logic as export.ts / kernel)        */
/* ------------------------------------------------------------------ */

const PRIVATE_MARKERS = [
  '别告诉', '别跟', '千万别', '别外传', '只跟你说',
  '你可别', '你别跟', '谁都没说', '别人不知道', '没跟', '嘱咐我',
];

const CN_AMOUNT_RE =
  /(?<!千)[一二两三四五六七八九十百\d]+[万千百亿](?:[一二两三四五六七八九十百千万]*)(?:块|元)?|\d[\d,.]*(?:万|千|百|元|块)/g;

function splitSentences(text: string): string[] {
  return text.split(/(?<=[。！？；\n])/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Extract private key phrases from all available texts in the package.
 * Same algorithm as export.ts's extractPrivateKeyPhrases.
 */
function extractPrivateKeyPhrases(texts: string[]): Set<string> {
  const phrases = new Set<string>();
  for (const text of texts) {
    const sentences = splitSentences(text);
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i]!;
      if (PRIVATE_MARKERS.some((m) => s.includes(m))) {
        // The marker sentence + preceding sentence
        if (i > 0) {
          for (const amt of [...sentences[i - 1]!.matchAll(CN_AMOUNT_RE)].map((m) => m[0])) {
            phrases.add(amt);
          }
        }
        for (const amt of [...s.matchAll(CN_AMOUNT_RE)].map((m) => m[0])) {
          phrases.add(amt);
        }
        for (const m of PRIVATE_MARKERS) {
          if (s.includes(m)) phrases.add(m);
        }
      }
    }
  }
  return phrases;
}

function containsPrivateContent(text: string, phrases: Set<string>): boolean {
  for (const p of phrases) {
    if (text.includes(p)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* CLI argument parsing                                                */
/* ------------------------------------------------------------------ */

function usage(): never {
  console.error(`
Usage:
  convert-character-card export <persona-package.json> --acknowledge-real-person [--png] [-o output]
  convert-character-card import <card.json|card.png> [-o output]

Export: reads a .persona package JSON file and converts it to a
Character Card V2 JSON (or PNG with --png).

  --acknowledge-real-person  Required for non-imported personas. Confirms
                             the caller understands they are distributing a
                             persona based on a real person.

Import: reads a Character Card V2 (JSON or PNG) and prints the
extracted fields. Use the HTTP API for actual database import.
`.trim());
  process.exit(1);
}

function parseArgs(args: string[]): {
  command: 'export' | 'import';
  inputFile: string;
  outputFile?: string;
  png: boolean;
  acknowledgeRealPerson: boolean;
} {
  if (args.length < 2) usage();
  const command = args[0] as 'export' | 'import';
  if (command !== 'export' && command !== 'import') usage();

  const inputFile = args[1]!;
  let outputFile: string | undefined;
  let png = false;
  let acknowledgeRealPerson = false;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--png') png = true;
    else if (args[i] === '--acknowledge-real-person' || args[i] === '--arp') acknowledgeRealPerson = true;
    else if (args[i] === '-o' && i + 1 < args.length) {
      outputFile = args[++i];
    }
  }

  return { command, inputFile, outputFile, png, acknowledgeRealPerson };
}

/* ------------------------------------------------------------------ */
/* Export                                                               */
/* ------------------------------------------------------------------ */

function exportPersona(inputFile: string, outputFile?: string, png = false, acknowledgeRealPerson = false): void {
  const raw = readFileSync(resolve(inputFile), 'utf8');
  const pkg = JSON.parse(raw);

  if (pkg.format !== 'openmimic.persona') {
    console.error('Error: input is not an OpenMimic .persona package');
    process.exit(1);
  }

  // --- Real-person gate ---
  const isImported = pkg.report?.imported === true;
  if (!isImported && !acknowledgeRealPerson) {
    console.error(
      'Error: This persona depicts a real person. Distributing a personality card\n' +
      'based on someone else requires their authorization.\n' +
      'Pass --acknowledge-real-person to proceed.',
    );
    process.exit(1);
  }

  // --- synthesis_only gate ---
  const witnesses = pkg.witnesses ?? [];
  const hasSynthesisOnly = witnesses.some(
    (w: { consentLevel: string }) => w.consentLevel === 'synthesis_only',
  );
  if (hasSynthesisOnly) {
    console.error(
      'Error: This persona has synthesis_only witnesses. The CLI cannot perform\n' +
      'the overlap-based filtering required for synthesis_only content.\n' +
      'Use the HTTP API endpoint to export with full privacy protection:\n' +
      '  curl "http://localhost:3000/api/subjects/$ID/export/character-card?acknowledgeRealPerson=true"',
    );
    process.exit(1);
  }

  // --- Private-content filtering ---
  // Collect all text from claims, episodes, corpus for marker scanning.
  const allTexts: string[] = [];
  for (const claim of (pkg.claims ?? [])) {
    if (typeof claim.text === 'string') allTexts.push(claim.text);
  }
  for (const ep of (pkg.episodes ?? [])) {
    if (typeof ep.text === 'string') allTexts.push(ep.text);
  }
  for (const ci of (pkg.corpus ?? [])) {
    if (typeof ci.text === 'string') allTexts.push(ci.text);
  }
  // styleSamples may also contain private-adjacent text
  for (const ss of (pkg.styleSamples ?? [])) {
    if (typeof ss.text === 'string') allTexts.push(ss.text);
  }

  const privateKeyPhrases = extractPrivateKeyPhrases(allTexts);
  const isPrivate = (text: string) => containsPrivateContent(text, privateKeyPhrases);

  if (privateKeyPhrases.size > 0) {
    console.error(
      `Warning: detected ${privateKeyPhrases.size} private key phrase(s) in the package.\n` +
      'Filtering claims, episodes, and corpus that contain private content.',
    );
  }

  const claims = (pkg.claims ?? [])
    .filter((c: { status: string; text: string }) => c.status === 'surviving' && !isPrivate(c.text));
  const episodes = (pkg.episodes ?? [])
    .filter((ep: { text: string }) => !isPrivate(ep.text));
  const corpus = (pkg.corpus ?? [])
    .filter((ci: { text: string }) => !isPrivate(ci.text));

  // --- Build description with claims + episodes ---
  const descriptionLines: string[] = [];

  if (claims.length > 0) {
    descriptionLines.push('## 别人眼中的他');
    for (const c of claims) {
      const q = c.qualifiers?.length ? `（限定：${c.qualifiers.join('；')}）` : '';
      descriptionLines.push(`- ${c.text}${q}`);
    }
  }

  if (episodes.length > 0) {
    // Build witness relation map from package
    const witnessRelationMap = new Map<string, string>();
    for (const w of witnesses) {
      for (const eid of (w.evidenceIds ?? [])) {
        witnessRelationMap.set(eid, w.relation);
      }
    }

    descriptionLines.push('');
    descriptionLines.push('## 别人讲过的事');
    // Round-robin by witness, up to 12
    const byWitness = new Map<string, typeof episodes>();
    for (const ep of episodes) {
      const wid = ep.witnessId ?? '';
      if (!byWitness.has(wid)) byWitness.set(wid, []);
      byWitness.get(wid)!.push(ep);
    }
    const witnessIds = [...byWitness.keys()];
    const indices = new Map<string, number>();
    for (const wid of witnessIds) indices.set(wid, 0);
    const picked: typeof episodes = [];
    let added = true;
    while (added && picked.length < 12) {
      added = false;
      for (const wid of witnessIds) {
        if (picked.length >= 12) break;
        const idx = indices.get(wid)!;
        const eps = byWitness.get(wid)!;
        if (idx < eps.length) {
          picked.push(eps[idx]!);
          indices.set(wid, idx + 1);
          added = true;
        }
      }
    }
    // Resolve relation for each episode's witness
    const resolveRelation = (ep: { witnessId?: string }): string => {
      // Try to find the witness in the package by ID match
      for (const w of witnesses) {
        // Episodes carry witnessId; witnesses don't carry their own id in package
        // but we can use evidenceIds to correlate
      }
      return '证人';
    };

    for (const ep of picked) {
      // Find relation from witness list by matching witnessId pattern
      let relation = '证人';
      for (const w of witnesses) {
        // The package's witness entries don't carry their original ID,
        // but we can match by evidence IDs or just use the relation field
        // when the witnessId appears as a key in the evidence mapping.
        // Since the .persona package doesn't carry a direct witnessId→relation
        // map, we iterate and check if this episode's witnessId matches
        // any testimony that this witness contributed.
        if (w.evidenceIds?.some((eid: string) => {
          // The episode's testimonyId should match one of the witness's evidence IDs
          return ep.testimonyId === eid;
        })) {
          relation = w.relation;
          break;
        }
      }
      const situationTag = ep.situation ? `（${ep.situation}）` : '';
      descriptionLines.push(`- ${relation}${situationTag}:「${ep.text}」`);
    }
  }

  const mesExampleLines: string[] = [];
  for (const ci of corpus) {
    mesExampleLines.push('<START>');
    mesExampleLines.push(`{{char}}: ${ci.text}`);
  }

  // personality: audience-aware claims
  const personalityParts: string[] = [];
  for (const claim of claims) {
    if (claim.context?.audience) {
      const prefix = claim.context.audience.startsWith('对') ? '' : '对';
      personalityParts.push(`${prefix}${claim.context.audience}：${claim.text}`);
    }
  }
  if (personalityParts.length === 0) {
    personalityParts.push(...claims.slice(0, 3).map((c: { text: string }) => c.text));
  }

  const card = {
    spec: 'chara_card_v2' as const,
    spec_version: '2.0' as const,
    data: {
      name: pkg.subject?.displayName ?? 'Unknown',
      description: descriptionLines.join('\n') || pkg.subject?.displayName || '',
      personality: personalityParts.join('\n'),
      scenario: '',
      first_mes: corpus[0]?.text ?? '...嗯？你找我？',
      mes_example: mesExampleLines.join('\n'),
      creator_notes: [
        `Generated by OpenMimic CLI from .persona package.`,
        `Based on ${witnesses.length} witness(es). Exported at: ${pkg.exportedAt ?? new Date().toISOString()}`,
        '',
        'IMPORTANT: This card does NOT contain the original testimonies.',
        'Once outside OpenMimic, there is no output-side fact-checking or privacy protection.',
      ].join('\n'),
      system_prompt: [
        `你正在扮演基于他人证言构建的${pkg.subject?.displayName ?? '此人'}。这是人格模拟,不是本人。`,
        '',
        '只依据 description 里的侧面与别人讲过的事来扮演,不虚构素材之外的信息。',
      ].join('\n'),
      post_history_instructions:
        '记住:这是基于证言的人格模拟,不是本人。只说素材里有的事,不确定的就以本人口吻说记不清。',
      alternate_greetings: [] as string[],
      tags: ['openmimic', 'testimony-based'],
      creator: 'OpenMimic',
      character_version: '0.0.1',
      extensions: {} as Record<string, unknown>,
    },
  };

  const json = JSON.stringify(card, null, 2);

  if (png) {
    const placeholder = generateMinimalPng();
    const pngBuf = writeCharaToPng(placeholder, json);
    const out = outputFile ?? inputFile.replace(/\.json$/i, '.png');
    writeFileSync(resolve(out), pngBuf);
    console.log(`Written PNG card to: ${out}`);
  } else {
    const out = outputFile ?? inputFile.replace(/\.persona(\.json)?$/i, '.card.json');
    writeFileSync(resolve(out), json, 'utf8');
    console.log(`Written JSON card to: ${out}`);
  }

  if (privateKeyPhrases.size > 0) {
    console.log(
      `Privacy: filtered out content containing ${privateKeyPhrases.size} private key phrase(s).`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

function importCard(inputFile: string, outputFile?: string): void {
  const filePath = resolve(inputFile);
  const raw = readFileSync(filePath);

  let cardData: unknown;
  if (inputFile.toLowerCase().endsWith('.png')) {
    cardData = readCharaFromPng(raw);
    if (!cardData) {
      console.error('Error: PNG does not contain a chara tEXt chunk');
      process.exit(1);
    }
  } else {
    cardData = JSON.parse(raw.toString('utf8'));
  }

  const card = CharacterCardV2Schema.parse(cardData);
  const { data } = card;

  console.log(`Name: ${data.name}`);
  console.log(`Description length: ${data.description.length} chars`);
  console.log(`Personality length: ${data.personality.length} chars`);
  console.log(`Scenario: ${data.scenario || '(empty)'}`);
  console.log(`First message: ${data.first_mes.slice(0, 80)}${data.first_mes.length > 80 ? '...' : ''}`);
  console.log(`Example messages: ${data.mes_example.length} chars`);
  console.log(`Creator: ${data.creator || '(none)'}`);
  console.log(`Tags: ${data.tags.join(', ') || '(none)'}`);
  console.log(`Has openmimic extension: ${!!data.extensions?.openmimic}`);
  console.log(`Alternate greetings: ${data.alternate_greetings.length}`);

  if (outputFile) {
    writeFileSync(resolve(outputFile), JSON.stringify(card, null, 2), 'utf8');
    console.log(`Written parsed card to: ${outputFile}`);
  }
}

// Main
const args = process.argv.slice(2);
const parsed = parseArgs(args);

if (parsed.command === 'export') {
  exportPersona(parsed.inputFile, parsed.outputFile, parsed.png, parsed.acknowledgeRealPerson);
} else {
  importCard(parsed.inputFile, parsed.outputFile);
}
