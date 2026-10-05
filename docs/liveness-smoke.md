# Liveness Smoke Test

**Status**: NOT RUN

**Reason**: No LLM provider configured in this session. The smoke test
requires `LLM_MODEL` and `LLM_API_KEY` environment variables to call a
real model, which is not available in the offline worktree build.

**Expected invocation** (when LLM is available):

```bash
LLM_BUDGET_CALLS=12 npx tsx eval/src/liveness-smoke.ts
```

**What it would do**:
1. Pick 2 scenarios (1 daily_chat, 1 robot_probe)
2. Run each through the simulator with a real LLM
3. Judge one pair (variant current vs variant slim) with position swap
4. Write the transcript and verdict to this file

**Prerequisites**:
- Liveness calibration must pass first (see eval-ledger.md Liveness section)
- Human-designated samples must be provided in `eval/samples.json`
