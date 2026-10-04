# W3c 冒烟记录:AI 访谈员 v1(问题树 + 追问)

> 2026-10-05 · 命令均在 `/home/liuce/code/openmimic` 执行,全部在 `127.0.0.1` 本机,
> **未配置任何 LLM/ASR key**(`env | grep -i llm` 为空),零真实网络。
> 前端为 `web/dist` 构建产物,由同一进程静态托管。

## 0. 构建与起服(无 key)

```console
$ npm run typecheck
(exit 0)

$ npm test
 Test Files  16 passed (16)
      Tests  121 passed (121)      # 既有 98 零回归 + W3c 新增 23

$ npm run build:web
dist/assets/index-BQyr8eg0.css         11.49 kB │ gzip:  3.04 kB
dist/assets/InterviewView-BL548ciR.js  16.09 kB │ gzip:  6.07 kB
✓ built in 590ms

$ rm -f data/openmimic.db*
$ PORT=7899 npx tsx server/src/main.ts
openmimic collection API listening on http://127.0.0.1:7899
$ curl -s -o /dev/null -w 'health HTTP %{http_code}\n' http://127.0.0.1:7899/api/health
health HTTP 200
```

## 1. 无 key 全流程(含 skip 路径)

问题树完全由服务端驱动;无 key 时 `answer` **永不返回 followup**。

```console
$ SID=$(curl -s -X POST http://127.0.0.1:7899/api/subjects \
    -H 'content-type: application/json' -d '{"displayName":"林小满"}' | jq -r .id)
$ TOKEN=$(curl -s -X POST http://127.0.0.1:7899/api/subjects/$SID/invites | jq -r .token)

$ curl -s -w '\nHTTP %{http_code}\n' -X POST http://127.0.0.1:7899/api/invites/$TOKEN/interview
{"sessionId":"e7c40db6-5b75-47c6-ad2a-bcbfa61ba9fb","question":{"qid":"q1", ...},"total":10}
HTTP 201
```

第一题给一条**本身已含事例特征**(长度 ≥40 字)的回答 —— 不调 LLM,直接到下一题:

```console
$ curl -s -w '\nHTTP %{http_code}\n' -X POST .../api/interview/$SESSION/answer \
    -H 'content-type: application/json' \
    -d '{"qid":"q1","text":"前年冬天我搬家，他请了一天假来帮忙，从早上八点搬到下午三点，连口水都没顾上喝。"}'
{"question":{"qid":"q2", ...},"index":1}
HTTP 200
```

显式跳过第二题(`{"skip":true}`)—— 记入 `avoidedQids`,不追问、不挽留:

```console
$ curl -s -w '\nHTTP %{http_code}\n' -X POST .../api/interview/$SESSION/answer \
    -H 'content-type: application/json' -d '{"qid":"q2","skip":true}'
{"question":{"qid":"q3", ...},"index":2}
HTTP 200
```

第 3–10 题逐题作答(即使回答很短,无 key 也没有任何 followup),末题返回 `{done:true}`:

```console
q3 HTTP 200 {"question":{"qid":"q4", ...},"index":3}
...
q9 HTTP 200 {"question":{"qid":"q10", ...},"index":9}
q10 HTTP 200 {"done":true}
```

收口提交,走 `submitTestimony` 只追加落账本:

```console
$ curl -s -w '\nHTTP %{http_code}\n' -X POST .../api/interview/$SESSION/finish \
    -H 'content-type: application/json' -d '{"relation":"大学同学","consentLevel":"quotable"}'
{"witnessId":"d2d4eee1-...","testimonyId":"bf83059c-...","count":1}
HTTP 201

$ curl -s .../api/subjects/$SID/progress
{"testimonyCount":1,"witnessCount":1}

$ curl -s -w '\nHTTP %{http_code}\n' -X POST .../api/interview/$SESSION/answer \
    -H 'content-type: application/json' -d '{"text":"any"}'
{"error":{"code":"session_invalid","message":"访谈会话不存在或已过期"}}
HTTP 410
```

`finish` 之后 session 被删除,再次访问 410。账本行直接检视(只读连接):

```console
$ node -e '... SELECT answers, avoided_qids FROM testimonies ORDER BY rowid DESC LIMIT 1 ...'
testimony: bf83059c-033a-470b-87f4-f0f47cc15ad4
avoided_qids: ["q2"]
answers count: 9
qids: q1,q3,q4,q5,q6,q7,q8,q9,q10
followupText present: false
triggers: testimonies_append_only_delete,testimonies_append_only_update
```

`avoidedQids` 落在 Testimony 上、`followupText` 只在真有追问时才存在;两个 append-only
触发器原样未动。

## 2. 旧直提交口保留

`POST /api/invites/:token/testimony` 原样保留(前端降级与第三方采集器仍可用):

```console
$ curl -s -w '\nHTTP %{http_code}\n' -X POST .../api/invites/$TOKEN/testimony \
    -H 'content-type: application/json' \
    -d '{"relation":"发小","consentLevel":"quotable","answers":[{"qid":"q1","behindText":"旧直提交口仍可用。"}]}'
{"witnessId":"3595214c-...","testimonyId":"2c8169cb-...","count":2}
HTTP 201
```

无 key 的 ASR 行为不变:

```console
$ curl -s .../api/asr/available
{"available":false}
```

SPA 硬刷新兜底不变(新构建产物):

```console
$ curl -s -o /dev/null -w 'GET /i/<token> HTTP %{http_code} content-type=%{content_type}\n' \
    http://127.0.0.1:7899/i/$TOKEN
GET /i/<token> HTTP 200 content-type=text/html; charset=utf-8
/assets/index-B4vrUlDo.js
/assets/index-BQyr8eg0.css
```

## 3. FakeLLM 单测日志:追问只发生在该发生处

`npx vitest run engines/witness/test/interview.test.ts --reporter=verbose` 摘录:

```console
 ✓ follow-up heuristic > treats a long answer, a number, a quote or a time marker as concrete
 ✓ follow-up heuristic > parses a bare, fenced or prose-wrapped follow-up object
 ✓ interview session state machine > asks for a follow-up only when the answer carries no concrete detail
 ✓ interview session state machine > never calls the model when the answer already contains an incident
 ✓ interview session state machine > never calls the model for a short answer that names a time
 ✓ interview session state machine > stops asking after the follow-up budget is spent
 ✓ interview session state machine > gives up the follow-up when the model output is unusable
 ✓ interview session state machine > records a skipped question as avoided and never asks its follow-up
 ✓ interview session state machine > records a skipped follow-up as a silence, not an empty followupText
 ✓ interview session state machine > refuses a follow-up answer when no follow-up is waiting
 ✓ interview session state machine > lets a client correct an earlier answer without spending a follow-up
 ✓ interview session state machine > never follows up when no model is configured
 ✓ interview session state machine > purges an expired session the next time it is touched
 ✓ interview finish > assembles a testimony with followupText kept apart and avoidedQids kept
 ✓ interview finish > round-trips avoidedQids and followupText through the ledger
 ✓ interview finish > accepts a client-held draft and can jump straight to a later question
```

断言要点(测试内直接断言 `FakeLLM.calls.length`):短而无事例特征 → 1 次调用并返回追问;
长答/含「有一回」→ 0 次调用;第 6 次潜在追问 → `calls` 仍停在 5;追问跳过 → 不存
`followupText`;无 key → 全程 0 次调用。追问 system prompt 含「不要连环问」「不评价对方的
回答好坏」「不贴标签」。

## 4. 设计落点

- **状态机纯函数核** `engines/witness/src/interview-state.ts`:启发式预筛、预算计数、
  状态迁移(`withAnswer`/`withSkip`/`advance`/`withPending`…)、追问 prompt 与 JSON 解析,
  无 store、无时钟、无模型;
- **Store 持久化** `interview_sessions(id/invite_token/state JSON/created_at)`:
  草稿允许 update(`putInterviewSession` upsert),`purgeInterviewSession` 惰性清理;
  24h TTL 在读取时判断并顺手删除;最终产物仍只经 `addTestimony` 追加;
- **shared 增量**:`TestimonyAnswerSchema.followupText?`、`TestimonySchema.avoidedQids?`,
  `testimonies.avoided_qids` 列由 `migrate()` 幂等补齐(旧库亦可用);
- **无 key 降级**:`answerQuestion` 的 LLM 分支仅在有 `llm` 时存在,前端在
  `/interview` 路由 404/405/501 时退回旧直提交口,体验与 W2b 完全一致;
- **Web**:`InterviewView.vue` 改走会话接口,追问以「访谈员」气泡出现在当前题下方,
  每题有小字「这题跳过」;授权卡与成功页不变。

## 5. 验收锚点

- [x] `npm run typecheck` 退出 0;`npm test` 121 passed(既有 98 零回归);
      `npm run build:web` 成功(43 modules);
- [x] 无 key 全流程 curl(第 1 节)含 skip 路径;账本行 proof(第 1 节末);
- [x] FakeLLM 单测日志摘录(第 3 节)证明追问只发生在该发生处;
- [x] 零新增依赖(`package.json`/`package-lock.json` 未动);`testimonies`
      两个 append-only 触发器未动;README/LICENSE/NOTICE 未动;
- [x] 冒烟后 `rm -f data/openmimic.db*`,`git status` 只含本批源码改动
      (`data/*.db` 与 `web/dist` 本就在 `.gitignore` 内)。
