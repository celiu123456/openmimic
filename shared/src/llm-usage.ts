/**
 * Process-wide LLM usage tracking and budget enforcement.
 *
 * Every LLM client (engine or eval) records per-call token usage into a
 * singleton ledger, bucketed by a caller-supplied purpose tag.  Two hard
 * gates — total tokens and total calls — trigger a non-retryable
 * {@link BudgetExceededError} when breached.
 *
 * HTTP 402 from an upstream is similarly wrapped in the non-retryable
 * {@link InsufficientBalanceError}.
 */

/* ------------------------------------------------------------------ */
/* Error types                                                         */
/* ------------------------------------------------------------------ */

/**
 * Thrown when the process-wide LLM budget is exceeded.
 * Callers must NOT retry — they should save progress and exit.
 */
export class BudgetExceededError extends Error {
  constructor(
    public readonly kind: 'tokens' | 'calls',
    public readonly limit: number,
    public readonly current: number,
  ) {
    super(
      `LLM budget exceeded: ${kind} limit ${limit} reached (current: ${current})`,
    );
    this.name = 'BudgetExceededError';
  }
}

/**
 * Thrown when the upstream API returns HTTP 402 (insufficient balance).
 * Callers must NOT retry — they should save progress and exit.
 */
export class InsufficientBalanceError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`Insufficient balance: HTTP ${status}${detail ? ` — ${detail}` : ''}`);
    this.name = 'InsufficientBalanceError';
  }
}

/* ------------------------------------------------------------------ */
/* Usage tracking types                                                */
/* ------------------------------------------------------------------ */

/** Standard purpose tags. Callers may use any string, but these are canonical. */
export type UsagePurpose =
  | 'court-filing'
  | 'court-pairing'
  | 'court-relation'
  | 'room-compose'
  | 'room-notalk'
  | 'room-verify'
  | 'eval-predict'
  | 'eval-judge'
  | 'other';

/** Token counts extracted from one LLM response. */
export interface CallUsage {
  promptTokens: number;
  completionTokens: number;
  /** Cached prompt tokens, if the upstream reports them. */
  cachedTokens?: number;
}

/** Accumulated usage for one purpose bucket. */
export interface BucketUsage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

/** Summary of all usage across all buckets. */
export interface UsageSummary {
  buckets: Record<string, BucketUsage>;
  totals: BucketUsage;
}

/* ------------------------------------------------------------------ */
/* Singleton ledger                                                    */
/* ------------------------------------------------------------------ */

const buckets = new Map<string, BucketUsage>();
let totalCalls = 0;
let totalTokens = 0;

/** Read budget limits from environment. undefined means "no limit". */
function budgetTokens(): number | undefined {
  const v = process.env.LLM_BUDGET_TOKENS;
  return v ? parseInt(v, 10) : undefined;
}

function budgetCalls(): number | undefined {
  const v = process.env.LLM_BUDGET_CALLS;
  return v ? parseInt(v, 10) : undefined;
}

function ensureBucket(purpose: string): BucketUsage {
  let b = buckets.get(purpose);
  if (!b) {
    b = { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0 };
    buckets.set(purpose, b);
  }
  return b;
}

/**
 * Record one LLM call's usage.  Throws {@link BudgetExceededError} if
 * the cumulative total breaches either budget limit.
 *
 * Call this *after* the response is received (so we count actual tokens).
 */
export function recordUsage(purpose: string, usage: CallUsage): void {
  const b = ensureBucket(purpose);
  b.calls += 1;
  b.promptTokens += usage.promptTokens;
  b.completionTokens += usage.completionTokens;
  b.cachedTokens += usage.cachedTokens ?? 0;

  totalCalls += 1;
  totalTokens += usage.promptTokens + usage.completionTokens;

  // Budget gates
  const limitTokens = budgetTokens();
  if (limitTokens !== undefined && totalTokens > limitTokens) {
    throw new BudgetExceededError('tokens', limitTokens, totalTokens);
  }
  const limitCalls = budgetCalls();
  if (limitCalls !== undefined && totalCalls > limitCalls) {
    throw new BudgetExceededError('calls', limitCalls, totalCalls);
  }
}

/**
 * Pre-flight budget check.  Throws before making the call if the budget
 * is already exhausted.  This avoids wasting a network round-trip.
 */
export function checkBudget(): void {
  const limitTokens = budgetTokens();
  if (limitTokens !== undefined && totalTokens >= limitTokens) {
    throw new BudgetExceededError('tokens', limitTokens, totalTokens);
  }
  const limitCalls = budgetCalls();
  if (limitCalls !== undefined && totalCalls >= limitCalls) {
    throw new BudgetExceededError('calls', limitCalls, totalCalls);
  }
}

/** Return a snapshot of all usage. */
export function getUsageSummary(): UsageSummary {
  const result: UsageSummary = {
    buckets: {},
    totals: { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0 },
  };
  for (const [name, b] of buckets) {
    result.buckets[name] = { ...b };
    result.totals.calls += b.calls;
    result.totals.promptTokens += b.promptTokens;
    result.totals.completionTokens += b.completionTokens;
    result.totals.cachedTokens += b.cachedTokens;
  }
  return result;
}

/** Reset all counters (for testing only). */
export function resetUsage(): void {
  buckets.clear();
  totalCalls = 0;
  totalTokens = 0;
}

/* ------------------------------------------------------------------ */
/* Pretty-print helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * Format a usage summary for console or file output.
 *
 * If LLM_PRICE_IN_PER_M and LLM_PRICE_OUT_PER_M are set (yuan per
 * million tokens), an estimated cost column is appended.  Otherwise
 * only token counts are shown.
 */
export function formatUsageSummary(summary?: UsageSummary): string {
  const s = summary ?? getUsageSummary();
  const priceIn = process.env.LLM_PRICE_IN_PER_M
    ? parseFloat(process.env.LLM_PRICE_IN_PER_M)
    : undefined;
  const priceOut = process.env.LLM_PRICE_OUT_PER_M
    ? parseFloat(process.env.LLM_PRICE_OUT_PER_M)
    : undefined;
  const hasPricing = priceIn !== undefined && priceOut !== undefined;

  const lines: string[] = ['=== LLM Usage Summary ==='];

  const header = hasPricing
    ? '| Bucket | Calls | Prompt | Completion | Cached | Est. Cost |'
    : '| Bucket | Calls | Prompt | Completion | Cached |';
  const sep = hasPricing
    ? '|--------|-------|--------|------------|--------|-----------|'
    : '|--------|-------|--------|------------|--------|';
  lines.push(header, sep);

  const costFn = (prompt: number, completion: number) => {
    if (!hasPricing) return '';
    const cost = (prompt / 1_000_000) * priceIn! + (completion / 1_000_000) * priceOut!;
    return ` ${cost.toFixed(4)} |`;
  };

  const sorted = Object.entries(s.buckets).sort(([a], [b]) => a.localeCompare(b));
  for (const [name, b] of sorted) {
    const costStr = hasPricing ? costFn(b.promptTokens, b.completionTokens) : '';
    lines.push(
      `| ${name} | ${b.calls} | ${b.promptTokens} | ${b.completionTokens} | ${b.cachedTokens} |${costStr}`,
    );
  }

  const t = s.totals;
  const totalCostStr = hasPricing ? costFn(t.promptTokens, t.completionTokens) : '';
  lines.push(
    `| **TOTAL** | ${t.calls} | ${t.promptTokens} | ${t.completionTokens} | ${t.cachedTokens} |${totalCostStr}`,
  );

  return lines.join('\n');
}

/**
 * Write usage summary to a JSON file (for post-run analysis).
 */
export function writeUsageSummary(filePath: string, summary?: UsageSummary): void {
  const { writeFileSync } = require('node:fs') as typeof import('node:fs');
  writeFileSync(filePath, JSON.stringify(summary ?? getUsageSummary(), null, 2), 'utf-8');
}
