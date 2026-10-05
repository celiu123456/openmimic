/**
 * Guard test: every prompt constructor that interpolates user text must
 * wrap it with the untrusted-content utilities.
 *
 * Implementation: scan the source files of all engines and kernel for
 * functions that build prompts, and verify they import and use
 * wrapUntrusted / appendGuardInstruction. A new prompt function that
 * interpolates user text without wrapping will fail this test.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/* ------------------------------------------------------------------ */
/* File discovery                                                      */
/* ------------------------------------------------------------------ */

const ROOT = join(__dirname, '..', '..');

function collectTsFiles(dir: string): string[] {
  const result: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
      if (statSync(full).isDirectory()) {
        result.push(...collectTsFiles(full));
      } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
        result.push(full);
      }
    }
  } catch {
    /* ignore unreadable directories */
  }
  return result;
}

const PROMPT_DIRS = [
  join(ROOT, 'engines', 'court', 'src'),
  join(ROOT, 'engines', 'room', 'src'),
  join(ROOT, 'engines', 'witness', 'src'),
  join(ROOT, 'kernel', 'src'),
  join(ROOT, 'plugins', 'meta-perception', 'src'),
];

const promptFiles = PROMPT_DIRS.flatMap((dir) => collectTsFiles(dir));

/* ------------------------------------------------------------------ */
/* Patterns that indicate user text interpolation                      */
/* ------------------------------------------------------------------ */

/**
 * Heuristic: a line that concatenates a variable containing user text
 * (testimony, answer, memory, claim, corpus, selfReport, freeText, etc.)
 * into a prompt string without wrapping it.
 *
 * We look for common function names and string patterns that build prompts.
 */
const PROMPT_BUILDING_FUNCTIONS = [
  'buildFilingUser',
  'buildFilingSystem',
  'buildRelationUser',
  'buildConfrontationUser',
  'buildSystem',
  'buildUser',
  'buildFollowupUserPrompt',
  'buildScoreUser',
  'generateNoTalkList',
  'llmVerifyLeak',
  'assemblePersonaContext',
  'assembleSections',
  'renderEpisodes',
  'renderCorpus',
];

describe('prompt-guard: untrusted content wrapping', () => {
  it('all prompt-constructing source files import wrapping utilities', () => {
    const violations: string[] = [];

    for (const filePath of promptFiles) {
      const content = readFileSync(filePath, 'utf-8');

      // Check if this file builds prompts (contains known function definitions or user-text interpolation)
      const buildsPrompts = PROMPT_BUILDING_FUNCTIONS.some(
        (fn) => content.includes(`function ${fn}`) || content.includes(`async function ${fn}`),
      );
      if (!buildsPrompts) continue;

      // Files that build prompts with user text must import wrapping utilities
      const importsWrapping =
        content.includes('wrapUntrusted') ||
        content.includes('appendGuardInstruction') ||
        content.includes('@openmimic/shared');

      if (!importsWrapping) {
        violations.push(
          `${filePath.replace(ROOT + '/', '')} builds prompts but does not import wrapping utilities`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it('no prompt file interpolates user text variables without wrapping', () => {
    const violations: string[] = [];

    // Pattern: direct interpolation of known user-text variables without wrapUntrusted
    // e.g. `${answer.behindText}` or `${testimony.freeText}` without wrapUntrusted around it
    const UNGUARDED_PATTERNS = [
      // Testimony text directly in template literal without wrapping
      /\$\{(?:answer|testimony|mem|entry)\.(?:behindText|followupText|freeText|text)\}/,
      // Self-report directly in template
      /\$\{(?:selfReport|rawSelfReport)\}/,
    ];

    for (const filePath of promptFiles) {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Skip lines that are already wrapped
        if (line.includes('wrapUntrusted') || line.includes('// trusted')) continue;
        // Skip type definitions and interfaces
        if (line.trim().startsWith('*') || line.trim().startsWith('//') || line.trim().startsWith('interface ')) continue;

        for (const pattern of UNGUARDED_PATTERNS) {
          if (pattern.test(line)) {
            violations.push(
              `${filePath.replace(ROOT + '/', '')}:${i + 1} — unguarded user text interpolation: ${line.trim().slice(0, 80)}`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
