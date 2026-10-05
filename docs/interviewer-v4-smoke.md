# Interviewer v4 Smoke Test

> Date: 2026-10-10
> Baseline: main (66d5a4f) + v4 interviewer commits
> Script: `npx tsx scripts/chat-smoke.ts`

## 1. Test Suite Results

```
$ npm run typecheck && npm test

> openmimic@0.0.2 typecheck
> tsc -p tsconfig.json --noEmit && tsc -p web/tsconfig.json --noEmit

 Test Files  69 passed (69)
      Tests  1521 passed (1521)
```

Before v4: 1470 tests. After: 1521 tests (+51 new, 0 removed).

### New test files

- `engines/witness/test/interviewer-v4.test.ts` -- 44 tests
- `server/test/chat-api.test.ts` -- 7 tests

## 2. Chat Flow (FakeLLM-backed server, actual `scripts/chat-smoke.ts` output)

```
Server started at http://127.0.0.1:35161

--- 1. POST /api/invites/:token/chat ---
Request: {}
Status: 201
Response: {
  "sessionId": "637adc2f-92e5-42da-b997-d17f5aec96f9",
  "message": {
    "id": "3c226a72-b977-4568-ab21-0efae776c8bc",
    "text": "你好，我是访谈员，这段对话用来更完整地理解林小满，随时可以停。你们是怎么认识的？"
  }
}

--- 2. POST /api/chat/:sid/say (normal) ---
Request: {
  "text": "大学认识的"
}
Status: 200
Response: {
  "message": {
    "id": "b94a42d9-9c3f-44d6-a817-736a89c01ed3",
    "text": "大学时代啊。你们在大学时经常一起做什么？"
  }
}

--- 3. POST /api/chat/:sid/say (guard violation repaired) ---
Request: {
  "text": "他人挺温和的"
}
Status: 200
Response: {
  "message": {
    "id": "0e39fdd0-c40a-4957-9ede-23e52971fbe3",
    "text": "嗯嗯，温和的人。能不能说一件让你印象最深的事？"
  }
}

--- 4. POST /api/chat/:sid/say (normal) ---
Request: {
  "text": "有一次搬家他专门来帮忙"
}
Status: 200
Response: {
  "message": {
    "id": "24df201a-637d-4e1f-9f09-968a5b13132b",
    "text": "搬家帮忙确实能看出人品。你觉得他身上还有什么特别的地方？"
  }
}

--- 5. POST /api/chat/:sid/finish ---
Request: {
  "consentLevel": "quotable",
  "relation": "大学同学"
}
Status: 201
Response: {
  "witnessId": "7be9e851-89e6-4bd1-aed2-237c782949c0",
  "testimonyId": "eb5537d8-a333-483b-8129-0e3d9987fb1e",
  "count": 1
}

=== Smoke test complete ===
```

## 3. Guard Tests (from unit tests)

| Guard | Input | Result |
|-------|-------|--------|
| Ack + question | `听起来那天挺难的。你后来是怎么跟他说的？` | Passes |
| Opening format | `你好，我是访谈员，…。你们是怎么认识的？` | Passes |
| Bare question | `你觉得他是一个怎样的人？` | Passes |
| Double question mark | `你喜欢吃什么？你呢？` | Rejected: not_single_question |
| No question mark | `你喜欢吃什么。` | Rejected: not_single_question |
| Chained questions | `他挺好的？那具体呢？` | Rejected: not_single_question |
| Two ack sentences | `原来是这样。真有意思。你后来怎么办的？` | Rejected: not_single_question |
| Newline | `听起来挺好的。\n你后来呢？` | Rejected: not_single_question |
| Closing language (4 variants) | `最后再问一个…` / `今天就先聊到这…` etc. | Rejected: premature_ending |
| Duplicate (Jaccard) | Same as previous question | Rejected: duplicate |
| Forbidden prefix | `抱歉，我换个问题…` | Rejected: not_single_question |
| Code fence wrapper | `` ```你们怎么认识的？``` `` | Sanitised, passes |
| JSON wrapper | `{"question":"你们怎么认识的？"}` | Extracted, passes |
| Repair chain (1st fail, 2nd pass) | 2 calls total | Passes on retry |
| Repair chain (both fail) | 2 calls total | interview_generation_failed |

## 4. Grep Proof

```
$ grep -rn 'questionnaires/' engines/witness/src/interviewer-v4/
engines/witness/src/interviewer-v4/interviewer.ts:16:import { OBSERVER_DIMENSIONS, WITNESS_V2_QUESTIONNAIRES } from '../questionnaires/witness-v2';
```

This import is for coverage dimension names (`OBSERVER_DIMENSIONS`) and
`computeCoverage()` input (`WITNESS_V2_QUESTIONNAIRES`), not for fixed questions.
The v4 path uses these only as reference metadata for the "uncovered aspects"
hint in the system prompt.

```
$ grep -rn 'OPENING_EXPECTATION' engines/witness/src/interviewer-v4/ server/src/mount-rest.ts web/src/views/ChatView.vue
(none)

$ grep -rn 'closingSuggested' engines/witness/src/interviewer-v4/ server/src/mount-rest.ts web/src/views/ChatView.vue
(none)

$ grep -rn 'navigator' engines/witness/src/interviewer-v4/
engines/witness/src/interviewer-v4/prompt.ts:5: * No questionnaire, no navigator, no planning.
engines/witness/src/interviewer-v4/interviewer.ts:4: * No questionnaire, no navigator, no planning. The model sees the
```

Only comment references (stating "no navigator"). No functional usage.

## 5. Web Build

**Pre-existing failure** (baseline issue, not fixed here): `shared/src/sanitize.ts`
imports `node:crypto` (`createHash`) which cannot be bundled for the browser by
Vite/Rollup. This failure exists on the baseline commit (66d5a4f) before any v4
changes. The v4 web components (`ChatView.vue`, `api.ts` additions,
`InterviewView.vue` integration) pass typecheck cleanly.

## 6. Checklist

- [x] Zero new dependencies
- [x] Zero uncommitted files (after final commit)
- [x] `testimonies` table triggers untouched
- [x] No real model invocations (all FakeLLM)
- [x] Old interview routes preserved (deprecated)
- [x] v4 path does not reference OPENING_EXPECTATION, closingSuggested, navigator (functionally)
