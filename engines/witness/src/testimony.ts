import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ConsentLevelSchema,
  TestimonyAnswerSchema,
  detectInjection,
  type RefluxSuspicion,
  type Testimony,
  type Witness,
} from '@openmimic/shared';
import { screenReflux, type Store } from '@openmimic/kernel';
import { resolveInvite } from './invite';

/**
 * The body a witness submits.
 *
 * `behindText` is required and non-empty: an answer with no words is not
 * evidence. `consentLevel` reuses the shared enum so the gate and the intake
 * can never disagree about what a level means.
 */
export const SubmitTestimonyInputSchema = z.object({
  relation: z.string().min(1),
  stance: z.string().min(1).optional(),
  consentLevel: ConsentLevelSchema,
  answers: z
    .array(TestimonyAnswerSchema.extend({ behindText: z.string().min(1) }))
    .min(1),
  freeText: z.string().min(1).optional(),
  /** Question ids the witness explicitly skipped (silence signal). */
  avoidedQids: z.array(z.string().min(1)).optional(),
  /** Year the witness first knew the subject. */
  knownFromYear: z.number().int().optional(),
  /** Year the acquaintance ended; null means still ongoing. */
  knownToYear: z.number().int().nullable().optional(),
});
export type SubmitTestimonyInput = z.infer<typeof SubmitTestimonyInputSchema>;

export interface SubmitTestimonyResult {
  witnessId: string;
  testimonyId: string;
  /** Testimonies on record for the subject *after* this append. */
  count: number;
}

export interface SubmitTestimonyOptions {
  /** Injectable clock for deterministic tests. */
  now?: Date;
  /** Id factory, injectable for deterministic tests. */
  newId?: () => string;
}

/**
 * Turn one filled-in questionnaire into a witness plus one ledger entry.
 *
 * Everything is validated before a single row is written, so a rejected
 * submission leaves the ledger untouched. The append itself goes through
 * {@link Store.addTestimony} — the same append-only path the kernel owns.
 */
export function submitTestimony(
  store: Store,
  token: string,
  input: SubmitTestimonyInput,
  options: SubmitTestimonyOptions = {},
): SubmitTestimonyResult {
  // Validate first: no token lookup, no writes until the body is acceptable.
  const parsed = SubmitTestimonyInputSchema.parse(input);
  const { subjectId } = resolveInvite(store, token, { now: options.now });

  const newId = options.newId ?? (() => randomUUID());
  const createdAt = (options.now ?? new Date()).toISOString();
  const witnessId = newId();
  const testimonyId = newId();

  const witness: Witness = {
    id: witnessId,
    subjectId,
    relation: parsed.relation,
    ...(parsed.stance !== undefined ? { stance: parsed.stance } : {}),
    consentLevel: parsed.consentLevel,
    ...(parsed.knownFromYear !== undefined ? { knownFromYear: parsed.knownFromYear } : {}),
    ...(parsed.knownToYear !== undefined ? { knownToYear: parsed.knownToYear } : {}),
  };
  store.putWitness(witness);

  // Scan all text for injection patterns (flag, don't reject)
  const allTexts = parsed.answers.map((a) => a.behindText);
  if (parsed.freeText) allTexts.push(parsed.freeText);
  const injectionMatch = allTexts.map(detectInjection).find(Boolean);

  // Screen for AI product reflux (flag, don't reject)
  const fullText = allTexts.join(' ');
  const fingerprints = store.listFingerprints(subjectId);
  const reflux = screenReflux(fullText, fingerprints);
  const refluxSuspicion: RefluxSuspicion | undefined =
    reflux.suspicion !== 'none' ? reflux.suspicion : undefined;

  const testimony: Testimony = {
    id: testimonyId,
    witnessId,
    subjectId,
    createdAt,
    answers: parsed.answers.map((answer) => ({ ...answer })),
    ...(parsed.freeText !== undefined ? { freeText: parsed.freeText } : {}),
    ...(parsed.avoidedQids !== undefined ? { avoidedQids: [...parsed.avoidedQids] } : {}),
    origin: 'human',
    ...(injectionMatch ? { suspectedInjection: injectionMatch } : {}),
    ...(refluxSuspicion ? { refluxSuspicion } : {}),
  };
  store.addTestimony(testimony);

  return {
    witnessId,
    testimonyId,
    count: store.listBySubject(subjectId).length,
  };
}
