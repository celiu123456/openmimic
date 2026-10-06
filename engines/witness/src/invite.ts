import { randomBytes } from 'node:crypto';
import type { Invite, InterviewMode } from '@openmimic/shared';
import type { Store } from '@openmimic/kernel';
import { InviteInvalidError } from './errors';
import { FRIEND_V1, type Questionnaire } from './questionnaires/friend-v1';
import {
  WITNESS_V2_QUESTIONNAIRES,
  WITNESS_V2_FRIEND,
  pickV2Questionnaire,
} from './questionnaires/witness-v2';
import {
  generateShortCode,
  normalizeShortCode,
  SHORT_CODE_MAX_RETRIES,
} from './short-code';

/** Invites live for two weeks unless the caller asks otherwise. */
export const DEFAULT_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** 16 random bytes encode to exactly 22 URL-safe base64 characters. */
export const INVITE_TOKEN_BYTES = 16;

/** A created invite, as handed back to the inviter (never the raw row). */
export interface CreatedInvite {
  token: string;
  expiresAt: string;
  /** 8-character short code alias, if generated. */
  shortCode?: string;
}

/** What a valid token resolves to: whose persona, and which questionnaire. */
export interface ResolvedInvite {
  subjectId: string;
  questionnaire: Questionnaire;
  /** Interview mode stored on the invite; absent means informant. */
  mode?: InterviewMode;
}

export interface CreateInviteOptions {
  /** Lifetime in milliseconds; defaults to {@link DEFAULT_INVITE_TTL_MS}. */
  ttlMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: Date;
  /** Interview mode; defaults to 'informant'. */
  mode?: InterviewMode;
}

export interface ResolveInviteOptions {
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

/** A URL-safe, 22-character random token with no embedded data. */
export function createInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
}

/**
 * Issue a reusable invite for a subject.
 *
 * One token can be pasted into a group chat and answered by several friends,
 * so it is intentionally not consumed on first use. Now also generates a
 * short code alias for easier sharing.
 */
export function createInvite(
  store: Store,
  subjectId: string,
  options: CreateInviteOptions = {},
): CreatedInvite {
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? DEFAULT_INVITE_TTL_MS;
  const mode = options.mode;
  const invite: Invite = {
    token: createInviteToken(),
    subjectId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    ...(mode && mode !== 'informant' ? { mode } : {}),
  };
  store.putInvite(invite);

  // Generate a unique short code with retry
  let shortCode: string | undefined;
  for (let attempt = 0; attempt < SHORT_CODE_MAX_RETRIES; attempt++) {
    const candidate = generateShortCode();
    if (store.setInviteShortCode(invite.token, candidate)) {
      shortCode = candidate;
      break;
    }
  }

  return {
    token: invite.token,
    expiresAt: invite.expiresAt,
    ...(shortCode ? { shortCode } : {}),
  };
}

/**
 * Resolve a token to its subject and questionnaire.
 *
 * Throws {@link InviteInvalidError} for a token that does not exist or has
 * expired — callers must fail closed and never fall back to a default subject.
 */
export function resolveInvite(
  store: Store,
  token: string,
  options: ResolveInviteOptions = {},
): ResolvedInvite {
  const invite = store.getInvite(token);
  if (!invite) {
    throw new InviteInvalidError('邀请链接无效或已被撤销');
  }
  const now = options.now ?? new Date();
  if (Date.parse(invite.expiresAt) <= now.getTime()) {
    throw new InviteInvalidError('邀请链接已过期');
  }
  return {
    subjectId: invite.subjectId,
    questionnaire: FRIEND_V1,
    ...(invite.mode ? { mode: invite.mode } : {}),
  };
}

/**
 * Resolve a short code to its subject and questionnaire.
 *
 * Short codes are case-insensitive and mapped one-to-one to long tokens.
 * Throws {@link InviteInvalidError} for an unknown or expired short code.
 */
export function resolveShortCode(
  store: Store,
  code: string,
  options: ResolveInviteOptions = {},
): ResolvedInvite {
  const normalized = normalizeShortCode(code);
  if (!normalized) {
    throw new InviteInvalidError('邀请码格式无效');
  }
  const invite = store.getInviteByShortCode(normalized);
  if (!invite) {
    throw new InviteInvalidError('邀请码无效或已被撤销');
  }
  const now = options.now ?? new Date();
  if (Date.parse(invite.expiresAt) <= now.getTime()) {
    throw new InviteInvalidError('邀请码已过期');
  }
  return {
    subjectId: invite.subjectId,
    questionnaire: FRIEND_V1,
    ...(invite.mode ? { mode: invite.mode } : {}),
  };
}
