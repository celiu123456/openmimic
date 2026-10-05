#!/usr/bin/env npx tsx
/**
 * v4 chat interview smoke test: starts the server with FakeLLM on an
 * ephemeral port, runs chat -> say x3 (one scripted guard violation
 * that gets repaired) -> finish via fetch, and prints request/response
 * JSON.
 *
 * Usage: npx tsx scripts/chat-smoke.ts
 *
 * Zero real network, zero real model — all FakeLLM.
 */

import { Store } from '@openmimic/kernel';
import { FakeLLM } from '@openmimic/engine-witness';
import { startServer, type RunningServer } from '@openmimic/server';

interface ApiResponse {
  status: number;
  body: unknown;
}

async function api(
  base: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<ApiResponse> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text === '' ? {} : JSON.parse(text),
  };
}

function logStep(label: string, request: unknown, response: ApiResponse): void {
  console.log(`\n--- ${label} ---`);
  if (request !== undefined) {
    console.log('Request:', JSON.stringify(request, null, 2));
  }
  console.log(`Status: ${response.status}`);
  console.log('Response:', JSON.stringify(response.body, null, 2));
}

async function main(): Promise<void> {
  const store = new Store();
  const llm = new FakeLLM([]);
  const server: RunningServer = await startServer({
    port: 0,
    store,
    asr: { apiKey: undefined },
    llm,
    webDistDir: '',
  });
  const base = server.url;
  console.log(`Server started at ${base}`);

  try {
    // Create subject and invite
    const subjectRes = await api(base, 'POST', '/api/subjects', { displayName: '林小满' });
    const subjectId = (subjectRes.body as Record<string, string>).id;
    const inviteRes = await api(base, 'POST', `/api/subjects/${subjectId}/invites`);
    const token = (inviteRes.body as Record<string, string>).token;
    console.log(`Subject: ${subjectId}, Token: ${token}`);

    // 1. Start chat
    llm.push('你好，我是访谈员，这段对话用来更完整地理解林小满，随时可以停。你们是怎么认识的？');
    const startRes = await api(base, 'POST', `/api/invites/${token}/chat`);
    logStep('1. POST /api/invites/:token/chat', {}, startRes);
    const sid = (startRes.body as Record<string, unknown>).sessionId as string;

    // 2. Say #1 — normal turn
    llm.push('大学时代啊。你们在大学时经常一起做什么？');
    const say1Body = { text: '大学认识的' };
    const say1Res = await api(base, 'POST', `/api/chat/${sid}/say`, say1Body);
    logStep('2. POST /api/chat/:sid/say (normal)', say1Body, say1Res);

    // 3. Say #2 — scripted guard violation → repair
    // First attempt: no question mark (fails guard)
    llm.push('他确实是个温和的人');
    // Repair attempt: valid question
    llm.push('嗯嗯，温和的人。能不能说一件让你印象最深的事？');
    const say2Body = { text: '他人挺温和的' };
    const say2Res = await api(base, 'POST', `/api/chat/${sid}/say`, say2Body);
    logStep('3. POST /api/chat/:sid/say (guard violation repaired)', say2Body, say2Res);

    // 4. Say #3 — normal turn
    llm.push('搬家帮忙确实能看出人品。你觉得他身上还有什么特别的地方？');
    const say3Body = { text: '有一次搬家他专门来帮忙' };
    const say3Res = await api(base, 'POST', `/api/chat/${sid}/say`, say3Body);
    logStep('4. POST /api/chat/:sid/say (normal)', say3Body, say3Res);

    // 5. Finish
    const finishBody = { consentLevel: 'quotable', relation: '大学同学' };
    const finishRes = await api(base, 'POST', `/api/chat/${sid}/finish`, finishBody);
    logStep('5. POST /api/chat/:sid/finish', finishBody, finishRes);

    console.log('\n=== Smoke test complete ===');
  } finally {
    await server.close();
    store.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
