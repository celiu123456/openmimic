# W2b 冒烟记录:手机访谈间 H5

> 2026-10-05 · 命令均在 `/home/liuce/code/openmimic` 执行,全部在 `127.0.0.1` 本机,无真实网络。
> 构建:`npm run build -w @openmimic/web` → `web/dist`(40 modules)。

## 0. 启动(已 build 的 web 静态托管)

```console
$ npm run build -w @openmimic/web
$ npx tsx server/src/main.ts
openmimic collection API listening on http://127.0.0.1:7860
```

## 1. 造一条邀请链接

```console
$ curl -s -X POST http://127.0.0.1:7860/api/subjects \
    -H 'content-type: application/json' -d '{"displayName":"林小满"}'
{"id":"2cc13afb-d45c-448f-8e34-bb3c40352938","displayName":"林小满"}

$ curl -s -X POST http://127.0.0.1:7860/api/subjects/2cc13afb-d45c-448f-8e34-bb3c40352938/invites
{"token":"uPY_T_sZIOhvMSyVsQiWPQ","url":"/i/uPY_T_sZIOhvMSyVsQiWPQ","expiresAt":"2026-10-18T16:02:44.512Z"}
```

## 2. `curl /i/<token>` 拿到访谈间页面 HTML

```console
$ curl -s -o page.html -w 'HTTP %{http_code} content-type=%{content_type} bytes=%{size_download}\n' \
    http://127.0.0.1:7860/i/uPY_T_sZIOhvMSyVsQiWPQ
HTTP 200 content-type=text/html; charset=utf-8 bytes=556

$ head -6 page.html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
```

即 `web/dist/index.html`(history 路由回退)。引用的静态资源:

```console
$ grep -oE '/assets/[A-Za-z0-9._-]+' page.html | sort -u
/assets/index-CyHvcex_.js
/assets/index-tBNaMldS.css

$ curl -s -o /dev/null -w 'HTTP %{http_code} content-type=%{content_type} bytes=%{size_download}\n' \
    http://127.0.0.1:7860/assets/index-CyHvcex_.js
HTTP 200 content-type=text/javascript; charset=utf-8 bytes=93566
```

`/` 同样回退到 SPA(`HTTP 200 text/html`);`/api/*` 永不回退:

```console
$ curl -s -w '\nHTTP %{http_code}\n' http://127.0.0.1:7860/api/nope
{"error":{"code":"not_found","message":"接口不存在"}}
HTTP 404
```

## 3. 语音端点:未配 key → 501、available=false

```console
$ curl -s http://127.0.0.1:7860/api/asr/available
{"available":false}

$ curl -s -w '\nHTTP %{http_code}\n' -X POST http://127.0.0.1:7860/api/asr \
    -H 'content-type: audio/webm' --data-binary 'fake-audio'
{"error":{"code":"asr_unavailable","message":"服务器未配置语音转写"}}
HTTP 501
```

因此访谈间进入时探测一次后,麦克风按钮整体不渲染(见 `InterviewView.vue` 的
`asrReady`)。配了 key 时 `available=true`(自动化测试覆盖,不发真实网络请求)。

## 4. 浏览器流程(逐步文字记录,无截图)

1. 手机浏览器打开 `http://127.0.0.1:7860/i/uPY_T_sZIOhvMSyVsQiWPQ`。
   `GET /api/invites/<token>` 返回 `subjectDisplayName` 与 friend-v1 题库,进入开场页。
2. 开场页显示「林小满」与定场文案「TA 看不到你此刻写的内容。说法冲突不用怕——矛盾本身就是信息。」,
   下方是关系选择:朋友 / 同事 / 家人 / 其他。默认未选,「开始」置灰;点「朋友」后可用。
   刷新页面仍停在开场页(草稿从 sessionStorage 恢复)。
3. 「开始」进入一屏一题:大字题干、追加提示、下方多行输入框与麦克风位(本机未配 key,麦克风不出现)。
   顶部进度点 + 「第 1 / 10 题」。
4. 输入第一题真实看法后,同屏下方出现追加问「这话你会当他面说吗?会怎么说?」。
   若直接点「下一题」——置灰不可点;必须写一句当面说法,或点「当面我不会说」显式跳过。
5. 点「当面我不会说」后按钮高亮、文本域禁用并提示「好,这一题不再追问」;此时「下一题」可点。
   再点一次该按钮即撤销跳过,回到可输入状态。
6. 点「上一题」回改第一题:已填内容还在,可修改;改动即时写入 sessionStorage。
7. 第 10 题点「去确认」进入结束页。两张授权卡片默认选中「只参与合成,原话不露出」(synthesis_only),
   另一张是「原话可展示」;下方诚实说明「提交后就不能再改了……以只追加的方式进入账本」。
8. 点「提交」→ `POST /api/invites/<token>/testimony` 201 → 成功页显示「你是第 1 位讲述者」
   (取返回的 `count`),并清除 sessionStorage 草稿;此时刷新页面回到开场页(不丢已有账本数据)。

## 5. 验收锚点 grep

默认授权为 `synthesis_only`:

```console
$ grep -rn "synthesis_only" web/src
web/src/answers.ts:10:export type ConsentLevel = 'quotable' | 'synthesis_only';
web/src/answers.ts:42:    consentLevel: 'synthesis_only',        # emptyDraft() 的默认值
web/src/answers.ts:77:    consentLevel: raw.consentLevel === 'quotable' ? 'quotable' : 'synthesis_only',
web/src/views/InterviewView.vue:301:        :class="{ active: draft.consentLevel === 'synthesis_only' }"
web/src/views/InterviewView.vue:302:        @click="chooseConsent('synthesis_only')"
```

显式跳过按钮存在(不是留空糊弄):

```console
$ grep -n "skipFront\|当面我不会说" web/src/interview.ts web/src/views/InterviewView.vue
web/src/interview.ts:71:export function skipFront(draft: InterviewDraft, qid: string): InterviewDraft {
web/src/views/InterviewView.vue:271:          当面我不会说
```

`skipFront` 把 `frontSkipped` 记为 `true`(而不是留一个空字符串);`canContinue()` 要求
`behindText` 有内容 **且**(front 有文字 **或** 显式跳过),提交时跳过的 frontText 直接不出现在 payload 里。
单测:`web/test/interview.test.ts` 的 *does not advance on a blank front* 与
*records the skip explicitly and lets typing undo it*。

## 6. 自动化结果

```console
$ npm test
 Test Files  11 passed (11)
      Tests  60 passed (60)      # W1+W2a 既有 40 + W2b 新增 20(web 18、server 2)

$ npm run typecheck
(exit 0)
$ npm run build -w @openmimic/web
✓ built
```
