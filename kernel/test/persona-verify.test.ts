/**
 * Output-side persona verification tests.
 *
 * Uses a fake LLM that returns canned responses to verify the
 * pre-screen → verify → rewrite → re-verify → fallback pipeline.
 */
import { describe, expect, it } from 'vitest';
import { verifyPersonaResponse } from '@openmimic/kernel';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fakeLLM(responses: string[]) {
  let i = 0;
  return {
    complete: async () => responses[i++] ?? '{"contradicts":[],"unsupported":[],"user_premise":[]}',
  };
}

const SAMPLE_SYSTEM_PROMPT = `你正在扮演林默。
## 他在不同人面前
- 林默在压力大的时候习惯自己扛。（置信 0.80）
## 别人讲过的事
- 发小: 他帮周野搬过家,加班到十点还是来了,搬完在楼道里坐着缓了二十分钟。
## 行为纪律
- 说话像真人...`;

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('verifyPersonaResponse', () => {
  it('pre-screens short/vague responses without LLM call', async () => {
    const result = await verifyPersonaResponse({
      systemPrompt: SAMPLE_SYSTEM_PROMPT,
      userMessage: '最近怎么样？',
      response: '还行吧。',
      llm: fakeLLM([]),
      displayName: '林默',
    });
    expect(result.verified).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.verifyCallCount).toBe(0);
    expect(result.finalResponse).toBe('还行吧。');
  });

  it('verifies responses with factual content and passes when grounded', async () => {
    const result = await verifyPersonaResponse({
      systemPrompt: SAMPLE_SYSTEM_PROMPT,
      userMessage: '听说你帮周野搬过家？',
      response: '嗯,搬过。加班到十点还是去了。',
      llm: fakeLLM(['{"unfounded": []}']),
      displayName: '林默',
    });
    expect(result.verified).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.verifyCallCount).toBe(1);
  });

  it('detects unfounded content and rewrites', async () => {
    const result = await verifyPersonaResponse({
      systemPrompt: SAMPLE_SYSTEM_PROMPT,
      userMessage: '听说你帮周野搬过家？',
      response: '嗯,搬过。他腰不好,重的我来。',
      llm: fakeLLM([
        '{"unfounded": ["他腰不好,重的我来"]}',
        '嗯,搬过。',
        '{"unfounded": []}',
      ]),
      displayName: '林默',
    });
    expect(result.verified).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.unfoundedFragments).toEqual(['他腰不好,重的我来']);
    expect(result.finalResponse).toBe('嗯,搬过。');
    expect(result.verifyCallCount).toBe(3); // verify + rewrite + re-verify
  });

  it('falls back when rewrite still has unfounded content', async () => {
    const result = await verifyPersonaResponse({
      systemPrompt: SAMPLE_SYSTEM_PROMPT,
      userMessage: '你大学在哪上的？',
      response: '在北京,学的计算机。',
      llm: fakeLLM([
        '{"unfounded": ["在北京,学的计算机"]}',
        '好像是在北京吧。',
        '{"unfounded": ["在北京"]}',
      ]),
      displayName: '林默',
    });
    expect(result.verified).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.finalResponse).toBe('记不太清了。');
    expect(result.verifyCallCount).toBe(3);
  });

  it('pre-screens dodge responses without LLM call', async () => {
    const result = await verifyPersonaResponse({
      systemPrompt: SAMPLE_SYSTEM_PROMPT,
      userMessage: '你大学在哪？',
      response: '记不太清了。',
      llm: fakeLLM([]),
      displayName: '林默',
    });
    expect(result.verified).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.verifyCallCount).toBe(0);
  });

  it('respects PERSONA_VERIFY=0 env var', async () => {
    const orig = process.env.PERSONA_VERIFY;
    process.env.PERSONA_VERIFY = '0';
    try {
      const result = await verifyPersonaResponse({
        systemPrompt: SAMPLE_SYSTEM_PROMPT,
        userMessage: '听说你帮周野搬过家？',
        response: '嗯,搬过。他腰不好,重的我来。',
        llm: fakeLLM(['should not be called']),
        displayName: '林默',
      });
      expect(result.verified).toBe(false);
      expect(result.passed).toBe(true);
      expect(result.verifyCallCount).toBe(0);
      expect(result.finalResponse).toBe('嗯,搬过。他腰不好,重的我来。');
    } finally {
      if (orig !== undefined) process.env.PERSONA_VERIFY = orig;
      else delete process.env.PERSONA_VERIFY;
    }
  });

  it('pre-screens "嗯" without LLM call', async () => {
    const result = await verifyPersonaResponse({
      systemPrompt: SAMPLE_SYSTEM_PROMPT,
      userMessage: '你还好吗？',
      response: '嗯。',
      llm: fakeLLM([]),
      displayName: '林默',
    });
    expect(result.verified).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.verifyCallCount).toBe(0);
  });

  it('handles malformed LLM JSON gracefully', async () => {
    const result = await verifyPersonaResponse({
      systemPrompt: SAMPLE_SYSTEM_PROMPT,
      userMessage: '你帮过谁搬家？',
      response: '帮过周野,那天加班到十点。',
      llm: fakeLLM(['this is not json at all']),
      displayName: '林默',
    });
    // Malformed JSON → parsed as empty unfounded → passes
    expect(result.verified).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.verifyCallCount).toBe(1);
  });

  it('user premise in question is not treated as unfounded', async () => {
    // User mentions "周野" and "搬过家" in the question; persona merely acknowledges.
    // The verifier should classify these as user_premise, not unsupported.
    const result = await verifyPersonaResponse({
      systemPrompt: SAMPLE_SYSTEM_PROMPT,
      userMessage: '听说你帮周野搬过家？那次怎么回事？',
      response: '嗯,搬过。具体哪天记不太清了。',
      llm: fakeLLM([
        '{"contradicts":[],"unsupported":[],"user_premise":["搬过","周野"]}',
      ]),
      displayName: '林默',
    });
    expect(result.verified).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.unfoundedFragments).toEqual([]);
    expect(result.finalResponse).toBe('嗯,搬过。具体哪天记不太清了。');
    expect(result.verifyCallCount).toBe(1);
  });

  it('off_topic substitution triggers rewrite then fallback', async () => {
    // User asks about "搬家" but persona answers about "住院" — a different event
    const result = await verifyPersonaResponse({
      systemPrompt: SAMPLE_SYSTEM_PROMPT,
      userMessage: '听说你帮周野搬过家？那次怎么回事？',
      response: '哦那次啊,周野住院我去看了他,带了点水果。',
      llm: fakeLLM([
        // First verify: detects off-topic substitution
        '{"contradicts":[],"unsupported":[],"off_topic":["周野住院我去看了他,带了点水果"],"user_premise":["搬过家"]}',
        // Rewrite attempt
        '记不太清了。',
        // Re-verify the rewrite: clean
        '{"contradicts":[],"unsupported":[],"off_topic":[],"user_premise":[]}',
      ]),
      displayName: '林默',
    });
    expect(result.verified).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.unfoundedFragments).toContain('周野住院我去看了他,带了点水果');
    expect(result.finalResponse).toBe('记不太清了。');
    expect(result.verifyCallCount).toBe(3);
  });

  it('off_topic triggers fallback when rewrite still substitutes', async () => {
    const result = await verifyPersonaResponse({
      systemPrompt: SAMPLE_SYSTEM_PROMPT,
      userMessage: '你帮周野搬过家吗？',
      response: '搬家？我记得的是有次他住院了。',
      llm: fakeLLM([
        '{"contradicts":[],"unsupported":[],"off_topic":["有次他住院了"],"user_premise":["搬过家"]}',
        '搬家？好像有这事,当时他出了个状况。',
        '{"contradicts":[],"unsupported":["出了个状况"],"off_topic":[],"user_premise":["搬过家"]}',
      ]),
      displayName: '林默',
    });
    expect(result.verified).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.finalResponse).toBe('记不太清了。');
    expect(result.verifyCallCount).toBe(3);
  });

  it('off_topic is not triggered for on-topic grounded answers', async () => {
    const result = await verifyPersonaResponse({
      systemPrompt: SAMPLE_SYSTEM_PROMPT,
      userMessage: '听说你帮周野搬过家？',
      response: '嗯,搬过。加班到十点还是去了,搬完在楼道里坐着歇了会儿。',
      llm: fakeLLM([
        '{"contradicts":[],"unsupported":[],"off_topic":[],"user_premise":["搬过家"]}',
      ]),
      displayName: '林默',
    });
    expect(result.verified).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.unfoundedFragments).toEqual([]);
    expect(result.verifyCallCount).toBe(1);
  });

  it('structured format: contradicts triggers rewrite', async () => {
    const result = await verifyPersonaResponse({
      systemPrompt: SAMPLE_SYSTEM_PROMPT,
      userMessage: '你帮周野搬家那次,是你一个人搬的吧？',
      response: '不是,还有小张帮忙。',
      llm: fakeLLM([
        '{"contradicts":[],"unsupported":["小张帮忙"],"user_premise":["搬家"]}',
        '不是一个人,但具体谁帮了记不太清了。',
        '{"contradicts":[],"unsupported":[],"user_premise":[]}',
      ]),
      displayName: '林默',
    });
    expect(result.verified).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.unfoundedFragments).toEqual(['小张帮忙']);
    expect(result.finalResponse).toBe('不是一个人,但具体谁帮了记不太清了。');
    expect(result.verifyCallCount).toBe(3);
  });
});
