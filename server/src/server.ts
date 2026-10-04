import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z, ZodError } from 'zod';
import { SubjectSchema } from '@openmimic/shared';
import type { Store } from '@openmimic/kernel';
import {
  InviteInvalidError,
  SubmitTestimonyInputSchema,
  createWitnessCollector,
} from '@openmimic/engine-witness';
import { redactForExternal } from './external';
import { HttpError, Router, readJsonBody, type RouteContext } from './router';

export const SERVER_VERSION = '0.0.1';

export interface StartServerOptions {
  port: number;
  store: Store;
}

export interface RunningServer {
  /** The port the server actually bound (resolves `port: 0`). */
  port: number;
  url: string;
  close(): Promise<void>;
}

/** Body accepted by `POST /api/subjects`; the id is server-generated. */
const CreateSubjectBodySchema = z.object({
  displayName: z.string().min(1),
  selfReport: z.string().min(1).optional(),
});

const errorBody = (code: string, message: string): unknown => ({ error: { code, message } });

function describeZodError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ');
}

function sendJson(response: ServerResponse, status: number, body: unknown, store: Store): void {
  // Every outbound payload crosses the W1 authorization gate's `external`
  // scope before serialization (see redactForExternal).
  const payload = JSON.stringify(redactForExternal(store, body));
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(payload);
}

function buildRouter(store: Store): Router {
  const collector = createWitnessCollector(store);
  const router = new Router();

  router.get('/api/health', () => ({
    status: 200,
    body: { ok: true, version: SERVER_VERSION },
  }));

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
    return {
      status: 201,
      body: { token: invite.token, url: `/i/${invite.token}`, expiresAt: invite.expiresAt },
    };
  });

  router.get('/api/invites/:token', (context) => {
    // resolveInvite throws InviteInvalidError for unknown/expired tokens.
    const resolved = collector.resolveInvite(context.params.token ?? '');
    const subject = store.getSubject(resolved.subjectId);
    if (!subject) throw new HttpError(404, 'subject_not_found', '当事人不存在');
    // Display name + questionnaire only: never selfReport, never testimony.
    return {
      status: 200,
      body: { subjectDisplayName: subject.displayName, questionnaire: resolved.questionnaire },
    };
  });

  router.post('/api/invites/:token/testimony', (context) => {
    const input = SubmitTestimonyInputSchema.parse(context.body);
    const result = collector.submitTestimony(context.params.token ?? '', input);
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

  return router;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  router: Router,
  store: Store,
): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const match = router.match(request.method ?? 'GET', url.pathname);
    if (!match) {
      sendJson(response, 404, errorBody('not_found', '接口不存在'), store);
      return;
    }
    let body: unknown;
    if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
      body = await readJsonBody(request);
    }
    const context: RouteContext = { params: match.params, query: url.searchParams, body };
    const result = await match.handler(context);
    sendJson(response, result.status, result.body, store);
  } catch (caught) {
    if (caught instanceof ZodError) {
      sendJson(response, 400, errorBody('validation_error', describeZodError(caught)), store);
    } else if (caught instanceof InviteInvalidError) {
      sendJson(response, 410, errorBody('invite_invalid', caught.message), store);
    } else if (caught instanceof HttpError) {
      sendJson(response, caught.status, errorBody(caught.code, caught.message), store);
    } else {
      sendJson(response, 500, errorBody('internal_error', '服务器内部错误'), store);
    }
  }
}

/**
 * Start the collection API and resolve once it is listening.
 *
 * The caller owns the {@link Store}; closing the server does not close it.
 */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const router = buildRouter(options.store);
  const { store } = options;

  const server = createServer((request, response) => {
    void handleRequest(request, response, router, store);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
