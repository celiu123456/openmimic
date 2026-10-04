# W4b 冒烟记录:手搓 MCP Server(stdio)+ .persona 人格包

> 2026-10-05 · 命令均在 `/home/liuce/code/openmimic` 执行,全部本机 / 零真实上游。
> 任务书:`任务书-OpenMimic-W4b-MCP与persona包-20261005.md`。
> MCP 零 SDK 手写 JSON-RPC 2.0 行协议;`.persona` 为单文件 JSON,不用 zip。

## 0. 构建与全量测试

```console
$ npm run typecheck
(exports 0)

$ npm test
 Test Files  21 passed (21)
      Tests  154 passed (154)     # 既有 138 零回归 + W4b 新增 16
```

新增 16 条全部离线:MCP 用例只驱动纯函数 `dispatchMcpMessage`(外加 1 条 `spawn`
真进程握手冒烟),persona 包用例只碰内存 `Store` 与 `127.0.0.1` 本地 HTTP。
零真实上游调用。

## 1. MCP stdio 真实往返

入口 `npx tsx server/src/mcp/main.ts`,一行一条 JSON-RPC 2.0 消息(`OPENMIMIC_DB`
指定 SQLite;缺省 `data/openmimic.db`,空库自动 seed 林默)。

```console
$ printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"persona_list","arguments":{}}}' \
  | OPENMIMIC_DB=/tmp/om-w4b/mcp.db npx tsx server/src/mcp/main.ts
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"openmimic","version":"0.0.1"}}}
{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"persona_list",...},{"name":"persona_context",...},{"name":"persona_speak",...},{"name":"testimony_submit",...},{"name":"room_run",...}]}}
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{\"personas\":[{\"id\":\"limo\",\"displayName\":\"林默\",\"claimCount\":5}]}"}]}}
```

- `initialize` 回显客户端 `protocolVersion`,给 `serverInfo{name:'openmimic',version}` 与
  `capabilities{tools:{}}`;`tools/list` 五个工具都给 JSON Schema 入参;
- `notifications/initialized` 是通知(无 `id`),静默接受、**不回帧**(上面输出只有 3 行);
- 未知方法回 JSON-RPC `-32601`:

```console
{"jsonrpc":"2.0","id":7,"error":{"code":-32601,"message":"Method not found: tools/nope"}}
```

### 1.1 工具调用与无 key 诚实报错

```console
$ ... id4 persona_context{subjectId:limo} / id5 persona_speak / id6 room_run / id7 tools/nope
id4 systemPrompt head: 你正在扮演基于他人证言构建的林默。这是人格模拟,不是本人。
id5: {"content":[{"type":"text","text":"{\"error\":\"服务器未配置语言模型(缺 LLM_API_KEY),无法让人格开口\"}"}],"isError":true}
id6: {"content":[{"type":"text","text":"{\"room\":{\"id\":\"room-limo-1\",...}}}]}
id7: {"code":-32601,"message":"Method not found: tools/nope"}
```

- `persona_context` 返回的 systemPrompt 身份声明永在(external 纪律已内建);
- `persona_speak` 无 key → `isError:true` 文案说明,**不发起任何真实调用**;
- `room_run` 对演示人格无 key 仍返回预生成房间;非演示人格无 key → `isError`;
- 所有工具结果都过 external scope:`withholdSynthesisOnly` 递归替换任意字符串中
  `synthesis_only` 证言的 ≥8 字连续片段。单测用 19 字独特子串
  `紫色大象在凌晨三点独自跳探戈且无人知晓` 断言它在 `persona_speak`(假上游故意原样回吐)、
  `persona_context`、`room_run` 的结果里都不出现(`[withheld]` 取代)。

## 2. `.persona` 导出

```console
$ curl -s -D - -o limo.persona http://127.0.0.1:7897/api/subjects/limo/export | head -3
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
content-disposition: attachment; filename="limo.persona"; filename*=UTF-8''%E6%9E%97%E9%BB%98.persona

$ head -c 320 limo.persona
{"format":"openmimic.persona","version":1,"subject":{"displayName":"林默"},"claims":[{"id":"c-limo-1","subjectId":"limo","text":"林默在压力大的时候习惯自己扛,不向身边人求助,也不让家人知道。","conviction":0.8,"evidence":["t-faxiao","t-mother","t-subordinate"],"status":"surviving","courtSes
```

包字段:`format/version/subject{仅 displayName}/claims(surviving+qualified 全量)/styleSamples
(仅 quotable,每证人 ≤2)/report/witnesses/exportedAt/notice`。

- `subject` **不含 `selfReport`**;`witnesses` 条目为
  `{relation, stance, consentLevel, evidenceIds}` —— `evidenceIds` 是证言 **id 清单**
  (不含原文),导入时用它把 claim 的 evidence 锚到对应报关单;
- `styleSamples` 是证人授权的短原话;完整证言条目不随包分发。冒烟断言里,长句
  `借了两万…`(`>40` 字,进不了样本)不出现在导出文本中;
- 导出还过一遍 `withholdSynthesisOnly`,`synthesis_only` 原文即便混进某个字段也会被遮蔽。
- 头部分号后的 `filename*=UTF-8''林默.persona` 是 RFC 5987 参数:HTTP 头只能 latin-1,
  非 ASCII 名走这里,`filename` 回退用 ASCII 的 subject id。

## 3. 导入 + `/v1/models`

```console
$ curl -s -X POST .../api/import -H 'content-type: application/json' --data-binary @limo.persona
{"subject":{"id":"99c3bf34-…","displayName":"林默(导入)","styleSamples":[…12 条…]},
 "claimCount":5,"witnessCount":6,"receiptCount":6}
HTTP 201

$ curl -s .../v1/models
{"object":"list","data":[
  {"id":"persona/limo",…},
  {"id":"persona/99c3bf34-97e8-4c84-a5b9-e61f5d7b3c15",…}]}
```

导入语义:

- 新建 subject,`displayName` 加 `(导入)` 后缀;`styleSamples` 落库(导入包不附原始证言,
  没得再推导,round-trip 靠它保真);
- 每个 `witnesses` 条目生成一条 **import-receipt** 占位证言:`answers: []`、
  `freeText: '导入自 .persona 包,原始证言未随包分发'`,consentLevel 继承包内声明;
  包内未归属的 evidence id 兜底生成一条 `synthesis_only` 报关单证人;
- **无锚铁律不破**:每条导入 claim 的 `evidence` 都指向真实存在的占位证言 id;
  注释与代码都写明占位证言是「进口报关单」,不是证据本身;
- 体检报告对导入人格标注 `report.imported: true`,提示 `evidenceCoverage` 是名义覆盖
  (锚是报关单,不是原始证言);
- 导入人格可直接用:`/v1/models` 立刻列出、`persona_context` 可装配;
  背后房间由 claims 驱动化身(`runImportedRoom`,台词 `kind:'speech'`,Room 上
  `imported:true`,无 key 也能跑,质量不苛求)。

round-trip 单测:`export(limo) → import → export(林默(导入))`,两次导出的
`claims`(去掉导入必然重生的 `id/subjectId/evidence`)与 `styleSamples` 深等。

## 4. 新增测试证据(零真实网络)

```console
$ npx vitest run server/test/mcp.test.ts server/test/persona-package.test.ts --reporter=verbose
 ✓ exports a consent-filtered package with an attachment header
 ✓ omits synthesis_only raw words from the export
 ✓ imports a package into an anchored new subject with placeholder receipts
 ✓ round-trips claims and style samples through export/import/export
 ✓ rejects a body that is not an openmimic.persona package
 ✓ serves an imported persona through /v1/models
 ✓ runs a claims-driven room for an imported persona and marks it imported
 ✓ initializes by echoing the client protocol version and advertising tools
 ✓ lists the five tools with JSON schemas
 ✓ answers method-not-found for unknown methods and stays silent for notifications
 ✓ persona_list filters out subjects with no surviving claim
 ✓ persona_context returns the assembled prompt with the identity declaration
 ✓ testimony_submit appends through the append-only ledger
 ✓ persona_speak and room_run answer isError without a configured model
 ✓ withholds synthesis_only raw words from every tool result
 ✓ completes a real stdio initialize handshake in a spawned process
 Test Files  2 passed (2)
      Tests  16 passed (16)
```

## 5. 验收锚点

- [x] `npm run typecheck` 退出 0;`npm test` **154 passed**(既有 138 零回归 + 新增 16);
- [x] 冒烟:真 stdio `initialize` 往返(第 1 节)、`tools/list`/`tools/call`、未知方法 -32601;
- [x] 林默 export 的 JSON 头部与响应头贴样(第 2 节);
- [x] import 后 `/v1/models` 出现新 persona(第 3 节);
- [x] 遮蔽:`synthesis_only` 原文在全部工具结果中不出现(第 1.1 节 + 单测);
- [x] 零新增依赖(`package.json`/`package-lock.json` 未动);`testimonies` 两个
      append-only 触发器未动;README/LICENSE/NOTICE 未动;
- [x] 冒烟后 `rm -f data/openmimic.db*` 并删除临时目录;`git status` 只含本批源码改动。
