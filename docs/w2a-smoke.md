# W2a 冒烟记录:采集 HTTP API

> 2026-10-05 · 命令:`npx tsx server/src/main.ts`(默认 `PORT=7860`,库文件 `data/openmimic.db`)
> 全部在 `127.0.0.1` 本机执行,无真实网络。

启动:

```console
$ npx tsx server/src/main.ts
openmimic collection API listening on http://127.0.0.1:7860
```

## 1. `GET /api/health`

```console
$ curl -s http://127.0.0.1:7860/api/health
{"ok":true,"version":"0.0.1"}
```

## 2. `POST /api/subjects`

```console
$ curl -s -X POST http://127.0.0.1:7860/api/subjects \
    -H 'content-type: application/json' \
    -d '{"displayName":"林小满","selfReport":"这是不会外传的自我描述"}'
{"id":"0432782c-7aa0-4c82-bba1-e82bbe30c2f2","displayName":"林小满","selfReport":"这是不会外传的自我描述"}
```

## 3. `POST /api/subjects/:id/invites`

```console
$ curl -s -X POST http://127.0.0.1:7860/api/subjects/0432782c-7aa0-4c82-bba1-e82bbe30c2f2/invites
{"token":"NIdV6KX01rFosrTMQeUM-w","url":"/i/NIdV6KX01rFosrTMQeUM-w","expiresAt":"2026-10-18T15:54:10.313Z"}
```

token 为 22 位 URL 安全随机串,14 天后过期;响应里没有 `selfReport`。

## 4. `GET /api/invites/:token`

```console
$ curl -s http://127.0.0.1:7860/api/invites/NIdV6KX01rFosrTMQeUM-w
{"subjectDisplayName":"林小满","questionnaire":{"id":"friend-v1","title":"朋友版问卷 v1",
"frontPrompt":"这话你会当他面说吗？会怎么说？","questions":[... 10 题 ...]}}
```

只回显示名与题库:无 `selfReport`、无既有证言。

## 5. `POST /api/invites/:token/testimony`(同一条链接,两个朋友)

```console
$ curl -s -o /tmp/t1.json -w 'HTTP %{http_code}\n' \
    -X POST http://127.0.0.1:7860/api/invites/NIdV6KX01rFosrTMQeUM-w/testimony \
    -H 'content-type: application/json' \
    -d '{"relation":"大学同学","consentLevel":"quotable","answers":[{"qid":"q1","behindText":"上次聚餐她提前把单买了。"}],"freeText":"她不太爱说自己的好。"}'
HTTP 201
{"witnessId":"7ea97b7b-2787-4faf-b29a-68af671b94cc","testimonyId":"185c6904-42de-48a8-82b5-c0c1d2fd9d84","count":1}

$ curl -s -o /tmp/t2.json -w 'HTTP %{http_code}\n' \
    -X POST http://127.0.0.1:7860/api/invites/NIdV6KX01rFosrTMQeUM-w/testimony \
    -H 'content-type: application/json' \
    -d '{"relation":"发小","consentLevel":"quotable","answers":[{"qid":"q1","behindText":"她生气就不说话。"}]}'
HTTP 201
{"witnessId":"b410e352-8004-4cc1-9534-73f48d4bd78b","testimonyId":"d68d2d5d-6875-484c-8777-82f114986f40","count":2}
```

同一条 token 两次都成功——链接是多次可用的。

## 6. `GET /api/subjects/:id/progress`

```console
$ curl -s http://127.0.0.1:7860/api/subjects/0432782c-7aa0-4c82-bba1-e82bbe30c2f2/progress
{"testimonyCount":2,"witnessCount":2}
```

## 7. 错误路径

`410`:过期或无效 token(统一 JSON 错误形状):

```console
$ curl -s -o /tmp/bad.json -w 'HTTP %{http_code}\n' http://127.0.0.1:7860/api/invites/never-existed
HTTP 410
{"error":{"code":"invite_invalid","message":"邀请链接无效或已被撤销"}}
```

`400`:请求体校验失败(`consentLevel` 非法 + `behindText` 缺失),账本零写入:

```console
$ curl -s -o /tmp/v.json -w 'HTTP %{http_code}\n' \
    -X POST http://127.0.0.1:7860/api/invites/NIdV6KX01rFosrTMQeUM-w/testimony \
    -H 'content-type: application/json' \
    -d '{"relation":"同事","consentLevel":"public","answers":[{"qid":"q1"}]}'
HTTP 400
{"error":{"code":"validation_error","message":"consentLevel: Invalid enum value. Expected 'quotable' | 'synthesis_only', received 'public'; answers.0.behindText: Required"}}
```

## 8. 泄露锁死(自动化测试覆盖)

`consentLevel=synthesis_only` 的证言写入后,遍历全部 GET 接口响应全文,均不含
该证言的 `behindText` / `freeText` / `frontText`,也不含 subject 的 `selfReport`;
响应文本连 `behindText` 这个字段名都不出现。见
`server/test/api.test.ts` 的 *never leaks synthesis_only words or selfReport* 用例。
