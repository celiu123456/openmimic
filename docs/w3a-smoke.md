# W3a 冒烟记录:房间引擎(背后 / 当面)+ 演示人格「林默」

> 2026-10-05 · 命令均在 `/home/liuce/code/openmimic` 执行,全部在 `127.0.0.1` 本机,
> **未配置任何 LLM key**,零真实网络。

## 0. 起服(无 key,自动 seed 演示数据)

```console
$ rm -f data/openmimic.db*
$ PORT=7899 npx tsx server/src/main.ts
openmimic collection API listening on http://127.0.0.1:7899
```

库里为空时自动写入「林默」演示:1 个当事人、6 位证人、6 条证言 / 60 条双栏回答、
1 场完整法庭(6 条 claims)、1 间房(背后 12 条 + 当面 10 条)。
`OPENMIMIC_SKIP_DEMO=1`(或 `startServer({skipDemo:true})`)可关闭。

## 1. 演示房间:无 key 也能拿到完整双转写

```console
$ curl -s http://127.0.0.1:7899/api/subjects/limo/rooms
{"rooms":[{"id":"room-limo-1","subjectId":"limo","topicSeed":"最近怎么看 TA",
  "status":"door_opened","behindTranscript":[ ... 12 条 ... ],
  "frontTranscript":[ ... 10 条 ... ],"createdAt":"2026-09-28T09:00:00.000Z"}]}
```

统计(脚本解析真实响应):

```console
$ curl -s http://127.0.0.1:7899/api/subjects/limo/rooms | python3 - <<'PY'
...
PY
rooms: 1
id: room-limo-1 status: door_opened behind: 12 front: 10
```

`POST /api/subjects/limo/rooms` 走同一份预生成数据(201):

```console
HTTP 201
{"id":"room-limo-1", ... "behindTranscript":[{... "displayLabel":"发小",
 "text":"他啊,表面上什么都好。上个月半夜给我打电话借两万,还让我别跟他妈说——这事你们谁都不知道吧?"...}]}
```

## 2. 推门(`POST /api/rooms/:id/door`):返回当面转写,二次调用幂等

```console
$ curl -s -o /tmp/door.json -w 'HTTP %{http_code} bytes=%{size_download}\n' \
    -X POST http://127.0.0.1:7899/api/rooms/room-limo-1/door
HTTP 200 bytes=4744

$ python3 - <<'PY'
import json
r = json.load(open('/tmp/door.json'))
print('status:', r['status'], 'behind:', len(r['behindTranscript']), 'front:', len(r['frontTranscript']))
print('behind 视角:', sorted({u['displayLabel'] for u in r['behindTranscript']}))
print('当面只出舞台提示:', [u['displayLabel'] for u in r['frontTranscript'] if u['kind'] == 'stage'])
PY
status: door_opened behind: 12 front: 10
behind 视角: ['前上司', '前下属', '前任', '发小', '母亲', '网友']
当面只出舞台提示: ['前任', '网友']
```

网友 10 题全部没有 `frontText`,所以当面一条观点都不代笔,只从写死在代码里的
6 条固定舞台提示里挑(`engines/room/src/room.ts` 的 `FIXED_STAGE_LINES`);前任当面也用
"低头喝了口水"接住。第二次 `POST door` 直接返回同一 room,不产生任何 LLM 调用
(自动化测试 `door is idempotent` 断言调用数不增长)。

## 3. 无 key 的边界:非演示 subject 501、危机话题 422

```console
$ SID=$(curl -s -X POST .../api/subjects -d '{"displayName":"临时对象"}' | ...)
$ curl -s -w ' HTTP %{http_code}\n' -X POST \
    http://127.0.0.1:7899/api/subjects/$SID/rooms -d '{}'
{"error":{"code":"llm_unavailable","message":"服务器未配置语言模型"}} HTTP 501

$ curl -s -w ' HTTP %{http_code}\n' -X POST \
    http://127.0.0.1:7899/api/subjects/limo/rooms -d '{"topicSeed":"他是不是想自杀"}'
{"error":{"code":"room_refused","message":"话题种子包含危机词面「自杀」,拒绝开房"}} HTTP 422
```

非演示 subject 也需要推门时会同样得到 501;未知房间/当事人分别是 404
`room_not_found` / `subject_not_found`。危机词在**任何**模型调用之前拦截。

## 4. 数据质检自评:六份证言的矛盾点(≥4 组)

同一批 10 道题,六个视角互相打架的地方是产品本身的信号。逐条列出可核对的原文冲突:

1. **稳重 vs 撑不住**:母亲说"他从小就稳重、上个月还说公司器重他要升职";前上司说
   "他是撑到不能再撑才走的,但他走的方式像个逃兵";发小补上辞职当晚的原话
   "每天早上醒来,一想到要去那个楼里,胃就疼"。母亲根本不知道他裸辞。
2. **大方 vs 算得清**:发小"跟我吃饭从来没让我买过单"、下属"默哥老是偷偷买单";
   前任"我们 AA 精确到小数点,看电影他买票我买爆米花";而发小同时揭出他上个月
   半夜借了两万——对外慷慨与对外借债并存。
3. **顾人 vs 不说话**:母亲/发小说他"话多、会照顾人、什么事都自己扛";前任说
   "最长冷战十九天,我哭我的,他抽他的烟,最后进来问我一句吃饭了"。
4. **自由浪漫 vs 焦虑失眠**:网友说他"白天朋友圈岁月静好,半夜聊想开小店、去云南";
   前任说他"整宿整宿失眠,凌晨三四点刷手机";下属说他发过凌晨三点的空马路照片。
5. **人缘好 vs 其实很独**:母亲说"街坊都羡慕,养了个孝顺儿子、朋友多";下属说他
   "嘴严到我怀疑他是不是没朋友";网友是他唯一深夜倾诉对象,而两人只见过一面。
6. **情绪稳定 vs 会发火**:母亲说"他脾气好,随他爸,从来不跟我顶嘴";前上司说他在会上
   当着一把手的面说"这个需求是拍脑袋定的";下属说"原来生气可以这么安静"。法庭据此
   把「林默情绪稳定、很少发火」判为 `retired`(置信 0.00)。

背后/当面的反差按同一口径控制:背后 12 条敢说借钱、失眠、冷战;当面 10 条只重复
各人 `frontText` 里写过的说法,没写当面说法的人只给舞台提示。不夸张——前任当面依然
只喝水,网友当面只打圆场,母亲当面还是那两句唠叨。

法庭数字自洽:6 条 claim → surviving(无 qualifier)3、qualified 2、rejected 1,
challenge 事件 6(每条 claim 都被质询过一次,存活的带 0.80 / 限定的 0.65),
evidenceCoverage 1.0(见 `fixtures/limo.ts` 的 `demoCourtReport`)。

## 5. 自动化结果

```console
$ npm run typecheck
(exit 0)

$ npm test
 Test Files  13 passed (13)
      Tests  83 passed (83)     # 既有 60 零回归 + W3a 新增 23
```

新增用例分布:`engines/room/test/room.test.ts` 16 条(背后隔离/上限、consent 改写与
stage 兜底、诊断词改写与 stage 兜底、解析失败跳过、推门 skipFront/幂等/只用 front、
插件注册、Store rooms)、`server/test/rooms.test.ts` 7 条(自动 seed 幂等、无 key 双转写、
非演示 501、危机 422、404、注入 FakeLLM 的 behind+door、skipDemo)。

## 6. 验收锚点

- [x] `npm run typecheck && npm test` 全绿(83 passed);
- [x] 无 key 起服,curl 林默的房间与推门接口拿到完整双转写(背后 12 / 当面 10);
- [x] 林默六证人 60 条双栏证言 + 两份转写全量入库可读;矛盾点 6 组见第 4 节;
- [x] 零新依赖(`package-lock.json` 仅新增 workspaces 链接)、kernel 触发器未动。

清理:冒烟后 `rm -f data/openmimic.db*`,`git status` 保持干净;`data/*.db` 本就在
`.gitignore` 内。
