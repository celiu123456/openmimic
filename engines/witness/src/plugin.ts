import type { PluginHost, Store } from '@openmimic/kernel';
import {
  createInvite,
  resolveInvite,
  type CreateInviteOptions,
  type CreatedInvite,
  type ResolveInviteOptions,
  type ResolvedInvite,
} from './invite';
import { FRIEND_V1, type Questionnaire } from './questionnaires/friend-v1';
import {
  submitTestimony,
  type SubmitTestimonyInput,
  type SubmitTestimonyOptions,
  type SubmitTestimonyResult,
} from './testimony';

/**
 * Official WitnessEngine manifest.
 *
 * Registered as a `collector`, not an `engine`: this is the intake surface
 * that gathers evidence from friends, and it goes through the same
 * {@link PluginHost} path as any third-party plugin.
 */
export const WITNESS_COLLECTOR_MANIFEST = {
  name: 'witness',
  kind: 'collector',
  version: '0.0.1',
  description: 'Friend questionnaire, reusable invites and testimony intake',
} as const;

/** The collector surface once a {@link Store} is bound to it. */
export interface WitnessCollector {
  /** The questionnaire every invite currently hands out. */
  readonly questionnaire: Questionnaire;
  createInvite(subjectId: string, options?: CreateInviteOptions): CreatedInvite;
  resolveInvite(token: string, options?: ResolveInviteOptions): ResolvedInvite;
  submitTestimony(
    token: string,
    input: SubmitTestimonyInput,
    options?: SubmitTestimonyOptions,
  ): SubmitTestimonyResult;
}

/** Bind the WitnessEngine functions to one store. */
export function createWitnessCollector(store: Store): WitnessCollector {
  return {
    questionnaire: FRIEND_V1,
    createInvite: (subjectId, options) => createInvite(store, subjectId, options),
    resolveInvite: (token, options) => resolveInvite(store, token, options),
    submitTestimony: (token, input, options) => submitTestimony(store, token, input, options),
  };
}

/** Shared context the kernel hands to every plugin. */
export interface WitnessCollectorContext {
  store: Store;
  collectors: Record<string, unknown>;
}

/** Register the official WitnessEngine with a plugin host. */
export async function registerWitnessCollector(
  host: PluginHost<WitnessCollectorContext>,
): Promise<void> {
  await host.register(WITNESS_COLLECTOR_MANIFEST, (context) => {
    context.collectors[WITNESS_COLLECTOR_MANIFEST.name] = createWitnessCollector(
      context.store,
    );
  });
}
