/**
 * mount-rest: REST API routes as a plugin.
 *
 * All `/api/*` routes formerly in buildRouter() live here. The plugin injects
 * `store` and `witness`, and optionally uses `court`, `room` and `llm` when
 * available. If those engines are not loaded, routes that require them return
 * 501 (or fall back to demo data for the demo subject).
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
  computeCoverage,
  adviseRelationGaps,
  resolveShortCode,
  WITNESS_V2_QUESTIONNAIRES,
  WITNESS_V2_FRIEND,
  type WitnessCollector,
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

const errorBody = (code: string, message: string): unknown => ({ error: { code, message } });

function claimsForSession(store: Store, subjectId: string, sessionId: string) {
  return store
    .listClaimsBySubject(subjectId)
    .filter((claim) => claim.courtSessionId === sessionId);
}

export interface MountRestConfig {
  asr?: Partial<AsrConfig>;
  /** Base URL for invite links (e.g. "https://example.com"). */
  publicUrl?: string;
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

    const hasCourt = () => ctx.has('court');
    const getCourt = () => ctx.get<CourtEngine>('court');
    const hasRoom = () => ctx.has('room');
    const getRoom = () => ctx.get<RoomEngine>('room');

    router.get('/api/health', () => ({
      status: 200,
      body: { ok: true, version: SERVER_VERSION },
    }));

    router.get('/api/subjects', () => {
      const subjects = store.listSubjects();
      return { status: 200, body: { subjects } };
    });

    router.post('/api/subjects', (context) => {
      const body = CreateSubjectBodySchema.parse(context.body);
      const subject = SubjectSchema.parse({
        id: randomUUID(),
        displayName: body.displayName,
        ...(body.selfReport !== undefined ? { selfReport: body.selfReport } : {}),
      });
      store.putSubject(subject);
      return { status: 201, body: subject };
    });

    router.post('/api/subjects/:id/invites', (context) => {
      const subject = store.getSubject(context.params.id ?? '');
      if (!subject) throw new HttpError(404, 'subject_not_found', '当事人不存在');
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
    });

    router.get('/api/invites/:token', (context) => {
      const resolved = collector.resolveInvite(context.params.token ?? '');
      const subject = store.getSubject(resolved.subjectId);
      if (!subject) throw new HttpError(404, 'subject_not_found', '当事人不存在');
      return {
        status: 200,
        body: { subjectDisplayName: subject.displayName, questionnaire: resolved.questionnaire },
      };
    });

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
    });

    router.post('/api/invites/:token/testimony', (context) => {
      const input = SubmitTestimonyInputSchema.parse(context.body);
      const result = collector.submitTestimony(context.params.token ?? '', input);
      return { status: 201, body: result };
    });

    /* Interview sessions */

    router.post('/api/invites/:token/interview', (context) => {
      const started = collector.startInterview(context.params.token ?? '');
      return {
        status: 201,
        body: {
          sessionId: started.sessionId,
          question: started.question,
          total: collector.questionnaire.questions.length,
        },
      };
    });

    router.post('/api/interview/:sid/answer', async (context) => {
      const input = AnswerQuestionInputSchema.parse(context.body);
      const step = await collector.answerQuestion(context.params.sid ?? '', input);
      return { status: 200, body: step };
    });

    router.post('/api/interview/:sid/followup', (context) => {
      const input = AnswerFollowupInputSchema.parse(context.body);
      const step = collector.answerFollowup(context.params.sid ?? '', input);
      return { status: 200, body: step };
    });

    router.post('/api/interview/:sid/finish', (context) => {
      const input = FinishInterviewInputSchema.parse(context.body);
      const result = collector.finishInterview(context.params.sid ?? '', input);
      return { status: 201, body: result };
    });

    router.get('/api/subjects/:id/progress', (context) => {
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', '当事人不存在');
      }
      return {
        status: 200,
        body: {
          testimonyCount: store.listBySubject(subjectId).length,
          witnessCount: store.listWitnessesBySubject(subjectId).length,
        },
      };
    });

    /* Coverage overview for the inviter page */

    router.get('/api/subjects/:id/coverage', (context) => {
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
    });

    router.get('/api/subjects/:id/rooms', (context) => {
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', '当事人不存在');
      }
      return { status: 200, body: { rooms: store.listRoomsBySubject(subjectId) } };
    });

    router.post('/api/subjects/:id/rooms', async (context) => {
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', '当事人不存在');
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
          `话题种子包含危机词面「${crisisWord}」,拒绝开房`,
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
        if (!room) throw new HttpError(500, 'demo_missing', '演示数据未初始化');
        return { status: 201, body: room };
      }
      throw new HttpError(501, 'llm_unavailable', '服务器未配置语言模型');
    });

    router.post('/api/rooms/:id/door', async (context) => {
      const roomId = context.params.id ?? '';
      const room = store.getRoom(roomId);
      if (!room) throw new HttpError(404, 'room_not_found', '房间不存在');

      if (hasRoom()) {
        const opened = await getRoom().openDoor(roomId);
        return { status: 200, body: opened };
      }
      if (room.subjectId === DEMO_SUBJECT_ID) {
        return { status: 200, body: room };
      }
      throw new HttpError(501, 'llm_unavailable', '服务器未配置语言模型');
    });

    router.get('/api/rooms/:id', (context) => {
      const room = store.getRoom(context.params.id ?? '');
      if (!room) throw new HttpError(404, 'room_not_found', '房间不存在');
      const subject = store.getSubject(room.subjectId);
      return { status: 200, body: { ...room, subjectDisplayName: subject?.displayName ?? '' } };
    });

    /* Court */

    router.post('/api/subjects/:id/court', async (context) => {
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', '当事人不存在');
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
        if (!session) throw new HttpError(500, 'demo_missing', '演示数据未初始化');
        return {
          status: 200,
          body: { session, claims: claimsForSession(store, subjectId, session.id) },
        };
      }
      throw new HttpError(501, 'llm_unavailable', '服务器未配置语言模型');
    });

    router.get('/api/subjects/:id/claims', (context) => {
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', '当事人不存在');
      }
      const claims = store
        .listClaimsBySubject(subjectId)
        .filter((claim) => claim.status === 'surviving');
      return { status: 200, body: { claims } };
    });

    /* Corpus, episodes, divergences */

    router.post('/api/subjects/:id/corpus', (context) => {
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', '当事人不存在');
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
    });

    router.get('/api/subjects/:id/corpus', (context) => {
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', '当事人不存在');
      }
      const items = store.listCorpusItemsBySubject(subjectId);
      return { status: 200, body: { items } };
    });

    router.get('/api/subjects/:id/divergences', (context) => {
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', '当事人不存在');
      }
      const divergences = store.listDivergencesBySubject(subjectId);
      return { status: 200, body: { divergences } };
    });

    router.get('/api/subjects/:id/episodes', (context) => {
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', '当事人不存在');
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
    });

    /* Persona packages */

    router.get('/api/subjects/:id/export', (context) => {
      const subjectId = context.params.id ?? '';
      const subject = store.getSubject(subjectId);
      if (!subject) throw new HttpError(404, 'subject_not_found', '当事人不存在');
      const pkg = buildPersonaPackage(subjectId, store);
      if (!pkg) throw new HttpError(404, 'subject_not_found', '当事人不存在');
      const body = withholdSynthesisOnly(store, subjectId, pkg);
      return {
        status: 200,
        body,
        headers: {
          'content-disposition': personaContentDisposition(subject.displayName, subjectId),
        },
      };
    });

    router.post('/api/import', (context) => {
      const result = importPersonaPackage(store, context.body);
      return { status: 201, body: result };
    });

    router.get('/api/court/:sessionId', (context) => {
      const session = store.getCourtSession(context.params.sessionId ?? '');
      if (!session) throw new HttpError(404, 'session_not_found', '法庭会话不存在');
      return { status: 200, body: session };
    });

    router.get('/api/asr/available', () => ({
      status: 200,
      body: { available: isAsrAvailable(asr) },
    }));

    router.post('/api/asr', async (context) => {
      if (!isAsrAvailable(asr)) {
        throw new HttpError(501, 'asr_unavailable', '服务器未配置语音转写');
      }
      const raw = context.rawBody;
      if (!raw || raw.length === 0) {
        throw new HttpError(400, 'asr_no_audio', '没有收到音频数据');
      }
      const input = await normalizeAudioInput(raw, context.contentType ?? '');
      const text = await transcribeAudio(input, asr);
      return { status: 200, body: { text } };
    });
  },
};
