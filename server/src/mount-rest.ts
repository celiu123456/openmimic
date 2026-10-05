/**
 * mount-rest: REST API routes as a plugin.
 *
 * All `/api/*` routes formerly in buildRouter() live here. The plugin injects
 * `store` and `witness`, and optionally uses `court`, `room` and `llm` when
 * available. If those engines are not loaded, routes that require them return
 * 501 (or fall back to demo data for the demo subject).
 *
 * Every route declares the scope it requires via the third argument to
 * `router.get()` / `router.post()`. Routes without a declaration default
 * to `admin` (fail-closed).
 */
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { SubjectSchema } from '@openmimic/shared';
import { assemblePersonaContext, findCrisisWord, type Store } from '@openmimic/kernel';
import type { Plugin, Context, Dispose } from '@openmimic/kernel';
import type { CourtEngine } from '@openmimic/engine-court';
import type { RoomEngine } from '@openmimic/engine-room';
import {
  AnswerFollowupInputSchema,
  AnswerQuestionInputSchema,
  FinishInterviewInputSchema,
  SubmitTestimonyInputSchema,
  SayInputSchema,
  FinishChatInputSchema,
  InterviewStateError,
  computeCoverage,
  adviseRelationGaps,
  resolveShortCode,
  WITNESS_V2_QUESTIONNAIRES,
  WITNESS_V2_FRIEND,
  type WitnessCollector,
  type ChatCollector,
} from '@openmimic/engine-witness';
import { RateLimiter } from './auth';
import { DEMO_SUBJECT_ID } from '../../fixtures/limo';
import { redactForExternal, withholdSynthesisOnly } from './external';
import {
  buildPersonaPackage,
  importPersonaPackage,
  personaContentDisposition,
} from './persona-package';
import { HttpError, type Router } from './router';
import { requireSubjectAccess } from './auth';
import { buildCapabilityDirectory } from './capabilities';
import { SCOPE_DEFINITIONS, type AuthContext } from './scopes';
import type { TokenStore } from './token-store';
import {
  isAsrAvailable,
  normalizeAudioInput,
  readAsrConfig,
  transcribeAudio,
  type AsrConfig,
} from './asr';

export const SERVER_VERSION = '0.0.1';

const CreateSubjectBodySchema = z.object({
  displayName: z.string().min(1),
  selfReport: z.string().min(1).optional(),
});

const CreateRoomBodySchema = z.object({
  topicSeed: z.string().min(1).optional(),
  scenarioId: z.string().min(1).optional(),
});

const CreateTokenBodySchema = z.object({
  name: z.string().min(1).max(128),
  scopes: z.array(z.string().min(1)).min(1),
  subjectIds: z.array(z.string().min(1)).optional(),
  expiresAt: z.string().min(1).optional(),
});

const errorBody = (code: string, message: string): unknown => ({ error: { code, message } });

function claimsForSession(store: Store, subjectId: string, sessionId: string) {
  return store
    .listClaimsBySubject(subjectId)
    .filter((claim) => claim.courtSessionId === sessionId);
}

/** Enforce subject binding from the auth context. */
function enforceSubject(context: { auth?: AuthContext; params: Record<string, string> }): void {
  const auth = context.auth;
  const subjectId = context.params.id;
  if (auth && subjectId) {
    requireSubjectAccess(auth, subjectId);
  }
}

export interface MountRestConfig {
  asr?: Partial<AsrConfig>;
  /** Base URL for invite links (e.g. "https://example.com"). */
  publicUrl?: string;
  /** Token store for scoped API tokens (injected by server). */
  tokenStore?: TokenStore;
}

export const mountRestPlugin: Plugin<MountRestConfig> = {
  name: 'mount-rest',
  kind: 'mount',
  version: '0.0.1',
  inject: ['store', 'witness', 'router'],
  apply(ctx, config) {
    const store = ctx.get<Store>('store');
    const collector = ctx.get<WitnessCollector>('witness');
    const router = ctx.get<Router>('router');
    const asr: AsrConfig = { ...readAsrConfig(), ...config?.asr };
    const publicUrl = (config?.publicUrl ?? process.env.OPENMIMIC_PUBLIC_URL ?? '').replace(/\/+$/, '');
    const tokenStore = config?.tokenStore;

    const hasCourt = () => ctx.has('court');
    const getCourt = () => ctx.get<CourtEngine>('court');
    const hasRoom = () => ctx.has('room');
    const getRoom = () => ctx.get<RoomEngine>('room');

    /* ---------------------------------------------------------------- */
    /* Health & capabilities (open)                                      */
    /* ---------------------------------------------------------------- */

    router.get('/api/health', () => ({
      status: 200,
      body: { ok: true, version: SERVER_VERSION },
    }), { open: true });

    router.get('/api/capabilities', () => {
      const capabilities = buildCapabilityDirectory();
      const scopes = Object.fromEntries(SCOPE_DEFINITIONS);
      return { status: 200, body: { capabilities, scopes } };
    }, { open: true });

    /* ---------------------------------------------------------------- */
    /* Token management (admin only)                                     */
    /* ---------------------------------------------------------------- */

    router.post('/api/tokens', (context) => {
      if (!tokenStore) {
        throw new HttpError(501, 'tokens_unavailable', 'Token management is not available');
      }
      const body = CreateTokenBodySchema.parse(context.body);
      try {
        const result = tokenStore.create({
          name: body.name,
          scopes: body.scopes,
          subjectIds: body.subjectIds,
          expiresAt: body.expiresAt,
        });
        return { status: 201, body: result };
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('unknown scope')) {
          throw new HttpError(400, 'invalid_scope', err.message);
        }
        throw err;
      }
    }, { scope: 'admin' });

    router.get('/api/tokens', () => {
      if (!tokenStore) {
        throw new HttpError(501, 'tokens_unavailable', 'Token management is not available');
      }
      return { status: 200, body: { tokens: tokenStore.list() } };
    }, { scope: 'admin' });

    router.add('DELETE', '/api/tokens/:id', (context) => {
      if (!tokenStore) {
        throw new HttpError(501, 'tokens_unavailable', 'Token management is not available');
      }
      const id = context.params.id ?? '';
      const deleted = tokenStore.delete(id);
      if (!deleted) throw new HttpError(404, 'token_not_found', 'Token not found');
      return { status: 200, body: { ok: true } };
    }, { scope: 'admin' });

    /* ---------------------------------------------------------------- */
    /* Subjects                                                          */
    /* ---------------------------------------------------------------- */

    router.get('/api/subjects', () => {
      const subjects = store.listSubjects();
      return { status: 200, body: { subjects } };
    }, { scope: 'persona.read' });

    router.post('/api/subjects', (context) => {
      const body = CreateSubjectBodySchema.parse(context.body);
      const subject = SubjectSchema.parse({
        id: randomUUID(),
        displayName: body.displayName,
        ...(body.selfReport !== undefined ? { selfReport: body.selfReport } : {}),
      });
      store.putSubject(subject);
      return { status: 201, body: subject };
    }, { scope: 'admin' });

    router.post('/api/subjects/:id/invites', (context) => {
      enforceSubject(context);
      const subject = store.getSubject(context.params.id ?? '');
      if (!subject) throw new HttpError(404, 'subject_not_found', 'Subject not found');
      const invite = collector.createInvite(subject.id);
      const invitePath = `/i/${invite.token}`;
      return {
        status: 201,
        body: {
          token: invite.token,
          url: publicUrl ? `${publicUrl}${invitePath}` : invitePath,
          expiresAt: invite.expiresAt,
          ...(invite.shortCode
            ? {
                shortCode: invite.shortCode,
                shortUrl: publicUrl
                  ? `${publicUrl}/i/${invite.shortCode}`
                  : `/i/${invite.shortCode}`,
              }
            : {}),
        },
      };
    }, { scope: 'admin' });

    /* ---------------------------------------------------------------- */
    /* Invite / interview routes (open — gated by invite token)          */
    /* ---------------------------------------------------------------- */

    router.get('/api/invites/:token', (context) => {
      const resolved = collector.resolveInvite(context.params.token ?? '');
      const subject = store.getSubject(resolved.subjectId);
      if (!subject) throw new HttpError(404, 'subject_not_found', 'Subject not found');
      return {
        status: 200,
        body: { subjectDisplayName: subject.displayName, questionnaire: resolved.questionnaire },
      };
    }, { open: true });

    /* Short code resolution — stricter rate limit against guessing */
    const shortCodeLimiter = new RateLimiter({ maxRequests: 10, windowMs: 60_000 });

    router.get('/api/i/:code', (context) => {
      const code = context.params.code ?? '';
      if (!shortCodeLimiter.check(`shortcode:${code.toUpperCase()}`)) {
        throw new HttpError(429, 'rate_limited', '请求过于频繁，请稍后再试');
      }
      const resolved = resolveShortCode(store, code);
      const subject = store.getSubject(resolved.subjectId);
      if (!subject) throw new HttpError(404, 'subject_not_found', '当事人不存在');
      // Return the same shape as the long token resolve, plus the long token
      // so the client can switch to the token-based flow for the interview.
      const invite = store.getInviteByShortCode(code.toUpperCase());
      return {
        status: 200,
        body: {
          subjectDisplayName: subject.displayName,
          questionnaire: resolved.questionnaire,
          token: invite?.token,
        },
      };
    }, { open: true });

    router.post('/api/invites/:token/testimony', (context) => {
      const input = SubmitTestimonyInputSchema.parse(context.body);
      const result = collector.submitTestimony(context.params.token ?? '', input);
      return { status: 201, body: result };
    }, { open: true });

    /** @deprecated Use POST /api/invites/:token/chat instead. */
    router.post('/api/invites/:token/interview', (context) => {
      const started = collector.startInterview(context.params.token ?? '');
      return {
        status: 201,
        body: {
          sessionId: started.sessionId,
          question: started.question,
          total: collector.questionnaire.questions.length,
          ...(started.opening ? { opening: started.opening } : {}),
        },
      };
    }, { open: true });

    /** @deprecated Use POST /api/chat/:sid/say instead. */
    router.post('/api/interview/:sid/answer', async (context) => {
      const input = AnswerQuestionInputSchema.parse(context.body);
      const step = await collector.answerQuestion(context.params.sid ?? '', input);
      return { status: 200, body: step };
    }, { open: true });

    /** @deprecated Use POST /api/chat/:sid/say instead. */
    router.post('/api/interview/:sid/followup', (context) => {
      const input = AnswerFollowupInputSchema.parse(context.body);
      const step = collector.answerFollowup(context.params.sid ?? '', input);
      return { status: 200, body: step };
    }, { open: true });

    /** @deprecated Use POST /api/chat/:sid/finish instead. */
    router.post('/api/interview/:sid/finish', (context) => {
      const input = FinishInterviewInputSchema.parse(context.body);
      const result = collector.finishInterview(context.params.sid ?? '', input);
      return { status: 201, body: result };
    }, { open: true });

    /* ---------------------------------------------------------------- */
    /* v4 chat routes (open — gated by invite token)                     */
    /* ---------------------------------------------------------------- */

    const hasChat = () => ctx.has('chat');
    const getChat = () => ctx.get<ChatCollector>('chat');

    router.post('/api/invites/:token/chat', async (context) => {
      if (!hasChat()) throw new HttpError(404, 'chat_unavailable', 'Chat interviewer not available');
      const body = (context.body ?? {}) as Record<string, unknown>;
      const mode = body.mode === 'self' ? 'self' as const : undefined;
      const result = await getChat().startChat(context.params.token ?? '', mode);
      return { status: 201, body: result };
    }, { open: true });

    router.post('/api/chat/:sid/say', async (context) => {
      if (!hasChat()) throw new HttpError(404, 'chat_unavailable', 'Chat interviewer not available');
      const body = SayInputSchema.parse(context.body);
      try {
        const result = await getChat().say(context.params.sid ?? '', body);
        return { status: 200, body: result };
      } catch (caught) {
        if (caught instanceof InterviewStateError && caught.message === 'interview_generation_failed') {
          return { status: 503, body: errorBody('interview_generation_failed', '生成失败，请稍后重试') };
        }
        throw caught;
      }
    }, { open: true });

    router.post('/api/chat/:sid/finish', (context) => {
      if (!hasChat()) throw new HttpError(404, 'chat_unavailable', 'Chat interviewer not available');
      const body = FinishChatInputSchema.parse(context.body);
      const result = getChat().finishChat(context.params.sid ?? '', body);
      return { status: 201, body: result };
    }, { open: true });

    router.get('/api/chat/:sid', (context) => {
      if (!hasChat()) throw new HttpError(404, 'chat_unavailable', 'Chat interviewer not available');
      const result = getChat().getChatHistory(context.params.sid ?? '');
      return { status: 200, body: result };
    }, { open: true });

    /* ---------------------------------------------------------------- */
    /* Subject data — persona.read scope                                 */
    /* ---------------------------------------------------------------- */

    router.get('/api/subjects/:id/progress', (context) => {
      enforceSubject(context);
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', 'Subject not found');
      }
      return {
        status: 200,
        body: {
          testimonyCount: store.listBySubject(subjectId).length,
          witnessCount: store.listWitnessesBySubject(subjectId).length,
        },
      };
    }, { scope: 'persona.read' });

    router.get('/api/subjects/:id/claims', (context) => {
      enforceSubject(context);
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', 'Subject not found');
      }
      const claims = store
        .listClaimsBySubject(subjectId)
        .filter((claim) => claim.status === 'surviving');
      return { status: 200, body: { claims } };
    }, { scope: 'testimony.read' });

    /* ---------------------------------------------------------------- */
    /* Rooms                                                             */
    /* ---------------------------------------------------------------- */

    /* Coverage overview for the inviter page */

    router.get('/api/subjects/:id/coverage', (context) => {
      enforceSubject(context);
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', '当事人不存在');
      }
      const testimonies = store.listBySubject(subjectId);
      const witnesses = store.listWitnessesBySubject(subjectId);
      const questionnaires = Object.values(WITNESS_V2_QUESTIONNAIRES);
      const coverage = computeCoverage(subjectId, testimonies, witnesses, questionnaires);
      const relationAdvice = adviseRelationGaps(witnesses);
      return {
        status: 200,
        body: { coverage, relationAdvice },
      };
    }, { scope: 'admin' });

    router.get('/api/subjects/:id/rooms', (context) => {
      enforceSubject(context);
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', 'Subject not found');
      }
      return { status: 200, body: { rooms: store.listRoomsBySubject(subjectId) } };
    }, { scope: 'room.read' });

    router.post('/api/subjects/:id/rooms', async (context) => {
      enforceSubject(context);
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', 'Subject not found');
      }
      const body = CreateRoomBodySchema.parse(context.body ?? {});

      // Resolve scenario topicSeed
      let topicSeed = body.topicSeed;
      if (body.scenarioId && !topicSeed) {
        const scenario = ctx.scenarios.get(body.scenarioId);
        if (scenario) topicSeed = scenario.topicSeed;
      }

      const crisisWord = topicSeed ? findCrisisWord(topicSeed) : undefined;
      if (crisisWord) {
        throw new HttpError(
          422,
          'room_refused',
          `Topic seed contains crisis word "${crisisWord}"`,
        );
      }

      if (hasRoom()) {
        const room = await getRoom().runBehindRoom(
          subjectId,
          topicSeed !== undefined ? { topicSeed } : {},
        );
        return { status: 201, body: room };
      }

      if (subjectId === DEMO_SUBJECT_ID) {
        const rooms = store.listRoomsBySubject(subjectId);
        const room = rooms[rooms.length - 1];
        if (!room) throw new HttpError(500, 'demo_missing', 'Demo data not initialized');
        return { status: 201, body: room };
      }
      throw new HttpError(501, 'llm_unavailable', 'LLM not configured');
    }, { scope: 'room.run' });

    router.post('/api/rooms/:id/door', async (context) => {
      const roomId = context.params.id ?? '';
      const room = store.getRoom(roomId);
      if (!room) throw new HttpError(404, 'room_not_found', 'Room not found');

      if (hasRoom()) {
        const opened = await getRoom().openDoor(roomId);
        return { status: 200, body: opened };
      }
      if (room.subjectId === DEMO_SUBJECT_ID) {
        return { status: 200, body: room };
      }
      throw new HttpError(501, 'llm_unavailable', 'LLM not configured');
    }, { scope: 'room.run' });

    router.get('/api/rooms/:id', (context) => {
      const room = store.getRoom(context.params.id ?? '');
      if (!room) throw new HttpError(404, 'room_not_found', 'Room not found');
      const subject = store.getSubject(room.subjectId);
      return { status: 200, body: { ...room, subjectDisplayName: subject?.displayName ?? '' } };
    }, { scope: 'room.read' });

    /* ---------------------------------------------------------------- */
    /* Court                                                             */
    /* ---------------------------------------------------------------- */

    router.post('/api/subjects/:id/court', async (context) => {
      enforceSubject(context);
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', 'Subject not found');
      }

      if (hasCourt()) {
        const session = await getCourt().runCourt(subjectId);
        for (const claim of store.listClaimsBySubject(subjectId)) {
          if (claim.courtSessionId !== session.id && claim.status !== 'retired') {
            store.putClaim({ ...claim, status: 'retired' });
          }
        }
        return {
          status: 200,
          body: { session, claims: claimsForSession(store, subjectId, session.id) },
        };
      }

      if (subjectId === DEMO_SUBJECT_ID) {
        const sessions = store.listCourtSessionsBySubject(subjectId);
        const session = sessions[sessions.length - 1];
        if (!session) throw new HttpError(500, 'demo_missing', 'Demo data not initialized');
        return {
          status: 200,
          body: { session, claims: claimsForSession(store, subjectId, session.id) },
        };
      }
      throw new HttpError(501, 'llm_unavailable', 'LLM not configured');
    }, { scope: 'court.run' });

    router.get('/api/court/:sessionId', (context) => {
      const session = store.getCourtSession(context.params.sessionId ?? '');
      if (!session) throw new HttpError(404, 'session_not_found', 'Court session not found');
      return { status: 200, body: session };
    }, { scope: 'testimony.read' });

    /* ---------------------------------------------------------------- */
    /* Testimony data (requires testimony.read or testimony.write)       */
    /* ---------------------------------------------------------------- */

    router.post('/api/subjects/:id/corpus', (context) => {
      enforceSubject(context);
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', 'Subject not found');
      }
      const { text } = z.object({ text: z.string().min(1) }).parse(context.body);
      const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
      const items = lines.map((line) =>
        store.putCorpusItem({
          id: randomUUID(),
          subjectId,
          text: line,
          source: 'pasted',
          createdAt: new Date().toISOString(),
        }),
      );
      return { status: 201, body: { items } };
    }, { scope: 'testimony.write' });

    router.get('/api/subjects/:id/corpus', (context) => {
      enforceSubject(context);
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', 'Subject not found');
      }
      const items = store.listCorpusItemsBySubject(subjectId);
      return { status: 200, body: { items } };
    }, { scope: 'testimony.read' });

    router.get('/api/subjects/:id/divergences', (context) => {
      enforceSubject(context);
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', 'Subject not found');
      }
      const divergences = store.listDivergencesBySubject(subjectId);
      return { status: 200, body: { divergences } };
    }, { scope: 'testimony.read' });

    router.get('/api/subjects/:id/episodes', (context) => {
      enforceSubject(context);
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', 'Subject not found');
      }
      const episodes = store.listEpisodesBySubject(subjectId);
      const synthesisOnlyWitnessIds = new Set(
        store.listWitnessesBySubject(subjectId)
          .filter((w) => w.consentLevel === 'synthesis_only')
          .map((w) => w.id),
      );
      const filtered = episodes.map((ep) =>
        synthesisOnlyWitnessIds.has(ep.witnessId)
          ? { ...ep, text: '[withheld]' }
          : ep,
      );
      return { status: 200, body: { episodes: filtered } };
    }, { scope: 'testimony.read' });

    /* ---------------------------------------------------------------- */
    /* Persona packages                                                  */
    /* ---------------------------------------------------------------- */

    router.get('/api/subjects/:id/export', (context) => {
      enforceSubject(context);
      const subjectId = context.params.id ?? '';
      const subject = store.getSubject(subjectId);
      if (!subject) throw new HttpError(404, 'subject_not_found', 'Subject not found');
      const ack = context.query.get('acknowledgeRealPerson') === 'true';
      let pkg: ReturnType<typeof buildPersonaPackage>;
      try {
        pkg = buildPersonaPackage(subjectId, store, { acknowledgeRealPerson: ack });
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('acknowledgeRealPerson')) {
          throw new HttpError(403, 'real_person_gate',
            'This persona depicts a real person. Pass acknowledgeRealPerson=true ' +
            'to confirm you have authorization to distribute this personality package.',
          );
        }
        throw err;
      }
      if (!pkg) throw new HttpError(404, 'subject_not_found', 'Subject not found');
      const body = withholdSynthesisOnly(store, subjectId, pkg);
      return {
        status: 200,
        body,
        headers: {
          'content-disposition': personaContentDisposition(subject.displayName, subjectId),
        },
      };
    }, { scope: 'export' });

    router.post('/api/import', (context) => {
      const result = importPersonaPackage(store, context.body);
      return { status: 201, body: result };
    }, { scope: 'admin' });

    /* ---------------------------------------------------------------- */
    /* ASR (admin — uses server resources)                               */
    /* ---------------------------------------------------------------- */

    router.get('/api/asr/available', () => ({
      status: 200,
      body: { available: isAsrAvailable(asr) },
    }), { open: true });

    router.post('/api/asr', async (context) => {
      if (!isAsrAvailable(asr)) {
        throw new HttpError(501, 'asr_unavailable', 'ASR not configured');
      }
      const raw = context.rawBody;
      if (!raw || raw.length === 0) {
        throw new HttpError(400, 'asr_no_audio', 'No audio data received');
      }
      const input = await normalizeAudioInput(raw, context.contentType ?? '');
      const result = await transcribeAudio(input, asr);
      return {
        status: 200,
        body: {
          text: result.text,
          lowConfidence: result.lowConfidence,
          confidence: result.confidence,
        },
      };
    }, { open: true });
  },
};
