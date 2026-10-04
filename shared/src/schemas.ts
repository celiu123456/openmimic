import { z } from 'zod';

/**
 * OpenMimic domain schemas.
 *
 * Every runtime entity is defined here once as a zod schema; the TypeScript
 * types are derived from those schemas (`z.infer`) so parsing and typing can
 * never drift apart.
 */

/** A person a persona is being built for. */
export const SubjectSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  /**
   * The subject's own account of themselves.
   *
   * Invariant: `selfReport` NEVER mixes into testimony. Testimony is
   * third-party evidence only; a subject cannot testify about themselves.
   * It is stored on the subject record for reference and must not be copied
   * into any `Testimony` or `Claim`.
   */
  selfReport: z.string().optional(),
});
export type Subject = z.infer<typeof SubjectSchema>;

/** Consent level a witness grants for their own words. */
export const ConsentLevelSchema = z.enum(['quotable', 'synthesis_only']);
export type ConsentLevel = z.infer<typeof ConsentLevelSchema>;

/** Someone who gives testimony about a subject. */
export const WitnessSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  relation: z.string().min(1),
  stance: z.string().optional(),
  consentLevel: ConsentLevelSchema,
});
export type Witness = z.infer<typeof WitnessSchema>;

/**
 * A reusable invitation link that turns friends into witnesses.
 *
 * Deliberately *not* single-use: one link can be pasted into a group chat and
 * several people may answer it. The token is the only secret; it is a
 * URL-safe random string and carries no embedded data.
 */
export const InviteSchema = z.object({
  token: z.string().min(1),
  subjectId: z.string().min(1),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
});
export type Invite = z.infer<typeof InviteSchema>;

/** One answer inside a testimony. */
export const TestimonyAnswerSchema = z.object({
  qid: z.string().min(1),
  /** What the witness says behind the subject's back (the raw evidence). */
  behindText: z.string(),
  /** Optional "to their face" variant. */
  frontText: z.string().optional(),
});
export type TestimonyAnswer = z.infer<typeof TestimonyAnswerSchema>;

/**
 * An append-only ledger entry.
 *
 * Corrections are expressed by appending a new testimony whose `correctionOf`
 * points at the earlier entry; existing entries are never mutated or removed.
 */
export const TestimonySchema = z.object({
  id: z.string().min(1),
  witnessId: z.string().min(1),
  subjectId: z.string().min(1),
  createdAt: z.string().min(1),
  answers: z.array(TestimonyAnswerSchema),
  freeText: z.string().optional(),
  correctionOf: z.string().min(1).optional(),
});
export type Testimony = z.infer<typeof TestimonySchema>;

/** Lifecycle status of a claim in the persona baseline. */
export const ClaimStatusSchema = z.enum(['surviving', 'contested', 'retired']);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

/** A candidate personality claim backed by at least one testimony. */
export const ClaimSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  text: z.string().min(1),
  conviction: z.number().min(0).max(1),
  /** Testimony ids; at least one is required (no anchor => no claim). */
  evidence: z.array(z.string().min(1)).min(1),
  qualifiers: z.array(z.string()).optional(),
  status: ClaimStatusSchema,
  courtSessionId: z.string().min(1),
});
export type Claim = z.infer<typeof ClaimSchema>;

/** Event kinds recorded on a court transcript. */
export const CourtEventTypeSchema = z.enum([
  'claim_proposed',
  'challenge',
  'defense',
  'adjudication',
]);
export type CourtEventType = z.infer<typeof CourtEventTypeSchema>;

/** A single transcript entry. */
export const CourtEventSchema = z.object({
  type: CourtEventTypeSchema,
  claimId: z.string().min(1).optional(),
  witnessId: z.string().min(1).optional(),
  text: z.string(),
  at: z.string().min(1),
});
export type CourtEvent = z.infer<typeof CourtEventSchema>;

/** Machine-checkable health report of a court session. */
export const CourtReportSchema = z.object({
  totalClaims: z.number().int().nonnegative(),
  surviving: z.number().int().nonnegative(),
  qualified: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  challengeCount: z.number().int().nonnegative(),
  /** Share of adjudicated claims that carry evidence (must always be 1). */
  evidenceCoverage: z.number().min(0).max(1),
});
export type CourtReport = z.infer<typeof CourtReportSchema>;

/** One adversarial court session about a subject. */
export const CourtSessionSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1).optional(),
  transcript: z.array(CourtEventSchema),
  report: CourtReportSchema.optional(),
});
export type CourtSession = z.infer<typeof CourtSessionSchema>;

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Placeholder substituted for raw witness words that may not be shown. */
export const WITHHELD_PLACEHOLDER = '[withheld]' as const;

/** Conviction for a claim that survived cross-examination. */
export const CONVICTION_SURVIVE = 0.8;

/** Conviction for a claim that survived only with qualifiers. */
export const CONVICTION_QUALIFY = 0.65;

/** Conviction ceiling for a claim that was never cross-examined. */
export const CONVICTION_UNCHALLENGED_CAP = 0.6;

/** Small conviction decay applied per *additional* survived challenge round. */
export const CONVICTION_DECAY_PER_CHALLENGE = 0.02;

/** Scopes a testimony can be viewed through. */
export const VIEWER_SCOPES = ['court', 'external'] as const;
export type ViewerScope = (typeof VIEWER_SCOPES)[number];
