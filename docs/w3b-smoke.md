# W3b 冒烟记录:房间 UI 与推门(web/)

> 2026-10-05 · 命令均在 `/home/liuce/code/openmimic` 执行,全部在 `127.0.0.1` 本机,
> **未配置任何 LLM key**,零真实网络。前端为 `web/dist` 构建产物,由同一进程静态托管。

## 0. 构建与起服(无 key,自动 seed 演示数据)

```console
$ npm run build -w @openmimic/web
dist/assets/index-D9icvKA5.css   10.67 kB │ gzip: 2.89 kB
dist/assets/room-BVlmg_Ps.js      2.77 kB │ gzip: 1.21 kB
dist/assets/RoomView-DZVQlvz0.js  7.35 kB │ gzip: 3.08 kB
✓ built in 565ms

$ rm -f data/openmimic.db*
$ PORT=7899 npx tsx server/src/main.ts
openmimic collection API listening on http://127.0.0.1:7899
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7899/api/health
200
```

服务端这一批**未改动**:W3a 的 `GET /api/subjects/:id/rooms`、`GET /api/rooms/:id`、
`POST /api/rooms/:id/door` 原样使用;新增的路由全部在 `web/src/router.ts`。

## 1. 首页演示入口 → 直接进林默的房间

`/` 顶部卡片「先看看别人的房间 / 林默，28 岁，刚裸辞。六个认识他的人正在聊他。」点击后
`enterDemoRoom()` 先查演示 subject 的房间:

```console
$ curl -s -o rooms.json -w 'HTTP %{http_code} bytes=%{size_download}\n' \
    http://127.0.0.1:7899/api/subjects/limo/rooms
HTTP 200 bytes=4756
rooms: 1 | id: room-limo-1 | status: door_opened
behind: 12 front: 10
first behind: 发小 - 他啊,表面上什么都好。上个月半夜给我打电话借两万 ...
speakers: ['前上司', '前下属', '前任', '发小', '母亲', '网友']
```

拿到 `room-limo-1` 后 `router.push('/room/room-limo-1?name=林默')`。`?name=` 是链接自带
的显示名(房间接口只返回 `subjectId`);没有 query 时回退到 localStorage 里发起人建 subject
时记下的名字,再不行显示「TA」——不会出现空句。硬刷新由 SPA 回退兜底:

```console
$ curl -s -o index.html -w 'GET /room/room-limo-1 HTTP %{http_code} content-type=%{content_type}\n' \
    http://127.0.0.1:7899/room/room-limo-1
GET /room/room-limo-1 HTTP 200 content-type=text/html; charset=utf-8
```

页面挂载后拉房间本体:

```console
$ curl -s -o room.json -w 'HTTP %{http_code} bytes=%{size_download}\n' \
    http://127.0.0.1:7899/api/rooms/room-limo-1
HTTP 200 bytes=4744
id: room-limo-1 subject: limo status: door_opened
behind lines: 12 | kinds: ['speech']
```

## 2. 背后模式:逐条浮现(进入即此)

顶部固定一行 `他们在聊 林默。林默 不在场。`(`behindHeadline`)。转写**不一次铺开**:
`ReplayScheduler` 每 `1200 + (index*350 mod 800)` 毫秒放出一条(区间 `[1200, 2000)`),
放之前先显示该说话人的打字指示;12 条走完约 18 秒。底部「跳到结尾」立即铺满并取消计时器。
演示房间 `status` 已是 `door_opened`,但页面**仍从背后模式开始**——推门是这里的动作,不是
数据状态的回显。这些规则全部在 `web/src/room.ts`,由 `web/test/room.test.ts` 定时器断言。

## 3. 推门:纯 CSS 门 + 唯一按钮

回放结束后屏幕下方浮出唯一按钮「推门进去」。点击后:

1. `pushDoor()` 先过状态机 `beginDoor`(`behind → opening`,计数 +1);CSS 门板从左右边缘
   合拢(`DOOR_CLOSE_MS = 460ms`),文案「所有人都听到了脚步声…」在门合上后浮出;
2. 与动画并行发 `POST /api/rooms/:id/door`,等待期内门保持合拢(真 LLM 下可能数秒);
3. 请求返回后门板向内打开(`DOOR_OPEN_MS = 520ms`,总过场 980ms ≤ 1.2s),转入当面模式。
   请求失败则 `doorFailed` 退回 `behind`,按钮可重试。

```console
$ curl -s -o door.json -w 'HTTP %{http_code} bytes=%{size_download}\n' \
    -X POST http://127.0.0.1:7899/api/rooms/room-limo-1/door
HTTP 200 bytes=4744
status: door_opened behind: 12 front: 10
front speakers: ['前上司', '前下属', '前任', '发小', '母亲', '网友']
stage-only: [('前任', '低头喝了口水'), ('网友', '笑了笑,把话题接给了别人')]

$ curl -s -o door2.json -w 'HTTP %{http_code}\n' -X POST http://127.0.0.1:7899/api/rooms/room-limo-1/door
HTTP 200
$ cmp -s door.json door2.json && echo 'identical payload: yes'
identical payload: yes
```

第二次推门在客户端就被状态机挡住(`canPushDoor` 只在 `behind` 为真,`beginDoor` 在其它阶段
原样返回),不会重复发请求;即便发了,服务端 door 也是幂等的(W3a 已有断言)。

## 4. 当面模式 → 对照双栏

进入 `front` 后用同一 `ReplayScheduler` 逐条回放 `frontTranscript`(10 条),顶部换成
`林默 推门进来了。还是这群人。`。当面回放结束后出现「对照」按钮 → `showContrast`
(`front → contrast`),左右双栏并排两份转写;窄屏( `<46rem` )自动上下堆叠。

配对规则 `buildPairs`(同 `witnessId` 配对,`kind: 'stage'` 永不配对):hover/点击任一句,
两栏里同一位说话人的**台词**互相高亮,其余台词压暗。真实数据下的配对表:

```text
w-faxiao        behind speech=2 front speech=2
w-boss          behind speech=2 front speech=2
w-ex            behind speech=2 front speech=0   # 当面只有「低头喝了口水」
w-mother        behind speech=2 front speech=2
w-subordinate   behind speech=2 front speech=2
w-netizen       behind speech=2 front speech=0   # 当面只有「笑了笑,把话题接给了别人」
stage behind: 0  stage front: 2
```

「这位当面对你无话可说」本身就是对照视图要传达的信息。房间页不出现任何证言原文入口
(`RoomView.vue` 只渲染房间自带的台词),证据链是后续周的事。

## 5. 无 key 的边界(沿用 W3a 行为)

```console
$ curl -s -w ' HTTP %{http_code}\n' -X POST .../api/subjects/$SID/rooms -d '{}'
{"error":{"code":"llm_unavailable","message":"服务器未配置语言模型"}} HTTP 501
$ curl -s -w ' HTTP %{http_code}\n' -X POST .../api/subjects/limo/rooms -d '{"topicSeed":"他是不是想自杀"}'
{"error":{"code":"room_refused","message":"话题种子包含危机词面「自杀」,拒绝开房"}} HTTP 422
```

发起人自己的 subject 在进度 ≥3 份时出现「开一间房」;无 key 时 POST 返回 501,前端把按钮
置灰并注明「需要配置模型：服务器还没有语言模型，暂时开不了新房间。」。房间列表按
`createdAt` 倒序渲染,点进去同样带 `?name=`。

## 6. prefers-reduced-motion 降级路径(grep 位置)

```console
$ grep -rn "prefers-reduced-motion" web/src
web/src/styles.css:140:@media (prefers-reduced-motion: reduce) {
web/src/styles.css:408:@media (prefers-reduced-motion: reduce) {
web/src/views/RoomView.vue:36: *   the panels move; `prefers-reduced-motion` turns that into a fade (styles.css).
web/src/views/RoomView.vue:125:    window.matchMedia('(prefers-reduced-motion: reduce)').matches
```

`styles.css:140` 是 W2b 既有的访谈正面问题降级;`styles.css:408` 是本批新增:门板取消
`transform` 位移、退化为纯透明度淡入淡出(关门变淡黑、开门再淡出),气泡入场动画与打字点
动画一并关闭;`RoomView.vue:125` 同时把自动滚动切成 `behavior: 'auto'` 并把门过场缩短为
240ms + 260ms。降级只改观感,不改状态机与请求。

## 7. 自动化结果

```console
$ npm run typecheck
(exit 0)

$ npm test
 Test Files  14 passed (14)
      Tests  98 passed (98)     # 既有 83 零回归 + W3b 新增 15

$ npm run build -w @openmimic/web
✓ built in 565ms
```

新增 15 条用例全在 `web/test/room.test.ts`,覆盖任务书点名的三块:

- **回放调度器**:节拍落在 1.2–2s 且确定性;逐条放出、条间带 `typing`;`skip()` 一次铺满且
  不再有任何定时器回调;`stop()` 停表;空转写视为已完成;两句固定文案逐字断言;
- **door 状态机**:`behind → opening → front → contrast`(并能 `hideContrast` 回到 `front`);
  二次推门 `doorCalls` 不增长、相位不变;失败回退后允许重试;乱序转移被忽略;
- **对照配对**:同 `witnessId` 跨两份转写配对、`stage` 不计入;`pairingKey`/`isLinked` 对
  stage 返回空;每位证人 tone 稳定且落在调色板内。
- 另含 subject 名缓存回退(`?name` → localStorage → `TA`)与房间 API 客户端的 URL/动词/解包断言。

## 8. 验收锚点

- [x] `npm run typecheck && npm test` 全绿(98 passed),`npm run build -w @openmimic/web` 成功;
- [x] 无 key 起服,首页演示卡片 → 林默房间 → 回放 → 推门 → 当面 → 对照全链路可用,各步
      HTTP 往来见第 1–4 节;
- [x] `prefers-reduced-motion` 降级存在,grep 位置见第 6 节;
- [x] 零新增依赖(`package.json` / `package-lock.json` 未动;门与回放无 three.js、无动画库,
      样式全在 `styles.css`);kernel 触发器与 README·LICENSE·NOTICE 未动。

清理:冒烟后 `rm -f data/openmimic.db*`,`git status` 只含本批改动的源码文件;`data/*.db`
与 `web/dist` 本就在 `.gitignore` 内。
