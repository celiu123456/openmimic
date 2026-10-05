import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordUsage,
  getUsageSummary,
  resetUsage,
  checkBudget,
  formatUsageSummary,
  BudgetExceededError,
  InsufficientBalanceError,
} from '../src/llm-usage';

describe('LLM usage tracking', () => {
  beforeEach(() => {
    resetUsage();
    delete process.env.LLM_BUDGET_TOKENS;
    delete process.env.LLM_BUDGET_CALLS;
    delete process.env.LLM_PRICE_IN_PER_M;
    delete process.env.LLM_PRICE_OUT_PER_M;
  });

  it('accumulates usage by bucket', () => {
    recordUsage('court-filing', { promptTokens: 100, completionTokens: 50 });
    recordUsage('court-filing', { promptTokens: 200, completionTokens: 80 });
    recordUsage('room-compose', { promptTokens: 150, completionTokens: 40, cachedTokens: 30 });

    const summary = getUsageSummary();
    expect(summary.buckets['court-filing']).toEqual({
      calls: 2,
      promptTokens: 300,
      completionTokens: 130,
      cachedTokens: 0,
    });
    expect(summary.buckets['room-compose']).toEqual({
      calls: 1,
      promptTokens: 150,
      completionTokens: 40,
      cachedTokens: 30,
    });
    expect(summary.totals).toEqual({
      calls: 3,
      promptTokens: 450,
      completionTokens: 170,
      cachedTokens: 30,
    });
  });

  it('throws BudgetExceededError when token limit is breached', () => {
    process.env.LLM_BUDGET_TOKENS = '500';
    recordUsage('other', { promptTokens: 300, completionTokens: 100 });
    // 400 total, still OK
    expect(() =>
      recordUsage('other', { promptTokens: 200, completionTokens: 50 }),
    ).toThrow(BudgetExceededError);
  });

  it('throws BudgetExceededError when call limit is breached', () => {
    process.env.LLM_BUDGET_CALLS = '2';
    recordUsage('other', { promptTokens: 10, completionTokens: 5 });
    recordUsage('other', { promptTokens: 10, completionTokens: 5 });
    // 2 calls done, next should throw
    expect(() =>
      recordUsage('other', { promptTokens: 10, completionTokens: 5 }),
    ).toThrow(BudgetExceededError);
  });

  it('checkBudget throws before a call when budget is already exhausted', () => {
    process.env.LLM_BUDGET_CALLS = '1';
    recordUsage('other', { promptTokens: 10, completionTokens: 5 });
    // 1 call done, limit is 1 => checkBudget should throw
    expect(() => checkBudget()).toThrow(BudgetExceededError);
  });

  it('InsufficientBalanceError is a non-retryable Error', () => {
    const err = new InsufficientBalanceError(402, 'no balance');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('InsufficientBalanceError');
    expect(err.status).toBe(402);
  });

  it('formatUsageSummary produces a readable table', () => {
    recordUsage('court-filing', { promptTokens: 1000, completionTokens: 200 });
    recordUsage('room-compose', { promptTokens: 500, completionTokens: 100, cachedTokens: 50 });
    const text = formatUsageSummary();
    expect(text).toContain('=== LLM Usage Summary ===');
    expect(text).toContain('court-filing');
    expect(text).toContain('room-compose');
    expect(text).toContain('**TOTAL**');
  });

  it('formatUsageSummary shows cost when prices are configured', () => {
    process.env.LLM_PRICE_IN_PER_M = '1.0';
    process.env.LLM_PRICE_OUT_PER_M = '2.0';
    recordUsage('other', { promptTokens: 1_000_000, completionTokens: 500_000 });
    const text = formatUsageSummary();
    // 1M * 1.0/M + 500K * 2.0/M = 1.0 + 1.0 = 2.0
    expect(text).toContain('Est. Cost');
    expect(text).toContain('2.0000');
  });

  it('resetUsage clears all counters', () => {
    recordUsage('other', { promptTokens: 100, completionTokens: 50 });
    resetUsage();
    const summary = getUsageSummary();
    expect(summary.totals.calls).toBe(0);
    expect(Object.keys(summary.buckets)).toHaveLength(0);
  });
});
