import { randomUUID } from 'node:crypto';
import type { Room, RoomUtterance } from '@openmimic/shared';
import type { Store } from '@openmimic/kernel';
import {
  DEFAULT_TOPIC_SEED,
  RoomRefusedError,
  findCrisisWord,
  parseRoomText,
  type LLMClient,
} from '@openmimic/engine-room';

/**
 * A minimal "behind the back" room for an imported persona.
 *
 * An imported subject has no per-witness `behindText` to build personas from —
 * its ledger holds only import receipts. The claims are all it has, so a claim
 * drives each turn: witnesses are assigned round-robin and speak to one
 * adjudicated facet of the subject. When a model is available it phrases the
 * line, otherwise the claim text itself is spoken. Quality is explicitly not
 * the point here; *running at all* is.
 */
export interface RunImportedRoomOptions {
  /** Topic seed; defaults to the room engine's default. */
  topicSeed?: string;
  /** Id factory, injectable for deterministic tests. */
  newId?: () => string;
  /** Clock, injectable for deterministic tests. */
  now?: () => string;
  /** Hard ceiling on utterances; defaults to 8. */
  maxUtterances?: number;
}

export async function runImportedRoom(
  subjectId: string,
  store: Store,
  llm?: LLMClient,
  options: RunImportedRoomOptions = {},
): Promise<Room> {
  const topicSeed = options.topicSeed ?? DEFAULT_TOPIC_SEED;
  const crisisWord = findCrisisWord(topicSeed);
  if (crisisWord) {
    throw new RoomRefusedError(`话题种子包含危机词面「${crisisWord}」,拒绝开房`);
  }

  const displayName = store.getSubject(subjectId)?.displayName ?? 'TA';
  const claims = store
    .listClaimsBySubject(subjectId)
    .filter((claim) => claim.status === 'surviving');
  const witnesses = store.listWitnessesBySubject(subjectId);
  const now = options.now ?? (() => new Date().toISOString());
  const cap = Math.max(0, options.maxUtterances ?? 8);

  const utterances: RoomUtterance[] = [];
  for (const [index, claim] of claims.entries()) {
    if (utterances.length >= cap) break;
    const witness = witnesses.length > 0 ? witnesses[index % witnesses.length] : undefined;
    const relation = witness?.relation ?? '导入人格';

    let text = claim.text;
    if (llm) {
      try {
        const raw = await llm.complete({
          system: [
            `你是${displayName}的${relation}。`,
            '下面给你一条关于TA的、经过整理的判断,用你自己的话随口说一句,不要复述原句,不要提"证言""分析"这类词。',
            '只输出 JSON,形如 {"text":"你要说的话"},不要输出任何别的内容。',
          ].join('\n'),
          user: [`话题:${topicSeed}`, `你知道的一点:${claim.text}`].join('\n'),
        });
        text = parseRoomText(raw);
      } catch {
        // Any model failure falls back to the claim text: the room still runs.
        text = claim.text;
      }
    }

    utterances.push({
      witnessId: witness?.id ?? `imported:${subjectId}`,
      displayLabel: relation,
      text,
      kind: 'speech',
      at: now(),
    });
  }

  const room: Room = {
    id: (options.newId ?? (() => randomUUID()))(),
    subjectId,
    topicSeed,
    status: 'behind_only',
    behindTranscript: utterances,
    createdAt: now(),
    imported: true,
  };
  store.putRoom(room);
  return room;
}
