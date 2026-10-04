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
## Run 4

Date: 2026-10-04T23:45:27.366Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 7 |
| extrapolate | 5 |
| extrapolate ratio | 42% |
| median length (chars) | 34 |
| mean length (chars) | 31 |
| p90 length (chars) | 43 |
| max length (chars) | 51 |
| secret leaks | 0 |
| reply chain rate | 50% (5/10) |
| repetition rate | 0% (0/55 pairs) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 1 |
| paraphrase | 7 |
| extrapolate | 4 |
| extrapolate ratio | 33% |
| median length (chars) | 25 |
| mean length (chars) | 29 |
| p90 length (chars) | 60 |
| max length (chars) | 60 |
| secret leaks | 0 |
| reply chain rate | 50% (4/8) |
| repetition rate | 0% (0/36 pairs) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 2 | 2 | 3% | 2% |
| w-ex | 2 | 2 | 4% | 0% |
| w-subordinate | 2 | 2 | 5% | 2% |
| w-mother | 2 | 1 | 11% | 5% |
| w-boss | 1 | 2 | 0% | 2% |

### Front frontText Anchoring

| Metric | Value |
|--------|-------|
| anchored lines | 7 |
| total front speeches | 9 |
| anchor rate | 78% |

### Half-truth Check

| Metric | Value |
|--------|-------|
| half-truth count | 0 (target: exactly 1) |
| heavy echo count | 0 (target: 0) |
| pass | NO |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 42% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 34 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | PASS | 50% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |
| front-repetition | PASS | 0% (target <=10%) |
| front-text-anchoring | PASS | 78% (target >=40%) |
| front-half-truth | FAIL | half-truths=0, heavy-echoes=0 (target: 1 half-truth, 0 heavy) |
| behind-front-overlap | PASS | 5% avg (target <=50%) |
| front-evaluative-ratio | PASS | 2% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，约他吃饭老说忙。上回我抢着买单他还跟我急，这人就这样，死要面子。" [anchors: q1]
  - [paraphrase] 前任: "他对外人一向大方，这个我见过。就是那种……对谁都好，好得你插不进去。" [anchors: q5]
  - [paraphrase] 前下属: "大方是真的，团建老偷偷买单，自己中午就啃个八块钱饭团。" [anchors: q1]
  - [extrapolate] 母亲: "唉，这孩子从小就这样，嘴上不说，心里有数。"
  - [paraphrase] 网友（认识四年,只见过一面）: "阿姨这话我信。他网上话可多了，能陪你聊到天亮，真见面那次，一个小时没说几句，光看窗外。" [anchors: q4]
  - [extrapolate] 前上司: "嗯，他就是这样，话都憋在心里。"
  - [paraphrase] 前任: "憋在心里是真的。我们在一起三年，账AA到小数点，他给外人花钱眼都不眨。" [anchors: q1]
  - [extrapolate] 母亲: "唉，随他吧，我也管不了那么多。"
  - [paraphrase] 发小: "阿姨您别这么说，他其实心里有您。上回您住院那事，他嘴上就跟我说了句“最近有点忙”，过了一礼拜我才知道。" [anchors: q4]
  - [extrapolate] 前上司(笑了笑,把话题接给了别人)
  - [paraphrase] 前下属: "他定的那套文档模板，我们到现在还在用，新人培训都拿它当教材。人走了，东西还留着。" [anchors: q1]
  - [extrapolate] 网友（认识四年,只见过一面）: "嗯，东西留着，人倒是走得挺潇洒。"

### Front Transcript (full)

  - [paraphrase] 发小: "哟,来了啊。我刚还跟他们说呢,这屋里最抠的人到了——手机屏碎两年不换,请客的时候倒比谁都大方。" [anchors: q1]
  - [paraphrase] 前任: "你那手机屏还碎着呢？两年了吧，也不换。" [anchors: q5]
  - [paraphrase] 前下属: "默哥对我们是真大方，自己倒挺省的，我抢单从来抢不过他。" [anchors: q1]
  - [paraphrase] 母亲: "他从小就这样，给他爸买烟都挑打折的，对自己抠得很。" [anchors: q1]
  - [extrapolate] 网友（认识四年,只见过一面）(笑了笑,把话题接给了别人)
  - [paraphrase] 前上司: "你最近手头的事忙得过来吗？我这儿还给你留着位置，你要肯开口就行。" [anchors: q7]
  - [paraphrase] 前任: "他对谁都客气，对我也一样，一点没多给。" [anchors: q5]
  - [extrapolate] 母亲(低头喝了口水)
  - [quote] 发小: "他辞职那事我到现在还气，不是气他辞，是气他憋到最后一刻才说。我问他你倒是说啊，他说说了你们也帮不上。就这句，我记到现在。" [anchors: q10]
  - [paraphrase] 前上司: "……你那天要是早说一句就好了。" [anchors: q6]
  - [extrapolate] 前下属: "哎对了，楼下那家面馆换老板了，你们吃过没？"
  - [extrapolate] 网友（认识四年,只见过一面）(盯着杯子没接话)

## Run 5

Date: 2026-10-04T23:47:24.564Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 1 |
| paraphrase | 5 |
| extrapolate | 6 |
| extrapolate ratio | 50% |
| median length (chars) | 37 |
| mean length (chars) | 33 |
| p90 length (chars) | 50 |
| max length (chars) | 50 |
| secret leaks | 0 |
| reply chain rate | 38% (3/8) |
| repetition rate | 0% (0/36 pairs) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 2 |
| paraphrase | 3 |
| extrapolate | 7 |
| extrapolate ratio | 58% |
| median length (chars) | 29 |
| mean length (chars) | 33 |
| p90 length (chars) | 62 |
| max length (chars) | 62 |
| secret leaks | 0 |
| reply chain rate | 0% (0/6) |
| repetition rate | 0% (0/21 pairs) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 2 | 2 | 2% | 2% |
| w-ex | 2 | 1 | 2% | 0% |
| w-subordinate | 2 | 1 | 0% | 0% |
| w-mother | 1 | 1 | 0% | 0% |
| w-boss | 1 | 2 | 0% | 8% |

### Front frontText Anchoring

| Metric | Value |
|--------|-------|
| anchored lines | 5 |
| total front speeches | 7 |
| anchor rate | 71% |

### Half-truth Check

| Metric | Value |
|--------|-------|
| half-truth count | 1 (target: exactly 1) |
| heavy echo count | 0 (target: 0) |
| pass | YES |

- half-truth: "他走的方式，像个逃兵。" (w-boss)


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 50% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 37 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | PASS | 38% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |
| front-repetition | PASS | 0% (target <=10%) |
| front-text-anchoring | PASS | 71% (target >=40%) |
| front-half-truth | PASS | half-truths=1, heavy-echoes=0 (target: 1 half-truth, 0 heavy) |
| behind-front-overlap | PASS | 1% avg (target <=50%) |
| front-evaluative-ratio | PASS | 2% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，约他吃饭老说忙。上回我抢着买单他还跟我急，这人就这样，死要面子。" [anchors: q1]
  - [paraphrase] 前任: "他对外人一向大方，这个我见过。就是那种，跟谁都算得清，唯独跟身边人算不清。" [anchors: q1]
  - [paraphrase] 前下属: "对，他对自己是真抠。团建老偷偷买单，自己中午就啃个八块钱的饭团。" [anchors: q1]
  - [extrapolate] 母亲: "嗯，他从小就不乱花钱。"
  - [extrapolate] 网友（认识四年,只见过一面）(笑了笑,把话题接给了别人)
  - [extrapolate] 前上司: "嗯，他这人，惜才是真惜才，就是最后那一下，走得我不太服气。"
  - [paraphrase] 前任: "他走之前那阵子，我刷到他朋友圈步数一天一万多，估计又开始跑步了。这人心里有事就闷头跑，从来不跟人说。" [anchors: q1,q6]
  - [extrapolate] 母亲(低头喝了口水)
  - [paraphrase] 发小: "忙是真忙，我上礼拜约他，也说在忙。不过他那个人，忙起来就不回消息，你们别多想。" [anchors: q1,q6]
  - [extrapolate] 前上司(盯着杯子没接话)
  - [quote] 前下属: "他答应我的事没落空过。我转正前一晚他陪我改PPT改到一点，第二天还替我挡了大老板两个问题。" [anchors: q3]
  - [extrapolate] 网友（认识四年,只见过一面）: "嗯，他答应的事是真上心。"

### Front Transcript (full)

  - [quote] 发小: "哟,来了啊。我刚还跟他们说呢,这屋里最抠的人到了——手机屏碎两年不换,请客的时候眼睛都不眨一下。" [anchors: q1]
  - [extrapolate] 前任(笑了笑,把话题接给了别人)
  - [paraphrase] 前下属: "默哥,你现在那边还天天加班到那么晚吗?我上次听人说你又接了个大活儿。" [anchors: q9]
  - [paraphrase] 母亲: "你上回说忙,一个月才回来一趟,我让你注意身体,你就说知道。" [anchors: q9]
  - [extrapolate] 网友（认识四年,只见过一面）(低头喝了口水)
  - [extrapolate] 前上司: "楼下那家面馆换老板了，汤头不如以前。"
  - [paraphrase] 前任: "他这人吧，对谁都客气，客气到轮到我这儿，也一点没少。" [anchors: q5]
  - [extrapolate] 母亲(盯着杯子没接话)
  - [quote] 发小: "他辞职那事我到现在还气——不是气他辞，是气他憋到最后一刻才说。我问他你有事你说啊，他说说了你们也帮不上。就这句，我记到现在。" [anchors: q10]
  - [extrapolate] 前上司: "他走的方式，像个逃兵。"
  - [extrapolate] 前下属(换了个坐姿,看向窗外)
  - [extrapolate] 网友（认识四年,只见过一面）(打了个哈哈,说起别的事)

## Run 6

Date: 2026-10-04T23:48:11.216Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 6 |
| extrapolate | 6 |
| extrapolate ratio | 50% |
| median length (chars) | 34 |
| mean length (chars) | 31 |
| p90 length (chars) | 42 |
| max length (chars) | 52 |
| secret leaks | 0 |
| reply chain rate | 70% (7/10) |
| repetition rate | 0% (0/55 pairs) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 1 |
| paraphrase | 5 |
| extrapolate | 6 |
| extrapolate ratio | 50% |
| median length (chars) | 22 |
| mean length (chars) | 26 |
| p90 length (chars) | 48 |
| max length (chars) | 48 |
| secret leaks | 0 |
| reply chain rate | 13% (1/8) |
| repetition rate | 0% (0/36 pairs) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 2 | 1 | 1% | 2% |
| w-ex | 2 | 2 | 4% | 3% |
| w-subordinate | 1 | 2 | 0% | 4% |
| w-mother | 2 | 2 | 7% | 0% |
| w-boss | 2 | 2 | 0% | 8% |

### Front frontText Anchoring

| Metric | Value |
|--------|-------|
| anchored lines | 6 |
| total front speeches | 9 |
| anchor rate | 67% |

### Half-truth Check

| Metric | Value |
|--------|-------|
| half-truth count | 1 (target: exactly 1) |
| heavy echo count | 0 (target: 0) |
| pass | YES |

- half-truth: "他走的方式，像个逃兵。" (w-boss)


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 50% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 34 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | PASS | 70% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |
| front-repetition | PASS | 0% (target <=10%) |
| front-text-anchoring | PASS | 67% (target >=40%) |
| front-half-truth | PASS | half-truths=1, heavy-echoes=0 (target: 1 half-truth, 0 heavy) |
| behind-front-overlap | PASS | 3% avg (target <=50%) |
| front-evaluative-ratio | PASS | 3% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，约他吃饭老说忙。上回我抢着买单他还跟我急，这人就这样，死要面子。" [anchors: q1]
  - [paraphrase] 前任: "他对外人一向大方，这个我见过。就是那种……对谁都好，好得你插不进去。" [anchors: q5]
  - [paraphrase] 前下属: "大方是真的。团建他老偷偷买单，我撞见过一次，他说你一个应届生跟我抢什么。结果他自己中午就啃八块钱的饭团。" [anchors: q1]
  - [extrapolate] 母亲: "唉，这孩子从小就这样，嘴上不说，心里装着事。"
  - [paraphrase] 网友（认识四年,只见过一面）: "阿姨这话我信。他网上话可多了，能陪你聊到天亮，真见面那次，一个小时没几句，光看窗外。" [anchors: q4]
  - [extrapolate] 前上司: "嗯，他就是这样，话都憋在心里。"
  - [paraphrase] 前任: "憋在心里是真的。我们在一起三年，账AA到小数点，他给外人花钱眼都不眨。" [anchors: q1]
  - [extrapolate] 母亲: "唉，随他吧，我也管不了那么多。"
  - [paraphrase] 发小: "阿姨您别这么说，他其实心里有数。就是……他最近是真忙，我约他两回都没约出来。" [anchors: q1]
  - [extrapolate] 前上司: "忙是真忙，不过他那个人，忙起来连自己都顾不上。"
  - [extrapolate] 前下属(笑了笑,把话题接给了别人)
  - [extrapolate] 网友（认识四年,只见过一面）: "嗯，他就那样，看着挺自由，其实……算了，不说了。"

### Front Transcript (full)

  - [quote] 发小: "哟,来了啊。我刚还跟他们说呢,这屋里最抠的人到了——手机屏碎两年不换,请客的时候眼睛都不眨一下。" [anchors: q1]
  - [extrapolate] 前任: "这剧我追到一半弃了,男主太磨叽。"
  - [paraphrase] 前下属: "默哥，你还记得我转正那回不？材料我整不明白，你陪我改到快十点，最后还请我吃了碗面。" [anchors: q3]
  - [paraphrase] 母亲: "你上个月回来那趟，我看你脸都瘦了，是不是又没好好吃饭？" [anchors: q9]
  - [extrapolate] 网友（认识四年,只见过一面）(笑了笑,把话题接给了别人)
  - [paraphrase] 前上司: "你最近手头的事忙得过来吗？我这儿还给你留着位置，你倒是开个口啊。" [anchors: q7]
  - [paraphrase] 前任: "他对谁都客气，对我也一样客气，一点没多。" [anchors: q5]
  - [paraphrase] 母亲: "他从小就这样，对谁都客客气气的，不跟人红脸。" [anchors: q5]
  - [extrapolate] 发小(低头喝了口水)
  - [extrapolate] 前上司: "他走的方式，像个逃兵。"
  - [extrapolate] 前下属: "哎，楼下那家面馆好像换招牌了，你们看见没？"
  - [extrapolate] 网友（认识四年,只见过一面）(盯着杯子没接话)

## Run 7

Date: 2026-10-04T23:48:46.199Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 1 |
| paraphrase | 6 |
| extrapolate | 5 |
| extrapolate ratio | 42% |
| median length (chars) | 34 |
| mean length (chars) | 31 |
| p90 length (chars) | 53 |
| max length (chars) | 55 |
| secret leaks | 0 |
| reply chain rate | 40% (4/10) |
| repetition rate | 0% (0/55 pairs) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 1 |
| paraphrase | 7 |
| extrapolate | 4 |
| extrapolate ratio | 33% |
| median length (chars) | 21 |
| mean length (chars) | 28 |
| p90 length (chars) | 63 |
| max length (chars) | 63 |
| secret leaks | 0 |
| reply chain rate | 0% (0/8) |
| repetition rate | 0% (0/36 pairs) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 2 | 2 | 2% | 1% |
| w-ex | 2 | 2 | 5% | 2% |
| w-subordinate | 2 | 2 | 0% | 0% |
| w-mother | 2 | 1 | 0% | 0% |
| w-boss | 1 | 2 | 0% | 5% |

### Front frontText Anchoring

| Metric | Value |
|--------|-------|
| anchored lines | 7 |
| total front speeches | 9 |
| anchor rate | 78% |

### Half-truth Check

| Metric | Value |
|--------|-------|
| half-truth count | 2 (target: exactly 1) |
| heavy echo count | 0 (target: 0) |
| pass | NO |

- half-truth: "你爸住院那回，你瘦了一圈，我看着都心疼。" (w-mother)
- half-truth: "他走的方式，像个逃兵。" (w-boss)


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 42% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 34 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | PASS | 40% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |
| front-repetition | PASS | 0% (target <=10%) |
| front-text-anchoring | PASS | 78% (target >=40%) |
| front-half-truth | FAIL | half-truths=2, heavy-echoes=0 (target: 1 half-truth, 0 heavy) |
| behind-front-overlap | PASS | 1% avg (target <=50%) |
| front-evaluative-ratio | PASS | 2% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，约他吃饭老说忙。上回我抢着买单他还跟我急，这人就这样，死要面子。" [anchors: q1]
  - [paraphrase] 前任: "他对外人一向大方，这个我见过。就是那种……对谁都好，好得你插不进去。" [anchors: q5]
  - [paraphrase] 前下属: "大方是真的。团建他老偷偷把单买了，我说哥这不行，他说你一个应届生跟我抢什么。结果他自己中午就啃个八块钱的饭团。" [anchors: q1]
  - [extrapolate] 母亲: "嗯，他就那样，嘴上不说，心里有数。"
  - [paraphrase] 网友（认识四年,只见过一面）: "阿姨这句我信。他给我寄过东西，我生日人没到，蛋糕到了。" [anchors: q1]
  - [extrapolate] 前上司: "嗯，蛋糕这事像他。"
  - [paraphrase] 前任: "像他。对谁都周到，就是回家一句话没有。我跟他那三年，他一天说不了十句。" [anchors: q4]
  - [extrapolate] 母亲: "唉，随他吧，男孩子大了都这样。"
  - [paraphrase] 发小: "阿姨您别这么说，他哪是随谁，他就是什么都自己扛。上回我约他吃饭，推了，说忙——我后来才知道那阵子他手头紧。" [anchors: q1]
  - [extrapolate] 前上司(笑了笑,把话题接给了别人)
  - [quote] 前下属: "他答应我的事没落空过。我转正答辩前一晚，他陪我改PPT改到一点，第二天还替我挡了大老板两个问题。" [anchors: q3]
  - [extrapolate] 网友（认识四年,只见过一面）: "嗯，他答应的事是真上心。"

### Front Transcript (full)

  - [paraphrase] 发小: "你那破手机屏还碎着呢？上回说换，又没换吧。" [anchors: q1]
  - [paraphrase] 前任: "哟，林默，还是那副对谁都客客气气的样子啊，连我这儿都没打个折。" [anchors: q5]
  - [paraphrase] 前下属: "默哥，你上次说腰不舒服，后来去看了没？" [anchors: q9]
  - [paraphrase] 母亲: "你爸住院那回，你瘦了一圈，我看着都心疼。" [anchors: q7]
  - [extrapolate] 网友（认识四年,只见过一面）(笑了笑,把话题接给了别人)
  - [paraphrase] 前上司: "这天儿一冷，我就想起去年那会儿，他非把外套塞给新来的小孩，自己冻得直搓手。" [anchors: q1]
  - [paraphrase] 前任: "他人是挺好的，对谁都客气——就是这份客气，到我这儿也一点没打折。" [anchors: q5]
  - [extrapolate] 母亲(低头喝了口水)
  - [quote] 发小: "他辞职那事我到现在还气，不是气他辞，是气他憋到最后一刻才说。我问他你有事你说啊，他来一句说了你们也帮不上。就这句，我记到现在。" [anchors: q10]
  - [paraphrase] 前上司: "他走的方式，像个逃兵。" [anchors: q6]
  - [extrapolate] 前下属: "哎，这茶凉了，我再去续一壶吧？"
  - [extrapolate] 网友（认识四年,只见过一面）(盯着杯子没接话)

## Run 7

Date: 2026-10-04T23:49:55.951Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 7 |
| extrapolate | 5 |
| extrapolate ratio | 42% |
| median length (chars) | 34 |
| mean length (chars) | 32 |
| p90 length (chars) | 51 |
| max length (chars) | 54 |
| secret leaks | 0 |
| reply chain rate | 55% (6/11) |
| repetition rate | 0% (0/66 pairs) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 7 |
| extrapolate | 5 |
| extrapolate ratio | 42% |
| median length (chars) | 30 |
| mean length (chars) | 32 |
| p90 length (chars) | 56 |
| max length (chars) | 56 |
| secret leaks | 0 |
| reply chain rate | 13% (1/8) |
| repetition rate | 0% (0/36 pairs) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 2 | 2 | 2% | 1% |
| w-ex | 2 | 1 | 5% | 0% |
| w-subordinate | 2 | 2 | 0% | 1% |
| w-mother | 2 | 2 | 12% | 0% |
| w-boss | 2 | 2 | 0% | 5% |

### Front frontText Anchoring

| Metric | Value |
|--------|-------|
| anchored lines | 7 |
| total front speeches | 9 |
| anchor rate | 78% |

### Half-truth Check

| Metric | Value |
|--------|-------|
| half-truth count | 2 (target: exactly 1) |
| heavy echo count | 0 (target: 0) |
| pass | NO |

- half-truth: "他爸住院那回，他瘦了一圈，有事他一定到。" (w-mother)
- half-truth: "他走那天，像个逃兵。" (w-boss)


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 42% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 34 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | PASS | 55% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |
| front-repetition | PASS | 0% (target <=10%) |
| front-text-anchoring | PASS | 78% (target >=40%) |
| front-half-truth | FAIL | half-truths=2, heavy-echoes=0 (target: 1 half-truth, 0 heavy) |
| behind-front-overlap | PASS | 4% avg (target <=50%) |
| front-evaluative-ratio | PASS | 2% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，约他吃饭老说忙。上回我抢着买单他还跟我急，这人就这样，死要面子。" [anchors: q1]
  - [paraphrase] 前任: "他对外人一向大方，这个我见过。就是那种……对谁都好，好得你插不进去。" [anchors: q5]
  - [paraphrase] 前下属: "大方是真的。团建他老偷偷买单，我撞见过一次，他说你一个应届生跟我抢什么。可他自己中午就啃八块钱的饭团。" [anchors: q1]
  - [extrapolate] 母亲: "唉，他从小就这样，嘴上不说，心里装着事。"
  - [paraphrase] 网友（认识四年,只见过一面）: "阿姨这话我信。他跟我也是,自己的事问十句答一句,倒是我的事他记得比我还清楚。" [anchors: q8]
  - [extrapolate] 前上司: "嗯，是这样。他这人，心里装事，嘴上不吭声。"
  - [paraphrase] 前任: "心里装事是真的。我们在一起三年，账算到小数点，他给外人花钱眼都不眨。" [anchors: q1]
  - [extrapolate] 母亲: "唉，随他吧，我也管不了那么多。"
  - [paraphrase] 发小: "阿姨您别这么说，他其实心里有数。就是……上回我约他吃饭，他又说忙，我后来才知道那阵子他手头紧。这人，撑着呢。" [anchors: q1]
  - [extrapolate] 前上司: "撑是真撑。就是最后那一下，走得跟逃似的，我到现在还有意见。"
  - [paraphrase] 前下属: "走那下我也懵。他离职前一天还照常来交接，该教的都教了，一点没留。" [anchors: q10]
  - [extrapolate] 网友（认识四年,只见过一面）: "嗯，他就是这样，走也不吭声。"

### Front Transcript (full)

  - [paraphrase] 发小: "你手机屏碎成那样还不换,请客的时候倒眼都不眨——钱花人身上才叫钱是吧,这话你说过。" [anchors: q1]
  - [extrapolate] 前任(笑了笑,把话题接给了别人)
  - [paraphrase] 前下属: "默哥，你还记得我转正那回不？材料我改得乱七八糟，是你留下来陪我一条条捋的，最后还帮我跟上面说了话。" [anchors: q3]
  - [paraphrase] 母亲: "他爸住院那回，他瘦了一圈，有事他一定到。" [anchors: q7]
  - [extrapolate] 网友（认识四年,只见过一面）(低头喝了口水)
  - [paraphrase] 前上司: "哟，手机屏还碎着呢？请客眼都不眨，轮到自己就舍不得——你这毛病我早说过。" [anchors: q1]
  - [paraphrase] 前任: "他对谁都客气，对我也一样客气，一点没多。" [anchors: q5]
  - [paraphrase] 母亲: "他从小就这样，心里有事也不吭声，我问他累不累，他就说还行。" [anchors: q4]
  - [paraphrase] 发小: "阿姨这话我信，他辞职那回憋到最后一刻才告诉我，我说你有事你说啊，他来一句说了你们也帮不上——就这句，我记到现在。" [anchors: q10]
  - [extrapolate] 前上司: "他走那天，像个逃兵。"
  - [extrapolate] 前下属: "哎对了，楼下那家面馆是不是换老板了？我昨天路过看招牌都换了。"
  - [extrapolate] 网友（认识四年,只见过一面）(盯着杯子没接话)

## Run 7

Date: 2026-10-04T23:51:14.401Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 5 |
| extrapolate | 7 |
| extrapolate ratio | 58% |
| median length (chars) | 38 |
| mean length (chars) | 31 |
| p90 length (chars) | 43 |
| max length (chars) | 43 |
| secret leaks | 0 |
| reply chain rate | 50% (4/8) |
| repetition rate | 0% (0/36 pairs) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 9 |
| extrapolate | 3 |
| extrapolate ratio | 25% |
| median length (chars) | 30 |
| mean length (chars) | 32 |
| p90 length (chars) | 58 |
| max length (chars) | 58 |
| secret leaks | 0 |
| reply chain rate | 33% (3/9) |
| repetition rate | 0% (0/45 pairs) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 2 | 2 | 2% | 3% |
| w-ex | 1 | 2 | 2% | 4% |
| w-subordinate | 2 | 2 | 0% | 2% |
| w-mother | 2 | 2 | 2% | 0% |
| w-boss | 2 | 2 | 1% | 4% |

### Front frontText Anchoring

| Metric | Value |
|--------|-------|
| anchored lines | 8 |
| total front speeches | 10 |
| anchor rate | 80% |

### Half-truth Check

| Metric | Value |
|--------|-------|
| half-truth count | 1 (target: exactly 1) |
| heavy echo count | 0 (target: 0) |
| pass | YES |

- half-truth: "他走的方式，像个逃兵。" (w-boss)


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 58% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 38 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | PASS | 50% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |
| front-repetition | PASS | 0% (target <=10%) |
| front-text-anchoring | PASS | 80% (target >=40%) |
| front-half-truth | PASS | half-truths=1, heavy-echoes=0 (target: 1 half-truth, 0 heavy) |
| behind-front-overlap | PASS | 2% avg (target <=50%) |
| front-evaluative-ratio | PASS | 3% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，约他吃饭老说忙。上回我抢着买单他还跟我急，这人就这样，死要面子。" [anchors: q1]
  - [paraphrase] 前任: "他对外人是真大方，我见过他给朋友垫钱眼都不眨。跟我那三年，账算到小数点后头。" [anchors: q1]
  - [paraphrase] 前下属: "垫钱这事我信，团建他老偷偷把单买了，我说哥这不行，他说你一个应届生跟我抢什么。" [anchors: q1]
  - [extrapolate] 母亲: "嗯，他就那样，对谁都客气。"
  - [extrapolate] 网友（认识四年,只见过一面）(笑了笑,把话题接给了别人)
  - [extrapolate] 前上司: "嗯，他这人，惜才是真惜才，就是最后那一下，我到现在还有意见。"
  - [extrapolate] 前任(低头喝了口水)
  - [extrapolate] 母亲: "嗯，随他吧，我也管不了那么多。"
  - [paraphrase] 发小: "阿姨您别这么说，他其实心里有数，就是不爱讲。上礼拜我约他吃饭，他又说忙，我估计是真忙。" [anchors: q1]
  - [extrapolate] 前上司: "嗯，忙是真忙，他那个人闲不下来。"
  - [paraphrase] 前下属: "闲不下来是真的，他中午就吃个便利店饭团，八块钱那种。我给他带过两次饭，他说别惯着我。" [anchors: q1]
  - [extrapolate] 网友（认识四年,只见过一面）(盯着杯子没接话)

### Front Transcript (full)

  - [paraphrase] 发小: "你那破手机屏还碎着呢？上回说换，又没换吧。" [anchors: q1]
  - [paraphrase] 前任: "他人是挺好的，对谁都客气——就是这份客气，到我这儿也一点没少。" [anchors: q5]
  - [paraphrase] 前下属: "默哥，你那个腰还疼不疼了？上回看你贴膏药，我记着呢。" [anchors: q9]
  - [paraphrase] 母亲: "他什么事都自己扛着，我问他累不累，他就说还行。" [anchors: q4,q6]
  - [extrapolate] 网友（认识四年,只见过一面）(笑了笑,把话题接给了别人)
  - [paraphrase] 前上司: "你小子，手机屏碎成那样还舍不得换，给团队花钱倒是眼都不眨——我说你该花就花，你偏说没那个必要。" [anchors: q1]
  - [paraphrase] 前任: "他对别人的事嘴严得很，这点我认。可我们俩的事，他也一样一个字不往外说——到最后我都在等他先开口。" [anchors: q8,q10]
  - [paraphrase] 母亲: "他从小就这样，心里有事宁可自己憋着，也不肯先开口。" [anchors: q2]
  - [paraphrase] 发小: "他辞职那事我最来气，不是辞，是憋到最后一刻才跟我说。我说你有事你开口啊，他来一句说了你们也帮不上——这话我记到现在。" [anchors: q10]
  - [paraphrase] 前上司: "他走的方式，像个逃兵。" [anchors: q6]
  - [extrapolate] 前下属: "哎对了，楼下那家面馆是不是换招牌了？我昨天路过瞅着不太一样。"
  - [extrapolate] 网友（认识四年,只见过一面）(低头喝了口水)

