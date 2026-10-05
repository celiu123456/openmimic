/**
 * Prompt variable substitution engine.
 *
 * The sole entry point for interpolating variables into prompt templates.
 * Uses split/join to avoid `$` special-character issues with String.replace.
 *
 * Variables are classified as trusted (system-generated, safe to inline) or
 * untrusted (user-supplied, must be wrapped in data blocks). Attempting to
 * substitute an unclassified variable throws at render time -- a guard test
 * scans engine prompt constructors to ensure nothing slips through.
 */

import { wrapUntrusted, appendGuardInstruction } from './untrusted';

/* ------------------------------------------------------------------ */
/* Variable classification                                             */
/* ------------------------------------------------------------------ */

export type VariableTrust = 'trusted' | 'untrusted';

export interface PromptVariable {
  /** The placeholder token in the template, e.g. '{{witness_relation}}'. */
  name: string;
  /** The replacement value. */
  value: string;
  /** Trust classification. */
  trust: VariableTrust;
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

/**
 * Render a prompt template by substituting variables.
 *
 * - Trusted variables are inlined verbatim.
 * - Untrusted variables are wrapped in EXTERNAL_CONTENT data blocks.
 * - If any untrusted variable was substituted, the guard instruction
 *   is appended exactly once at the end.
 *
 * Uses split/join instead of regex replace to avoid `$` metacharacter issues.
 *
 * @throws Error if a variable's trust is not 'trusted' or 'untrusted'.
 */
export function renderPrompt(
  template: string,
  variables: readonly PromptVariable[],
): string {
  let result = template;
  let hasUntrusted = false;

  for (const variable of variables) {
    if (variable.trust !== 'trusted' && variable.trust !== 'untrusted') {
      throw new Error(
        `Prompt variable "${variable.name}" has unclassified trust level "${variable.trust as string}". ` +
        'Every variable must be explicitly classified as "trusted" or "untrusted".',
      );
    }

    const replacement =
      variable.trust === 'untrusted'
        ? wrapUntrusted(variable.name, variable.value)
        : variable.value;

    if (variable.trust === 'untrusted') {
      hasUntrusted = true;
    }

    // split/join avoids $-substitution issues that String.replace has
    result = result.split(variable.name).join(replacement);
  }

  if (hasUntrusted) {
    result = appendGuardInstruction(result);
  }

  return result;
}

/**
 * Convenience: wrap a single untrusted value and append the guard.
 * Used when building prompts imperatively (not from templates).
 */
export function wrapAndGuard(name: string, value: string, prompt: string): string {
  const wrapped = wrapUntrusted(name, value);
  return appendGuardInstruction(`${prompt}\n\n${wrapped}`);
}
