# Interviewer v4: Per-Turn Generation

## How It Works

The v4 interviewer replaces the fixed questionnaire approach with single-model per-turn generation. Each turn sends the **complete conversation history** to the LLM, which decides what to ask next. There are no fixed questions, no navigator, no planning step.

### One LLM Call Per Turn

```
system(identity + direction + objective + constraints)
  + full effective history (assistant=questions, user=answers)
  + current user text
  → one LLM call
  → at most one acknowledgement sentence + one question
```

Repair adds at most one retry (2 calls max per turn).

### Two Scenarios

| Scenario | Mode | Who is "you" | Who is "I" |
|----------|------|-------------|------------|
| **Informant** | `informant` | The witness (respondent) | Also the witness |
| **Self** | `self` | The subject themselves | Also the subject |

The same module handles both; only the objective sentence and relationship binding change.

## System Prompt (Chinese)

The system prompt is built by `buildSystemPrompt(ctx)` in `prompt.ts`. It includes:

1. **Identity**: Natural, perceptive, boundaried interviewer (not a questionnaire, interrogator, therapist, or data collector). Always identifies itself as AI; never claims to be a real person.
2. **Role binding**: Respondent name, related name, relationship direction. "You" always addresses the respondent; "I" always means the respondent. Never swap behaviours, dialogue, feelings, or responses between the two. Self-mode adds: respondent and related are the same person.
3. **Objective**: Scenario-specific goal sentence (see `objective.ts`).
4. **Method rules**: 9 constraints covering active listening, open questions, no evaluation, retreat on pushback, no fabrication, no model-decided endpoint.
5. **Uncovered aspects** (optional): Up to 6 dimension names from `coverage.ts` as reference, not a checklist.
6. **Output format**: At most one acknowledgement + one question ending with `?`. No analysis, rules, numbering, JSON, or Markdown.
7. **Opening instruction** (first turn only): Explicitly identify as AI assistant, explain purpose (informant: on behalf of the subject; self: to help understand yourself), mention they can stop anytime, forbid claiming any human identity (friend, colleague, etc.), ask the lightest question.
8. **Retreat injection** (when detected): Brief "no worries", immediately switch direction.
9. **Repair injection** (after guard failure): Re-generate instruction.

## Server-Side Guards (Zero Model)

Guards run in `guards.ts`, reusing existing implementations from `interview-state.ts`:

1. **Single question**: Exactly one `?/？` at the end; no chained questions; no forbidden prefixes.
2. **Premature ending**: Regex catches closing/wrap-up language.
3. **Dedup**: 2-gram Jaccard >= 0.58 or containment >= 0.72 against last 12 questions.
4. **Acknowledgement check**: The acknowledgement part must not contain its own question mark.
5. **Opening identity** (opening turn only): Rejects outputs that claim a human relationship identity (`我是你的朋友/同事/同学/家人/亲戚/老师`) or that do not mention "AI" (case-insensitive). Only applied when `isOpening=true`.

### Repair Chain

Guard failure triggers one repair call with `REPAIR_INSTRUCTION` appended to the system prompt. If the retry also fails, the server returns `503 interview_generation_failed` and the history stays unchanged.

### Output Sanitisation

Before guards run, the raw output is sanitised:
- Code fence wrappers (triple backticks) are stripped.
- If the output is JSON with a `question` field, the question text is extracted.

## Retreat & Reopen

Retreat detection reuses `retreat.ts`:
- **Retreat**: Detected topic added to `cautiousTopics`; system prompt receives `RETREAT_BOUNDARY_INJECTION`.
- **Reopen**: Topic removed from `cautiousTopics`; no injection.

## Coverage Dimensions

From `coverage.ts` (the 10 observer dimensions in `witness-v2.ts`), the prompt receives up to 6 uncovered aspect names as a non-binding reference. When all are covered or fewer than needed, this section is omitted.

## Low-Confidence Speech

ASR confidence below 0.72 triggers a confirmation response (`{ confirm: { text } }`) instead of entering the text into history. The user can correct and resubmit.

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/invites/:token/chat` | Start a chat session; returns `{ sessionId, message }` |
| POST | `/api/chat/:sid/say` | Send a message; returns `{ message }`, `{ confirm }`, or `503` |
| POST | `/api/chat/:sid/finish` | End session; converts turns to testimony |
| GET | `/api/chat/:sid` | Get session history (refresh recovery) |

Old `/api/invites/:token/interview` routes remain as deprecated compatibility.

## LLM Parameters

- Temperature: 0.4
- Max tokens: 260 (first attempt); 1200 on retry when `finish_reason=length` and content is empty
- Timeout: 15s
- Thinking: `disabled` — sent as `{"thinking":{"type":"disabled"}}` in the request body

### Thinking Model Gating (`LLM_THINKING_PARAM`)

DeepSeek reasoning models (e.g. `deepseek-flash` / V4.1) emit `reasoning_content` before the actual `content`. With a small `max_tokens`, reasoning can consume the entire budget and leave `content` empty.

The v4 interviewer always requests `thinking: 'disabled'`. Whether the wire field is actually sent is controlled by the `LLM_THINKING_PARAM` environment variable:

| Value | Behaviour |
|-------|-----------|
| `off` | Never send the `thinking` field (for providers that reject unknown fields) |
| `on` | Always send `thinking: {type: 'disabled'}` |
| *(empty / unset)* | Send only when `LLM_BASE_URL` contains `deepseek` (default) |

### Empty Content Retry

When the LLM returns empty content with `finish_reason=length` (token budget exhausted by reasoning despite the disable flag, or simply too short), the interviewer retries **once** with `max_tokens=1200`. This retry is transparent to the guard chain and does not count as a repair attempt. The call-count invariant remains "exactly 1 LLM call per normal turn" for the happy path.

## Testimony Conversion

`finishChat` converts turns to `TestimonyAnswer[]`:
- `qid = 'v4:' + turnId`
- `question = assistant question text`
- `behindText = user answer text`

Submitted through the existing `submitTestimony` path. Post-processing (`classifyBasis`, etc.) runs as before.

## Evaluation Criteria (Future)

After real usage:
- Turn count and session duration
- Answer length trend across turns
- Exit rate (explicit stop vs. natural finish)
- "Would you chat again?" sentiment
- Transcript quality via Nature SR 2026 five-dimension rubric

Information quantity is **not** a target metric.

## Plugin Registration

Registered as `collector:chat` alongside the existing `collector:interview`. Both are loaded by default; the chat plugin requires an LLM to be configured. When no LLM is available, chat routes return 404 while the questionnaire routes continue working.
