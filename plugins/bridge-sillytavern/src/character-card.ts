/**
 * SillyTavern Character Card V2 types and validation.
 *
 * Spec: https://github.com/malfoyslastname/character-card-spec-v2
 *
 * The V2 card wraps legacy V1 fields inside a `data` object and adds
 * creator-facing fields (system_prompt, post_history_instructions,
 * alternate_greetings, character_book, creator_notes) plus metadata
 * (tags, creator, character_version).
 *
 * Fields marked "待核对" have not been validated against a real
 * SillyTavern import — the descriptions are based on the published
 * spec and community documentation.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Character Book (embedded lorebook)                                  */
/* ------------------------------------------------------------------ */

export const CharacterBookEntrySchema = z.object({
  keys: z.array(z.string()),
  content: z.string(),
  extensions: z.record(z.unknown()).default({}),
  enabled: z.boolean(),
  insertion_order: z.number().int(),
  case_sensitive: z.boolean().optional(),
  name: z.string().optional(),
  priority: z.number().int().optional(),
  id: z.number().int().optional(),
  comment: z.string().optional(),
  selective: z.boolean().optional(),
  secondary_keys: z.array(z.string()).optional(),
  constant: z.boolean().optional(),
  /** 待核对: position enum values may vary across frontends. */
  position: z.enum(['before_char', 'after_char']).optional(),
});
export type CharacterBookEntry = z.infer<typeof CharacterBookEntrySchema>;

export const CharacterBookSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  scan_depth: z.number().optional(),
  token_budget: z.number().optional(),
  recursive_scanning: z.boolean().optional(),
  extensions: z.record(z.unknown()).default({}),
  entries: z.array(CharacterBookEntrySchema),
});
export type CharacterBook = z.infer<typeof CharacterBookSchema>;

/* ------------------------------------------------------------------ */
/* Character Card V2 data                                              */
/* ------------------------------------------------------------------ */

export const CharacterCardV2DataSchema = z.object({
  // V1 fields
  name: z.string(),
  description: z.string(),
  personality: z.string(),
  scenario: z.string(),
  first_mes: z.string(),
  mes_example: z.string(),

  // V2 fields
  creator_notes: z.string().default(''),
  system_prompt: z.string().default(''),
  post_history_instructions: z.string().default(''),
  alternate_greetings: z.array(z.string()).default([]),
  /** 待核对: character_book is optional per spec; some frontends may require it. */
  character_book: CharacterBookSchema.optional(),
  tags: z.array(z.string()).default([]),
  creator: z.string().default(''),
  character_version: z.string().default(''),
  extensions: z.record(z.unknown()).default({}),
});
export type CharacterCardV2Data = z.infer<typeof CharacterCardV2DataSchema>;

export const CharacterCardV2Schema = z.object({
  spec: z.literal('chara_card_v2'),
  spec_version: z.literal('2.0'),
  data: CharacterCardV2DataSchema,
});
export type CharacterCardV2 = z.infer<typeof CharacterCardV2Schema>;

/* ------------------------------------------------------------------ */
/* OpenMimic extension payload                                         */
/* ------------------------------------------------------------------ */

/**
 * Structured data stored in `extensions.openmimic` for round-trip fidelity.
 *
 * When a card with this extension is imported back into OpenMimic, the
 * structured claims and episodes restore without loss. Third-party cards
 * lack this extension; their import path uses heuristic mapping instead.
 */
export interface OpenMimicExtension {
  version: string;
  exportedAt: string;
  subjectDisplayName: string;
  witnessCount: number;
  claims: Array<{
    id: string;
    text: string;
    conviction: number;
    kind?: string;
    domain?: string;
    context?: Record<string, string | undefined>;
    qualifiers?: string[];
    witnessRelations: string[];
  }>;
  episodes: Array<{
    id: string;
    text: string;
    witnessRelation: string;
    situation?: string;
  }>;
  corpus: Array<{
    id: string;
    text: string;
  }>;
}
