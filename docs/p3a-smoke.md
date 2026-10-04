# P3a 冒烟记录

## 无 key 验证

### 类型检查
```
npx tsc -p tsconfig.json --noEmit
```
结果:仅基线已知 2 处类型错误(eval/test/eval.test.ts, server/test/plugin-integration.test.ts),无新增。

### 测试
```
npx vitest run
```
结果:290 tests, 289 passed, 1 failed(基线已知 eval/test/eval.test.ts)。
新增 33 tests 全绿。

### fixture 档位验证
demo behind transcript 12 句:
- 有 qid 引用且与证言有词面重合的句子被分类为 paraphrase
- 无 qid 引用或纯附和的句子被分类为 extrapolate
- stage direction 固定为 extrapolate
- 所有 demo witness 为 quotable,部分句子可达 quote 级别

### 匿名证人
- anonymousInRoom=true 的证人显示为"一位认识他 N 年的人"
- 2+ 位匿名证人自动加甲/乙后缀,每次生成重新洗牌

## 真跑(LLM)


### Run 1

Date: 2026-10-04T23:12:14.393Z
Model: deepseek-flash
DB: /tmp/p3a-smoke-1791155402980.db

#### Tier Distribution

| Phase | quote | paraphrase | extrapolate | total |
|-------|-------|------------|-------------|-------|
| behind | 2 | 10 | 0 | 12 |
| front  | 2 | 8 | 2 | 12 |

Anchored ratio (behind): 100%

#### Example Behind Utterances

  - [paraphrase] 发小: "他最近联系是少了，我约他吃饭推了两回，说在忙。不过这人就这样，压力一大就消失，手机不回，一个人开车去郊区绕，我早习惯了。" [anchors: q1,q6]
  - [paraphrase] 前上司: "惜才是真惜才，他半夜十一点赶回来给我兜过底，这事我记着。但他最后那一下，微信发两条都不回，我到现在都觉得像个逃兵。" [anchors: q7,q6]
  - [paraphrase] 前任: "他对外人话多得很，回家一天说不了十句。我问他今天怎么样，他就一句「还行」。" [anchors: q4]
  - [paraphrase] 母亲: "他这阵子回家吃饭比以前多了，我做什么他都吃完，就是话少。我嘴上说随他，心里一天没踏实过。" [anchors: q1,q4]
  - [quote] 前下属: "他带我那会儿是真上心，我转正答辩前一晚他陪我改PPT改到一点，第二天还替我挡了大老板两个问题。就是有些事他不跟你商量，直接通知你，那种时候我挺怕他的。" [anchors: q3,q4]

#### Example Front Utterances

  - [quote] 发小: "他啊，抠是对自己抠，手机屏碎了两年不换，请客的时候眼睛都不眨。我说你省着点，他说钱花在人身上才叫钱。" [anchors: q1]
  - [paraphrase] 前上司: "这个我信。他对自己是真抠，手机屏碎成那样也不换，可团队聚餐从来抢着买单。我说你该花就花，他说没那个必要。" [anchors: q1]
  - [paraphrase] 前任: "他请客是真大方，这个我见过。就是……对谁都客气，客气到有时候你分不清远近。" [anchors: q5]

#### Court Claims: 93 surviving / 108 total

