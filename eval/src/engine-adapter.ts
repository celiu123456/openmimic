/**
 * Engine adapter — the single point of contact between the eval package and
 * the kernel / court engine. P1a may change these signatures; after merge only
 * this file needs updating.
 */

import type { Store } from '@openmimic/kernel';
import type { LLMClient } from '@openmimic/engine-court';
import { runCourt, type RunCourtOptions } from '@openmimic/engine-court';
import { assemblePersonaContext, type PersonaContext } from '@openmimic/kernel';
import type { CourtSession } from '@openmimic/shared';

/** Run the adversarial court pipeline. Wraps in Promise.resolve for future-proofing. */
export async function adapterRunCourt(
  subjectId: string,
  store: Store,
  llm: LLMClient,
  options?: RunCourtOptions,
): Promise<CourtSession> {
  return await Promise.resolve(runCourt(subjectId, store, llm, options));
}

/** Assemble the persona context for a subject. */
export async function adapterAssemblePersona(
  subjectId: string,
  store: Store,
): Promise<PersonaContext> {
  return await Promise.resolve(assemblePersonaContext(subjectId, store));
}
