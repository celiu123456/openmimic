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

未跑。原因:主控要求立即收尾,未配置 .env。
