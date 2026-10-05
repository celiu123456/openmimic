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

