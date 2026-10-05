/**
 * collector-chatlog: import chat logs to populate the subject's corpus.
 *
 * Two-step flow:
 *   1. POST /api/subjects/:id/chatlog/preview — parse and preview (no DB writes)
 *   2. POST /api/subjects/:id/chatlog/import  — commit to corpus with sender attribution
 *
 * Additional routes:
 *   GET    /api/subjects/:id/chatlog/imports           — list past imports
 *   DELETE /api/subjects/:id/chatlog/imports/:importId — undo an import
 *
 * Privacy:
 * - Raw file never touches disk; parsed in memory only.
 * - PII anonymized before storage (shared/sanitize.ts).
 * - Injection detection flags suspicious text (shared/prompt/untrusted.ts).
 * - Reflux screening prevents AI-generated text from entering the corpus.
 * - Only the subject's own words enter the corpus; others' words are discarded.
 * - Imported corpus items are marked source='imported' (not 'pasted').
 *
 * Imported chat records are used for mimicking word choice, rhythm, and length.
 * They are NOT treated as factual evidence.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Plugin, Store, Context } from '@openmimic/kernel';
import { computeStyleProfile } from '@openmimic/kernel';
import type { Router } from '@openmimic/server';
import { HttpError } from '@openmimic/server';
import { parse, type ParseOptions, type ParseResult } from './parsers';
import { denoise, type DenoiseResult } from './denoise';
import { buildCorpus, type BuildOptions, type BuildResult, type BuildStats } from './corpus-builder';

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const PreviewBodySchema = z.object({
  content: z.string().min(1),
  format: z.enum(['text', 'csv', 'json']).optional(),
  csvColumns: z.object({
    time: z.string().optional(),
    sender: z.string().optional(),
    content: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  maxSizeBytes: z.number().int().positive().optional(),
});

const ImportBodySchema = z.object({
  content: z.string().min(1),
  /** Names to treat as the subject (at least one required). */
  selfNames: z.array(z.string().min(1)).min(1),
  format: z.enum(['text', 'csv', 'json']).optional(),
  csvColumns: z.object({
    time: z.string().optional(),
    sender: z.string().optional(),
    content: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  /** Maximum message length to include in corpus. Default 120. */
  maxLength: z.number().int().positive().optional(),
  /** Keep low-content messages (pure particles, single punctuation). Default true. */
  keepLowContent: z.boolean().optional(),
  /** Maximum corpus items to import. Default 500. */
  maxItems: z.number().int().positive().optional(),
  maxSizeBytes: z.number().int().positive().optional(),
});

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export interface ChatlogConfig {
  /** Default max file size in bytes. Default 5MB. */
  maxSizeBytes?: number;
  /** Default max items per import. Default 500. */
  maxItems?: number;
  /** Default max text length. Default 120 characters. */
  maxLength?: number;
}

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

export const collectorChatlogPlugin: Plugin<ChatlogConfig> = {
  name: 'collector-chatlog',
  kind: 'collector',
  version: '0.0.1',
  inject: ['store'],
  apply(ctx, config) {
    const store = ctx.get<Store>('store');
    const defaults = {
      maxSizeBytes: config?.maxSizeBytes ?? 5 * 1024 * 1024,
      maxItems: config?.maxItems ?? 500,
      maxLength: config?.maxLength ?? 120,
    };

    // Plugin table: tracks imports and their corpus item IDs
    const importTable = store.registerPluginTable(
      'collector_chatlog', 'imports',
      `CREATE TABLE IF NOT EXISTS plugin_collector_chatlog_imports (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        format TEXT NOT NULL,
        self_names TEXT NOT NULL,
        corpus_item_ids TEXT NOT NULL,
        item_count INTEGER NOT NULL,
        stats TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      { appendOnly: false },
    );

    // Register collector in the registry
    ctx.collectors.register('chatlog', {
      id: 'chatlog',
      label: 'Chat Log Import',
      describe: () => 'Import chat logs (WeChat text export, CSV, JSON) to populate the subject\'s corpus with their own words.',
      submit: async (input) => {
        // Programmatic API — same as the import route
        return input;
      },
    });

    if (!ctx.has('router')) return;
    const router = ctx.get<Router>('router');

    /* ---------------------------------------------------------------- */
    /* POST /api/subjects/:id/chatlog/preview                            */
    /* ---------------------------------------------------------------- */

    router.post('/api/subjects/:id/chatlog/preview', (context) => {
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', '当事人不存在');
      }

      const body = PreviewBodySchema.parse(context.body);

      const parseOptions: ParseOptions = {
        format: body.format,
        csvColumns: body.csvColumns,
        maxSizeBytes: body.maxSizeBytes ?? defaults.maxSizeBytes,
      };

      const parseResult = parse(body.content, parseOptions);
      const denoiseResult = denoise(parseResult.messages);

      // Collect sender statistics
      const senderStats = new Map<string, number>();
      for (const msg of denoiseResult.messages) {
        senderStats.set(msg.sender, (senderStats.get(msg.sender) ?? 0) + 1);
      }

      const senders = Array.from(senderStats.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      return {
        status: 200,
        body: {
          format: parseResult.format,
          totalMessages: parseResult.messages.length,
          textMessages: denoiseResult.stats.retained,
          senders,
          denoiseStats: denoiseResult.stats.filtered,
          failedLines: parseResult.failedLines,
          failedLineCount: parseResult.failedLines.length,
          totalLines: parseResult.totalLines,
        },
      };
    }, { scope: 'admin' });

    /* ---------------------------------------------------------------- */
    /* POST /api/subjects/:id/chatlog/import                             */
    /* ---------------------------------------------------------------- */

    router.post('/api/subjects/:id/chatlog/import', (context) => {
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', '当事人不存在');
      }

      const body = ImportBodySchema.parse(context.body);

      const parseOptions: ParseOptions = {
        format: body.format,
        csvColumns: body.csvColumns,
        maxSizeBytes: body.maxSizeBytes ?? defaults.maxSizeBytes,
      };

      const parseResult = parse(body.content, parseOptions);
      if (parseResult.messages.length === 0) {
        throw new HttpError(422, 'no_messages', '未能从内容中解析出任何消息');
      }

      const denoiseResult = denoise(parseResult.messages);
      if (denoiseResult.messages.length === 0) {
        throw new HttpError(422, 'no_text_messages', '解析出的消息全部为非文本类型');
      }

      // Get AI fingerprints for reflux screening
      const fingerprints = store.listFingerprints(subjectId);

      const buildOptions: BuildOptions = {
        selfNames: body.selfNames,
        maxLength: body.maxLength ?? defaults.maxLength,
        keepLowContent: body.keepLowContent,
        maxItems: body.maxItems ?? defaults.maxItems,
        fingerprints,
      };

      const buildResult = buildCorpus(denoiseResult.messages, buildOptions);
      if (buildResult.candidates.length === 0) {
        throw new HttpError(422, 'no_corpus_items', '指定的发送者没有符合条件的文本消息');
      }

      // Write corpus items
      const importId = randomUUID();
      const now = new Date().toISOString();
      const corpusItemIds: string[] = [];

      for (const candidate of buildResult.candidates) {
        const itemId = randomUUID();
        store.putCorpusItem({
          id: itemId,
          subjectId,
          text: candidate.text,
          source: 'imported',
          createdAt: candidate.parsedTime?.toISOString() ?? now,
        });
        corpusItemIds.push(itemId);
      }

      // Record the import for tracking/undo
      importTable.insert({
        id: importId,
        subject_id: subjectId,
        format: parseResult.format,
        self_names: JSON.stringify(body.selfNames),
        corpus_item_ids: JSON.stringify(corpusItemIds),
        item_count: corpusItemIds.length,
        stats: JSON.stringify(buildResult.stats),
        created_at: now,
      });

      // Compute style profile preview
      const allCorpus = store.listCorpusItemsBySubject(subjectId);
      const styleResult = computeStyleProfile(allCorpus.map((c) => c.text));

      return {
        status: 201,
        body: {
          importId,
          format: parseResult.format,
          imported: corpusItemIds.length,
          stats: {
            selfTotal: buildResult.stats.selfTotal,
            othersTotal: buildResult.stats.othersTotal,
            tooLong: buildResult.stats.tooLong,
            duplicatesRemoved: buildResult.stats.duplicatesRemoved,
            injectionFlagged: buildResult.stats.injectionFlagged,
            refluxExcluded: buildResult.stats.refluxExcluded,
            afterFilter: buildResult.stats.afterFilter,
            afterSampling: buildResult.stats.afterSampling,
            catchphrases: buildResult.stats.catchphrases,
          },
          styleProfile: styleResult,
        },
      };
    }, { scope: 'admin' });

    /* ---------------------------------------------------------------- */
    /* GET /api/subjects/:id/chatlog/imports                             */
    /* ---------------------------------------------------------------- */

    router.get('/api/subjects/:id/chatlog/imports', (context) => {
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', '当事人不存在');
      }

      const rows = importTable.query('subject_id = ?', [subjectId]);
      const imports = rows.map((row) => ({
        id: row.id as string,
        format: row.format as string,
        selfNames: JSON.parse(row.self_names as string) as string[],
        itemCount: row.item_count as number,
        stats: JSON.parse(row.stats as string) as BuildStats,
        createdAt: row.created_at as string,
      }));

      // Sort newest first
      imports.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

      return {
        status: 200,
        body: { imports },
      };
    }, { scope: 'admin' });

    /* ---------------------------------------------------------------- */
    /* DELETE /api/subjects/:id/chatlog/imports/:importId                */
    /*                                                                   */
    /* NOTE: This route records the undo intent in the plugin table.      */
    /* Actual corpus item deletion requires Store.deleteCorpusItem(),     */
    /* which does not exist yet. The corpus_items table has no append-    */
    /* only triggers (unlike testimonies), so adding this method is       */
    /* safe. Until then, this route marks the import as undone and        */
    /* returns the list of corpus item IDs that should be deleted.        */
    /* ---------------------------------------------------------------- */

    router.add('DELETE', '/api/subjects/:id/chatlog/imports/:importId', (context) => {
      const subjectId = context.params.id ?? '';
      if (!store.getSubject(subjectId)) {
        throw new HttpError(404, 'subject_not_found', '当事人不存在');
      }

      const importId = context.params.importId ?? '';
      const rows = importTable.query('id = ? AND subject_id = ?', [importId, subjectId]);
      if (rows.length === 0) {
        throw new HttpError(404, 'import_not_found', '导入记录不存在');
      }

      const row = rows[0]!;
      const corpusItemIds = JSON.parse(row.corpus_item_ids as string) as string[];

      // Delete the actual corpus items from the kernel store
      const deletedCount = store.deleteCorpusItems(corpusItemIds);

      // Delete the import record
      importTable.delete('id = ?', [importId]);

      return {
        status: 200,
        body: {
          deleted: true,
          importId,
          corpusItemsDeleted: deletedCount,
          corpusItemIdsRequested: corpusItemIds.length,
        },
      };
    }, { scope: 'admin' });
  },
};

// Re-export submodules for testing
export { parse, detectFormat, parseDateTime, detectMessageType } from './parsers';
export type { ChatMessage, ParseResult, ParseOptions } from './parsers';
export { denoise, normalizeText } from './denoise';
export type { DenoisedMessage, DenoiseResult, DenoiseStats } from './denoise';
export { buildCorpus } from './corpus-builder';
export type { CorpusCandidate, BuildOptions, BuildResult, BuildStats } from './corpus-builder';
