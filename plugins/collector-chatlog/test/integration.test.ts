/**
 * Integration tests: end-to-end flow through the plugin.
 *
 * Tests exercise the routes via the plugin host and router,
 * without starting a real HTTP server. All data is fabricated.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '@openmimic/kernel';
import { PluginHost, type Context, type Plugin } from '@openmimic/kernel';
import { Router, type RouteContext, type RouteResult } from '@openmimic/server';
import { collectorChatlogPlugin } from '../src/index';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Minimal witness plugin stub to satisfy the collector registry. */
const stubWitnessPlugin: Plugin = {
  name: 'stub-witness',
  kind: 'engine',
  version: '0.0.1',
  inject: ['store'],
  apply(ctx) {
    ctx.provide('witness', {
      createInvite: () => ({}),
      resolveInvite: () => ({}),
      submitTestimony: () => ({}),
      questionnaire: { questions: [] },
    });
  },
};

interface TestEnv {
  store: Store;
  router: Router;
  dispatch: (method: string, path: string, body?: unknown) => Promise<RouteResult>;
}

function setupTestEnv(): TestEnv {
  const store = new Store({ path: ':memory:' });
  const router = new Router();

  // Create a minimal plugin host
  const services = new Map<string, unknown>();
  services.set('store', store);
  services.set('router', router);

  const collectors = {
    _map: new Map<string, unknown>(),
    register(id: string, collector: unknown) { this._map.set(id, collector); },
    get(id: string) { return this._map.get(id); },
    list() { return Array.from(this._map.values()); },
  };

  const scenarios = {
    _map: new Map<string, unknown>(),
    register(id: string, scenario: unknown) { this._map.set(id, scenario); },
    get(id: string) { return this._map.get(id); },
    list() { return Array.from(this._map.values()); },
  };

  const ctx: Context = {
    provide<T>(name: string, service: T) { services.set(name, service); },
    get<T>(name: string): T {
      const svc = services.get(name);
      if (!svc) throw new Error(`Service not found: ${name}`);
      return svc as T;
    },
    has(name: string): boolean { return services.has(name); },
    on() { return () => {}; },
    emit() {},
    collectors: collectors as any,
    scenarios: scenarios as any,
  };

  // Apply the plugin
  collectorChatlogPlugin.apply(ctx, {} as any);

  const dispatch = async (method: string, path: string, body?: unknown): Promise<RouteResult> => {
    const match = router.match(method, path);
    if (!match) return { status: 404, body: { error: 'route not found' } };
    const context: RouteContext = {
      params: match.params,
      query: new URLSearchParams(),
      body,
    };
    try {
      const result = await match.handler(context);
      return result as RouteResult;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && 'code' in err) {
        const httpErr = err as { status: number; code: string; message: string };
        return {
          status: httpErr.status,
          body: { error: { code: httpErr.code, message: httpErr.message } },
        };
      }
      throw err;
    }
  };

  return { store, router, dispatch };
}

/* ------------------------------------------------------------------ */
/* Fabricated test data                                                 */
/* ------------------------------------------------------------------ */

const WECHAT_TEXT_EXPORT = [
  '2024-03-15 14:30:25 王大明',
  '今天下午有时间吗？',
  '',
  '2024-03-15 14:30:45 赵小红',
  '有啊，什么事？',
  '',
  '2024-03-15 14:31:02 王大明',
  '一起吃饭吧',
  '',
  '2024-03-15 14:31:15 赵小红',
  '好的好的',
  '',
  '2024-03-15 14:31:30 王大明',
  '[图片]',
  '',
  '2024-03-15 14:31:45 赵小红',
  '哈哈哈这个好好笑',
  '',
  '2024-03-15 14:32:00 王大明',
  '"赵小红"撤回了一条消息',
  '',
  '2024-03-15 14:32:15 王大明',
  '嗯',
  '',
  '2024-03-15 14:32:30 赵小红',
  '那就这么说定了',
  '',
  '2024-03-15 14:33:00 王大明',
  '好，五点老地方见',
].join('\n');

const CSV_EXPORT = [
  'time,sender,content,type',
  '2024-03-15 14:30,王大明,今天下午有时间吗,text',
  '2024-03-15 14:31,赵小红,有啊,text',
  '2024-03-15 14:32,王大明,一起吃饭吧,text',
  '2024-03-15 14:33,赵小红,[图片],image',
].join('\n');

const JSON_EXPORT = JSON.stringify([
  { time: '2024-03-15 14:30', sender: '王大明', content: '今天下午有时间吗' },
  { time: '2024-03-15 14:31', sender: '赵小红', content: '有啊' },
  { time: '2024-03-15 14:32', sender: '王大明', content: '一起吃饭吧' },
]);

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('integration: preview route', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = setupTestEnv();
    env.store.putSubject({ id: 's1', displayName: '王大明' });
  });

  it('previews text format and returns sender stats', async () => {
    const res = await env.dispatch('POST', '/api/subjects/s1/chatlog/preview', {
      content: WECHAT_TEXT_EXPORT,
    });
    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.format).toBe('text');
    expect(body.senders).toBeInstanceOf(Array);
    expect(body.senders.length).toBeGreaterThanOrEqual(2);

    const wangSender = body.senders.find((s: any) => s.name === '王大明');
    expect(wangSender).toBeDefined();
    expect(wangSender.count).toBeGreaterThan(0);
  });

  it('previews CSV format', async () => {
    const res = await env.dispatch('POST', '/api/subjects/s1/chatlog/preview', {
      content: CSV_EXPORT,
    });
    expect(res.status).toBe(200);
    expect((res.body as any).format).toBe('csv');
  });

  it('previews JSON format', async () => {
    const res = await env.dispatch('POST', '/api/subjects/s1/chatlog/preview', {
      content: JSON_EXPORT,
    });
    expect(res.status).toBe(200);
    expect((res.body as any).format).toBe('json');
  });

  it('returns 404 for unknown subject', async () => {
    const res = await env.dispatch('POST', '/api/subjects/unknown/chatlog/preview', {
      content: 'anything',
    });
    expect(res.status).toBe(404);
  });

  it('shows denoise stats', async () => {
    const res = await env.dispatch('POST', '/api/subjects/s1/chatlog/preview', {
      content: WECHAT_TEXT_EXPORT,
    });
    const body = res.body as any;
    expect(body.denoiseStats).toBeDefined();
    expect(body.textMessages).toBeLessThan(body.totalMessages);
  });
});

describe('integration: import route', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = setupTestEnv();
    env.store.putSubject({ id: 's1', displayName: '王大明' });
  });

  it('imports messages attributed to self into corpus', async () => {
    const res = await env.dispatch('POST', '/api/subjects/s1/chatlog/import', {
      content: WECHAT_TEXT_EXPORT,
      selfNames: ['王大明'],
    });
    expect(res.status).toBe(201);
    const body = res.body as any;
    expect(body.importId).toBeDefined();
    expect(body.imported).toBeGreaterThan(0);
    expect(body.stats.selfTotal).toBeGreaterThan(0);
    expect(body.stats.othersTotal).toBeGreaterThan(0);

    // Verify corpus items are in the store
    const corpus = env.store.listCorpusItemsBySubject('s1');
    expect(corpus.length).toBe(body.imported);
    for (const item of corpus) {
      expect(item.source).toBe('imported');
    }
  });

  it('does not include others\' messages in corpus', async () => {
    await env.dispatch('POST', '/api/subjects/s1/chatlog/import', {
      content: WECHAT_TEXT_EXPORT,
      selfNames: ['王大明'],
    });

    const corpus = env.store.listCorpusItemsBySubject('s1');
    for (const item of corpus) {
      // None of 赵小红's messages should be here
      expect(item.text).not.toBe('有啊，什么事？');
      expect(item.text).not.toBe('好的好的');
      expect(item.text).not.toBe('哈哈哈这个好好笑');
      expect(item.text).not.toBe('那就这么说定了');
    }
  });

  it('returns style profile preview', async () => {
    // Need enough corpus for a profile (8+ items)
    const messages = Array.from({ length: 15 }, (_, i) =>
      `2024-03-15 14:${String(i).padStart(2, '0')}:00 王大明\n消息内容${i}是不同的`,
    ).join('\n\n');

    const res = await env.dispatch('POST', '/api/subjects/s1/chatlog/import', {
      content: messages,
      selfNames: ['王大明'],
    });
    const body = res.body as any;
    expect(body.styleProfile).toBeDefined();
  });

  it('returns 404 for unknown subject', async () => {
    const res = await env.dispatch('POST', '/api/subjects/unknown/chatlog/import', {
      content: WECHAT_TEXT_EXPORT,
      selfNames: ['王大明'],
    });
    expect(res.status).toBe(404);
  });

  it('returns 422 for empty content', async () => {
    const res = await env.dispatch('POST', '/api/subjects/s1/chatlog/import', {
      content: '没有任何可解析的消息格式',
      selfNames: ['王大明'],
    });
    expect(res.status).toBe(422);
  });

  it('returns 422 when no messages match self names', async () => {
    const res = await env.dispatch('POST', '/api/subjects/s1/chatlog/import', {
      content: WECHAT_TEXT_EXPORT,
      selfNames: ['不存在的人'],
    });
    expect(res.status).toBe(422);
  });

  it('imports CSV format', async () => {
    const res = await env.dispatch('POST', '/api/subjects/s1/chatlog/import', {
      content: CSV_EXPORT,
      selfNames: ['王大明'],
    });
    expect(res.status).toBe(201);
    expect((res.body as any).imported).toBeGreaterThan(0);
  });

  it('imports JSON format', async () => {
    const res = await env.dispatch('POST', '/api/subjects/s1/chatlog/import', {
      content: JSON_EXPORT,
      selfNames: ['王大明'],
    });
    expect(res.status).toBe(201);
    expect((res.body as any).imported).toBeGreaterThan(0);
  });
});

describe('integration: list imports route', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = setupTestEnv();
    env.store.putSubject({ id: 's1', displayName: '王大明' });
  });

  it('lists past imports', async () => {
    // Import twice
    await env.dispatch('POST', '/api/subjects/s1/chatlog/import', {
      content: WECHAT_TEXT_EXPORT,
      selfNames: ['王大明'],
    });
    await env.dispatch('POST', '/api/subjects/s1/chatlog/import', {
      content: CSV_EXPORT,
      selfNames: ['王大明'],
    });

    const res = await env.dispatch('GET', '/api/subjects/s1/chatlog/imports');
    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.imports).toHaveLength(2);
    expect(body.imports[0].id).toBeDefined();
    expect(body.imports[0].format).toBeDefined();
    expect(body.imports[0].itemCount).toBeGreaterThan(0);
    // No raw text in the import records
    expect(body.imports[0].content).toBeUndefined();
  });

  it('returns 404 for unknown subject', async () => {
    const res = await env.dispatch('GET', '/api/subjects/unknown/chatlog/imports');
    expect(res.status).toBe(404);
  });
});

describe('integration: delete import route', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = setupTestEnv();
    env.store.putSubject({ id: 's1', displayName: '王大明' });
  });

  it('deletes an import record', async () => {
    const importRes = await env.dispatch('POST', '/api/subjects/s1/chatlog/import', {
      content: WECHAT_TEXT_EXPORT,
      selfNames: ['王大明'],
    });
    const importId = (importRes.body as any).importId;

    const delRes = await env.dispatch('DELETE', `/api/subjects/s1/chatlog/imports/${importId}`);
    expect(delRes.status).toBe(200);
    expect((delRes.body as any).deleted).toBe(true);
    expect((delRes.body as any).corpusItemsDeleted).toBeGreaterThanOrEqual(0);
    expect((delRes.body as any).corpusItemIdsRequested).toBeGreaterThan(0);

    // Verify corpus items are actually deleted from the store
    const corpusAfter = env.store.listCorpusItemsBySubject('s1');
    expect(corpusAfter).toHaveLength(0);

    // Verify import is gone from list
    const listRes = await env.dispatch('GET', '/api/subjects/s1/chatlog/imports');
    expect((listRes.body as any).imports).toHaveLength(0);
  });

  it('returns 404 for unknown import ID', async () => {
    const res = await env.dispatch('DELETE', '/api/subjects/s1/chatlog/imports/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns 404 for wrong subject', async () => {
    const importRes = await env.dispatch('POST', '/api/subjects/s1/chatlog/import', {
      content: WECHAT_TEXT_EXPORT,
      selfNames: ['王大明'],
    });
    const importId = (importRes.body as any).importId;

    env.store.putSubject({ id: 's2', displayName: '赵小红' });
    const res = await env.dispatch('DELETE', `/api/subjects/s2/chatlog/imports/${importId}`);
    expect(res.status).toBe(404);
  });
});

describe('integration: plugin disabled', () => {
  it('returns 404 when plugin is not loaded', () => {
    const router = new Router();
    const match = router.match('POST', '/api/subjects/s1/chatlog/preview');
    expect(match).toBeUndefined();
  });
});

describe('integration: raw file does not persist', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = setupTestEnv();
    env.store.putSubject({ id: 's1', displayName: '王大明' });
  });

  it('plugin table and corpus do not contain others\' text', async () => {
    await env.dispatch('POST', '/api/subjects/s1/chatlog/import', {
      content: WECHAT_TEXT_EXPORT,
      selfNames: ['王大明'],
    });

    const corpus = env.store.listCorpusItemsBySubject('s1');
    const othersTexts = ['有啊，什么事？', '好的好的', '哈哈哈这个好好笑', '那就这么说定了'];

    for (const item of corpus) {
      for (const other of othersTexts) {
        expect(item.text).not.toBe(other);
      }
    }
  });
});

describe('integration: size and count limits', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = setupTestEnv();
    env.store.putSubject({ id: 's1', displayName: '王大明' });
  });

  it('rejects content exceeding size limit', async () => {
    const res = await env.dispatch('POST', '/api/subjects/s1/chatlog/preview', {
      content: 'x'.repeat(100),
      maxSizeBytes: 50,
    });
    // The parser returns an empty messages array with a failed line
    expect(res.status).toBe(200);
    expect((res.body as any).totalMessages).toBe(0);
  });
});
