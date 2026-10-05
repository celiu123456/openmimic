/**
 * example-bridge: minimal bridge plugin template.
 *
 * Listens for `court.finished` events and POSTs the assembled persona context
 * to a configured webhook URL. This is the starting point for community bridge
 * plugins that sync persona data to external systems.
 *
 * ## Callback signature
 *
 * When `signingSecret` is configured, every outbound POST carries three
 * signature headers:
 *
 * - `X-OpenMimic-Signature`: HMAC-SHA256 hex of `${timestamp}.${body}`
 * - `X-OpenMimic-Timestamp`: Unix seconds when the request was signed
 * - `X-OpenMimic-Event-Id`: Unique event ID for replay protection
 *
 * The receiver should:
 * 1. Reject if the timestamp is more than 5 minutes old.
 * 2. Recompute HMAC-SHA256(`${timestamp}.${body}`, signingSecret) and
 *    compare with the signature header (constant-time).
 * 3. Track event IDs and reject duplicates.
 *
 * Example verification (Node.js):
 *
 * ```ts
 * import { createHmac, timingSafeEqual } from 'node:crypto';
 *
 * function verifySignature(body: string, headers: Record<string, string>, secret: string): boolean {
 *   const timestamp = headers['x-openmimic-timestamp'];
 *   const signature = headers['x-openmimic-signature'];
 *   if (!timestamp || !signature) return false;
 *
 *   // Reject if older than 5 minutes
 *   const age = Math.abs(Date.now() / 1000 - Number(timestamp));
 *   if (age > 300) return false;
 *
 *   const expected = createHmac('sha256', secret)
 *     .update(`${timestamp}.${body}`)
 *     .digest('hex');
 *   return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
 * }
 * ```
 */
import { randomUUID } from 'node:crypto';
import { createHmac } from 'node:crypto';
import { assemblePersonaContext, type Store, type Plugin } from '@openmimic/kernel';

export interface BridgeConfig {
  /** URL to POST the persona context to. */
  webhookUrl: string;
  /**
   * HMAC-SHA256 signing secret. When set, every outbound POST carries
   * signature headers for the receiver to verify authenticity.
   */
  signingSecret?: string;
  /** Optional fetch implementation for testing. */
  fetchImpl?: typeof fetch;
}

/**
 * Sign a webhook payload with HMAC-SHA256.
 *
 * Returns the three headers to attach to the request.
 */
export function signPayload(
  body: string,
  secret: string,
): { signature: string; timestamp: string; eventId: string } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const eventId = randomUUID();
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return { signature, timestamp, eventId };
}

/**
 * Verify a webhook signature.
 *
 * - Rejects timestamps older than `maxAgeSeconds` (default 300 = 5 minutes).
 * - Uses constant-time comparison for the signature.
 */
export function verifySignature(
  body: string,
  timestamp: string,
  signature: string,
  secret: string,
  maxAgeSeconds = 300,
): boolean {
  // Time window check
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (Number.isNaN(age) || age > maxAgeSeconds) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  if (expected.length !== signature.length) return false;
  try {
    const { timingSafeEqual } = require('node:crypto');
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return expected === signature;
  }
}

export const exampleBridgePlugin: Plugin<BridgeConfig> = {
  name: 'example-bridge',
  kind: 'bridge',
  version: '0.0.1',
  inject: ['store'],
  apply(ctx, config) {
    if (!config?.webhookUrl) return;

    const store = ctx.get<Store>('store');
    const doFetch = config.fetchImpl ?? fetch;
    const signingSecret = config.signingSecret;

    const unsub = ctx.on('court.finished', (session) => {
      // Fire and forget: bridge errors must not break the main pipeline.
      void (async () => {
        try {
          const persona = await assemblePersonaContext(session.subjectId, store);
          const payload = JSON.stringify({
            event: 'court.finished',
            subjectId: session.subjectId,
            sessionId: session.id,
            systemPrompt: persona.systemPrompt,
            meta: persona.meta,
          });

          const headers: Record<string, string> = {
            'content-type': 'application/json',
          };

          // Sign the payload if a signing secret is configured
          if (signingSecret) {
            const sig = signPayload(payload, signingSecret);
            headers['x-openmimic-signature'] = sig.signature;
            headers['x-openmimic-timestamp'] = sig.timestamp;
            headers['x-openmimic-event-id'] = sig.eventId;
          }

          await doFetch(config.webhookUrl, {
            method: 'POST',
            headers,
            body: payload,
          });
        } catch {
          // Bridge errors are swallowed: a downstream failure must never
          // break the court pipeline.
        }
      })();
    });

    return unsub;
  },
};
