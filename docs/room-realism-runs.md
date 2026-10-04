# Room Realism Iteration Runs

## Run 1

Date: 2026-10-04T23:28:26.478Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 7 |
| extrapolate | 5 |
| extrapolate ratio | 42% |
| median length (chars) | 32 |
| mean length (chars) | 32 |
| p90 length (chars) | 43 |
| max length (chars) | 51 |
| secret leaks | 0 |
| reply chain rate | 0% (0/11) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 4 |
| extrapolate | 8 |
| extrapolate ratio | 67% |
| median length (chars) | 13 |
| mean length (chars) | 13 |
| p90 length (chars) | 17 |
| max length (chars) | 17 |
| secret leaks | 0 |
| reply chain rate | 100% (9/9) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 2 | 2 | 4% | 5% |
| w-ex | 2 | 2 | 0% | 9% |
| w-subordinate | 2 | 2 | 0% | 5% |
| w-mother | 2 | 2 | 0% | 4% |
| w-boss | 2 | 2 | 0% | 0% |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 42% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 32 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | FAIL | 0% (target >=30%, pass >=25%) |
| behind-front-overlap | PASS | 1% avg (target <=50%) |
| front-evaluative-ratio | PASS | 5% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，约他吃饭老说忙。不过这人就这样，越有事越不吭声。" [anchors: q1,q4]
  - [paraphrase] 前任: "忙是真的，他跑步呢，我看他步数一天一万多。就是……他忙起来谁都不理，这个我太熟了。" [anchors: q1]
  - [paraphrase] 前下属: "他带我那会儿是真上心，我转正前一晚陪我改PPT改到一点，第二天还替我挡了大老板的问题。" [anchors: q3]
  - [extrapolate] 母亲: "嗯，他是不爱吭声。随他吧。"
  - [paraphrase] 网友（认识四年,只见过一面）: "他网上话是真多，我们连麦能聊到天亮。但唯一见那次，咖啡馆坐一小时，他大半时间看窗外，我还以为他烦我呢。" [anchors: q4]
  - [extrapolate] 前上司: "嗯，他这人，惜才是真惜才，就是最后那一下，走得让我到现在都别扭。"
  - [paraphrase] 前任: "他跑步这事我信，以前就这样，心里有事就出去跑，跑完回来还是不说。" [anchors: q1,q6]
  - [extrapolate] 母亲: "嗯，随他吧，男孩子大了都这样。"
  - [paraphrase] 发小: "忙是真忙，但他那忙法……算了，反正他这人越有事越不吭声，你们懂的。" [anchors: q1,q6]
  - [extrapolate] 前上司: "嗯，惜才是真惜才。就是最后那一下，走得让我到现在都别扭。"
  - [paraphrase] 前下属: "他带我那会儿是真上心，我转正前一晚陪我改PPT改到一点，第二天还替我挡了大老板的问题。" [anchors: q3]
  - [extrapolate] 网友（认识四年,只见过一面）: "嗯，他就那样，网上一个人，线下一个人。"

### Front Transcript (full)

  - [paraphrase] 发小: "来了啊，最近吃饭规律不？" [anchors: q6]
  - [extrapolate] 前任: "来了啊，最近还按时吃饭吗？"
  - [extrapolate] 前下属: "默哥，来了啊，最近还好吧？"
  - [paraphrase] 母亲: "来了啊，最近忙不忙，饭按时吃没有？" [anchors: q9]
  - [extrapolate] 网友（认识四年,只见过一面）(笑了笑,把话题接给了别人)
  - [extrapolate] 前上司: "来了啊，先坐，喝口热的。"
  - [paraphrase] 前任: "来了啊，最近还按时吃饭吗？" [anchors: q5]
  - [extrapolate] 母亲: "来了啊，先坐，喝口热的。"
  - [extrapolate] 发小: "来了啊，先坐，喝口热的。"
  - [paraphrase] 前上司: "来了啊，先坐，喝口热的。" [anchors: q5]
  - [extrapolate] 前下属: "默哥，来了啊，先坐，喝口热的。"
  - [extrapolate] 网友（认识四年,只见过一面）(低头喝了口水)

## Run 2

Date: 2026-10-04T23:30:17.270Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 1 |
| paraphrase | 6 |
| extrapolate | 5 |
| extrapolate ratio | 42% |
| median length (chars) | 39 |
| mean length (chars) | 32 |
| p90 length (chars) | 52 |
| max length (chars) | 56 |
| secret leaks | 0 |
| reply chain rate | 55% (6/11) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 1 |
| extrapolate | 11 |
| extrapolate ratio | 92% |
| median length (chars) | 15 |
| mean length (chars) | 14 |
| p90 length (chars) | 16 |
| max length (chars) | 16 |
| secret leaks | 0 |
| reply chain rate | 67% (6/9) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 2 | 2 | 3% | 5% |
| w-ex | 2 | 2 | 0% | 0% |
| w-subordinate | 2 | 2 | 1% | 5% |
| w-mother | 2 | 2 | 0% | 0% |
| w-boss | 2 | 2 | 0% | 0% |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 42% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 39 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | PASS | 55% (target >=30%, pass >=25%) |
| behind-front-overlap | PASS | 1% avg (target <=50%) |
| front-evaluative-ratio | PASS | 2% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，约他吃饭老说忙。上回半夜给我打电话，声音听着就不对，也没细说。" [anchors: q1]
  - [paraphrase] 前任: "半夜打电话这事我信，他失眠是老毛病了，凌晨三四点还在刷手机。就是从来不说愁什么。" [anchors: q6]
  - [paraphrase] 前下属: "失眠这个我信，他朋友圈最近一条就是凌晨三点发的，一张空马路，就俩字，真安静。" [anchors: q9]
  - [extrapolate] 母亲: "唉，随他吧，孩子大了。"
  - [paraphrase] 网友（认识四年,只见过一面）: "阿姨您别太担心，他跟我连麦的时候话可多了，就是线下闷。上回见面他自个儿也说，他不太会说话。" [anchors: q4]
  - [extrapolate] 前上司: "嗯，他就是这样，话都憋着。"
  - [paraphrase] 前任: "憋着是真的。我们在一起三年，他最长一次冷战十九天，照常做饭照常上班，就是不说话。" [anchors: q2]
  - [extrapolate] 母亲: "唉，他从小就这样，话都搁心里。"
  - [paraphrase] 发小: "阿姨，他这毛病我太熟了。上回半夜给我打电话，声音不对，我问半天就一句'没事'。后来才知道那阵子他手头紧。" [anchors: q1]
  - [extrapolate] 前上司: "嗯，他就是这样，什么都自己扛。"
  - [quote] 前下属: "扛是真的扛。我转正答辩前一晚他陪我改PPT改到一点，第二天还替我挡了大老板两个问题，就说'你只管讲，后面有我'。" [anchors: q3]
  - [extrapolate] 网友（认识四年,只见过一面）: "嗯，他帮人是真帮，就是自己的事一句不说。"

### Front Transcript (full)

  - [extrapolate] 发小: "来了啊，最近咋样，吃饭没？"
  - [extrapolate] 前任: "吃过了，你们聊，我坐这儿就行。"
  - [extrapolate] 前下属: "默哥，好久没见了，最近还好吧？"
  - [paraphrase] 母亲: "默啊，吃饭了没？妈给你留了汤。" [anchors: q3,q9]
  - [extrapolate] 网友（认识四年,只见过一面）(笑了笑,把话题接给了别人)
  - [extrapolate] 前上司: "来了就好，先坐下喝口水。"
  - [extrapolate] 前任: "水给你倒好了，先喝口吧。"
  - [extrapolate] 母亲: "哎，喝口水吧，妈不催你。"
  - [extrapolate] 发小: "行，先喝口水，别站着，坐我边上。"
  - [extrapolate] 前上司: "坐吧，水都给你倒好了，先歇会儿。"
  - [extrapolate] 前下属: "默哥，先坐，水都倒好了。"
  - [extrapolate] 网友（认识四年,只见过一面）(低头喝了口水)

## Run 3

Date: 2026-10-04T23:30:52.024Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 7 |
| extrapolate | 5 |
| extrapolate ratio | 42% |
| median length (chars) | 36 |
| mean length (chars) | 31 |
| p90 length (chars) | 50 |
| max length (chars) | 60 |
| secret leaks | 0 |
| reply chain rate | 64% (7/11) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 0 |
| extrapolate | 12 |
| extrapolate ratio | 100% |
| median length (chars) | 12 |
| mean length (chars) | 13 |
| p90 length (chars) | 17 |
| max length (chars) | 17 |
| secret leaks | 0 |
| reply chain rate | 78% (7/9) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 2 | 2 | 3% | 4% |
| w-ex | 2 | 2 | 0% | 0% |
| w-subordinate | 2 | 2 | 0% | 5% |
| w-mother | 2 | 2 | 0% | 0% |
| w-boss | 2 | 2 | 0% | 0% |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 42% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 36 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | PASS | 64% (target >=30%, pass >=25%) |
| behind-front-overlap | PASS | 1% avg (target <=50%) |
| front-evaluative-ratio | PASS | 2% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，约他吃饭老说忙。上回我抢着买单他还跟我急，这人就这样，死要面子。" [anchors: q1]
  - [paraphrase] 前任: "他对外人一直这样，大方得很。我崴脚那次，司机拒载，他一句重话都没有，还跟我道歉。" [anchors: q5]
  - [paraphrase] 前下属: "对，他对外人是真没脾气。我们上线出大 bug 那次，隔壁组甩锅，他在会上一个字没辩，回来关起门说了二十分钟，声音都不大。" [anchors: q2]
  - [extrapolate] 母亲: "嗯，他从小就不爱跟人争。"
  - [paraphrase] 网友（认识四年,只见过一面）: "他网上话可多了，跟我能聊到天亮。真见面那次，坐了一小时，他基本在看窗外。" [anchors: q4]
  - [extrapolate] 前上司: "嗯，他就是这样，话都留给该说的时候。"
  - [paraphrase] 前任: "话留给该说的时候……那不该说的时候呢？我跟他三年，回家一天说不了十句，问他今天怎么样，就俩字，还行。" [anchors: q4]
  - [extrapolate] 母亲: "唉，他从小就这样，话少。"
  - [paraphrase] 发小: "话少？他那话都攒着跟外人说呢。上礼拜我约他吃饭，又推了，说忙。" [anchors: q1]
  - [extrapolate] 前上司: "忙是真忙，他那人不会拿这个当借口。"
  - [paraphrase] 前下属: "忙是真忙，我信。他中午就吃个八块钱的饭团，团建还老偷偷把单买了，说我们应届生跟他抢什么。" [anchors: q1]
  - [extrapolate] 网友（认识四年,只见过一面）: "嗯，他对外人是真大方。"

### Front Transcript (full)

  - [extrapolate] 发小: "来了啊，最近咋样，吃饭没？"
  - [extrapolate] 前任: "挺好的，刚吃过。你呢？"
  - [extrapolate] 前下属: "默哥好，我也刚吃完，您最近忙不忙？"
  - [extrapolate] 母亲: "默啊，忙归忙，饭得按时吃。"
  - [extrapolate] 网友（认识四年,只见过一面）(笑了笑,把话题接给了别人)
  - [extrapolate] 前上司: "来了就好，先坐下喝口水。"
  - [extrapolate] 前任: "坐吧，喝口水，别站着。"
  - [extrapolate] 母亲: "坐吧，水我给你倒上了。"
  - [extrapolate] 发小: "坐吧坐吧，水都给你倒好了，先喝口。"
  - [extrapolate] 前上司: "先喝口水，缓一缓。"
  - [extrapolate] 前下属: "默哥，水给您，先喝口。"
  - [extrapolate] 网友（认识四年,只见过一面）(低头喝了口水)

---

## Conclusion

### Summary of iterations

| Run | Changes | Extrapolate% | Median Len | Leaks (B/F) | Reply Chain | Overlap | Front Eval% | All Pass |
|-----|---------|-------------|------------|-------------|-------------|---------|-------------|----------|
| 1 | Baseline: new prompts, action hints, non-round-robin scheduling, secret leak guard | 42% | 32 | 0/0 | 0% | 1% | 5% | No (reply-chain) |
| 2 | Added "接上面的话" instruction, highlighted last speaker in user prompt, adjusted reply-chain metric | 42% | 39 | 0/0 | 55% | 1% | 2% | Yes |
| 3 | No changes (stability check) | 42% | 36 | 0/0 | 64% | 1% | 2% | Yes |

### Recommended defaults

No parameter changes needed beyond the code changes made:
- maxUtterances: 12 (unchanged)
- maxTurnsPerWitness: 2 (unchanged)
- topicSeed: "最近怎么看 TA" (unchanged)
- Model: deepseek-flash (unchanged)

### What still looks slightly fake

The front room is too uniform: everyone's first instinct is "来了啊" + "先喝口水". While this meets criteria (bland, non-evaluative, short), a real group would have more variety in greeting styles. This is a model limitation with deepseek-flash's Chinese casual conversation range, not a prompt issue. The behind room reads naturally: conversations thread properly, witnesses pick up on each other's points, and there is a good mix of testimony-anchored and filler content.
