import { z } from 'zod';

/**
 * OpenMimic domain schemas.
 *
 * Every runtime entity is defined here once as a zod schema; the TypeScript
 * types are derived from those schemas (`z.infer`) so parsing and typing can
 * never drift apart.
 */

/**
 * One authorized verbatim style sample, attributed to the witness whose words
 * they are.
 *
 * Native subjects derive these from `quotable` testimony on demand; an
 * imported `.persona` package carries them explicitly, because the raw
 * testimony they came from is deliberately not distributed.
 */
export const StyleSampleSchema = z.object({
  relation: z.string().min(1),
  text: z.string().min(1),
});
export type StyleSample = z.infer<typeof StyleSampleSchema>;

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
  /**
   * Authorized style samples that travelled with an imported `.persona`
   * package.
   *
   * Only ever populated by `POST /api/import`: a native subject's samples are
   * re-derived from its `quotable` testimony instead of being duplicated here.
   * Keeping them on the record is what lets the import/export round trip
   * reproduce the package's `styleSamples` even though the raw testimony was
   * not distributed with it.
   */
  styleSamples: z.array(StyleSampleSchema).optional(),
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
  /** Year the witness first knew the subject (optional). */
  knownFromYear: z.number().int().optional(),
  /** Year the acquaintance ended; null means still ongoing. */
  knownToYear: z.number().int().nullable().optional(),
  /** How often the witness is in contact with the subject. */
  contactFrequency: z.string().optional(),
  /** When true, the witness's relation label is hidden in rooms. */
  anonymousInRoom: z.boolean().optional(),
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

/** Epistemic basis of a testimony answer. */
export const EvidenceBasisSchema = z.enum(['witnessed', 'heard', 'inferred', 'unknown']);
export type EvidenceBasis = z.infer<typeof EvidenceBasisSchema>;

/** One answer inside a testimony. */
export const TestimonyAnswerSchema = z.object({
  qid: z.string().min(1),
  /** What the witness says behind the subject's back (the raw evidence). */
  behindText: z.string(),
  /** Optional "to their face" variant. */
  frontText: z.string().optional(),
  /**
   * What the interviewer's follow-up question drew out.
   *
   * Deliberately a separate field rather than text appended to `behindText`:
   * the raw answer and the answer given under a prompt are different evidence,
   * and only the first was volunteered unprompted.
   */
  followupText: z.string().optional(),
  /**
   * Epistemic basis: how does the witness know this?
   *
   * - witnessed: first-hand observation ("I saw it happen")
   * - heard: second-hand ("someone told me")
   * - inferred: the witness is guessing ("I think", "probably")
   * - unknown: the rules couldn't determine the basis
   *
   * Set by rule-based heuristics during the interview; 'unknown' values
   * may be refined by the court during filing.
   */
  basis: EvidenceBasisSchema.optional(),
  /**
   * When true, this answer must not appear in any view the subject can see
   * (rooms, reports, meta-perception results). It still participates in
   * persona synthesis (court, claims).
   */
  doNotRaiseToSubject: z.boolean().optional(),
});
export type TestimonyAnswer = z.infer<typeof TestimonyAnswerSchema>;

/**
 * An append-only ledger entry.
 *
 * Corrections are expressed by appending a new testimony whose `correctionOf`
 * points at the earlier entry; existing entries are never mutated or removed.
 */
/** Origin of a text entity: human-written testimony vs AI-generated artifact. */
export const OriginSchema = z.enum(['human', 'ai']);
export type Origin = z.infer<typeof OriginSchema>;

/** Reflux suspicion level: how similar new testimony is to prior AI output. */
export const RefluxSuspicionSchema = z.enum(['none', 'low', 'medium', 'high']);
export type RefluxSuspicion = z.infer<typeof RefluxSuspicionSchema>;

export const TestimonySchema = z.object({
  id: z.string().min(1),
  witnessId: z.string().min(1),
  subjectId: z.string().min(1),
  createdAt: z.string().min(1),
  answers: z.array(TestimonyAnswerSchema),
  freeText: z.string().optional(),
  correctionOf: z.string().min(1).optional(),
  /**
   * Question ids the witness explicitly skipped.
   *
   * A skip is a silence signal, not an error: the witness pressed "skip this"
   * rather than leaving the field blank. Later the court can read a cluster of
   * skips on one question as collective silence. Stored on the testimony so it
   * survives the append-only ledger alongside the words that *were* given.
   */
  avoidedQids: z.array(z.string().min(1)).optional(),
  /**
   * Origin: testimony is always 'human'. Set for completeness; room/court/biography
   * outputs are 'ai'. This field is read-only metadata.
   */
  origin: OriginSchema.optional(),
  /**
   * Matched injection pattern text, if any. The testimony is NOT rejected;
   * it is flagged for the subject's report page. Court and room treat it as data.
   */
  suspectedInjection: z.string().optional(),
  /**
   * How similar this testimony is to prior AI-generated output for this subject.
   * Read-only metadata set at submission time. Court skips medium/high fragments.
   */
  refluxSuspicion: RefluxSuspicionSchema.optional(),
});
export type Testimony = z.infer<typeof TestimonySchema>;

/** Lifecycle status of a claim in the persona baseline. */
export const ClaimStatusSchema = z.enum(['surviving', 'contested', 'retired']);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

/** Kind of a claim: fact (verifiable event), observation (what someone saw), pattern (behavioural tendency). */
export const ClaimKindSchema = z.enum(['fact', 'observation', 'pattern']);
export type ClaimKind = z.infer<typeof ClaimKindSchema>;

/** Domain of a claim. */
export const ClaimDomainSchema = z.enum(['observable', 'internal', 'evaluative']);
export type ClaimDomain = z.infer<typeof ClaimDomainSchema>;

/** Situational context attached to a claim. */
export const ClaimContextSchema = z.object({
  audience: z.string().optional(),
  situation: z.string().optional(),
  period: z.string().optional(),
});
export type ClaimContext = z.infer<typeof ClaimContextSchema>;

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
  /** Claim classification; old data without this field is treated as 'pattern'. */
  kind: ClaimKindSchema.optional(),
  /** Observable / internal / evaluative domain. */
  domain: ClaimDomainSchema.optional(),
  /** Situational context (audience, situation, period). */
  context: ClaimContextSchema.optional(),
  /** Witness ids this claim reflects the perspective of. */
  witnessIds: z.array(z.string().min(1)).optional(),
  /** Episode ids that support this claim. */
  episodeIds: z.array(z.string().min(1)).optional(),
  /** True when this claim was re-raised after a contest, not its first time through court. */
  reraised: z.boolean().optional(),
  /**
   * Wording history. Each entry records a previous version of the claim
   * text (e.g. after a re-raise rewording). Newest first.
   * Optional — absent for claims that have never been reworded.
   */
  versions: z.array(z.object({
    text: z.string().min(1),
    at: z.string().min(1),
    reason: z.string().optional(),
  })).optional(),
});
export type Claim = z.infer<typeof ClaimSchema>;

/**
 * An episode: a verbatim excerpt from a testimony answer that describes
 * a concrete experience or event.
 *
 * The `text` field must be an exact substring of the corresponding
 * testimony answer (behindText or followupText). This invariant is
 * enforced by `Store.putEpisode`.
 */
export const EpisodeSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  witnessId: z.string().min(1),
  testimonyId: z.string().min(1),
  qid: z.string().min(1),
  /** Verbatim substring of the source answer text. */
  text: z.string().min(1),
  /** True when the text comes from a followupText (elicited by interviewer). */
  elicited: z.boolean(),
  /** Situational context, e.g. "评审会", "借钱". */
  situation: z.string().optional(),
  /** Audience, e.g. "对上司", "对母亲". */
  audience: z.string().optional(),
  /** Time hint, e.g. "上个月", "离职前两三周". */
  timeHint: z.string().optional(),
  /** Epistemic basis inherited from the source answer. */
  basis: EvidenceBasisSchema.optional(),
});
export type Episode = z.infer<typeof EpisodeSchema>;

/** A divergence between witnesses on a topic. */
export const DivergencePositionSchema = z.object({
  witnessId: z.string().min(1),
  claimId: z.string().min(1),
  summary: z.string().min(1),
});

export const DivergenceSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  courtSessionId: z.string().min(1),
  topic: z.string().min(1),
  type: z.enum(['perspective', 'factual']),
  /** At least 2 positions from different witnesses. */
  positions: z.array(DivergencePositionSchema).min(2),
  resolution: z.enum(['kept_both', 'qualified', 'unresolved']).optional(),
});
export type Divergence = z.infer<typeof DivergenceSchema>;

/**
 * A corpus item: the subject's own words (not testimony).
 *
 * Physically separate from testimony; corpus text must never be written
 * into a testimony or episode.
 */
export const CorpusItemSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  text: z.string().min(1),
  source: z.enum(['pasted', 'imported']),
  createdAt: z.string().min(1),
});
export type CorpusItem = z.infer<typeof CorpusItemSchema>;

/**
 * A silence signal: a question that was skipped by a significant fraction
 * of witnesses, indicating a collectively avoided topic.
 *
 * Not a claim — silence is not an assertion. Stored in a separate table
 * and excluded from the persona assertion zone.
 */
export const SilenceSignalSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  qid: z.string().min(1),
  /** Witness ids who skipped this question. */
  skipperIds: z.array(z.string().min(1)).min(3),
  /** Total witnesses who had a chance to answer. */
  totalWitnesses: z.number().int().min(1),
  /** Fraction of witnesses who skipped (>= 0.5). */
  skipRatio: z.number().min(0).max(1),
  createdAt: z.string().min(1),
});
export type SilenceSignal = z.infer<typeof SilenceSignalSchema>;

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
  /** @deprecated Use `retired` instead; kept for backward compatibility. */
  rejected: z.number().int().nonnegative().optional(),
  /** Claims with status='retired'. */
  retired: z.number().int().nonnegative().optional(),
  /** Claims with status='contested'. */
  contested: z.number().int().nonnegative().optional(),
  challengeCount: z.number().int().nonnegative(),
  /** Share of adjudicated claims that carry evidence (must always be 1). */
  evidenceCoverage: z.number().min(0).max(1),
  /** Total number of divergences recorded. */
  divergences: z.number().int().nonnegative().optional(),
  /** Number of factual conflicts. */
  factualConflicts: z.number().int().nonnegative().optional(),
  /** Total number of episodes extracted. */
  episodeCount: z.number().int().nonnegative().optional(),
  /** Number of claims with at least one supporting episode. */
  claimsWithEpisode: z.number().int().nonnegative().optional(),
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

/** Lifecycle status of a room. */
export const RoomStatusSchema = z.enum(['behind_only', 'door_opened']);
export type RoomStatus = z.infer<typeof RoomStatusSchema>;

/** Expression tier: how close a room utterance is to a witness's own words. */
export const UtteranceTierSchema = z.enum(['quote', 'paraphrase', 'extrapolate']);
export type UtteranceTier = z.infer<typeof UtteranceTierSchema>;

/** An anchor linking an utterance to a specific testimony question. */
export const UtteranceAnchorSchema = z.object({
  testimonyId: z.string().min(1),
  qid: z.string().min(1),
});
export type UtteranceAnchor = z.infer<typeof UtteranceAnchorSchema>;

/**
 * One turn inside a room transcript.
 *
 * `kind: 'speech'` is something a witness persona actually said; `kind: 'stage'`
 * is a stage direction (a silence, a deflection, a polite change of subject).
 * Both are attribution-carrying on purpose: a stage entry still names the
 * witness it belongs to, so "who did not say it" stays answerable.
 *
 * `tier` classifies how close the line is to raw testimony: 'quote' means
 * verbatim overlap with a quotable witness's words, 'paraphrase' means anchored
 * to a specific testimony question but reworded, 'extrapolate' means
 * unanchored filler (greetings, agreement, stage directions). Stage entries are
 * always 'extrapolate'. Old data without `tier` reads as 'extrapolate'.
 */
export const RoomUtteranceSchema = z.object({
  witnessId: z.string().min(1),
  displayLabel: z.string().min(1),
  text: z.string(),
  kind: z.enum(['speech', 'stage']),
  at: z.string().min(1),
  /** Expression tier; absent on old data, treated as 'extrapolate'. */
  tier: UtteranceTierSchema.optional(),
  /** Which testimony answers this utterance draws from; empty for extrapolate. */
  anchors: z.array(UtteranceAnchorSchema).optional(),
});
export type RoomUtterance = z.infer<typeof RoomUtteranceSchema>;

/**
 * A generated room: the same witnesses, first behind the subject's back and
 * then with the door open.
 *
 * A room is *generated artifact*, not evidence. Unlike a testimony it is not
 * append-only: `frontTranscript` is allowed to be written once the door opens.
 * The raw evidence it was generated from still lives in the testimony ledger.
 */
export const RoomSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  topicSeed: z.string().min(1),
  status: RoomStatusSchema,
  behindTranscript: z.array(RoomUtteranceSchema),
  frontTranscript: z.array(RoomUtteranceSchema).optional(),
  createdAt: z.string().min(1),
  /**
   * True when the room was driven by an imported persona's claims rather than
   * by per-witness testimony (an imported subject has no raw answers to build
   * personas from). Purely a provenance mark: the transcript is still a
   * generated artifact, never evidence.
   */
  imported: z.boolean().optional(),
});
export type Room = z.infer<typeof RoomSchema>;

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Placeholder substituted for raw witness words that may not be shown. */
export const WITHHELD_PLACEHOLDER = '[withheld]' as const;

/** Conviction ceiling for a claim that was never cross-examined. */
export const CONVICTION_UNCHALLENGED_CAP = 0.6;

/** Scopes a testimony can be viewed through. */
export const VIEWER_SCOPES = ['court', 'external'] as const;
export type ViewerScope = (typeof VIEWER_SCOPES)[number];
