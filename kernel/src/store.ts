/// <reference path="../types/better-sqlite3.d.ts" />
import Database from 'better-sqlite3';
import type { Database as DatabaseConnection } from 'better-sqlite3';
import {
  ClaimSchema,
  CourtSessionSchema,
  InviteSchema,
  RoomSchema,
  SubjectSchema,
  TestimonySchema,
  WitnessSchema,
  type Claim,
  type ConsentLevel,
  type CourtSession,
  type Invite,
  type Room,
  type RoomUtterance,
  type Subject,
  type Testimony,
  type ViewerScope,
  type Witness,
} from '@openmimic/shared';
import { EventBus } from './events';
import { AuthorizationGate } from './gate';
import { NoEvidenceError, UnknownRoomError, UnknownTestimonyError } from './errors';

/** Store configuration. Defaults to an ephemeral in-memory database. */
export interface StoreOptions {
  /** SQLite filename, or `:memory:` (the default). */
  path?: string;
}

/** Input accepted by {@link Store.addTestimony}; `createdAt` defaults to now. */
export type TestimonyInput = Omit<Testimony, 'createdAt'> & { createdAt?: string };

interface TestimonyRow {
  id: string;
  witness_id: string;
  subject_id: string;
  created_at: string;
  answers: string;
  free_text: string | null;
  correction_of: string | null;
}

interface ClaimRow {
  id: string;
  subject_id: string;
  text: string;
  conviction: number;
  evidence: string;
  qualifiers: string | null;
  status: string;
  court_session_id: string;
}

interface SubjectRow {
  id: string;
  display_name: string;
  self_report: string | null;
}

interface WitnessRow {
  id: string;
  subject_id: string;
  relation: string;
  stance: string | null;
  consent_level: string;
}

interface CourtSessionRow {
  id: string;
  subject_id: string;
  started_at: string;
  finished_at: string | null;
  transcript: string;
  report: string | null;
}

interface InviteRow {
  token: string;
  subject_id: string;
  created_at: string;
  expires_at: string;
}

interface RoomRow {
  id: string;
  subject_id: string;
  topic_seed: string;
  status: string;
  behind_transcript: string;
  front_transcript: string | null;
  created_at: string;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS subjects (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  self_report  TEXT
);

CREATE TABLE IF NOT EXISTS witnesses (
  id            TEXT PRIMARY KEY,
  subject_id    TEXT NOT NULL,
  relation      TEXT NOT NULL,
  stance        TEXT,
  consent_level TEXT NOT NULL CHECK (consent_level IN ('quotable', 'synthesis_only'))
);

CREATE TABLE IF NOT EXISTS testimonies (
  id            TEXT PRIMARY KEY,
  witness_id    TEXT NOT NULL,
  subject_id    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  answers       TEXT NOT NULL,
  free_text     TEXT,
  correction_of TEXT
);

CREATE INDEX IF NOT EXISTS idx_testimonies_subject ON testimonies (subject_id, created_at);
CREATE INDEX IF NOT EXISTS idx_testimonies_witness ON testimonies (witness_id, created_at);

CREATE TABLE IF NOT EXISTS claims (
  id               TEXT PRIMARY KEY,
  subject_id       TEXT NOT NULL,
  text             TEXT NOT NULL,
  conviction       REAL NOT NULL,
  evidence         TEXT NOT NULL,
  qualifiers       TEXT,
  status           TEXT NOT NULL CHECK (status IN ('surviving', 'contested', 'retired')),
  court_session_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_claims_subject ON claims (subject_id);

CREATE TABLE IF NOT EXISTS court_sessions (
  id          TEXT PRIMARY KEY,
  subject_id  TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  transcript  TEXT NOT NULL,
  report      TEXT
);

CREATE INDEX IF NOT EXISTS idx_court_sessions_subject ON court_sessions (subject_id);

-- Second line of defence for the append-only ledger. The TypeScript API
-- deliberately exposes no mutation method; these triggers guarantee that even
-- raw SQL cannot rewrite history.
CREATE TRIGGER IF NOT EXISTS testimonies_append_only_update
BEFORE UPDATE ON testimonies
BEGIN
  SELECT RAISE(ABORT, 'append-only violation: testimonies may not be updated');
END;

CREATE TRIGGER IF NOT EXISTS testimonies_append_only_delete
BEFORE DELETE ON testimonies
BEGIN
  SELECT RAISE(ABORT, 'append-only violation: testimonies may not be deleted');
END;

-- Invites are a separate, mutable table: a token can be revoked or allowed to
-- expire, and nothing here touches the append-only testimony ledger.
CREATE TABLE IF NOT EXISTS invites (
  token      TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invites_subject ON invites (subject_id);

-- Rooms are AI-generated artifacts, not evidence. They deliberately have no
-- append-only triggers: unlike testimonies, a room is allowed to grow a
-- front_transcript and move to door_opened (see updateRoomFront). The
-- source material a room quotes from is still the append-only testimonies
-- table, which stays untouched.
CREATE TABLE IF NOT EXISTS rooms (
  id                TEXT PRIMARY KEY,
  subject_id        TEXT NOT NULL,
  topic_seed        TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('behind_only', 'door_opened')),
  behind_transcript TEXT NOT NULL,
  front_transcript  TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rooms_subject ON rooms (subject_id);
`;

/**
 * The kernel store.
 *
 * Holds the four kernel concerns that must never be pluggable: the testimony
 * ledger (append-only), the claim store (evidence-anchored), the event bus and
 * the authorization gate. Everything else is a plugin.
 */
export class Store {
  /** In-process typed event bus (`testimony.added`, `court.finished`). */
  readonly events = new EventBus();

  private readonly db: DatabaseConnection;
  private readonly gate: AuthorizationGate;

  constructor(options: StoreOptions = {}) {
    this.db = new Database(options.path ?? ':memory:');
    if (options.path && options.path !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.exec(SCHEMA_SQL);
    this.gate = new AuthorizationGate((witnessId) => this.getConsentLevel(witnessId));
  }

  /* ---------------------------------------------------------------- */
  /* Subjects & witnesses                                              */
  /* ---------------------------------------------------------------- */

  putSubject(subject: Subject): Subject {
    const parsed = SubjectSchema.parse(subject);
    this.db
      .prepare<[string, string, string | null]>(
        `INSERT INTO subjects (id, display_name, self_report) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           self_report  = excluded.self_report`,
      )
      .run(parsed.id, parsed.displayName, parsed.selfReport ?? null);
    return parsed;
  }

  getSubject(id: string): Subject | undefined {
    const row = this.db
      .prepare<[string], SubjectRow>('SELECT * FROM subjects WHERE id = ?')
      .get(id);
    return row ? SubjectSchema.parse(this.rowToSubject(row)) : undefined;
  }

  listSubjects(): Subject[] {
    return this.db
      .prepare<[], SubjectRow>('SELECT * FROM subjects ORDER BY rowid ASC')
      .all()
      .map((row) => SubjectSchema.parse(this.rowToSubject(row)));
  }

  putWitness(witness: Witness): Witness {
    const parsed = WitnessSchema.parse(witness);
    this.db
      .prepare<[string, string, string, string | null, string]>(
        `INSERT INTO witnesses (id, subject_id, relation, stance, consent_level)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           subject_id    = excluded.subject_id,
           relation      = excluded.relation,
           stance        = excluded.stance,
           consent_level = excluded.consent_level`,
      )
      .run(
        parsed.id,
        parsed.subjectId,
        parsed.relation,
        parsed.stance ?? null,
        parsed.consentLevel,
      );
    return parsed;
  }

  getWitness(id: string): Witness | undefined {
    const row = this.db
      .prepare<[string], WitnessRow>('SELECT * FROM witnesses WHERE id = ?')
      .get(id);
    return row ? WitnessSchema.parse(this.rowToWitness(row)) : undefined;
  }

  listWitnessesBySubject(subjectId: string): Witness[] {
    return this.db
      .prepare<[string], WitnessRow>(
        'SELECT * FROM witnesses WHERE subject_id = ? ORDER BY rowid ASC',
      )
      .all(subjectId)
      .map((row) => WitnessSchema.parse(this.rowToWitness(row)));
  }

  getConsentLevel(witnessId: string): ConsentLevel | undefined {
    return this.getWitness(witnessId)?.consentLevel;
  }

  /* ---------------------------------------------------------------- */
  /* Invites                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Persist an invite. Invites are reusable by design: one link, many
   * witnesses. Unlike testimony they are mutable infrastructure, so a plain
   * upsert is fine (re-putting a token refreshes its row).
   */
  putInvite(invite: Invite): Invite {
    const parsed = InviteSchema.parse(invite);
    this.db
      .prepare<[string, string, string, string]>(
        `INSERT INTO invites (token, subject_id, created_at, expires_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(token) DO UPDATE SET
           subject_id = excluded.subject_id,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`,
      )
      .run(parsed.token, parsed.subjectId, parsed.createdAt, parsed.expiresAt);
    return parsed;
  }

  getInvite(token: string): Invite | undefined {
    const row = this.db
      .prepare<[string], InviteRow>('SELECT * FROM invites WHERE token = ?')
      .get(token);
    return row ? this.rowToInvite(row) : undefined;
  }

  listInvitesBySubject(subjectId: string): Invite[] {
    return this.db
      .prepare<[string], InviteRow>(
        'SELECT * FROM invites WHERE subject_id = ? ORDER BY created_at ASC, rowid ASC',
      )
      .all(subjectId)
      .map((row) => this.rowToInvite(row));
  }

  /* ---------------------------------------------------------------- */
  /* Rooms — generated artifacts, deliberately mutable                 */
  /* ---------------------------------------------------------------- */

  /**
   * Persist a room.
   *
   * Rooms are generated from testimony but are not testimony themselves, so
   * they sit outside the append-only ledger and a plain upsert is fine. The
   * evidence a room was generated from is never duplicated here: only the
   * resulting transcript is stored.
   */
  putRoom(room: Room): Room {
    const parsed = RoomSchema.parse(room);
    this.db
      .prepare<
        [string, string, string, string, string, string | null, string]
      >(
        `INSERT INTO rooms
           (id, subject_id, topic_seed, status, behind_transcript, front_transcript, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           subject_id        = excluded.subject_id,
           topic_seed        = excluded.topic_seed,
           status            = excluded.status,
           behind_transcript = excluded.behind_transcript,
           front_transcript  = excluded.front_transcript,
           created_at        = excluded.created_at`,
      )
      .run(
        parsed.id,
        parsed.subjectId,
        parsed.topicSeed,
        parsed.status,
        JSON.stringify(parsed.behindTranscript),
        parsed.frontTranscript ? JSON.stringify(parsed.frontTranscript) : null,
        parsed.createdAt,
      );
    return parsed;
  }

  getRoom(id: string): Room | undefined {
    const row = this.db
      .prepare<[string], RoomRow>('SELECT * FROM rooms WHERE id = ?')
      .get(id);
    return row ? this.rowToRoom(row) : undefined;
  }

  listRoomsBySubject(subjectId: string): Room[] {
    return this.db
      .prepare<[string], RoomRow>(
        'SELECT * FROM rooms WHERE subject_id = ? ORDER BY created_at ASC, rowid ASC',
      )
      .all(subjectId)
      .map((row) => this.rowToRoom(row));
  }

  /**
   * Attach the "door open" transcript to an existing room.
   *
   * This is the one sanctioned in-place update in the store, and it exists
   * precisely because a room is not evidence: opening the door must not
   * rewrite any testimony. Unknown ids fail loudly rather than silently
   * creating a half-room.
   */
  updateRoomFront(roomId: string, frontTranscript: RoomUtterance[]): Room {
    const existing = this.getRoom(roomId);
    if (!existing) throw new UnknownRoomError(`room not found: ${roomId}`);
    const updated = RoomSchema.parse({
      ...existing,
      status: 'door_opened',
      frontTranscript,
    });
    this.db
      .prepare<[string, string, string]>(
        'UPDATE rooms SET status = ?, front_transcript = ? WHERE id = ?',
      )
      .run(updated.status, JSON.stringify(updated.frontTranscript), roomId);
    return updated;
  }

  /* ---------------------------------------------------------------- */
  /* Testimony ledger — append-only, and only these three methods      */
  /* ---------------------------------------------------------------- */

  /** Append a testimony. There is intentionally no update or delete. */
  addTestimony(input: TestimonyInput): Testimony {
    const testimony = TestimonySchema.parse({
      ...input,
      createdAt: input.createdAt ?? new Date().toISOString(),
    });

    if (testimony.correctionOf !== undefined && !this.getTestimony(testimony.correctionOf)) {
      throw new UnknownTestimonyError(
        `correction target not found in ledger: ${testimony.correctionOf}`,
      );
    }

    this.db
      .prepare<[string, string, string, string, string, string | null, string | null]>(
        `INSERT INTO testimonies
           (id, witness_id, subject_id, created_at, answers, free_text, correction_of)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        testimony.id,
        testimony.witnessId,
        testimony.subjectId,
        testimony.createdAt,
        JSON.stringify(testimony.answers),
        testimony.freeText ?? null,
        testimony.correctionOf ?? null,
      );

    this.events.emit('testimony.added', testimony);
    return testimony;
  }

  getTestimony(id: string): Testimony | undefined {
    const row = this.db
      .prepare<[string], TestimonyRow>('SELECT * FROM testimonies WHERE id = ?')
      .get(id);
    return row ? this.rowToTestimony(row) : undefined;
  }

  listBySubject(subjectId: string): Testimony[] {
    return this.db
      .prepare<[string], TestimonyRow>(
        'SELECT * FROM testimonies WHERE subject_id = ? ORDER BY created_at ASC, rowid ASC',
      )
      .all(subjectId)
      .map((row) => this.rowToTestimony(row));
  }

  /* ---------------------------------------------------------------- */
  /* Claim repository                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Persist a claim.
   *
   * Rejects (with {@link NoEvidenceError}) any claim whose evidence list is
   * empty or references a testimony that is not in the ledger.
   */
  putClaim(claim: Claim): Claim {
    // Check the anchor before schema validation so that an empty evidence list
    // always surfaces as NoEvidenceError rather than a generic parse failure.
    if (!Array.isArray(claim.evidence) || claim.evidence.length < 1) {
      throw new NoEvidenceError(`claim ${claim.id} has no evidence`);
    }
    const parsed = ClaimSchema.parse(claim);
    for (const testimonyId of parsed.evidence) {
      if (!this.getTestimony(testimonyId)) {
        throw new NoEvidenceError(
          `claim ${parsed.id} references unknown testimony ${testimonyId}`,
        );
      }
    }

    this.db
      .prepare<[string, string, string, number, string, string | null, string, string]>(
        `INSERT INTO claims
           (id, subject_id, text, conviction, evidence, qualifiers, status, court_session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           subject_id       = excluded.subject_id,
           text             = excluded.text,
           conviction       = excluded.conviction,
           evidence         = excluded.evidence,
           qualifiers       = excluded.qualifiers,
           status           = excluded.status,
           court_session_id = excluded.court_session_id`,
      )
      .run(
        parsed.id,
        parsed.subjectId,
        parsed.text,
        parsed.conviction,
        JSON.stringify(parsed.evidence),
        parsed.qualifiers ? JSON.stringify(parsed.qualifiers) : null,
        parsed.status,
        parsed.courtSessionId,
      );

    return parsed;
  }

  getClaim(id: string): Claim | undefined {
    const row = this.db
      .prepare<[string], ClaimRow>('SELECT * FROM claims WHERE id = ?')
      .get(id);
    return row ? this.rowToClaim(row) : undefined;
  }

  listClaimsBySubject(subjectId: string): Claim[] {
    return this.db
      .prepare<[string], ClaimRow>(
        'SELECT * FROM claims WHERE subject_id = ? ORDER BY rowid ASC',
      )
      .all(subjectId)
      .map((row) => this.rowToClaim(row));
  }

  /* ---------------------------------------------------------------- */
  /* Court sessions                                                    */
  /* ---------------------------------------------------------------- */

  putCourtSession(session: CourtSession): CourtSession {
    const parsed = CourtSessionSchema.parse(session);
    this.db
      .prepare<[string, string, string, string | null, string, string | null]>(
        `INSERT INTO court_sessions
           (id, subject_id, started_at, finished_at, transcript, report)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           subject_id  = excluded.subject_id,
           started_at  = excluded.started_at,
           finished_at = excluded.finished_at,
           transcript  = excluded.transcript,
           report      = excluded.report`,
      )
      .run(
        parsed.id,
        parsed.subjectId,
        parsed.startedAt,
        parsed.finishedAt ?? null,
        JSON.stringify(parsed.transcript),
        parsed.report ? JSON.stringify(parsed.report) : null,
      );
    return parsed;
  }

  getCourtSession(id: string): CourtSession | undefined {
    const row = this.db
      .prepare<[string], CourtSessionRow>('SELECT * FROM court_sessions WHERE id = ?')
      .get(id);
    return row ? this.rowToCourtSession(row) : undefined;
  }

  listCourtSessionsBySubject(subjectId: string): CourtSession[] {
    return this.db
      .prepare<[string], CourtSessionRow>(
        'SELECT * FROM court_sessions WHERE subject_id = ? ORDER BY started_at ASC, rowid ASC',
      )
      .all(subjectId)
      .map((row) => this.rowToCourtSession(row));
  }

  /* ---------------------------------------------------------------- */
  /* Authorization gate                                                */
  /* ---------------------------------------------------------------- */

  /** Redact a testimony for the given viewer scope. */
  redact(testimony: Testimony, viewerScope: ViewerScope): Testimony {
    return this.gate.redact(testimony, viewerScope);
  }

  /** Redact a batch of testimonies for the given viewer scope. */
  redactAll(testimonies: readonly Testimony[], viewerScope: ViewerScope): Testimony[] {
    return this.gate.redactAll(testimonies, viewerScope);
  }

  /** Release the underlying database connection. */
  close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Row mapping                                                       */
  /* ---------------------------------------------------------------- */

  private rowToSubject(row: SubjectRow): unknown {
    return {
      id: row.id,
      displayName: row.display_name,
      selfReport: row.self_report ?? undefined,
    };
  }

  private rowToWitness(row: WitnessRow): unknown {
    return {
      id: row.id,
      subjectId: row.subject_id,
      relation: row.relation,
      stance: row.stance ?? undefined,
      consentLevel: row.consent_level,
    };
  }

  private rowToInvite(row: InviteRow): Invite {
    return InviteSchema.parse({
      token: row.token,
      subjectId: row.subject_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    });
  }

  private rowToTestimony(row: TestimonyRow): Testimony {
    return TestimonySchema.parse({
      id: row.id,
      witnessId: row.witness_id,
      subjectId: row.subject_id,
      createdAt: row.created_at,
      answers: JSON.parse(row.answers) as unknown,
      freeText: row.free_text ?? undefined,
      correctionOf: row.correction_of ?? undefined,
    });
  }

  private rowToClaim(row: ClaimRow): Claim {
    return ClaimSchema.parse({
      id: row.id,
      subjectId: row.subject_id,
      text: row.text,
      conviction: row.conviction,
      evidence: JSON.parse(row.evidence) as unknown,
      qualifiers: row.qualifiers ? (JSON.parse(row.qualifiers) as unknown) : undefined,
      status: row.status,
      courtSessionId: row.court_session_id,
    });
  }

  private rowToCourtSession(row: CourtSessionRow): CourtSession {
    return CourtSessionSchema.parse({
      id: row.id,
      subjectId: row.subject_id,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined,
      transcript: JSON.parse(row.transcript) as unknown,
      report: row.report ? (JSON.parse(row.report) as unknown) : undefined,
    });
  }

  private rowToRoom(row: RoomRow): Room {
    return RoomSchema.parse({
      id: row.id,
      subjectId: row.subject_id,
      topicSeed: row.topic_seed,
      status: row.status,
      behindTranscript: JSON.parse(row.behind_transcript) as unknown,
      frontTranscript: row.front_transcript
        ? (JSON.parse(row.front_transcript) as unknown)
        : undefined,
      createdAt: row.created_at,
    });
  }
}
