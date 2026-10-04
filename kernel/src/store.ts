/// <reference path="../types/better-sqlite3.d.ts" />
import Database from 'better-sqlite3';
import type { Database as DatabaseConnection } from 'better-sqlite3';
import {
  ClaimSchema,
  CorpusItemSchema,
  CourtSessionSchema,
  DivergenceSchema,
  EpisodeSchema,
  InviteSchema,
  RoomSchema,
  SubjectSchema,
  TestimonySchema,
  WitnessSchema,
  type Claim,
  type ConsentLevel,
  type CorpusItem,
  type CourtSession,
  type Divergence,
  type Episode,
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
import { NoAnchorError, NoEvidenceError, UnknownRoomError, UnknownTestimonyError } from './errors';

/** Store configuration. Defaults to an ephemeral in-memory database. */
export interface StoreOptions {
  /** SQLite filename, or `:memory:` (the default). */
  path?: string;
}

/** Input accepted by {@link Store.addTestimony}; `createdAt` defaults to now. */
export type TestimonyInput = Omit<Testimony, 'createdAt'> & { createdAt?: string };

/**
 * One in-progress interview.
 *
 * `state` is opaque JSON owned by whichever collector created the session; the
 * kernel only persists it. A session is a *process draft*, not evidence: unlike
 * a testimony it may be rewritten while the witness answers, and it is dropped
 * once the final testimony has been appended through the append-only ledger.
 */
export interface InterviewSessionRecord {
  id: string;
  inviteToken: string;
  state: unknown;
  createdAt: string;
}

/** Input accepted by {@link Store.putInterviewSession}; `createdAt` defaults to now. */
export type InterviewSessionInput = Omit<InterviewSessionRecord, 'createdAt'> & {
  createdAt?: string;
};

interface TestimonyRow {
  id: string;
  witness_id: string;
  subject_id: string;
  created_at: string;
  answers: string;
  free_text: string | null;
  correction_of: string | null;
  avoided_qids: string | null;
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
  kind: string | null;
  domain: string | null;
  context: string | null;
  witness_ids: string | null;
  episode_ids: string | null;
  reraised: number | null;
}

interface EpisodeRow {
  id: string;
  subject_id: string;
  witness_id: string;
  testimony_id: string;
  qid: string;
  text: string;
  elicited: number;
  situation: string | null;
  audience: string | null;
  time_hint: string | null;
}

interface DivergenceRow {
  id: string;
  subject_id: string;
  court_session_id: string;
  topic: string;
  type: string;
  positions: string;
  resolution: string | null;
}

interface CorpusItemRow {
  id: string;
  subject_id: string;
  text: string;
  source: string;
  created_at: string;
}

interface SubjectRow {
  id: string;
  display_name: string;
  self_report: string | null;
  style_samples: string | null;
}

interface WitnessRow {
  id: string;
  subject_id: string;
  relation: string;
  stance: string | null;
  consent_level: string;
  known_from_year: number | null;
  known_to_year: number | null;
  anonymous_in_room: number | null;
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
  imported: number | null;
}

interface InterviewSessionRow {
  id: string;
  invite_token: string;
  state: string;
  created_at: string;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS subjects (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  self_report   TEXT,
  style_samples TEXT
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
  correction_of TEXT,
  avoided_qids  TEXT
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
  created_at        TEXT NOT NULL,
  imported          INTEGER
);

CREATE INDEX IF NOT EXISTS idx_rooms_subject ON rooms (subject_id);

-- Interview sessions are in-progress drafts, not evidence. They deliberately
-- have no append-only triggers: a session is rewritten as the witness answers,
-- and it is purged once its testimony has been appended. The final product
-- still exits through addTestimony, which is append-only; this table never
-- holds the evidence the court will read.
CREATE TABLE IF NOT EXISTS interview_sessions (
  id           TEXT PRIMARY KEY,
  invite_token TEXT NOT NULL,
  state        TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interview_sessions_token
  ON interview_sessions (invite_token);

CREATE TABLE IF NOT EXISTS episodes (
  id           TEXT PRIMARY KEY,
  subject_id   TEXT NOT NULL,
  witness_id   TEXT NOT NULL,
  testimony_id TEXT NOT NULL,
  qid          TEXT NOT NULL,
  text         TEXT NOT NULL,
  elicited     INTEGER NOT NULL DEFAULT 0,
  situation    TEXT,
  audience     TEXT,
  time_hint    TEXT
);

CREATE INDEX IF NOT EXISTS idx_episodes_subject ON episodes (subject_id);

CREATE TABLE IF NOT EXISTS divergences (
  id               TEXT PRIMARY KEY,
  subject_id       TEXT NOT NULL,
  court_session_id TEXT NOT NULL,
  topic            TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('perspective', 'factual')),
  positions        TEXT NOT NULL,
  resolution       TEXT
);

CREATE INDEX IF NOT EXISTS idx_divergences_subject ON divergences (subject_id);

CREATE TABLE IF NOT EXISTS corpus_items (
  id         TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  text       TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('pasted', 'imported')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_corpus_items_subject ON corpus_items (subject_id);
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
    this.migrate();
    this.gate = new AuthorizationGate((witnessId) => this.getConsentLevel(witnessId));
  }

  /**
   * Idempotent column migrations for databases created before a column existed.
   *
   * `CREATE TABLE IF NOT EXISTS` never adds columns to an existing table, so an
   * older `data/openmimic.db` needs this to pick up `avoided_qids`. The
   * append-only triggers on `testimonies` are never touched.
   */
  private migrate(): void {
    const columns = this.db
      .prepare<[], { name: string }>("SELECT name FROM pragma_table_info('testimonies')")
      .all()
      .map((row) => row.name);
    if (!columns.includes('avoided_qids')) {
      this.db.exec('ALTER TABLE testimonies ADD COLUMN avoided_qids TEXT');
    }
    // `style_samples` and `rooms.imported` arrived with the `.persona` package
    // support; older databases need the columns added before first use.
    const subjectColumns = this.db
      .prepare<[], { name: string }>("SELECT name FROM pragma_table_info('subjects')")
      .all()
      .map((row) => row.name);
    if (!subjectColumns.includes('style_samples')) {
      this.db.exec('ALTER TABLE subjects ADD COLUMN style_samples TEXT');
    }
    const roomColumns = this.db
      .prepare<[], { name: string }>("SELECT name FROM pragma_table_info('rooms')")
      .all()
      .map((row) => row.name);
    if (!roomColumns.includes('imported')) {
      this.db.exec('ALTER TABLE rooms ADD COLUMN imported INTEGER');
    }
    // P1a: claims table extensions
    const claimColumns = this.db
      .prepare<[], { name: string }>("SELECT name FROM pragma_table_info('claims')")
      .all()
      .map((row) => row.name);
    if (!claimColumns.includes('kind')) {
      this.db.exec("ALTER TABLE claims ADD COLUMN kind TEXT DEFAULT 'pattern'");
    }
    if (!claimColumns.includes('domain')) {
      this.db.exec('ALTER TABLE claims ADD COLUMN domain TEXT');
    }
    if (!claimColumns.includes('context')) {
      this.db.exec('ALTER TABLE claims ADD COLUMN context TEXT');
    }
    if (!claimColumns.includes('witness_ids')) {
      this.db.exec('ALTER TABLE claims ADD COLUMN witness_ids TEXT');
    }
    if (!claimColumns.includes('episode_ids')) {
      this.db.exec('ALTER TABLE claims ADD COLUMN episode_ids TEXT');
    }
    // P3: reraised flag for claims that were re-raised after a contest
    if (!claimColumns.includes('reraised')) {
      this.db.exec('ALTER TABLE claims ADD COLUMN reraised INTEGER');
    }
    // P1a: witnesses table extensions
    const witnessColumns = this.db
      .prepare<[], { name: string }>("SELECT name FROM pragma_table_info('witnesses')")
      .all()
      .map((row) => row.name);
    if (!witnessColumns.includes('known_from_year')) {
      this.db.exec('ALTER TABLE witnesses ADD COLUMN known_from_year INTEGER');
    }
    if (!witnessColumns.includes('known_to_year')) {
      this.db.exec('ALTER TABLE witnesses ADD COLUMN known_to_year INTEGER');
    }
    // P3a: anonymousInRoom flag
    if (!witnessColumns.includes('anonymous_in_room')) {
      this.db.exec('ALTER TABLE witnesses ADD COLUMN anonymous_in_room INTEGER');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Subjects & witnesses                                              */
  /* ---------------------------------------------------------------- */

  putSubject(subject: Subject): Subject {
    const parsed = SubjectSchema.parse(subject);
    this.db
      .prepare<[string, string, string | null, string | null]>(
        `INSERT INTO subjects (id, display_name, self_report, style_samples) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name  = excluded.display_name,
           self_report   = excluded.self_report,
           style_samples = excluded.style_samples`,
      )
      .run(
        parsed.id,
        parsed.displayName,
        parsed.selfReport ?? null,
        parsed.styleSamples ? JSON.stringify(parsed.styleSamples) : null,
      );
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
      .prepare<[string, string, string, string | null, string, number | null, number | null, number | null]>(
        `INSERT INTO witnesses (id, subject_id, relation, stance, consent_level, known_from_year, known_to_year, anonymous_in_room)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           subject_id        = excluded.subject_id,
           relation          = excluded.relation,
           stance            = excluded.stance,
           consent_level     = excluded.consent_level,
           known_from_year   = excluded.known_from_year,
           known_to_year     = excluded.known_to_year,
           anonymous_in_room = excluded.anonymous_in_room`,
      )
      .run(
        parsed.id,
        parsed.subjectId,
        parsed.relation,
        parsed.stance ?? null,
        parsed.consentLevel,
        parsed.knownFromYear ?? null,
        parsed.knownToYear ?? null,
        parsed.anonymousInRoom ? 1 : null,
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
        [string, string, string, string, string, string | null, string, number | null]
      >(
        `INSERT INTO rooms
           (id, subject_id, topic_seed, status, behind_transcript, front_transcript, created_at, imported)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           subject_id        = excluded.subject_id,
           topic_seed        = excluded.topic_seed,
           status            = excluded.status,
           behind_transcript = excluded.behind_transcript,
           front_transcript  = excluded.front_transcript,
           created_at        = excluded.created_at,
           imported          = excluded.imported`,
      )
      .run(
        parsed.id,
        parsed.subjectId,
        parsed.topicSeed,
        parsed.status,
        JSON.stringify(parsed.behindTranscript),
        parsed.frontTranscript ? JSON.stringify(parsed.frontTranscript) : null,
        parsed.createdAt,
        parsed.imported ? 1 : null,
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
  /* Interview sessions — mutable process drafts, not evidence         */
  /* ---------------------------------------------------------------- */

  /**
   * Persist an interview session.
   *
   * A session is rewritten on every answer, so unlike testimony this is a
   * plain upsert. Its `state` is opaque to the kernel: the collector that
   * created it owns the shape. The boundary is deliberate — a session is a
   * draft on the way to a testimony, and only `addTestimony` ever puts words
   * into the append-only ledger.
   */
  putInterviewSession(input: InterviewSessionInput): InterviewSessionRecord {
    const record: InterviewSessionRecord = {
      id: input.id,
      inviteToken: input.inviteToken,
      state: input.state,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.db
      .prepare<[string, string, string, string]>(
        `INSERT INTO interview_sessions (id, invite_token, state, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           invite_token = excluded.invite_token,
           state        = excluded.state,
           created_at   = excluded.created_at`,
      )
      .run(
        record.id,
        record.inviteToken,
        JSON.stringify(record.state),
        record.createdAt,
      );
    return record;
  }

  getInterviewSession(id: string): InterviewSessionRecord | undefined {
    const row = this.db
      .prepare<[string], InterviewSessionRow>(
        'SELECT * FROM interview_sessions WHERE id = ?',
      )
      .get(id);
    return row ? this.rowToInterviewSession(row) : undefined;
  }

  /**
   * Drop a finished or expired session.
   *
   * Named `purge` rather than `delete` on purpose: the session table is a
   * draft store, not the ledger, and the ledger's own no-mutator guard keeps
   * its meaning.
   */
  purgeInterviewSession(id: string): boolean {
    const result = this.db
      .prepare<[string]>('DELETE FROM interview_sessions WHERE id = ?')
      .run(id);
    return result.changes > 0;
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
      .prepare<
        [string, string, string, string, string, string | null, string | null, string | null]
      >(
        `INSERT INTO testimonies
           (id, witness_id, subject_id, created_at, answers, free_text, correction_of, avoided_qids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        testimony.id,
        testimony.witnessId,
        testimony.subjectId,
        testimony.createdAt,
        JSON.stringify(testimony.answers),
        testimony.freeText ?? null,
        testimony.correctionOf ?? null,
        testimony.avoidedQids ? JSON.stringify(testimony.avoidedQids) : null,
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
      .prepare(
        `INSERT INTO claims
           (id, subject_id, text, conviction, evidence, qualifiers, status, court_session_id, kind, domain, context, witness_ids, episode_ids, reraised)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           subject_id       = excluded.subject_id,
           text             = excluded.text,
           conviction       = excluded.conviction,
           evidence         = excluded.evidence,
           qualifiers       = excluded.qualifiers,
           status           = excluded.status,
           court_session_id = excluded.court_session_id,
           kind             = excluded.kind,
           domain           = excluded.domain,
           context          = excluded.context,
           witness_ids      = excluded.witness_ids,
           episode_ids      = excluded.episode_ids,
           reraised         = excluded.reraised`,
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
        parsed.kind ?? 'pattern',
        parsed.domain ?? null,
        parsed.context ? JSON.stringify(parsed.context) : null,
        parsed.witnessIds ? JSON.stringify(parsed.witnessIds) : null,
        parsed.episodeIds ? JSON.stringify(parsed.episodeIds) : null,
        parsed.reraised ? 1 : null,
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

  /* ---------------------------------------------------------------- */
  /* Episodes                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Persist an episode.
   *
   * Validates that `text` is a verbatim substring of the corresponding
   * testimony answer. If `elicited` is true, the text must be in
   * `followupText`; if false, in `behindText`. Throws {@link NoAnchorError}
   * when validation fails.
   */
  putEpisode(episode: Episode): Episode {
    const parsed = EpisodeSchema.parse(episode);
    const testimony = this.getTestimony(parsed.testimonyId);
    if (!testimony) {
      throw new NoAnchorError(`episode ${parsed.id} references unknown testimony ${parsed.testimonyId}`);
    }
    const answer = testimony.answers.find((a) => a.qid === parsed.qid);
    if (!answer) {
      throw new NoAnchorError(`episode ${parsed.id}: qid ${parsed.qid} not found in testimony ${parsed.testimonyId}`);
    }
    // Validate verbatim substring against the correct source field
    if (parsed.elicited) {
      if (!answer.followupText || !answer.followupText.includes(parsed.text)) {
        throw new NoAnchorError(`episode ${parsed.id}: text is not a verbatim substring of followupText`);
      }
    } else {
      if (!answer.behindText.includes(parsed.text)) {
        throw new NoAnchorError(`episode ${parsed.id}: text is not a verbatim substring of behindText`);
      }
    }

    this.db
      .prepare<[string, string, string, string, string, string, number, string | null, string | null, string | null]>(
        `INSERT INTO episodes (id, subject_id, witness_id, testimony_id, qid, text, elicited, situation, audience, time_hint)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           subject_id   = excluded.subject_id,
           witness_id   = excluded.witness_id,
           testimony_id = excluded.testimony_id,
           qid          = excluded.qid,
           text         = excluded.text,
           elicited     = excluded.elicited,
           situation    = excluded.situation,
           audience     = excluded.audience,
           time_hint    = excluded.time_hint`,
      )
      .run(
        parsed.id,
        parsed.subjectId,
        parsed.witnessId,
        parsed.testimonyId,
        parsed.qid,
        parsed.text,
        parsed.elicited ? 1 : 0,
        parsed.situation ?? null,
        parsed.audience ?? null,
        parsed.timeHint ?? null,
      );
    return parsed;
  }

  getEpisode(id: string): Episode | undefined {
    const row = this.db
      .prepare<[string], EpisodeRow>('SELECT * FROM episodes WHERE id = ?')
      .get(id);
    return row ? this.rowToEpisode(row) : undefined;
  }

  listEpisodesBySubject(subjectId: string): Episode[] {
    return this.db
      .prepare<[string], EpisodeRow>(
        'SELECT * FROM episodes WHERE subject_id = ? ORDER BY rowid ASC',
      )
      .all(subjectId)
      .map((row) => this.rowToEpisode(row));
  }

  /* ---------------------------------------------------------------- */
  /* Divergences                                                       */
  /* ---------------------------------------------------------------- */

  putDivergence(divergence: Divergence): Divergence {
    const parsed = DivergenceSchema.parse(divergence);
    this.db
      .prepare<[string, string, string, string, string, string, string | null]>(
        `INSERT INTO divergences (id, subject_id, court_session_id, topic, type, positions, resolution)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           subject_id       = excluded.subject_id,
           court_session_id = excluded.court_session_id,
           topic            = excluded.topic,
           type             = excluded.type,
           positions        = excluded.positions,
           resolution       = excluded.resolution`,
      )
      .run(
        parsed.id,
        parsed.subjectId,
        parsed.courtSessionId,
        parsed.topic,
        parsed.type,
        JSON.stringify(parsed.positions),
        parsed.resolution ?? null,
      );
    return parsed;
  }

  getDivergence(id: string): Divergence | undefined {
    const row = this.db
      .prepare<[string], DivergenceRow>('SELECT * FROM divergences WHERE id = ?')
      .get(id);
    return row ? this.rowToDivergence(row) : undefined;
  }

  listDivergencesBySubject(subjectId: string): Divergence[] {
    return this.db
      .prepare<[string], DivergenceRow>(
        'SELECT * FROM divergences WHERE subject_id = ? ORDER BY rowid ASC',
      )
      .all(subjectId)
      .map((row) => this.rowToDivergence(row));
  }

  /* ---------------------------------------------------------------- */
  /* Corpus items — the subject's own words, separate from testimony    */
  /* ---------------------------------------------------------------- */

  putCorpusItem(item: CorpusItem): CorpusItem {
    const parsed = CorpusItemSchema.parse(item);
    this.db
      .prepare<[string, string, string, string, string]>(
        `INSERT INTO corpus_items (id, subject_id, text, source, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           subject_id = excluded.subject_id,
           text       = excluded.text,
           source     = excluded.source,
           created_at = excluded.created_at`,
      )
      .run(
        parsed.id,
        parsed.subjectId,
        parsed.text,
        parsed.source,
        parsed.createdAt,
      );
    return parsed;
  }

  getCorpusItem(id: string): CorpusItem | undefined {
    const row = this.db
      .prepare<[string], CorpusItemRow>('SELECT * FROM corpus_items WHERE id = ?')
      .get(id);
    return row ? this.rowToCorpusItem(row) : undefined;
  }

  listCorpusItemsBySubject(subjectId: string): CorpusItem[] {
    return this.db
      .prepare<[string], CorpusItemRow>(
        'SELECT * FROM corpus_items WHERE subject_id = ? ORDER BY created_at ASC, rowid ASC',
      )
      .all(subjectId)
      .map((row) => this.rowToCorpusItem(row));
  }

  /* ---------------------------------------------------------------- */
  /* Plugin storage — sandboxed tables for plugin-specific data        */
  /* ---------------------------------------------------------------- */

  /**
   * Register a table owned by a plugin.
   *
   * The table name is forced to `plugin_<pluginName>_<tableSuffix>` to prevent
   * any plugin from touching the core tables (especially `testimonies`).
   * The DDL must be a CREATE TABLE IF NOT EXISTS statement; the store validates
   * that the table name in the DDL matches the expected prefixed name.
   *
   * Returns a `PluginTableHandle` with read/write methods scoped to that table.
   * The handle exposes `insert` (append-only by default), `query`, and optionally
   * `update` (only if `appendOnly` is false).
   */
  registerPluginTable(
    pluginName: string,
    tableSuffix: string,
    ddl: string,
    options: { appendOnly?: boolean } = {},
  ): PluginTableHandle {
    const fullName = `plugin_${pluginName}_${tableSuffix}`;
    const appendOnly = options.appendOnly ?? false;

    // Validate DDL references the correct table name
    if (!ddl.includes(fullName)) {
      throw new Error(
        `Plugin table DDL must reference "${fullName}", got: ${ddl.slice(0, 120)}`,
      );
    }
    // Guard: no plugin can reference core tables
    const forbidden = ['testimonies', 'claims', 'witnesses', 'subjects',
      'court_sessions', 'rooms', 'invites', 'episodes', 'divergences',
      'corpus_items', 'interview_sessions'];
    for (const table of forbidden) {
      // Check for direct table references (not in the prefixed name)
      const pattern = new RegExp(`\\b${table}\\b`);
      const withoutPrefix = ddl.replace(new RegExp(fullName, 'g'), '');
      if (pattern.test(withoutPrefix)) {
        throw new Error(`Plugin DDL must not reference core table "${table}"`);
      }
    }

    this.db.exec(ddl);

    return new PluginTableHandle(this.db, fullName, appendOnly);
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
      styleSamples: row.style_samples
        ? (JSON.parse(row.style_samples) as unknown)
        : undefined,
    };
  }

  private rowToWitness(row: WitnessRow): unknown {
    return {
      id: row.id,
      subjectId: row.subject_id,
      relation: row.relation,
      stance: row.stance ?? undefined,
      consentLevel: row.consent_level,
      knownFromYear: row.known_from_year ?? undefined,
      knownToYear: row.known_to_year === null ? undefined : row.known_to_year,
      anonymousInRoom: row.anonymous_in_room === 1 ? true : undefined,
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
      avoidedQids: row.avoided_qids ? (JSON.parse(row.avoided_qids) as unknown) : undefined,
    });
  }

  private rowToInterviewSession(row: InterviewSessionRow): InterviewSessionRecord {
    return {
      id: row.id,
      inviteToken: row.invite_token,
      state: JSON.parse(row.state) as unknown,
      createdAt: row.created_at,
    };
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
      kind: row.kind ?? 'pattern',
      domain: row.domain ?? undefined,
      context: row.context ? (JSON.parse(row.context) as unknown) : undefined,
      witnessIds: row.witness_ids ? (JSON.parse(row.witness_ids) as unknown) : undefined,
      episodeIds: row.episode_ids ? (JSON.parse(row.episode_ids) as unknown) : undefined,
      reraised: row.reraised === 1 ? true : undefined,
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
      imported: row.imported === 1 ? true : undefined,
    });
  }

  private rowToEpisode(row: EpisodeRow): Episode {
    return EpisodeSchema.parse({
      id: row.id,
      subjectId: row.subject_id,
      witnessId: row.witness_id,
      testimonyId: row.testimony_id,
      qid: row.qid,
      text: row.text,
      elicited: row.elicited === 1,
      situation: row.situation ?? undefined,
      audience: row.audience ?? undefined,
      timeHint: row.time_hint ?? undefined,
    });
  }

  private rowToDivergence(row: DivergenceRow): Divergence {
    return DivergenceSchema.parse({
      id: row.id,
      subjectId: row.subject_id,
      courtSessionId: row.court_session_id,
      topic: row.topic,
      type: row.type,
      positions: JSON.parse(row.positions) as unknown,
      resolution: row.resolution ?? undefined,
    });
  }

  private rowToCorpusItem(row: CorpusItemRow): CorpusItem {
    return CorpusItemSchema.parse({
      id: row.id,
      subjectId: row.subject_id,
      text: row.text,
      source: row.source,
      createdAt: row.created_at,
    });
  }
}

/* ------------------------------------------------------------------ */
/* PluginTableHandle — sandboxed DB access for plugin-owned tables     */
/* ------------------------------------------------------------------ */

/**
 * A scoped handle that lets a plugin read from and write to its own table.
 *
 * - The table name is always `plugin_<pluginName>_<suffix>` — a plugin cannot
 *   reach the testimony ledger or any other core table through this handle.
 * - When `appendOnly` is true, the handle exposes no update or delete methods,
 *   enforcing immutability at the API level.
 */
export class PluginTableHandle {
  constructor(
    private readonly db: DatabaseConnection,
    readonly tableName: string,
    private readonly appendOnly: boolean,
  ) {}

  /** Insert a row. Column names and values are taken from the object keys. */
  insert(row: Record<string, unknown>): void {
    const keys = Object.keys(row);
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map((k) => {
      const v = row[k];
      if (v === undefined || v === null) return null;
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });
    this.db
      .prepare(`INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders})`)
      .run(...values);
  }

  /** Query rows. Returns plain objects with snake_case keys. */
  query(where?: string, params?: unknown[]): Record<string, unknown>[] {
    const sql = where
      ? `SELECT * FROM ${this.tableName} WHERE ${where}`
      : `SELECT * FROM ${this.tableName}`;
    return this.db.prepare(sql).all(...(params ?? [])) as Record<string, unknown>[];
  }

  /** Update rows. Only available when the table is not append-only. */
  update(set: Record<string, unknown>, where: string, params: unknown[]): number {
    if (this.appendOnly) {
      throw new Error(`Table ${this.tableName} is append-only; updates are not allowed`);
    }
    const setClause = Object.keys(set)
      .map((k) => `${k} = ?`)
      .join(', ');
    const setValues = Object.keys(set).map((k) => {
      const v = set[k];
      if (v === undefined || v === null) return null;
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });
    const result = this.db
      .prepare(`UPDATE ${this.tableName} SET ${setClause} WHERE ${where}`)
      .run(...setValues, ...params);
    return result.changes;
  }

  /** Delete rows. Only available when the table is not append-only. */
  delete(where: string, params: unknown[]): number {
    if (this.appendOnly) {
      throw new Error(`Table ${this.tableName} is append-only; deletes are not allowed`);
    }
    const result = this.db
      .prepare(`DELETE FROM ${this.tableName} WHERE ${where}`)
      .run(...params);
    return result.changes;
  }
}
