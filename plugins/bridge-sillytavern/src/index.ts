/**
 * bridge-sillytavern: bidirectional converter between OpenMimic .persona
 * packages and SillyTavern Character Card V2.
 *
 * Routes (admin-gated):
 *   GET  /api/subjects/:id/export/character-card?format=json|png
 *   POST /api/import/character-card  (JSON body or PNG body)
 *
 * Plugin kind: 'bridge' — syncs data to an external format.
 */
import { z } from 'zod';
import type { Plugin, Store } from '@openmimic/kernel';
import type { Router, RouteContext } from '@openmimic/server';
import { HttpError } from '@openmimic/server';
import { CharacterCardV2Schema } from './character-card';
import { exportCharacterCard } from './export';
import {
  importCharacterCard,
  extractCardMetadata,
  type ImportCharacterCardOptions,
} from './import';
import { readCharaFromPng, writeCharaToPng, generateMinimalPng } from './png';

export type { CharacterCardV2, CharacterCardV2Data, OpenMimicExtension } from './character-card';
export { exportCharacterCard, type ExportCharacterCardOptions, type ExportResult } from './export';
export {
  importCharacterCard,
  extractCardMetadata,
  type ImportCharacterCardOptions,
  type ImportCharacterCardResult,
  type CardMetadata,
} from './import';
export { readCharaFromPng, writeCharaToPng, generateMinimalPng, crc32 } from './png';

export const bridgeSillyTavernPlugin: Plugin = {
  name: 'bridge-sillytavern',
  kind: 'bridge',
  version: '0.0.1',
  inject: ['store'],
  apply(ctx) {
    const store = ctx.get<Store>('store');

    // Register plugin table for card metadata (first_mes, scenario, etc.)
    const metaTable = store.registerPluginTable(
      'bridge-sillytavern',
      'card_meta',
      `CREATE TABLE IF NOT EXISTS "plugin_bridge-sillytavern_card_meta" (
        subject_id TEXT PRIMARY KEY,
        first_mes TEXT NOT NULL DEFAULT '',
        scenario TEXT NOT NULL DEFAULT '',
        alternate_greetings TEXT NOT NULL DEFAULT '[]',
        creator_notes TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        post_history_instructions TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        creator TEXT NOT NULL DEFAULT '',
        character_version TEXT NOT NULL DEFAULT '',
        imported_at TEXT NOT NULL
      )`,
    );

    // HTTP routes (only if router is available)
    if (!ctx.has('router')) return;
    const router = ctx.get<Router>('router');

    // --- Export: GET /api/subjects/:id/export/character-card --- (export scope)
    router.get('/api/subjects/:id/export/character-card', (context: RouteContext) => {
      const subjectId = context.params.id ?? '';
      const format = context.query.get('format') ?? 'json';
      const ack = context.query.get('acknowledgeRealPerson') === 'true';

      if (format !== 'json' && format !== 'png') {
        throw new HttpError(400, 'invalid_format', 'format must be json or png');
      }

      try {
        const result = exportCharacterCard(subjectId, store, {
          acknowledgeRealPerson: ack,
        });

        if (format === 'png') {
          const placeholder = generateMinimalPng();
          const pngWithCard = writeCharaToPng(placeholder, result.json);
          const safeName = result.card.data.name.replace(/[^a-zA-Z0-9_一-鿿-]/g, '_');
          return {
            status: 200,
            body: pngWithCard.toString('base64'),
            headers: {
              'content-type': 'image/png',
              'content-transfer-encoding': 'base64',
              'content-disposition': `attachment; filename="${safeName}.png"`,
            },
          };
        }

        return { status: 200, body: result.card };
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('acknowledgeRealPerson')) {
          throw new HttpError(403, 'real_person_gate',
            'This persona depicts a real person. Pass acknowledgeRealPerson=true ' +
            'to confirm you have authorization to distribute this personality card.',
          );
        }
        if (err instanceof Error && err.message.includes('not found')) {
          throw new HttpError(404, 'subject_not_found', err.message);
        }
        throw err;
      }
    }, { scope: 'export' });

    // --- Import: POST /api/import/character-card --- (admin)
    router.post('/api/import/character-card', (context: RouteContext) => {
      let cardData: unknown;

      // Detect PNG vs JSON input
      if (context.rawBody && context.contentType?.includes('image/png')) {
        const parsed = readCharaFromPng(context.rawBody);
        if (!parsed) {
          throw new HttpError(400, 'no_chara_chunk', 'PNG does not contain a chara tEXt chunk');
        }
        cardData = parsed;
      } else if (context.rawBody && context.contentType?.includes('octet-stream')) {
        // Try as PNG first
        try {
          const parsed = readCharaFromPng(context.rawBody);
          if (parsed) {
            cardData = parsed;
          } else {
            throw new Error('not PNG');
          }
        } catch {
          // Try as JSON
          try {
            cardData = JSON.parse(context.rawBody.toString('utf8'));
          } catch {
            throw new HttpError(400, 'invalid_input', 'Input is neither a valid PNG with chara data nor valid JSON');
          }
        }
      } else {
        cardData = context.body;
      }

      if (!cardData) {
        throw new HttpError(400, 'empty_body', 'No character card data provided');
      }

      // Validate V2 schema
      try {
        CharacterCardV2Schema.parse(cardData);
      } catch {
        throw new HttpError(400, 'invalid_card', 'Input does not conform to Character Card V2 schema');
      }

      const result = importCharacterCard(store, cardData);

      // Store card metadata in plugin table
      const card = CharacterCardV2Schema.parse(cardData);
      const meta = extractCardMetadata(card);
      metaTable.insert({
        subject_id: result.subjectId,
        first_mes: meta.firstMes,
        scenario: meta.scenario,
        alternate_greetings: JSON.stringify(meta.alternateGreetings),
        creator_notes: meta.creatorNotes,
        system_prompt: meta.systemPrompt,
        post_history_instructions: meta.postHistoryInstructions,
        tags: JSON.stringify(meta.tags),
        creator: meta.creator,
        character_version: meta.characterVersion,
        imported_at: new Date().toISOString(),
      });

      return {
        status: 201,
        body: {
          subjectId: result.subjectId,
          displayName: result.displayName,
          claimCount: result.claimCount,
          corpusCount: result.corpusCount,
          injectionFlags: result.injectionFlags,
          roundTrip: result.roundTrip,
        },
      };
    }, { scope: 'admin' });
  },
};
