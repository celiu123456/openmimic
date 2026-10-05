import { describe, expect, it } from 'vitest';
import { extractJson, tryExtractJson, generateStructuredJson, type RepairModel, type RepairChatMessage } from '../src/llm-json';
import { ProviderError } from '../src/provider-error';

describe('extractJson', () => {
  it('parses clean JSON', () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it('parses JSON array', () => {
    expect(extractJson('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('extracts from markdown fence', () => {
    const response = 'Here is the result:\n```json\n{"a": 1}\n```\n';
    expect(extractJson(response)).toEqual({ a: 1 });
  });

  it('extracts from fence without json tag', () => {
    const response = 'Result:\n```\n{"a": 1}\n```';
    expect(extractJson(response)).toEqual({ a: 1 });
  });

  it('extracts outermost JSON object from prose', () => {
    const response = 'The answer is {"a": 1} and that is it.';
    expect(extractJson(response)).toEqual({ a: 1 });
  });

  it('extracts outermost JSON array from prose', () => {
    const response = 'Results: [1, 2, 3]. Done.';
    expect(extractJson(response)).toEqual([1, 2, 3]);
  });

  it('handles whitespace around JSON', () => {
    expect(extractJson('  {"a": 1}  ')).toEqual({ a: 1 });
  });

  it('throws for non-JSON text', () => {
    expect(() => extractJson('no json here')).toThrow('parseable JSON');
  });

  it('throws for empty string', () => {
    expect(() => extractJson('')).toThrow('parseable JSON');
  });
});

describe('tryExtractJson', () => {
  it('returns parsed value on success', () => {
    expect(tryExtractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it('returns undefined on failure', () => {
    expect(tryExtractJson('not json')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* generateStructuredJson repair loop                                   */
/* ------------------------------------------------------------------ */

describe('generateStructuredJson', () => {
  function fakeModel(responses: string[]): RepairModel {
    let index = 0;
    return {
      async chat(_messages: RepairChatMessage[]): Promise<string> {
        if (index >= responses.length) throw new Error('no more responses');
        return responses[index++]!;
      },
    };
  }

  it('returns on first valid attempt', async () => {
    const model = fakeModel(['{"value": 42}']);
    const result = await generateStructuredJson({
      model,
      messages: [{ role: 'user', content: 'give me json' }],
      validate: (v) => (v as { value: number }).value,
    });
    expect(result).toBe(42);
  });

  it('repairs on validation failure and succeeds on second attempt', async () => {
    const model = fakeModel([
      '{"value": "wrong_type"}',  // first attempt: wrong type
      '{"value": 42}',           // repair attempt: correct
    ]);
    const result = await generateStructuredJson({
      model,
      messages: [{ role: 'user', content: 'give me json' }],
      validate: (v) => {
        const num = (v as { value: unknown }).value;
        if (typeof num !== 'number') throw new Error('value must be a number');
        return num;
      },
      maxAttempts: 2,
    });
    expect(result).toBe(42);
  });

  it('throws after exhausting attempts', async () => {
    const model = fakeModel([
      '{"value": "wrong"}',
      '{"value": "still wrong"}',
    ]);
    await expect(
      generateStructuredJson({
        model,
        messages: [{ role: 'user', content: 'give me json' }],
        validate: (v) => {
          const num = (v as { value: unknown }).value;
          if (typeof num !== 'number') throw new Error('value must be a number');
          return num;
        },
        maxAttempts: 2,
      }),
    ).rejects.toThrow('structured_json_validation_failed');
  });

  it('propagates non-retryable errors immediately', async () => {
    const model: RepairModel = {
      async chat(): Promise<string> {
        throw new ProviderError({
          provider: 'test',
          message: 'quota exhausted',
          errorClass: 'QUOTA_EXHAUSTED',
          retryable: false,
        });
      },
    };
    await expect(
      generateStructuredJson({
        model,
        messages: [{ role: 'user', content: 'give me json' }],
        validate: (v) => v,
        maxAttempts: 3,
      }),
    ).rejects.toThrow('quota exhausted');
  });

  it('feeds original output and error to repair attempt', async () => {
    const capturedMessages: RepairChatMessage[][] = [];
    let callIndex = 0;
    const model: RepairModel = {
      async chat(messages: RepairChatMessage[]): Promise<string> {
        capturedMessages.push([...messages]);
        if (callIndex++ === 0) return '{"bad": true}';
        return '{"good": true}';
      },
    };
    await generateStructuredJson({
      model,
      messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'request' }],
      validate: (v) => {
        if (!(v as Record<string, unknown>).good) throw new Error('need good');
        return v;
      },
      maxAttempts: 2,
    });
    // Second call should have the original messages + assistant output + repair prompt
    const secondCall = capturedMessages[1]!;
    expect(secondCall).toHaveLength(4); // system + user + assistant + repair
    expect(secondCall[2]!.role).toBe('assistant');
    expect(secondCall[2]!.content).toBe('{"bad": true}');
    expect(secondCall[3]!.role).toBe('user');
    expect(secondCall[3]!.content).toContain('need good');
  });
});
