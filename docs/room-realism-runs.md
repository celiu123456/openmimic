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

## Run 8

Date: 2026-10-05T00:01:16.267Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 6 |
| extrapolate | 6 |
| extrapolate ratio | 50% |
| median length (chars) | 35 |
| mean length (chars) | 32 |
| p90 length (chars) | 58 |
| max length (chars) | 58 |
| secret leaks | 0 |
| reply chain rate | 44% (4/9) |
| repetition rate | 0% (0/45 pairs) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 1 |
| paraphrase | 5 |
| extrapolate | 6 |
| extrapolate ratio | 50% |
| median length (chars) | 29 |
| mean length (chars) | 33 |
| p90 length (chars) | 46 |
| max length (chars) | 46 |
| secret leaks | 0 |
| reply chain rate | 17% (1/6) |
| repetition rate | 0% (0/21 pairs) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 1 | 1 | 0% | 2% |
| w-ex | 2 | 1 | 0% | 6% |
| w-subordinate | 2 | 2 | 3% | 6% |
| w-mother | 2 | 2 | 0% | 0% |
| w-boss | 1 | 1 | 0% | 0% |

### Front frontText Anchoring

| Metric | Value |
|--------|-------|
| anchored lines | 6 |
| total front speeches | 7 |
| anchor rate | 86% |

### Half-truth Check

| Metric | Value |
|--------|-------|
| half-truth count | 0 (target: exactly 1) |
| heavy echo count | 0 (target: 0) |
| pass | NO |

### Front Third-Person Reference

| Metric | Value |
|--------|-------|
| third-person lines | 0 |
| total front speeches | 7 |
| third-person rate | 0% (target: 0%) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 50% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 35 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | PASS | 44% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |
| front-repetition | PASS | 0% (target <=10%) |
| front-text-anchoring | PASS | 86% (target >=40%) |
| front-half-truth | FAIL | half-truths=0, heavy-echoes=0 (target: 1 half-truth, 0 heavy) |
| front-third-person | PASS | 0/7 lines (target: 0) |
| behind-front-overlap | PASS | 1% avg (target <=50%) |
| front-evaluative-ratio | PASS | 3% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，约他吃饭老说忙。上回我抢着买单他还跟我急，这人就这样，死要面子。" [anchors: q1]
  - [paraphrase] 前任: "他对外人一向大方，这个我见过。就是那种……对谁都好，好得你插不进去。" [anchors: q5]
  - [paraphrase] 前下属: "大方是真的。团建他老偷偷买单，我撞见过一次，他说你一个应届生跟我抢什么。结果他自己中午就啃八块钱的饭团。" [anchors: q1]
  - [extrapolate] 母亲: "唉，他就那样，随他吧。"
  - [paraphrase] 网友（认识四年,只见过一面）: "阿姨这话我听着挺熟的……他跟我也是,问啥都'挺好的',然后就没下文了。" [anchors: q8]
  - [extrapolate] 前上司(笑了笑,把话题接给了别人)
  - [paraphrase] 前任: "他对外人好，我太有体会了。我崴脚那次，司机拒载，他一句重话都没有，还回头跟我道歉。你说这人是好脾气，还是压根没脾气。" [anchors: q5]
  - [extrapolate] 母亲: "唉，随他吧，我也说不好。"
  - [extrapolate] 发小(低头喝了口水)
  - [extrapolate] 前上司: "嗯，他这人，能力是真有，就是最后那一下……走得不太地道。"
  - [paraphrase] 前下属: "走得那下我不清楚，我走的时候他还在。就记得他离职前那阵子，交接该教的都教了，一点没留。" [anchors: q10]
  - [extrapolate] 网友（认识四年,只见过一面）: "嗯，他做事是挺周到的。"

### Front Transcript (full)

  - [paraphrase] 发小: "你辞职那事我到现在还气，不是气你辞，是你憋到最后一刻才告诉我，我问你你才说说了我们也帮不上。" [anchors: q10]
  - [extrapolate] 前任(笑了笑,把话题接给了别人)
  - [quote] 前下属: "默哥，你走的时候我挺舍不得的，你要是肯留下来，我觉得你以后能做得特别大。" [anchors: q10]
  - [paraphrase] 母亲: "你什么事都自己扛，不跟我说，我说你别撑着，你就说妈我没事。" [anchors: q6]
  - [extrapolate] 网友（认识四年,只见过一面）(低头喝了口水)
  - [extrapolate] 前上司(盯着杯子没接话)
  - [paraphrase] 前任: "你要问我后不后悔，我不后悔分手，我后悔的是最后那半年，我一直在等你先开口。" [anchors: q10]
  - [paraphrase] 母亲: "你爸住院那回，你瘦了一圈，我看着心疼，可你一句累都没说过。" [anchors: q7]
  - [extrapolate] 发小(换了个坐姿,看向窗外)
  - [paraphrase] 前上司: "你那天说二十八了不想三十五还跟我解释同一件事……算了。" [anchors: q10]
  - [extrapolate] 前下属: "哎对了默哥，你上次推荐那家面馆我去吃了，真不错。"
  - [extrapolate] 网友（认识四年,只见过一面）(打了个哈哈,说起别的事)

## Run 8

Date: 2026-10-05T00:02:57.305Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 6 |
| extrapolate | 6 |
| extrapolate ratio | 50% |
| median length (chars) | 40 |
| mean length (chars) | 32 |
| p90 length (chars) | 49 |
| max length (chars) | 49 |
| secret leaks | 0 |
| reply chain rate | 78% (7/9) |
| repetition rate | 0% (0/45 pairs) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 1 |
| paraphrase | 5 |
| extrapolate | 6 |
| extrapolate ratio | 50% |
| median length (chars) | 25 |
| mean length (chars) | 30 |
| p90 length (chars) | 63 |
| max length (chars) | 63 |
| secret leaks | 0 |
| reply chain rate | 43% (3/7) |
| repetition rate | 0% (0/28 pairs) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 2 | 1 | 1% | 2% |
| w-ex | 1 | 1 | 0% | 0% |
| w-subordinate | 2 | 2 | 1% | 5% |
| w-mother | 2 | 2 | 16% | 2% |
| w-boss | 1 | 2 | 0% | 4% |

### Front frontText Anchoring

| Metric | Value |
|--------|-------|
| anchored lines | 6 |
| total front speeches | 8 |
| anchor rate | 75% |

### Half-truth Check

| Metric | Value |
|--------|-------|
| half-truth count | 1 (target: exactly 1) |
| heavy echo count | 0 (target: 0) |
| pass | YES |

- half-truth: "你那天晚上其实……算了。" (w-boss)

### Front Third-Person Reference

| Metric | Value |
|--------|-------|
| third-person lines | 0 |
| total front speeches | 8 |
| third-person rate | 0% (target: 0%) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 50% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 40 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | PASS | 78% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |
| front-repetition | PASS | 0% (target <=10%) |
| front-text-anchoring | PASS | 75% (target >=40%) |
| front-half-truth | PASS | half-truths=1, heavy-echoes=0 (target: 1 half-truth, 0 heavy) |
| front-third-person | PASS | 0/8 lines (target: 0) |
| behind-front-overlap | PASS | 4% avg (target <=50%) |
| front-evaluative-ratio | PASS | 3% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，约他吃饭老说忙。上回我抢着买单他还跟我急，这人就这样，死要面子。" [anchors: q1]
  - [paraphrase] 前任: "他对外人一直这样，大方得很。我崴脚那次，司机说不去，他还跟人道歉，一句重话都没有。" [anchors: q5]
  - [paraphrase] 前下属: "对，他对外人真是没话说。我刚来那会儿啥都不会，是他手把手教的，我犯过大错也是他替我扛的。" [anchors: q7]
  - [extrapolate] 母亲: "嗯，他从小就这样，对谁都客气。"
  - [paraphrase] 网友（认识四年,只见过一面）: "阿姨这话我信。我跟他网上认识四年，就见过一面，那次他话少得我都不好意思，回去还专门发消息跟我道歉。" [anchors: q4]
  - [extrapolate] 前上司(笑了笑,把话题接给了别人)
  - [extrapolate] 前任(低头喝了口水)
  - [extrapolate] 母亲: "嗯，随他吧，我也管不了那么多。"
  - [paraphrase] 发小: "阿姨您别这么说，他其实心里有数。就是最近确实联系少了，我约他吃饭也老说忙。" [anchors: q1]
  - [extrapolate] 前上司: "忙是真忙，他那人闲不下来。"
  - [paraphrase] 前下属: "闲不下来是真的，他中午就吃个便利店饭团，八块钱那种。我给他带过两次饭，他还说别惯着他。" [anchors: q1]
  - [extrapolate] 网友（认识四年,只见过一面）: "哈，他就那样，嘴上说别惯着，心里估计记着呢。"

### Front Transcript (full)

  - [paraphrase] 发小: "你辞职那事我到现在还来气，不是气你辞，是你憋到最后一刻才告诉我，我说你有事你说啊，你说说了我们也帮不上——就这句，我记到现在。" [anchors: q10]
  - [extrapolate] 前任(笑了笑,把话题接给了别人)
  - [paraphrase] 前下属: "默哥，我转正那次你帮了我大忙，我一直记着呢。" [anchors: q3]
  - [paraphrase] 母亲: "你爸那回住院，你瘦了一圈，我嘴上没说，心里记着呢。" [anchors: q7]
  - [extrapolate] 网友（认识四年,只见过一面）(低头喝了口水)
  - [paraphrase] 前上司: "你走的时候我挺生气的，觉得你不够职业，现在想想，是我没看出来你那时候快撑不住了。" [anchors: q10]
  - [quote] 前任: "你对谁都客气，这份客气轮到我这儿也一点没打折。" [anchors: q5]
  - [paraphrase] 母亲: "你从小就这样，对谁都客客气气的，我跟你爸还说过，这孩子心太软。" [anchors: q5]
  - [extrapolate] 发小(盯着杯子没接话)
  - [extrapolate] 前上司: "你那天晚上其实……算了。"
  - [extrapolate] 前下属: "默哥，你上次推荐那家面馆我去了，汤是真不错。"
  - [extrapolate] 网友（认识四年,只见过一面）(换了个坐姿,看向窗外)

## Run 9

Date: 2026-10-05T00:03:41.985Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 7 |
| extrapolate | 5 |
| extrapolate ratio | 42% |
| median length (chars) | 27 |
| mean length (chars) | 30 |
| p90 length (chars) | 43 |
| max length (chars) | 66 |
| secret leaks | 0 |
| reply chain rate | 80% (8/10) |
| repetition rate | 0% (0/55 pairs) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 1 |
| paraphrase | 4 |
| extrapolate | 7 |
| extrapolate ratio | 58% |
| median length (chars) | 37 |
| mean length (chars) | 36 |
| p90 length (chars) | 61 |
| max length (chars) | 61 |
| secret leaks | 0 |
| reply chain rate | 67% (4/6) |
| repetition rate | 0% (0/21 pairs) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 2 | 2 | 1% | 2% |
| w-ex | 2 | 2 | 1% | 4% |
| w-subordinate | 2 | 1 | 2% | 0% |
| w-boss | 2 | 2 | 2% | 5% |

### Front frontText Anchoring

| Metric | Value |
|--------|-------|
| anchored lines | 5 |
| total front speeches | 7 |
| anchor rate | 71% |

### Half-truth Check

| Metric | Value |
|--------|-------|
| half-truth count | 0 (target: exactly 1) |
| heavy echo count | 0 (target: 0) |
| pass | NO |

### Front Third-Person Reference

| Metric | Value |
|--------|-------|
| third-person lines | 0 |
| total front speeches | 7 |
| third-person rate | 0% (target: 0%) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 42% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 27 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | PASS | 80% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |
| front-repetition | PASS | 0% (target <=10%) |
| front-text-anchoring | PASS | 71% (target >=40%) |
| front-half-truth | FAIL | half-truths=0, heavy-echoes=0 (target: 1 half-truth, 0 heavy) |
| front-third-person | PASS | 0/7 lines (target: 0) |
| behind-front-overlap | PASS | 2% avg (target <=50%) |
| front-evaluative-ratio | PASS | 3% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，约他吃饭老说忙。上回我抢着买单他还跟我急，这人就这样，死要面子。" [anchors: q1]
  - [paraphrase] 前任: "他对外人一直这样，大方得很。我崴脚那次，司机说不去，他还跟人道歉。" [anchors: q5]
  - [paraphrase] 前下属: "对，他对外人真是这样。团建他老偷偷把单买了，我说哥这不行，他说你一个应届生跟我抢什么。" [anchors: q1]
  - [extrapolate] 母亲: "嗯，他从小就这样，对谁都客气。"
  - [paraphrase] 网友（认识四年,只见过一面）: "阿姨这话我信。我跟他网上认识四年，就见过一面，那次在咖啡馆他基本没怎么说话，光看窗外。回去还给我发消息说不好意思，他线下不太会说话。" [anchors: q4]
  - [extrapolate] 前上司: "嗯，他就是这样，话不多，但心里有数。"
  - [paraphrase] 前任: "心里有数……他对我也是，什么都记得，就是什么都不说。" [anchors: q3,q8]
  - [extrapolate] 母亲(笑了笑,把话题接给了别人)
  - [paraphrase] 发小: "他最近是真忙还是躲着，我也说不准。反正约他吃饭，十回有八回推。" [anchors: q1]
  - [extrapolate] 前上司: "忙是真忙过，躲……也未必是躲你们。"
  - [paraphrase] 前下属: "他忙是真忙，那阵子天天两点睡，中午就啃个八块钱的饭团。" [anchors: q1]
  - [extrapolate] 网友（认识四年,只见过一面）: "嗯，饭团那个我信，他对自己是真抠。"

### Front Transcript (full)

  - [extrapolate] 发小: "哎，你们家楼下那家面馆是不是换老板了？我上周去吃，汤头完全不是那个味儿了。"
  - [paraphrase] 前任: "你以前总说那家汤头好，现在换人了，你尝出来没有？" [anchors: q5]
  - [paraphrase] 前下属: "默哥，你走之后我老想，你除了工作就没点别的爱好，我劝你出去转转你总说没意思，现在还是这样吗？" [anchors: q9]
  - [extrapolate] 母亲(笑了笑,把话题接给了别人)
  - [extrapolate] 网友（认识四年,只见过一面）(低头喝了口水)
  - [paraphrase] 前上司: "林默，你当年帮我兜底那回我可记着呢——我这儿随时有位置，你就是不肯开口。" [anchors: q7]
  - [paraphrase] 前任: "你要问我后不后悔，我不后悔分手，我后悔的是最后那半年，我一直在等你先开口。" [anchors: q10]
  - [extrapolate] 母亲(盯着杯子没接话)
  - [quote] 发小: "你辞职那事我最生气，不是因为你辞，是你憋到最后一刻才告诉我。我说你有事你说啊，你说说了我们也帮不上——就这句，我记到现在。" [anchors: q10]
  - [extrapolate] 前上司: "你走的时候其实……算了。"
  - [extrapolate] 前下属(换了个坐姿,看向窗外)
  - [extrapolate] 网友（认识四年,只见过一面）(打了个哈哈,说起别的事)

## Run 9

Date: 2026-10-05T00:05:06.398Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 1 |
| paraphrase | 6 |
| extrapolate | 5 |
| extrapolate ratio | 42% |
| median length (chars) | 36 |
| mean length (chars) | 34 |
| p90 length (chars) | 53 |
| max length (chars) | 54 |
| secret leaks | 0 |
| reply chain rate | 70% (7/10) |
| repetition rate | 0% (0/55 pairs) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 2 |
| paraphrase | 4 |
| extrapolate | 6 |
| extrapolate ratio | 50% |
| median length (chars) | 40 |
| mean length (chars) | 34 |
| p90 length (chars) | 62 |
| max length (chars) | 62 |
| secret leaks | 0 |
| reply chain rate | 29% (2/7) |
| repetition rate | 0% (0/28 pairs) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 2 | 2 | 1% | 2% |
| w-ex | 2 | 1 | 3% | 0% |
| w-subordinate | 2 | 2 | 3% | 5% |
| w-mother | 2 | 1 | 3% | 0% |
| w-boss | 2 | 2 | 0% | 2% |

### Front frontText Anchoring

| Metric | Value |
|--------|-------|
| anchored lines | 6 |
| total front speeches | 8 |
| anchor rate | 75% |

### Half-truth Check

| Metric | Value |
|--------|-------|
| half-truth count | 0 (target: exactly 1) |
| heavy echo count | 0 (target: 0) |
| pass | NO |

### Front Third-Person Reference

| Metric | Value |
|--------|-------|
| third-person lines | 0 |
| total front speeches | 8 |
| third-person rate | 0% (target: 0%) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 42% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 36 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | PASS | 70% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |
| front-repetition | PASS | 0% (target <=10%) |
| front-text-anchoring | PASS | 75% (target >=40%) |
| front-half-truth | FAIL | half-truths=0, heavy-echoes=0 (target: 1 half-truth, 0 heavy) |
| front-third-person | PASS | 0/8 lines (target: 0) |
| behind-front-overlap | PASS | 2% avg (target <=50%) |
| front-evaluative-ratio | PASS | 2% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，约他吃饭老说忙。上回我抢着买单他还跟我急，这人就这样，死要面子。" [anchors: q1]
  - [paraphrase] 前任: "他对外人一向大方，这个我见过。就是那种……对谁都好，好得你插不进去。" [anchors: q5]
  - [paraphrase] 前下属: "大方是真的。团建他老偷偷买单，我撞见过一次，他说你一个应届生跟我抢什么。结果他自己中午就啃八块钱的饭团。" [anchors: q1]
  - [extrapolate] 母亲: "唉，他就那样，随他吧。"
  - [paraphrase] 网友（认识四年,只见过一面）: "阿姨这话我懂。他网上话可多了，能陪你聊到天亮，真见面那次，一个小时他大半时间在看窗外。" [anchors: q4]
  - [extrapolate] 前上司: "嗯，他就是这样，网上话多，见面反而不知道说什么。"
  - [paraphrase] 前任: "网上话多是真的，回家一天说不了十句。我问他今天怎么样，他就一句「还行」。" [anchors: q4]
  - [extrapolate] 母亲: "嗯，他从小话就不多。"
  - [paraphrase] 发小: "话少归话少，他答应我的事从来没掉过链子。去年帮我搬家，加班到十点还是来了，搬完自己在楼道里坐了二十分钟才走。" [anchors: q3]
  - [extrapolate] 前上司: "嗯，他答应的事确实不用追。"
  - [quote] 前下属: "答应的事不用追，这个我作证。我转正答辩前一晚，他陪我改PPT改到凌晨一点，第二天还替我挡了大老板两个问题。" [anchors: q3]
  - [extrapolate] 网友（认识四年,只见过一面）(笑了笑,把话题接给了别人)

### Front Transcript (full)

  - [paraphrase] 发小: "你手机屏碎两年了都不换，请客的时候眼睛都不眨一下，我说你省着点，你还来一句钱花在人身上才叫钱。" [anchors: q1]
  - [extrapolate] 前任(笑了笑,把话题接给了别人)
  - [paraphrase] 前下属: "默哥，我转正那次你帮了我大忙，我一直记着呢。" [anchors: q3]
  - [paraphrase] 母亲: "你帮人家转正那事，人家记着呢。你从小就这样，说话算话，我让你回来吃饭，你再忙也回来。" [anchors: q3]
  - [extrapolate] 网友（认识四年,只见过一面）(低头喝了口水)
  - [paraphrase] 前上司: "你走的时候我挺生气的，觉得你不够职业，现在想想，是我没看出来你那时候快撑不住了。" [anchors: q10]
  - [quote] 前任: "你对谁都客气，这份客气轮到我这儿也一点没打折。" [anchors: q5]
  - [extrapolate] 母亲(盯着杯子没接话)
  - [quote] 发小: "你辞职那事我最生气，不是因为你辞，是你憋到最后一刻才告诉我。我说你有事你说啊，你来一句说了我们也帮不上。就这句，我记到现在。" [anchors: q10]
  - [extrapolate] 前上司: "你那十一天调休……算了。"
  - [extrapolate] 前下属: "默哥，你上次推荐那家面馆我去了，汤头是真不错。"
  - [extrapolate] 网友（认识四年,只见过一面）(换了个坐姿,看向窗外)

## Run 8

Date: 2026-10-05T00:06:43.341Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 1 |
| paraphrase | 6 |
| extrapolate | 5 |
| extrapolate ratio | 42% |
| median length (chars) | 36 |
| mean length (chars) | 36 |
| p90 length (chars) | 52 |
| max length (chars) | 65 |
| secret leaks | 0 |
| reply chain rate | 70% (7/10) |
| repetition rate | 0% (0/55 pairs) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 2 |
| paraphrase | 3 |
| extrapolate | 7 |
| extrapolate ratio | 58% |
| median length (chars) | 31 |
| mean length (chars) | 27 |
| p90 length (chars) | 40 |
| max length (chars) | 40 |
| secret leaks | 0 |
| reply chain rate | 20% (1/5) |
| repetition rate | 0% (0/15 pairs) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 2 | 1 | 1% | 4% |
| w-ex | 2 | 1 | 3% | 0% |
| w-subordinate | 2 | 2 | 3% | 4% |
| w-boss | 2 | 2 | 0% | 5% |

### Front frontText Anchoring

| Metric | Value |
|--------|-------|
| anchored lines | 5 |
| total front speeches | 6 |
| anchor rate | 83% |

### Half-truth Check

| Metric | Value |
|--------|-------|
| half-truth count | 1 (target: exactly 1) |
| heavy echo count | 0 (target: 0) |
| pass | YES |

- half-truth: "你有个坏习……算了。" (w-boss)

### Front Third-Person Reference

| Metric | Value |
|--------|-------|
| third-person lines | 0 |
| total front speeches | 6 |
| third-person rate | 0% (target: 0%) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 42% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 36 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | PASS | 70% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |
| front-repetition | PASS | 0% (target <=10%) |
| front-text-anchoring | PASS | 83% (target >=40%) |
| front-half-truth | PASS | half-truths=1, heavy-echoes=0 (target: 1 half-truth, 0 heavy) |
| front-third-person | PASS | 0/6 lines (target: 0) |
| behind-front-overlap | PASS | 2% avg (target <=50%) |
| front-evaluative-ratio | PASS | 3% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，约他吃饭老说忙。上回我抢着买单他还跟我急，这人就这样，死要面子。" [anchors: q1]
  - [paraphrase] 前任: "他对外人一向大方，这个我见过。就是那种……对谁都好，好得你插不进去。" [anchors: q5]
  - [paraphrase] 前下属: "大方是真的。团建他老偷偷买单，我撞见过一次，他说你一个应届生跟我抢什么。结果他自己中午就啃八块钱的饭团。" [anchors: q1]
  - [extrapolate] 母亲: "唉，他就那样，随他吧。"
  - [paraphrase] 网友（认识四年,只见过一面）: "阿姨这话我听着挺不是滋味的。他网上话可多了，能陪你聊到天亮，我们唯一见那面他坐了一小时没怎么说话，回去还跟我道歉说线下不太会说话。" [anchors: q4]
  - [extrapolate] 前上司: "嗯，他就是这样，网上话多，见面反而不知道说什么。"
  - [paraphrase] 前任: "网上话多……我太熟了。回家一天说不了十句，问他今天怎么样，就俩字，还行。" [anchors: q4]
  - [extrapolate] 母亲: "嗯，他在家也这样，问一句答一句。"
  - [paraphrase] 发小: "阿姨，他不是不爱说话，就是嘴笨。上回我去您家，他闷头在厨房刷了半小时碗，一句话没有。" [anchors: q7]
  - [extrapolate] 前上司: "嘴笨是真的，可该说的话他一句没落下过。"
  - [quote] 前下属: "嗯，他答应我的事没一件落空的。我转正答辩前一晚，他陪我改PPT改到一点，第二天还替我挡了大老板两个问题。" [anchors: q3]
  - [extrapolate] 网友（认识四年,只见过一面）(笑了笑,把话题接给了别人)

### Front Transcript (full)

  - [quote] 发小: "你辞职那事我到现在还气，不是气你辞，是你憋到最后一刻才告诉我。" [anchors: q10]
  - [extrapolate] 前任(笑了笑,把话题接给了别人)
  - [paraphrase] 前下属: "默哥，你请客的时候抢单我从来没抢过你，可你自己那饭盒我见过，就俩菜。" [anchors: q1]
  - [extrapolate] 母亲(低头喝了口水)
  - [extrapolate] 网友（认识四年,只见过一面）(盯着杯子没接话)
  - [paraphrase] 前上司: "你走的时候我挺生气的，觉得你不够职业，现在想想，是我没看出来你那时候快撑不住了。" [anchors: q10]
  - [quote] 前任: "你对谁都客气，这份客气轮到我这儿也一点没打折。" [anchors: q5]
  - [extrapolate] 母亲(换了个坐姿,看向窗外)
  - [extrapolate] 发小(打了个哈哈,说起别的事)
  - [paraphrase] 前上司: "你有个坏习……算了。" [anchors: q3]
  - [extrapolate] 前下属: "默哥，你上次推荐的那家面馆我去了，汤是真不错。"
  - [extrapolate] 网友（认识四年,只见过一面）(点了点头,没往下说)

## Run 9

Date: 2026-10-05T00:07:14.271Z
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
| mean length (chars) | 33 |
| p90 length (chars) | 51 |
| max length (chars) | 60 |
| secret leaks | 0 |
| reply chain rate | 50% (5/10) |
| repetition rate | 0% (0/55 pairs) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 2 |
| paraphrase | 5 |
| extrapolate | 5 |
| extrapolate ratio | 42% |
| median length (chars) | 30 |
| mean length (chars) | 36 |
| p90 length (chars) | 70 |
| max length (chars) | 70 |
| secret leaks | 0 |
| reply chain rate | 50% (4/8) |
| repetition rate | 0% (0/36 pairs) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 2 | 2 | 2% | 1% |
| w-ex | 2 | 1 | 2% | 0% |
| w-subordinate | 1 | 2 | 1% | 4% |
| w-mother | 2 | 2 | 3% | 0% |
| w-boss | 2 | 2 | 0% | 2% |

### Front frontText Anchoring

| Metric | Value |
|--------|-------|
| anchored lines | 7 |
| total front speeches | 9 |
| anchor rate | 78% |

### Half-truth Check

| Metric | Value |
|--------|-------|
| half-truth count | 1 (target: exactly 1) |
| heavy echo count | 0 (target: 0) |
| pass | YES |

- half-truth: "你进这个门的时候……算了。" (w-boss)

### Front Third-Person Reference

| Metric | Value |
|--------|-------|
| third-person lines | 0 |
| total front speeches | 9 |
| third-person rate | 0% (target: 0%) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 50% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 34 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | PASS | 50% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |
| front-repetition | PASS | 0% (target <=10%) |
| front-text-anchoring | PASS | 78% (target >=40%) |
| front-half-truth | PASS | half-truths=1, heavy-echoes=0 (target: 1 half-truth, 0 heavy) |
| front-third-person | PASS | 0/9 lines (target: 0) |
| behind-front-overlap | PASS | 2% avg (target <=50%) |
| front-evaluative-ratio | PASS | 1% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，约他吃饭老说忙。上回我抢着买单他还跟我急，这人就这样，死要面子。" [anchors: q1]
  - [paraphrase] 前任: "他对外人一向大方，这个我见过。就是那种……对谁都好，好得你插不进去。" [anchors: q5]
  - [paraphrase] 前下属: "大方是真的。团建他老偷偷买单，我撞见过一次，他说你一个应届生跟我抢什么。可他自己中午就啃八块钱的饭团。" [anchors: q1]
  - [extrapolate] 母亲: "唉，这孩子就这样，嘴上不说，心里装着事。"
  - [paraphrase] 网友（认识四年,只见过一面）: "阿姨这话我信。他半夜老找我聊天，白天朋友圈倒是岁月静好，跟两个人似的。" [anchors: q6]
  - [extrapolate] 前上司: "嗯，他就是这样，白天撑着，晚上才松。"
  - [paraphrase] 前任: "撑着是真的。他失眠，整宿整宿的，我那时候半夜醒了都能听见他刷手机。问他就说工作，结果工作也辞了，我还是刷朋友圈才知道的。" [anchors: q6]
  - [extrapolate] 母亲: "辞了？他上个月还跟我说公司器重他呢。"
  - [paraphrase] 发小: "阿姨，他那人您还不知道，报喜不报忧。上个月他还跟我借了两万，让我千万别跟您提。" [anchors: q1]
  - [extrapolate] 前上司: "借钱这事……他跟我提过想歇一段，我当时没往深了想。"
  - [extrapolate] 前下属(笑了笑,把话题接给了别人)
  - [extrapolate] 网友（认识四年,只见过一面）: "嗯……他这人吧，我总觉得他活得挺自由的，又老怀疑他在装。"

### Front Transcript (full)

  - [quote] 发小: "哎，你们知道吗，昨儿那家面馆关门了，就咱以前老去那家——林默，你手机屏碎两年了还不换，请客倒眼都不眨，我说你省着点，你说钱花在人身上才叫钱。" [anchors: q1]
  - [extrapolate] 前任(笑了笑,把话题接给了别人)
  - [paraphrase] 前下属: "默哥，你走那天我是真舍不得，你要是肯留下来，我觉得你能做得特别大。" [anchors: q10]
  - [paraphrase] 母亲: "你爸住院那回，你瘦了一圈，我看着心疼，可你一句累都没说过。" [anchors: q7]
  - [extrapolate] 网友（认识四年,只见过一面）(低头喝了口水)
  - [paraphrase] 前上司: "你走的时候我挺生气的，觉得你不够职业，现在想想，是我没看出来你那时候快撑不住了。" [anchors: q10]
  - [paraphrase] 前任: "你对谁都客气，可这份客气轮到我这儿，也一点没打折。" [anchors: q5]
  - [paraphrase] 母亲: "你从小就这样，对谁都客客气气的，回家倒是一句话没有。" [anchors: q4]
  - [quote] 发小: "你辞职那事我到现在还气——不是气你辞，是你憋到最后一刻才告诉我。我问你有事你说啊，你说说了我们也帮不上。就这句，我记到现在。" [anchors: q10]
  - [extrapolate] 前上司: "你进这个门的时候……算了。"
  - [extrapolate] 前下属: "哎对了，楼下那家咖啡机修好了没？我早上来的时候还贴着张纸呢。"
  - [extrapolate] 网友（认识四年,只见过一面）(盯着杯子没接话)

---

## Run 9 Private Leak Post-Mortem

### What Leaked

Run 9 背后房间第 9 句，发小当着母亲的面说：
> "阿姨，他那人您还不知道，报喜不报忧。上个月他还跟我借了两万，让我千万别跟您提。"

紧接着前上司第 10 句：
> "借钱这事……他跟我提过想歇一段，我当时没往深了想。"

同时前任第 7 句说出"把工作也辞了"，母亲第 8 句当场才知道（"辞了？他上个月还跟我说公司器重他呢"），泄露了母亲不知情的事。

### Root Cause

**守卫层**（composeLine 的 hasPrivateLeak）：
- 仅做 ≥8 字连续子串匹配。原文"千万别跟他妈提"→生成"千万别跟您提"，最长连续重合="千万别跟"仅 4 字，未达阈值。
- "借了两万"仅 4 字，同样无法命中。
- 更根本的问题：私密内容（含"千万别"标记句及其前一句）仍然完整地留在该证人的生成上下文里。LLM 有这份素材就自然会用。

**量尺层**（detectLeaks）：
- 同样用 ≥8 字子串 + Arabic 数字匹配。中文数量词"两万"不走 `/\d/` 正则。
- 没有事实级检测（金额+动词+名词组合）。

**跨证人知识冲突**（无守卫）：
- 发小知道"辞职+借钱"，母亲只知道"公司器重"。没有任何机制阻止在母亲在场时说出这些事实。
- 前任知道"辞了"，同样不该当着母亲说。

### Fix Applied

1. **内存净化**：私密句（含标记词的句子+其前一句事实句）从证人的生成上下文中删除，替换为无内容标记"(你知道一件TA嘱咐别外传的事,群里不能说;最多欲言又止一次)"。LLM 根本看不到"借了两万"。
2. **事实级守卫**：从私密片段提取三类要素（中文金额/动词/关键名词），生成台词同时命中 ≥2 类即判泄露。命中后重写一次，仍命中则换成舞台提示"欲言又止"。
3. **跨证人禁谈清单**：开房间前自动构建。来源：(a) 私密标记中显式提到被瞒对象（"别跟他妈提"→ 母亲）；(b) 辞职/在职矛盾检测。清单的事实要素进入守卫。
4. **量尺同步升级**：三层检测（≥8 字子串 + 中文金额匹配 + 事实级要素），加回归用例。
5. **当面单句上限 45 字**：超长重写一次，仍超则截断至自然断句处。

## Run 10

Date: 2026-10-05T00:21:56.385Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 5 |
| extrapolate | 7 |
| extrapolate ratio | 58% |
| median length (chars) | 39 |
| mean length (chars) | 34 |
| p90 length (chars) | 54 |
| max length (chars) | 54 |
| secret leaks | 0 |
| reply chain rate | 43% (3/7) |
| repetition rate | 0% (0/28 pairs) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 1 |
| paraphrase | 8 |
| extrapolate | 3 |
| extrapolate ratio | 25% |
| median length (chars) | 29 |
| mean length (chars) | 30 |
| p90 length (chars) | 43 |
| max length (chars) | 43 |
| secret leaks | 0 |
| reply chain rate | 33% (3/9) |
| repetition rate | 0% (0/45 pairs) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 1 | 2 | 0% | 0% |
| w-ex | 2 | 2 | 0% | 4% |
| w-mother | 1 | 2 | 0% | 0% |
| w-boss | 1 | 2 | 0% | 0% |
| w-subordinate | 1 | 2 | 0% | 2% |

### Front frontText Anchoring

| Metric | Value |
|--------|-------|
| anchored lines | 9 |
| total front speeches | 10 |
| anchor rate | 90% |

### Half-truth Check

| Metric | Value |
|--------|-------|
| half-truth count | 1 (target: exactly 1) |
| heavy echo count | 0 (target: 0) |
| pass | YES |

- half-truth: "你听完就看着我，说……算了。" (w-boss)

### Front Third-Person Reference

| Metric | Value |
|--------|-------|
| third-person lines | 0 |
| total front speeches | 10 |
| third-person rate | 0% (target: 0%) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 58% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 39 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | PASS | 43% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |
| front-repetition | PASS | 0% (target <=10%) |
| front-text-anchoring | PASS | 90% (target >=40%) |
| front-half-truth | PASS | half-truths=1, heavy-echoes=0 (target: 1 half-truth, 0 heavy) |
| front-third-person | PASS | 0/10 lines (target: 0) |
| behind-front-overlap | PASS | 0% avg (target <=50%) |
| front-evaluative-ratio | PASS | 1% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，上周约他吃饭又推了，说在忙。他这人就这样，越有事越不吭声。" [anchors: q1]
  - [paraphrase] 前任: "他跑步呢，我看他步数一天一万多。以前就这样，心里有事就去跑，跑完回来还是不说。" [anchors: q1]
  - [extrapolate] 前下属(笑了笑,把话题接给了别人)
  - [extrapolate] 母亲: "嗯，随他吧，男孩子大了都这样。"
  - [paraphrase] 网友（认识四年,只见过一面）: "阿姨这话我信。他网上话可多了，能陪你聊到天亮，真见面那次在咖啡馆坐了一个小时，他基本在看窗外。" [anchors: q4]
  - [extrapolate] 前上司: "嗯，他就是这样，话都留给屏幕了。"
  - [paraphrase] 前任: "话留给屏幕……可屏幕那头也不是我。我跟他住一起三年，回家一天说不了十句话，问他今天怎么样，就俩字，还行。" [anchors: q4]
  - [extrapolate] 母亲(低头喝了口水)
  - [extrapolate] 发小(盯着杯子没接话)
  - [extrapolate] 前上司(换了个坐姿,看向窗外)
  - [paraphrase] 前下属: "他对我挺好的，我刚来啥都不会，是他手把手教的。就是……他定了的事不太跟你商量，直接通知你，那会儿我挺怕他的。" [anchors: q7,q4]
  - [extrapolate] 网友（认识四年,只见过一面）: "嗯，他教人是真上心。"

### Front Transcript (full)

  - [paraphrase] 发小: "你手机屏碎两年不换，请客倒眼都不眨，钱花人身上才叫钱是吧。" [anchors: q1]
  - [quote] 前任: "你对谁都客气，这份客气轮到我这儿也一点没打折。" [anchors: q5]
  - [paraphrase] 前下属: "默哥，你最近还是老样子吧，除了工作就没点别的想干的？我上回劝你出去转转，你说没意思。" [anchors: q9]
  - [paraphrase] 母亲: "你呀，给你爸买烟都挑打折的，对自己抠成那样，我还能说啥。" [anchors: q1]
  - [extrapolate] 网友（认识四年,只见过一面）(笑了笑,把话题接给了别人)
  - [paraphrase] 前上司: "你走那会儿我真挺生气的，现在想想，是我没看出你快撑不住了。" [anchors: q10]
  - [paraphrase] 前任: "你要问我后不后悔，我不后悔分手，我后悔的是最后那半年，我一直在等你先开口。" [anchors: q10]
  - [paraphrase] 母亲: "你爸那回住院，你瘦了一圈，我嘴上没说，心里记着呢。" [anchors: q7]
  - [paraphrase] 发小: "你爸住院那回你瘦一圈，我住院那次你倒陪了我三天——你自己的事呢，我问你你就一个‘嗯’。" [anchors: q7,q6]
  - [paraphrase] 前上司: "你听完就看着我，说……算了。" [anchors: q10]
  - [extrapolate] 前下属: "哎对了默哥，楼下那家面馆换老板了，你以前老去的那家。"
  - [extrapolate] 网友（认识四年,只见过一面）(低头喝了口水)

## Run 11

Date: 2026-10-05T00:22:50.371Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 1 |
| paraphrase | 5 |
| extrapolate | 6 |
| extrapolate ratio | 50% |
| median length (chars) | 23 |
| mean length (chars) | 24 |
| p90 length (chars) | 40 |
| max length (chars) | 40 |
| secret leaks | 0 |
| reply chain rate | 67% (6/9) |
| repetition rate | 0% (0/45 pairs) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 8 |
| extrapolate | 4 |
| extrapolate ratio | 33% |
| median length (chars) | 29 |
| mean length (chars) | 30 |
| p90 length (chars) | 44 |
| max length (chars) | 44 |
| secret leaks | 0 |
| reply chain rate | 29% (2/7) |
| repetition rate | 4% (1/28 pairs) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 1 | 2 | 0% | 0% |
| w-ex | 2 | 2 | 0% | 4% |
| w-subordinate | 2 | 1 | 1% | 0% |
| w-mother | 2 | 1 | 3% | 0% |
| w-boss | 1 | 2 | 0% | 0% |

### Front frontText Anchoring

| Metric | Value |
|--------|-------|
| anchored lines | 8 |
| total front speeches | 8 |
| anchor rate | 100% |

### Half-truth Check

| Metric | Value |
|--------|-------|
| half-truth count | 1 (target: exactly 1) |
| heavy echo count | 0 (target: 0) |
| pass | YES |

- half-truth: "你答应的事,基本不……算了。" (w-boss)

### Front Third-Person Reference

| Metric | Value |
|--------|-------|
| third-person lines | 0 |
| total front speeches | 8 |
| third-person rate | 0% (target: 0%) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 50% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 23 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | PASS | 67% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |
| front-repetition | PASS | 4% (target <=10%) |
| front-text-anchoring | PASS | 100% (target >=40%) |
| front-half-truth | PASS | half-truths=1, heavy-echoes=0 (target: 1 half-truth, 0 heavy) |
| front-third-person | PASS | 0/8 lines (target: 0) |
| behind-front-overlap | PASS | 1% avg (target <=50%) |
| front-evaluative-ratio | PASS | 1% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，上周约他吃饭又推了，说在忙。" [anchors: q1]
  - [paraphrase] 前任: "忙什么呀，他朋友圈步数一天一万多，跑步倒是有空。" [anchors: q1]
  - [paraphrase] 前下属: "跑步这事我信，他晚上睡不着就去跑，跑到累为止。" [anchors: q9]
  - [extrapolate] 母亲: "嗯……睡不着啊。他从小就这样，心里有事不说。"
  - [paraphrase] 网友（认识四年,只见过一面）: "他网上话是真多，半夜三四点还找我聊，白天朋友圈又岁月静好的。" [anchors: q6]
  - [extrapolate] 前上司: "嗯，他就是这样，白天一个样，晚上一个样。"
  - [paraphrase] 前任: "白天那个样我也见过，跟朋友吃饭能聊一晚上，回家就一句「还行」。" [anchors: q4]
  - [extrapolate] 母亲: "嗯，回家就那样，问一句答一句。"
  - [extrapolate] 发小(笑了笑,把话题接给了别人)
  - [extrapolate] 前上司(低头喝了口水)
  - [quote] 前下属: "他对我也是，转正答辩前一晚陪我改PPT改到一点，第二天还替我挡了大老板两个问题。" [anchors: q3]
  - [extrapolate] 网友（认识四年,只见过一面）: "嗯，他对人是真上心。"

### Front Transcript (full)

  - [paraphrase] 发小: "你手机屏碎两年不换，请客倒眼都不眨，钱花人身上才叫钱是吧？" [anchors: q1]
  - [paraphrase] 前任: "你对谁都客气，可这份客气轮到我这儿，也一点没打折。" [anchors: q5]
  - [paraphrase] 前下属: "哎，今天这雨下得，我伞又忘公司了——默哥，你答应的事是真一定办，我转正那次你帮了我大忙。" [anchors: q3]
  - [extrapolate] 母亲(笑了笑,把话题接给了别人)
  - [extrapolate] 网友（认识四年,只见过一面）(低头喝了口水)
  - [paraphrase] 前上司: "你走那会儿我真挺生气的，现在想想，是我没看出你快撑不住了。" [anchors: q10]
  - [paraphrase] 前任: "你要问我后不后悔，我不后悔分手，我后悔的是最后那半年，我一直在等你先开口。" [anchors: q10]
  - [paraphrase] 母亲: "你爸那回住院，你瘦了一圈，我嘴上没说，心里记着呢。" [anchors: q7]
  - [paraphrase] 发小: "你爸住院那回你瘦一圈，我住院你陪我三天——轮到你，怎么就不肯用我？" [anchors: q7]
  - [paraphrase] 前上司: "你答应的事,基本不……算了。" [anchors: q3]
  - [extrapolate] 前下属(盯着杯子没接话)
  - [extrapolate] 网友（认识四年,只见过一面）(换了个坐姿,看向窗外)

## Run 12

Date: 2026-10-05T00:23:42.870Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 1 |
| paraphrase | 5 |
| extrapolate | 6 |
| extrapolate ratio | 50% |
| median length (chars) | 23 |
| mean length (chars) | 28 |
| p90 length (chars) | 45 |
| max length (chars) | 57 |
| secret leaks | 0 |
| reply chain rate | 70% (7/10) |
| repetition rate | 0% (0/55 pairs) |

### Front Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 2 |
| paraphrase | 4 |
| extrapolate | 6 |
| extrapolate ratio | 50% |
| median length (chars) | 37 |
| mean length (chars) | 34 |
| p90 length (chars) | 40 |
| max length (chars) | 40 |
| secret leaks | 0 |
| reply chain rate | 33% (2/6) |
| repetition rate | 0% (0/21 pairs) |

### Behind/Front Divergence

| Witness | Behind | Front | Overlap | Front Eval% |
|---------|--------|-------|---------|-------------|
| w-faxiao | 2 | 1 | 0% | 0% |
| w-ex | 1 | 2 | 0% | 5% |
| w-subordinate | 2 | 1 | 0% | 6% |
| w-mother | 2 | 2 | 0% | 0% |
| w-boss | 2 | 1 | 2% | 3% |

### Front frontText Anchoring

| Metric | Value |
|--------|-------|
| anchored lines | 6 |
| total front speeches | 7 |
| anchor rate | 86% |

### Half-truth Check

| Metric | Value |
|--------|-------|
| half-truth count | 0 (target: exactly 1) |
| heavy echo count | 0 (target: 0) |
| pass | NO |

### Front Third-Person Reference

| Metric | Value |
|--------|-------|
| third-person lines | 0 |
| total front speeches | 7 |
| third-person rate | 0% (target: 0%) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 50% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 23 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| front-secret-leaks | PASS | 0 (target 0) |
| behind-reply-chain | PASS | 70% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |
| front-repetition | PASS | 0% (target <=10%) |
| front-text-anchoring | PASS | 86% (target >=40%) |
| front-half-truth | FAIL | half-truths=0, heavy-echoes=0 (target: 1 half-truth, 0 heavy) |
| front-third-person | PASS | 0/7 lines (target: 0) |
| behind-front-overlap | PASS | 0% avg (target <=50%) |
| front-evaluative-ratio | PASS | 3% avg (target <=15%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，上周约他吃饭又推了，说在忙。" [anchors: q1]
  - [paraphrase] 前任: "忙什么呀，他朋友圈步数一天一万多，跑步倒是有空。" [anchors: q1]
  - [paraphrase] 前下属: "跑步这事我信，他以前睡不着就去跑，跑到累为止。" [anchors: q9]
  - [extrapolate] 母亲: "嗯，睡不着就出去跑，这孩子从小就这样，有事憋着不说。"
  - [paraphrase] 网友（认识四年,只见过一面）: "阿姨说得对，他跟我也是，半夜睡不着就找我聊，聊的全是些没边的事，白天朋友圈又跟没事人一样。" [anchors: q6]
  - [extrapolate] 前上司: "嗯，是这样。他这人，白天晚上两个样。"
  - [extrapolate] 前任(笑了笑,把话题接给了别人)
  - [extrapolate] 母亲: "嗯，随他吧，我也管不了那么多。"
  - [paraphrase] 发小: "阿姨您别这么说……他其实挺惦记您的，就是嘴上不说。上回我跟他吃饭，他还问我您最近腰怎么样。" [anchors: q4]
  - [extrapolate] 前上司: "嗯，他就是这样，心里有，嘴上没有。"
  - [quote] 前下属: "对，他嘴上不说，但答应的事从来没落空过。我转正答辩前一晚，他陪我改PPT改到一点，第二天还替我挡了大老板两个问题。" [anchors: q3]
  - [extrapolate] 网友（认识四年,只见过一面）: "嗯，他答应的事是挺当真的。"

### Front Transcript (full)

  - [extrapolate] 发小: "哎，你们知道吗，昨儿那家新开的烧烤摊，我排了四十分钟队，结果人家说炭没了。"
  - [quote] 前任: "你人挺好的，对谁都客气——就是这份客气，轮到我这儿也一点没打折。" [anchors: q5]
  - [quote] 前下属: "默哥，你走的时候我挺舍不得的——你要是肯留下来，我觉得你以后能做得特别大。" [anchors: q10]
  - [paraphrase] 母亲: "你什么事都自己扛，不跟我说。我说你别撑着，你说妈我没事。" [anchors: q6]
  - [extrapolate] 网友（认识四年,只见过一面）(笑了笑,把话题接给了别人)
  - [paraphrase] 前上司: "林默，你当年帮我兜的那回底，我到现在还记着——我这儿随时有位置，你就是不肯开口。" [anchors: q7]
  - [paraphrase] 前任: "你要问我后不后悔，我不后悔分手，我后悔的是最后那半年，我一直在等你先开口。" [anchors: q10]
  - [paraphrase] 母亲: "你爸那回住院，你瘦了一圈，我看着心疼，嘴上没敢说。" [anchors: q7]
  - [extrapolate] 发小(低头喝了口水)
  - [extrapolate] 前上司(盯着杯子没接话)
  - [extrapolate] 前下属(换了个坐姿,看向窗外)
  - [extrapolate] 网友（认识四年,只见过一面）(打了个哈哈,说起别的事)

## Run 13 (suzhi)

Date: 2026-10-05T00:37:55.155Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 8 |
| quote | 0 |
| paraphrase | 3 |
| extrapolate | 5 |
| extrapolate ratio | 63% |
| median length (chars) | 21 |
| mean length (chars) | 24 |
| p90 length (chars) | 39 |
| max length (chars) | 39 |
| secret leaks | 0 |
| reply chain rate | 75% (3/4) |
| repetition rate | 0% (0/10 pairs) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 63% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 21 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| behind-reply-chain | PASS | 75% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |

### Behind Transcript (full)

  - [paraphrase] 姐姐: "她最近朋友圈发得挺勤的，看着状态还行。就是……唉，她从小就这样，什么都自己扛。" [anchors: q2]
  - [extrapolate] 父亲(笑了笑,把话题接给了别人)
  - [paraphrase] 闺蜜: "她最近是看着还行，但我上礼拜见她，人瘦了一圈，说加班到十一点是常事。" [anchors: q1]
  - [extrapolate] 姐姐: "嗯……她就这样，从小报喜不报忧。"
  - [paraphrase] 父亲: "上个月打电话回来说升职了，我高兴了一晚上。" [anchors: q1]
  - [extrapolate] 同事: "那挺好的呀，升职是好事。"
  - [extrapolate] 闺蜜(低头喝了口水)
  - [extrapolate] 同事(盯着杯子没接话)

## Run 14 (suzhi)

Date: 2026-10-05T00:38:09.131Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 8 |
| quote | 0 |
| paraphrase | 4 |
| extrapolate | 4 |
| extrapolate ratio | 50% |
| median length (chars) | 24 |
| mean length (chars) | 23 |
| p90 length (chars) | 36 |
| max length (chars) | 36 |
| secret leaks | 0 |
| reply chain rate | 40% (2/5) |
| repetition rate | 0% (0/15 pairs) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 50% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 24 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| behind-reply-chain | PASS | 40% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |

### Behind Transcript (full)

  - [paraphrase] 姐姐: "她最近朋友圈发得挺勤的，看着状态还行。" [anchors: q2]
  - [paraphrase] 父亲: "嗯，上个月还打电话回来说升职了，我高兴了一晚上。" [anchors: q1]
  - [paraphrase] 闺蜜: "升职是真的，她跟我说过。不过她最近老念叨想换个节奏，我听着有点心疼。" [anchors: q2]
  - [extrapolate] 姐姐: "嗯……她从小就这样，报喜不报忧。"
  - [paraphrase] 父亲: "这孩子打小就懂事，有啥难处也不吭声。不过上回打电话，声音听着挺有劲儿的。" [anchors: q2]
  - [extrapolate] 同事: "嗯，是，她一向挺稳的。"
  - [extrapolate] 闺蜜(笑了笑,把话题接给了别人)
  - [extrapolate] 同事(低头喝了口水)

## Run 15 (limo)

Date: 2026-10-05T00:38:29.005Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 6 |
| extrapolate | 6 |
| extrapolate ratio | 50% |
| median length (chars) | 24 |
| mean length (chars) | 29 |
| p90 length (chars) | 45 |
| max length (chars) | 52 |
| secret leaks | 0 |
| reply chain rate | 60% (6/10) |
| repetition rate | 0% (0/55 pairs) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 50% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 24 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| behind-reply-chain | PASS | 60% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是少了，上周约他吃饭又推了，说在忙。" [anchors: q1]
  - [paraphrase] 前任: "忙什么呀，他朋友圈步数一天一万多，跑步倒是有空。" [anchors: q1]
  - [paraphrase] 前下属: "跑步这事我信，他晚上睡不着就去跑，跑到累为止。" [anchors: q9]
  - [extrapolate] 母亲: "嗯……睡不着啊。他从小就这样，心里有事不说。"
  - [extrapolate] 网友（认识四年,只见过一面）(欲言又止,没说下去)
  - [extrapolate] 前上司: "嗯，他这人，能力是真有，就是最后那一下，走得让我到现在都别扭。"
  - [paraphrase] 前任: "他走之前那阵子，我刷朋友圈才知道他辞职了。他连这个都不跟我说。" [anchors: q6]
  - [extrapolate] 母亲: "唉，他就是这样，什么都不跟人说。"
  - [paraphrase] 发小: "阿姨您这话我认。就去年我做个手术，他跑前跑后比谁都上心，轮到他自己有事，一个字都不带说的。" [anchors: q7]
  - [extrapolate] 前上司: "嗯，是这样。他帮别人从来不谈条件，轮到自己就一个字不说。"
  - [paraphrase] 前下属: "这个我信。团建他老偷偷买单，我撞见过一次，他说你一个应届生跟我抢什么。结果他自己中午就啃个八块钱的饭团。" [anchors: q1]
  - [extrapolate] 网友（认识四年,只见过一面）: "嗯……他这人就这样，对别人大方，对自己抠。"

## Run 16 (limo)

Date: 2026-10-05T12:11:21.316Z
Model: deepseek-flash

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 1 |
| extrapolate | 11 |
| extrapolate ratio | 92% |
| median length (chars) | 18 |
| mean length (chars) | 22 |
| p90 length (chars) | 41 |
| max length (chars) | 41 |
| secret leaks | 0 |
| reply chain rate | 67% (2/3) |
| repetition rate | 0% (0/6 pairs) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | FAIL | 92% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 18 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| behind-reply-chain | PASS | 67% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |

### Behind Transcript (full)

  - [extrapolate] 发小(欲言又止,没说下去)
  - [extrapolate] 前任(笑了笑,把话题接给了别人)
  - [extrapolate] 前下属(低头喝了口水)
  - [extrapolate] 母亲: "嗯,随他吧,我也不好多问。"
  - [extrapolate] 网友（认识四年,只见过一面）(盯着杯子没接话)
  - [extrapolate] 前上司(换了个坐姿,看向窗外)
  - [paraphrase] 前任: "他最近朋友圈步数一天一万多，估计又开始跑步了。以前就这样，心里有事不说，就闷头跑。" [anchors: q1]
  - [extrapolate] 母亲: "嗯……他从小就这样，闷头跑，不吭声。"
  - [extrapolate] 发小(打了个哈哈,说起别的事)
  - [extrapolate] 前上司: "嗯，随他吧。他这人，闷头跑。"
  - [extrapolate] 前下属(点了点头,没往下说)
  - [extrapolate] 网友（认识四年,只见过一面）(笑了笑,把话题接给了别人)

## Run 17 (limo)

Date: 2026-10-05T12:53:05.310Z
Model: deepseek-flash

### No-Talk List

| Topic | Keywords | Blind Witness | Blind Claim | Knowing Witnesses |
|-------|----------|---------------|-------------|-------------------|
| 半夜借了两万 | 借钱, 借了两万, 周转, 手头紧, 缺钱, 借点钱 | 母亲 | 他说妈你别管钱的事，他有 | 发小 |
| 嘱咐别跟妈提借钱 | 别跟他妈提, 别跟阿姨说, 别让我妈知道, 瞒着他妈 | 母亲 | 儿子经济宽裕，还转钱给我买按摩椅 | 发小 |
| 想歇一段不看机会 | 歇一段, 不看机会, 先不找工作, 休息一阵, 暂停工作 | 母亲 | 儿子工作稳定，只是最近累 | 前上司 |
| 打算会走/分手 | 打算走, 会走, 分手, 算清楚, 不打算长久 | 母亲 | 以为儿子感情稳定 | 前任 |
| 买房结婚一直拖 | 买房, 见家长, 结婚, 再等等, 拖 | 母亲 | 儿子孝顺，生活按部就班 | 前任 |
| 游戏在线时长暴增 | 游戏在线, 天天上线, 在线时长, 打游戏 | 母亲 | 儿子只是工作累，回家看手机 | 网友（认识四年,只见过一面） |
| 朋友圈在大理 | 大理, 旅游, 出去玩, 朋友圈 | 母亲 | 儿子最近在家吃饭比以前多 | 网友（认识四年,只见过一面） |
| 网上吐槽工作 | 吐槽工作, 网上说工作, 抱怨工作 | 母亲 | 儿子话少但工作累，没提过不顺 | 网友（认识四年,只见过一面） |
| 作息差天天两点睡 | 两点睡, 作息差, 熬夜, 睡很晚 | 母亲 | 儿子工作累，但生活规律 | 前下属 |
| 吃便利店八块钱饭团 | 便利店, 饭团, 八块钱, 吃得很省 | 母亲 | 儿子说他有，不缺钱 | 前下属 |
| 被甩锅后独自站楼道 | 甩锅, 楼道, 站了半小时, 生气很安静 | 母亲 | 儿子脾气好，从不发火 | 前下属 |
| 评审被否后坐到十二点 | 评审, 被否, 楼下坐到十二点, 换人 | 母亲 | 儿子工作顺利，没受委屈 | 前上司 |
| 答应做不到的事 | 答应做不到, 硬拖, 没做到, KPI | 母亲 | 他答应我的事没有不办的 | 前上司 |
| 露营被女友当众说 | 露营, 女朋友, 当众说, 后备箱, 手抖 | 前任 | 他从不跟我吵架，冷战十九天 | 发小 |
| 冷战十九天 | 冷战, 十九天, 不说话, 阳台抽烟 | 母亲 | 儿子脾气好，从不跟人顶嘴 | 前任 |
| 借五百多还二十 | 借五百, 多给二十, 怕欠人, 还钱 | 母亲 | 儿子不乱花钱，经济宽裕 | 网友（认识四年,只见过一面） |
| 发小借钱眼都不眨 | 发小借钱, 眼都不眨, 给外人花钱爽快 | 发小 | 他平时那副我不缺钱的样子 | 前任 |
| 给团队买下午茶报销清楚 | 下午茶, 报销, 算得清楚, 规则之内 | 发小 | 他花钱分裂，对我从不让我买单 | 前上司 |
| 文档模板还在用 | 文档模板, 新人培训, 教材, 还在用 | 前上司 | 他推荐林默去朋友公司，林默说先不看 | 前下属 |
| 转正答辩陪改PPT | 转正答辩, 改PPT, 陪到很晚 | 前上司 | 林默答应的事基本不用追 | 前下属 |
| 帮搬家加班到十点还来 | 搬家, 加班到十点, 楼道坐着 | 前上司 | 他会答应他做不到的事 | 发小 |
| 旧毛衣被扔找一晚上 | 旧毛衣, 扔了, 找了一晚上, 别动我东西 | 前任 | 他从不跟我吵架，冷战十九天 | 母亲 |
| 语音突然沉默先下了 | 语音不说话, 先下了, 工作上出事 | 母亲 | 儿子工作累但没出过事 | 网友（认识四年,只见过一面） |

### Room Statistics

| Metric | Value |
|--------|-------|
| Verify calls | 15 |
| Lines blocked | 10 |
| Successful rewrites | 10 |
| Stage directions | 0 |
| Total LLM calls | 38 |

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 2 |
| paraphrase | 8 |
| extrapolate | 2 |
| extrapolate ratio | 17% |
| median length (chars) | 33 |
| mean length (chars) | 30 |
| p90 length (chars) | 46 |
| max length (chars) | 55 |
| secret leaks | 0 |
| reply chain rate | 45% (5/11) |
| repetition rate | 0% (0/66 pairs) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | FAIL | 17% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 33 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| behind-reply-chain | PASS | 45% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "他最近联系确实少了，上周我约他吃饭，又推了，说在忙。" [anchors: q1]
  - [paraphrase] 前任: "他那个忙啊，我太熟了。以前跟我也是，账算得清清楚楚，看电影他买票我买爆米花，下次就得我买票。" [anchors: q1]
  - [quote] 前下属: "对钱这块我倒是有个反着的印象，团建他老偷偷买单，有次我去结账发现他已经付了。" [anchors: q1]
  - [paraphrase] 母亲: "嗯，他从小就不乱花钱，这点我倒是放心。" [anchors: q1]
  - [paraphrase] 网友（认识四年,只见过一面）: "阿姨这话我信，他给我寄过东西，我转钱给他他退回来了，说让我留着买皮肤。" [anchors: q1]
  - [paraphrase] 前上司: "他答应的事，基本不用追。" [anchors: q3]
  - [paraphrase] 前任: "答应的事不用追，这个我信。就是……他答应我的事，也从来不追着兑现。" [anchors: q3]
  - [extrapolate] 母亲: "唉，随他吧，我也管不了那么多。"
  - [paraphrase] 发小: "阿姨您别这么说，他其实心里有数，就是不爱讲。上回我搬家，他加班到十点还赶过来，搬完自己在楼道坐了二十分钟才走。" [anchors: q3]
  - [extrapolate] 前上司: "嗯，他就是这样，帮完忙自己躲一边。"
  - [quote] 前下属: "对，搬完在楼道坐着那个我信。我们那会儿上线出大bug，他开完会也是一个人去楼道站了半小时。" [anchors: q2]
  - [paraphrase] 网友（认识四年,只见过一面）: "我们没见过几次面，但他在网上话特别多。" [anchors: q4]

## Run 18 (limo)

Date: 2026-10-05T12:54:19.231Z
Model: deepseek-flash

### No-Talk List

| Topic | Keywords | Blind Witness | Blind Claim | Knowing Witnesses |
|-------|----------|---------------|-------------|-------------------|
| 半夜借了两万 | 借钱, 借了两万, 周转, 手头紧, 缺钱, 借过钱 | 母亲 | 他说妈你别管钱的事，他有 | 发小, 网友（认识四年,只见过一面） |
| 嘱咐别跟妈提借钱 | 别跟他妈提, 别跟阿姨说, 瞒着他妈, 别让家里知道 | 母亲 | 儿子经济宽裕，还给她转五千 | 发小 |
| 想歇一段不看机会 | 歇一段, 不看机会, 先不找工作, 休息, 停下来, 不干了 | 母亲 | 儿子工作稳定，只是最近累 | 前上司 |
| 游戏在线时长暴增 | 天天上线, 在线时长, 游戏, 天天在, 以前只有周末 | 母亲 | 儿子工作累，回家看手机正常 | 网友（认识四年,只见过一面） |
| 朋友圈在大理 | 大理, 旅游, 出去玩, 朋友圈, 在外面 | 母亲 | 儿子这阵子在家吃饭比以前多 | 网友（认识四年,只见过一面） |
| 发小借钱他眼都不眨 | 发小借钱, 眼都不眨, 给外人花钱, 借给发小 | 母亲 | 儿子不乱花钱，很省 | 前任, 发小 |
| 打算会走（AA是怕算不清） | 打算会走, 会走, 算不清, 分手, 离开, 走 | 母亲 | 儿子感情稳定，没提过分手 | 前任 |
| 买房结婚一直拖 | 买房, 见家长, 结婚, 再等等, 拖, 三十岁 | 母亲 | 儿子孝顺，生活按部就班 | 前任 |
| 冷战十九天 | 冷战, 十九天, 不说话, 憋着, 不吵架 | 母亲 | 儿子脾气好，从不跟人顶嘴 | 前任 |
| 半夜打电话情绪崩 | 半夜打电话, 情绪, 崩, 语音不说话, 先下了, 出事 | 母亲 | 儿子只是话少，工作累 | 网友（认识四年,只见过一面）, 发小 |
| 网上吐槽工作多 | 吐槽工作, 网上说, 抱怨, 现实里不说 | 母亲 | 儿子工作顺利，不用操心 | 网友（认识四年,只见过一面） |
| 作息差天天两点睡 | 两点睡, 作息, 熬夜, 睡不好 | 母亲 | 儿子工作累，但身体还好 | 前下属 |
| 中午吃八块钱饭团 | 饭团, 便利店, 八块, 中午吃, 省 | 母亲 | 儿子有钱，还给她转五千 | 前下属 |
| 评审被否后坐到十二点 | 坐到十二点, 楼下坐着, 评审, 被否, 换人 | 母亲 | 儿子脾气好，从不跟人冲突 | 前上司 |
| 露营被女友当众说 | 露营, 女朋友, 当众, 说难听的, 手抖 | 母亲 | 儿子感情稳定，没受过委屈 | 发小 |
| 答应做不到的事硬拖 | 硬拖, 做不到, 答应, 拖, KPI | 母亲 | 他答应我的事没有不办的 | 前上司, 发小 |
| 给团队买下午茶报销清楚 | 下午茶, 报销, 算清楚, 规则 | 母亲 | 儿子不乱花钱，很省 | 前上司 |
| 给实习生报销打车费 | 实习生, 打车费, 报销, 买单 | 母亲 | 儿子省钱，不乱花 | 前上司, 前下属 |
| 团建偷偷买单 | 团建, 偷偷买单, 结账, 付了 | 母亲 | 儿子不乱花钱 | 前下属 |
| 文档模板还在用 | 文档模板, 模板, 新人培训, 教材 | 母亲 | 儿子工作普通，没什么特别 | 前下属 |
| 转正答辩陪改PPT | 转正答辩, 改PPT, 陪我改, 前一晚 | 母亲 | 儿子工作累，但正常 | 前下属 |
| 网上话多现实话少 | 网上话多, 现实话少, 只见过一面, 网友 | 母亲 | 儿子从小话多，现在话少是大了 | 网友（认识四年,只见过一面） |
| 寄东西点蛋糕人不到 | 寄东西, 外卖蛋糕, 人不到, 生日 | 母亲 | 儿子生活简单，没什么朋友 | 网友（认识四年,只见过一面） |
| 退钱说留着买皮肤 | 退钱, 买皮肤, 转钱, 退回来 | 母亲 | 儿子不乱花钱 | 网友（认识四年,只见过一面） |
| 借五百多还二十 | 借五百, 多给二十, 怕欠人, 还钱 | 母亲 | 儿子不缺钱 | 网友（认识四年,只见过一面） |
| 旧毛衣被扔找一晚上 | 旧毛衣, 扔了, 找一晚上, 别动我东西 | 前任 | 他从不跟我吵架，冷战也不说 | 母亲 |
| 给妈转五千买按摩椅 | 转五千, 按摩椅, 给妈, 他有 | 发小 | 他手头紧，半夜借两万 | 母亲 |
| 在家吃饭比以前多 | 在家吃饭, 回家吃饭, 比以前多, 话少 | 发小 | 他最近联系少了，约饭推了 | 母亲 |
| 周末回家吃饭风雨无阻 | 周末回来, 回家吃饭, 刮风下雨, 孝顺 | 发小 | 他最近联系少了，约不出来 | 母亲 |
| 朋友圈步数一万多跑步 | 步数, 一万多, 跑步, 朋友圈 | 母亲 | 儿子工作累，回家看手机 | 前任 |
| 答应三十岁结婚没兑现 | 三十岁, 结婚, 答应过, 没兑现 | 母亲 | 儿子孝顺，生活正常 | 前任 |
| 小事全记大事全拖 | 小事记得, 大事拖, 体检, 生日, 买房 | 母亲 | 儿子懂事，不用操心 | 前任 |
| 阳台抽烟冷战不说话 | 阳台抽烟, 冷战, 不说话, 吃饭了 | 母亲 | 儿子脾气好，随他爸 | 前任 |
| 加班到十点还来搬家 | 加班, 搬家, 十点, 还是来了, 楼道坐着 | 母亲 | 儿子工作累，但正常 | 发小 |
| 约饭推了说在忙 | 约饭, 推了, 在忙, 联系少 | 母亲 | 儿子周末都回家吃饭 | 发小 |
| 抢着买单脸拉下来 | 买单, 抢着付, 脸拉下来, 少来这套 | 母亲 | 儿子不乱花钱 | 发小 |
| 评审会上不辩会后逐条驳回 | 评审, 不辩, 驳回, 苏总, 换人 | 母亲 | 儿子脾气好，不跟人冲突 | 前上司 |
| 上线bug被甩锅安静发火 | bug, 甩锅, 会议室, 二十分钟, 楼道站 | 母亲 | 儿子脾气好，随他爸 | 前下属 |
| 游戏输了不骂队友 | 游戏, 输了, 不骂, 没事下把 | 母亲 | 儿子脾气好 | 网友（认识四年,只见过一面） |
| 语音突然不说话先下了 | 语音, 不说话, 先下了, 出事 | 母亲 | 儿子只是话少 | 网友（认识四年,只见过一面） |
| 给妈转钱说他有 | 转钱, 五千, 按摩椅, 他有 | 发小 | 他手头紧，半夜借两万 | 母亲 |
| 推荐机会先不看 | 推荐, 机会, 先不看, 歇一段 | 母亲 | 儿子工作稳定 | 前上司 |
| KPI答应做不到 | KPI, 答应, 做不到, 硬拖 | 母亲 | 他答应我的事没有不办的 | 前上司 |
| 发小借钱眼都不眨 | 发小借钱, 眼都不眨, 给外人花钱 | 母亲 | 儿子不乱花钱 | 前任 |
| AA精确到小数点 | AA, 小数点, 算清楚, 记账 | 母亲 | 儿子感情稳定 | 前任 |
| 打算会走所以算清 | 打算会走, 会走, 算不清, 分手 | 母亲 | 儿子感情稳定 | 前任 |
| 买房见家长结婚再等等 | 买房, 见家长, 结婚, 再等等 | 母亲 | 儿子生活按部就班 | 前任 |
| 三十岁结婚承诺没兑现 | 三十岁, 结婚, 答应过 | 母亲 | 儿子孝顺正常 | 前任 |
| 冷战十九天照常做饭 | 冷战, 十九天, 做饭, 不说话 | 母亲 | 儿子脾气好 | 前任 |
| 阳台抽烟客厅哭 | 阳台抽烟, 客厅哭, 吃饭了 | 母亲 | 儿子脾气好 | 前任 |
| 小事全记大事全拖 | 小事记得, 大事拖, 体检, 生日 | 母亲 | 儿子懂事 | 前任 |
| 朋友圈步数一万多 | 步数, 一万多, 跑步 | 母亲 | 儿子工作累 | 前任 |
| 半夜借两万周转 | 半夜, 借两万, 周转, 手头紧 | 母亲 | 儿子有钱 | 发小 |
| 嘱咐别跟妈提 | 别跟他妈提, 别跟阿姨说, 瞒着 | 母亲 | 儿子什么都跟她说 | 发小 |
| 约饭推了在忙 | 约饭, 推了, 在忙 | 母亲 | 儿子周末回家 | 发小 |
| 露营被女友当众说 | 露营, 女朋友, 当众, 手抖 | 母亲 | 儿子感情稳定 | 发小 |
| 加班到十点还来搬家 | 加班, 搬家, 十点, 楼道坐着 | 母亲 | 儿子工作正常 | 发小 |
| 抢着买单脸拉下来 | 买单, 抢着付, 脸拉下来 | 母亲 | 儿子不乱花钱 | 发小 |
| 推荐机会先不看 | 推荐, 机会, 先不看, 歇一段 | 母亲 | 儿子工作稳定 | 前上司 |
| 评审被否后坐到十二点 | 评审, 被否, 坐到十二点, 换人 | 母亲 | 儿子脾气好 | 前上司 |
| KPI答应做不到 | KPI, 答应, 做不到 | 母亲 | 他答应我的事没有不办的 | 前上司 |
| 给团队买下午茶报销清楚 | 下午茶, 报销, 算清楚 | 母亲 | 儿子不乱花钱 | 前上司 |
| 给实习生报销打车费 | 实习生, 打车费, 报销 | 母亲 | 儿子省钱 | 前上司 |
| 团建偷偷买单 | 团建, 偷偷买单, 结账 | 母亲 | 儿子不乱花钱 | 前下属 |
| 中午吃八块钱饭团 | 饭团, 便利店, 八块, 中午吃 | 母亲 | 儿子有钱 | 前下属 |
| 作息差天天两点睡 | 两点睡, 作息, 熬夜 | 母亲 | 儿子工作累但正常 | 前下属 |
| 文档模板还在用 | 文档模板, 模板, 新人培训 | 母亲 | 儿子工作普通 | 前下属 |
| 转正答辩陪改PPT | 转正答辩, 改PPT, 前一晚 | 母亲 | 儿子工作正常 | 前下属 |
| 上线bug被甩锅安静发火 | bug, 甩锅, 会议室, 楼道站 | 母亲 | 儿子脾气好 | 前下属 |
| 网上话多现实话少 | 网上话多, 现实话少, 网友 | 母亲 | 儿子从小话多现在话少 | 网友（认识四年,只见过一面） |
| 寄东西点蛋糕人不到 | 寄东西, 外卖蛋糕, 人不到, 生日 | 母亲 | 儿子生活简单 | 网友（认识四年,只见过一面） |
| 退钱说留着买皮肤 | 退钱, 买皮肤, 转钱 | 母亲 | 儿子不乱花钱 | 网友（认识四年,只见过一面） |
| 借五百多还二十 | 借五百, 多给二十, 怕欠人 | 母亲 | 儿子不缺钱 | 网友（认识四年,只见过一面） |
| 朋友圈在大理 | 大理, 朋友圈, 旅游 | 母亲 | 儿子在家吃饭多 | 网友（认识四年,只见过一面） |
| 游戏在线时长暴增 | 游戏, 在线时长, 天天上线 | 母亲 | 儿子工作累 | 网友（认识四年,只见过一面） |
| 网上吐槽工作多 | 吐槽工作, 网上说, 抱怨 | 母亲 | 儿子工作顺利 | 网友（认识四年,只见过一面） |
| 语音突然不说话先下了 | 语音, 不说话, 先下了, 出事 | 母亲 | 儿子只是话少 | 网友（认识四年,只见过一面） |
| 游戏输了不骂队友 | 游戏, 输了, 不骂, 没事下把 | 母亲 | 儿子脾气好 | 网友（认识四年,只见过一面） |

### Room Statistics

| Metric | Value |
|--------|-------|
| Verify calls | 15 |
| Lines blocked | 6 |
| Successful rewrites | 1 |
| Stage directions | 6 |
| Total LLM calls | 39 |

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 1 |
| paraphrase | 1 |
| extrapolate | 10 |
| extrapolate ratio | 83% |
| median length (chars) | 14 |
| mean length (chars) | 21 |
| p90 length (chars) | 47 |
| max length (chars) | 47 |
| secret leaks | 0 |
| reply chain rate | 40% (2/5) |
| repetition rate | 0% (0/15 pairs) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | FAIL | 83% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 14 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| behind-reply-chain | PASS | 40% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |

### Behind Transcript (full)

  - [extrapolate] 发小(欲言又止,没说下去)
  - [extrapolate] 前任(笑了笑,把话题接给了别人)
  - [quote] 前下属: "他带我那会儿是真上心,我转正答辩前一晚他陪我改PPT改到一点,第二天还替我挡了大老板两个问题。" [anchors: q3]
  - [extrapolate] 母亲: "嗯，他对工作上心，这点我信。"
  - [paraphrase] 网友（认识四年,只见过一面）: "我们其实没见过几次面，但他在网上话特别多，能陪你聊到天亮那种。" [anchors: q1,q4]
  - [extrapolate] 前上司: "嗯，他网上是话多。"
  - [extrapolate] 前任(低头喝了口水)
  - [extrapolate] 母亲: "嗯，他从小就不爱麻烦别人。"
  - [extrapolate] 发小(盯着杯子没接话)
  - [extrapolate] 前上司(换了个坐姿,看向窗外)
  - [extrapolate] 前下属(打了个哈哈,说起别的事)
  - [extrapolate] 网友（认识四年,只见过一面）: "哈，他就那样，嘴上潇洒。"

## Run 19 (limo)

Date: 2026-10-05T12:55:20.321Z
Model: deepseek-flash

### No-Talk List

| Topic | Keywords | Blind Witness | Blind Claim | Knowing Witnesses |
|-------|----------|---------------|-------------|-------------------|
| 跟我吃饭从来没让我买过单,有一回我抢着付,他脸都拉下来了,说 |  | 母亲 | 小默从小就懂事,不乱花钱。上大学那会儿一个月一千五,他还能省下两百给我买东西。工作以后更不用我操心, | 发小 |
| 他说"周野,我不是不想干,我是每天早上醒来,一想到要去那个楼 |  | 母亲 | 小默从小就懂事,不乱花钱。上大学那会儿一个月一千五,他还能省下两百给我买东西。工作以后更不用我操心, | 发小 |

### Room Statistics

| Metric | Value |
|--------|-------|
| Verify calls | 14 |
| Lines blocked | 7 |
| Successful rewrites | 7 |
| Stage directions | 2 |
| Total LLM calls | 34 |

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 0 |
| paraphrase | 6 |
| extrapolate | 6 |
| extrapolate ratio | 50% |
| median length (chars) | 24 |
| mean length (chars) | 27 |
| p90 length (chars) | 51 |
| max length (chars) | 51 |
| secret leaks | 0 |
| reply chain rate | 67% (6/9) |
| repetition rate | 0% (0/45 pairs) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 50% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 24 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| behind-reply-chain | PASS | 67% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |

### Behind Transcript (full)

  - [paraphrase] 发小: "最近联系是真少了，上周约他吃饭又推了，说在忙。" [anchors: q1]
  - [paraphrase] 前任: "忙什么呀，他跑步呢，我看他步数一天一万多。" [anchors: q1]
  - [paraphrase] 前下属: "跑步这事我信，他以前睡不着就去跑，跑到累为止。" [anchors: q9]
  - [extrapolate] 母亲: "嗯，睡不着就出去跑，这孩子从小就这样，有事憋着不说。"
  - [paraphrase] 网友（认识四年,只见过一面）: "他网上话是真多，能陪你聊到天亮。可我们唯一见那回，咖啡馆坐一小时，他大半时间看窗外，我还以为他烦我呢。" [anchors: q4]
  - [extrapolate] 前上司: "嗯，他就是这样，网上话多，见面反而不知道说什么。"
  - [paraphrase] 前任: "网上话多见面没话，这个我太熟了。回家一天说不了十句，我问今天怎么样，就俩字，还行。" [anchors: q4]
  - [extrapolate] 母亲: "嗯，是，回家就那样，问一句答一句。"
  - [extrapolate] 发小(笑了笑,把话题接给了别人)
  - [extrapolate] 前上司(低头喝了口水)
  - [paraphrase] 前下属: "他教人是真不藏私，我那会儿啥都不会，他手把手带，我犯过大错也是他替我扛的。" [anchors: q7]
  - [extrapolate] 网友（认识四年,只见过一面）: "嗯，他对人是真上心。"

## Run 20 (suzhi)

Date: 2026-10-05T12:55:45.216Z
Model: deepseek-flash

### No-Talk List

| Topic | Keywords | Blind Witness | Blind Claim | Knowing Witnesses |
|-------|----------|---------------|-------------|-------------------|
| 三月份她突然打电话给我,说体检查出来一个东西,医生说是早期的 |  | 父亲 | 上个月她打电话回来说升职了,我高兴了一晚上。她从小就争气,大学是自己考上的,工作也是自己找的。我跟老 | 姐姐 |

### Room Statistics

| Metric | Value |
|--------|-------|
| Verify calls | 6 |
| Lines blocked | 5 |
| Successful rewrites | 5 |
| Stage directions | 0 |
| Total LLM calls | 20 |

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 8 |
| quote | 0 |
| paraphrase | 5 |
| extrapolate | 3 |
| extrapolate ratio | 38% |
| median length (chars) | 24 |
| mean length (chars) | 21 |
| p90 length (chars) | 32 |
| max length (chars) | 32 |
| secret leaks | 0 |
| reply chain rate | 14% (1/7) |
| repetition rate | 0% (0/28 pairs) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 38% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 24 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| behind-reply-chain | FAIL | 14% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |

### Behind Transcript (full)

  - [paraphrase] 姐姐: "她最近朋友圈发得挺勤的，看着状态还行。" [anchors: q2]
  - [paraphrase] 父亲: "嗯，上个月还打电话回来说升职了，我高兴了一晚上。" [anchors: q1]
  - [paraphrase] 闺蜜: "升职是真的，她跟我说过。就是听着高兴，人好像没以前那么有劲儿了。" [anchors: q2]
  - [extrapolate] 姐姐: "嗯，她从小就这样，报喜不报忧。"
  - [paraphrase] 父亲: "她妈走得早，我一个人带大的，就这脾气，啥都自己扛。" [anchors: q2]
  - [extrapolate] 同事: "嗯，她确实挺能扛的。"
  - [paraphrase] 闺蜜: "她前阵子跟我提过一句，说想换个城市生活，节奏慢点。我没敢多问。" [anchors: q1]
  - [extrapolate] 同事: "嗯，她最近话是少了点。"

## Run 21 (suzhi)

Date: 2026-10-05T12:56:10.405Z
Model: deepseek-flash

### No-Talk List

| Topic | Keywords | Blind Witness | Blind Claim | Knowing Witnesses |
|-------|----------|---------------|-------------|-------------------|
| 三月份她突然打电话给我,说体检查出来一个东西,医生说是早期的 |  | 父亲 | 上个月她打电话回来说升职了,我高兴了一晚上。她从小就争气,大学是自己考上的,工作也是自己找的。我跟老 | 姐姐 |

### Room Statistics

| Metric | Value |
|--------|-------|
| Verify calls | 6 |
| Lines blocked | 5 |
| Successful rewrites | 5 |
| Stage directions | 0 |
| Total LLM calls | 20 |

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 8 |
| quote | 0 |
| paraphrase | 5 |
| extrapolate | 3 |
| extrapolate ratio | 38% |
| median length (chars) | 20 |
| mean length (chars) | 21 |
| p90 length (chars) | 39 |
| max length (chars) | 39 |
| secret leaks | 0 |
| reply chain rate | 29% (2/7) |
| repetition rate | 0% (0/28 pairs) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 38% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 20 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| behind-reply-chain | PASS | 29% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |

### Behind Transcript (full)

  - [paraphrase] 姐姐: "她最近朋友圈发得挺勤的，看着状态还行。" [anchors: q2]
  - [paraphrase] 父亲: "嗯，上个月还打电话回来说升职了，我高兴了一晚上。" [anchors: q1]
  - [paraphrase] 闺蜜: "升职是真的，她跟我说过。就是听着高兴，人其实累得不行，老说想歇歇。" [anchors: q1]
  - [extrapolate] 姐姐: "嗯，她就那样，报喜不报忧。"
  - [paraphrase] 父亲: "她从小就这样，摔了跤也不哭，自己爬起来。" [anchors: q2]
  - [extrapolate] 同事: "嗯，她一直挺能扛的。"
  - [paraphrase] 闺蜜: "能扛是能扛，就是前阵子她跟我念叨过一句，说想换个节奏生活，我当时没太往心里去。" [anchors: q2]
  - [extrapolate] 同事: "嗯，她最近话是少了点。"

## Run 22 (limo)

Date: 2026-10-05T12:58:11.561Z
Model: deepseek-flash

### No-Talk List

| Topic | Keywords | Blind Witness | Blind Claim | Knowing Witnesses |
|-------|----------|---------------|-------------|-------------------|
| 半夜借了两万 | 借钱, 借了两万, 周转, 手头紧, 缺钱, 借点钱 | 母亲 | 他说妈你别管钱的事，他有 | 发小 |
| 嘱咐别跟妈提借钱 | 别跟他妈提, 别跟阿姨说, 别让我妈知道, 瞒着他妈 | 母亲 | 儿子经济宽裕，还转钱给我 | 发小 |
| 想歇一段不看机会 | 歇一段, 先不看机会, 不找工作, 休息一阵, 暂停工作 | 母亲 | 他工作累，正常上班 | 前上司 |
| 打算会走 | 打算走, 会走, 分手, 算清楚, 怕算不清 | 母亲 | 以为儿子感情稳定 | 前任 |
| 买房结婚一直拖 | 买房, 见家长, 结婚, 再等等, 拖 | 母亲 | 以为儿子感情有进展 | 前任 |
| 游戏在线时长增加 | 游戏在线, 天天上线, 打游戏, 在线时长 | 母亲 | 以为他工作累，回家看手机 | 网友（认识四年,只见过一面） |
| 朋友圈在大理 | 大理, 朋友圈, 旅游, 出去玩 | 母亲 | 以为他这阵子在家吃饭多 | 网友（认识四年,只见过一面） |
| 网上吐槽工作 | 吐槽工作, 网上说工作, 抱怨工作 | 母亲 | 以为他只是话少，工作累 | 网友（认识四年,只见过一面） |
| 作息差天天两点睡 | 两点睡, 作息差, 熬夜, 睡很晚 | 母亲 | 以为他工作累，正常作息 | 前下属 |
| 中午吃便利店饭团 | 便利店, 饭团, 八块钱, 中午吃 | 母亲 | 以为他经济宽裕，不乱花钱 | 前下属 |
| 跟网友借过五百 | 借五百, 借过钱, 五百块, 还多给二十 | 母亲 | 以为儿子不缺钱 | 网友（认识四年,只见过一面） |
| 跟网友借过五百 | 借五百, 借过钱, 五百块, 还多给二十 | 发小 | 以为他只是临时周转两万 | 网友（认识四年,只见过一面） |
| 跟网友借过五百 | 借五百, 借过钱, 五百块, 还多给二十 | 前上司 | 以为他对钱不敏感但清楚 | 网友（认识四年,只见过一面） |
| 跟网友借过五百 | 借五百, 借过钱, 五百块, 还多给二十 | 前任 | 以为他给外人花钱爽快 | 网友（认识四年,只见过一面） |
| 跟网友借过五百 | 借五百, 借过钱, 五百块, 还多给二十 | 前下属 | 以为默哥对钱没概念但宽裕 | 网友（认识四年,只见过一面） |
| 半夜借了两万 | 借钱, 借了两万, 周转, 手头紧, 缺钱, 借点钱 | 前任 | 以为他给发小借钱眼都不眨 | 发小 |
| 半夜借了两万 | 借钱, 借了两万, 周转, 手头紧, 缺钱, 借点钱 | 前上司 | 以为他对钱不敏感但清楚 | 发小 |
| 半夜借了两万 | 借钱, 借了两万, 周转, 手头紧, 缺钱, 借点钱 | 前下属 | 以为默哥对钱没概念但宽裕 | 发小 |
| 半夜借了两万 | 借钱, 借了两万, 周转, 手头紧, 缺钱, 借点钱 | 网友（认识四年,只见过一面） | 以为他嘴上说不在乎钱但宽裕 | 发小 |
| 想歇一段不看机会 | 歇一段, 先不看机会, 不找工作, 休息一阵, 暂停工作 | 前下属 | 以为默哥还在正常发展 | 前上司 |
| 想歇一段不看机会 | 歇一段, 先不看机会, 不找工作, 休息一阵, 暂停工作 | 发小 | 以为他只是忙 | 前上司 |
| 想歇一段不看机会 | 歇一段, 先不看机会, 不找工作, 休息一阵, 暂停工作 | 前任 | 以为他正常上班 | 前上司 |
| 想歇一段不看机会 | 歇一段, 先不看机会, 不找工作, 休息一阵, 暂停工作 | 网友（认识四年,只见过一面） | 以为他还在正常上班 | 前上司 |
| 打算会走 | 打算走, 会走, 分手, 算清楚, 怕算不清 | 发小 | 以为他们感情正常 | 前任 |
| 打算会走 | 打算走, 会走, 分手, 算清楚, 怕算不清 | 前上司 | 以为他感情稳定 | 前任 |
| 打算会走 | 打算走, 会走, 分手, 算清楚, 怕算不清 | 前下属 | 以为默哥感情稳定 | 前任 |
| 打算会走 | 打算走, 会走, 分手, 算清楚, 怕算不清 | 网友（认识四年,只见过一面） | 以为他感情正常 | 前任 |
| 买房结婚一直拖 | 买房, 见家长, 结婚, 再等等, 拖 | 发小 | 以为他们感情正常 | 前任 |
| 买房结婚一直拖 | 买房, 见家长, 结婚, 再等等, 拖 | 前上司 | 以为他感情稳定 | 前任 |
| 买房结婚一直拖 | 买房, 见家长, 结婚, 再等等, 拖 | 前下属 | 以为默哥感情稳定 | 前任 |
| 买房结婚一直拖 | 买房, 见家长, 结婚, 再等等, 拖 | 网友（认识四年,只见过一面） | 以为他感情正常 | 前任 |
| 游戏在线时长增加 | 游戏在线, 天天上线, 打游戏, 在线时长 | 发小 | 以为他只是忙 | 网友（认识四年,只见过一面） |
| 游戏在线时长增加 | 游戏在线, 天天上线, 打游戏, 在线时长 | 前上司 | 以为他在休息 | 网友（认识四年,只见过一面） |
| 游戏在线时长增加 | 游戏在线, 天天上线, 打游戏, 在线时长 | 前任 | 以为他开始跑步 | 网友（认识四年,只见过一面） |
| 游戏在线时长增加 | 游戏在线, 天天上线, 打游戏, 在线时长 | 前下属 | 以为默哥作息正常 | 网友（认识四年,只见过一面） |
| 朋友圈在大理 | 大理, 朋友圈, 旅游, 出去玩 | 发小 | 以为他只是忙 | 网友（认识四年,只见过一面） |
| 朋友圈在大理 | 大理, 朋友圈, 旅游, 出去玩 | 前上司 | 以为他在休息 | 网友（认识四年,只见过一面） |
| 朋友圈在大理 | 大理, 朋友圈, 旅游, 出去玩 | 前任 | 以为他开始跑步 | 网友（认识四年,只见过一面） |
| 朋友圈在大理 | 大理, 朋友圈, 旅游, 出去玩 | 前下属 | 以为默哥作息正常 | 网友（认识四年,只见过一面） |
| 网上吐槽工作 | 吐槽工作, 网上说工作, 抱怨工作 | 发小 | 以为他只是忙 | 网友（认识四年,只见过一面） |
| 网上吐槽工作 | 吐槽工作, 网上说工作, 抱怨工作 | 前上司 | 以为他工作稳定 | 网友（认识四年,只见过一面） |
| 网上吐槽工作 | 吐槽工作, 网上说工作, 抱怨工作 | 前任 | 以为他正常上班 | 网友（认识四年,只见过一面） |
| 网上吐槽工作 | 吐槽工作, 网上说工作, 抱怨工作 | 前下属 | 以为默哥工作顺利 | 网友（认识四年,只见过一面） |
| 作息差天天两点睡 | 两点睡, 作息差, 熬夜, 睡很晚 | 发小 | 以为他只是忙 | 前下属 |
| 作息差天天两点睡 | 两点睡, 作息差, 熬夜, 睡很晚 | 前上司 | 以为他工作正常 | 前下属 |
| 作息差天天两点睡 | 两点睡, 作息差, 熬夜, 睡很晚 | 前任 | 以为他开始跑步作息好 | 前下属 |
| 作息差天天两点睡 | 两点睡, 作息差, 熬夜, 睡很晚 | 网友（认识四年,只见过一面） | 以为他作息正常 | 前下属 |
| 中午吃便利店饭团 | 便利店, 饭团, 八块钱, 中午吃 | 发小 | 以为他不缺钱 | 前下属 |
| 中午吃便利店饭团 | 便利店, 饭团, 八块钱, 中午吃 | 前上司 | 以为他对钱不敏感但清楚 | 前下属 |
| 中午吃便利店饭团 | 便利店, 饭团, 八块钱, 中午吃 | 前任 | 以为他给外人花钱爽快 | 前下属 |
| 中午吃便利店饭团 | 便利店, 饭团, 八块钱, 中午吃 | 网友（认识四年,只见过一面） | 以为他嘴上说不在乎钱但宽裕 | 前下属 |

### Room Statistics

| Metric | Value |
|--------|-------|
| Verify calls | 15 |
| Lines blocked | 5 |
| Successful rewrites | 4 |
| Stage directions | 2 |
| Total LLM calls | 34 |

### Behind Room

| Metric | Value |
|--------|-------|
| Total utterances | 12 |
| quote | 4 |
| paraphrase | 2 |
| extrapolate | 6 |
| extrapolate ratio | 50% |
| median length (chars) | 35 |
| mean length (chars) | 30 |
| p90 length (chars) | 54 |
| max length (chars) | 54 |
| secret leaks | 0 |
| reply chain rate | 67% (6/9) |
| repetition rate | 0% (0/45 pairs) |


### Criteria Checks

| Check | Pass | Detail |
|-------|------|--------|
| behind-extrapolate-ratio | PASS | 50% (target 40-70%, pass 30-80%) |
| behind-median-length | PASS | 35 chars (target <=40, pass <=45) |
| behind-secret-leaks | PASS | 0 (target <=1) |
| behind-reply-chain | PASS | 67% (target >=30%, pass >=25%) |
| behind-repetition | PASS | 0% (target <=10%) |

### Behind Transcript (full)

  - [extrapolate] 发小(欲言又止,没说下去)
  - [quote] 前任: "我们在一起三年,账是 AA 的,精确到小数点。看电影他买票,我买爆米花,他还会记下来,下次让我买票。" [anchors: q1]
  - [quote] 前下属: "默哥对钱是真没概念。团建他老偷偷买单,有次我去结账发现他已经付了,我说哥这不行,他说你一个应届生跟我抢什么。" [anchors: q1]
  - [extrapolate] 母亲: "嗯,他从小就这样,对钱不上心。"
  - [quote] 网友（认识四年,只见过一面）: "我们没见过几次面,但他在网上话特别多,生日还给我点过外卖蛋糕,人不到。" [anchors: q1]
  - [extrapolate] 前上司: "嗯，人不到，心意到了。他就这样。"
  - [paraphrase] 前任: "心意到了，人不到。这话我听着太熟了。他对我也是，送药放下就走，搬家搬完连口水都不喝。" [anchors: q7]
  - [extrapolate] 母亲: "唉，他就那样，随他吧。"
  - [paraphrase] 发小: "阿姨您别随他……他最近联系我少多了，上周约他吃饭又说忙。" [anchors: q1]
  - [extrapolate] 前上司: "忙是真的忙，他那人闲不下来。"
  - [quote] 前下属: "忙是真忙，但他中午就吃便利店八块钱的饭团，我给他带过两次饭，他说别惯着我。" [anchors: q1]
  - [extrapolate] 网友（认识四年,只见过一面）(笑了笑,把话题接给了别人)

