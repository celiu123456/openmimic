import type { CourtSession, Testimony } from '@openmimic/shared';

/** Typed kernel event payloads. */
export interface KernelEventMap {
  'testimony.added': Testimony;
  'court.finished': CourtSession;
}

export type KernelEventName = keyof KernelEventMap;

export type KernelEventHandler<K extends KernelEventName> = (
  payload: KernelEventMap[K],
) => void;

/** Unsubscribe handle returned by {@link EventBus.on}. */
export type Unsubscribe = () => void;

/**
 * Minimal in-process event bus.
 *
 * Deliberately tiny: one process, synchronous delivery, no persistence.
 * A rejected handler must not prevent the emit from reaching other handlers,
 * so errors are collected and re-thrown after delivery.
 */
export class EventBus {
  private readonly handlers = new Map<
    KernelEventName,
    Set<(payload: unknown) => void>
  >();

  on<K extends KernelEventName>(event: K, handler: KernelEventHandler<K>): Unsubscribe {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: unknown) => void);
    return () => this.off(event, handler);
  }

  once<K extends KernelEventName>(event: K, handler: KernelEventHandler<K>): Unsubscribe {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  off<K extends KernelEventName>(event: K, handler: KernelEventHandler<K>): void {
    this.handlers.get(event)?.delete(handler as (payload: unknown) => void);
  }

  emit<K extends KernelEventName>(event: K, payload: KernelEventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    const errors: unknown[] = [];
    for (const handler of [...set]) {
      try {
        (handler as KernelEventHandler<K>)(payload);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, `handlers for ${event} failed`);
  }

  listenerCount(event: KernelEventName): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}
