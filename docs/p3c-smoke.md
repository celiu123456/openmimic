# P3c 冒烟记录

## 新增端点

### 集体沉默信号

**列出沉默信号**

```bash
curl -s http://localhost:7860/api/subjects/<id>/silence-signals | jq
```

```json
{
  "subjectId": "limo",
  "signals": [
    {
      "id": "...",
      "subjectId": "limo",
      "qid": "q_family_conflict",
      "skipperIds": ["w1", "w3", "w5"],
      "totalWitnesses": 6,
      "skipRatio": 0.5,
      "createdAt": "2026-10-05T..."
    }
  ]
}
```

**手动扫描**

```bash
curl -s -X POST http://localhost:7860/api/subjects/<id>/silence-signals/scan | jq
```

```json
{
  "subjectId": "limo",
  "signals": [...],
  "count": 1
}
```

触发条件:avoidedQids 中同一 qid 被 >= 半数 且 >= 3 位证人跳过。
自动扫描:court.finished 事件触发后自动执行。

### 论断否决 (GateEngine)

**否决一条论断**

```bash
curl -s -X POST http://localhost:7860/api/claims/<claim-id>/contest | jq
```

```json
{
  "claimId": "c1",
  "status": "contested",
  "contestedAt": "2026-10-05T...",
  "evidenceSnapshot": ["t1", "t2"]
}
```

**撤回否决**

```bash
curl -s -X POST http://localhost:7860/api/claims/<claim-id>/uncontest | jq
```

```json
{
  "claimId": "c1",
  "status": "surviving"
}
```

**列出被否决的论断**

```bash
curl -s http://localhost:7860/api/subjects/<id>/contested | jq
```

```json
{
  "subjectId": "limo",
  "contested": [
    {
      "id": "c1",
      "text": "花钱大方,请客不犹豫",
      "conviction": 0.62,
      "records": [
        {
          "claimId": "c1",
          "at": "2026-10-05T...",
          "evidenceSnapshot": ["t1"]
        }
      ]
    }
  ]
}
```

### 元知觉 (meta-perception)

**获取预测题目**

```bash
curl -s http://localhost:7860/api/subjects/<id>/meta/questions | jq
```

**提交预测(一次性,不可修改)**

```bash
curl -s -X POST http://localhost:7860/api/subjects/<id>/meta/predictions \
  -H 'Content-Type: application/json' \
  -d '{"predictions":[{"witnessId":"w1","qid":"meta_overall_impression","predictedText":"觉得他很聪明"}]}' | jq
```

**LLM 评分**

```bash
curl -s -X POST http://localhost:7860/api/subjects/<id>/meta/score | jq
```

**获取结果**

```bash
curl -s http://localhost:7860/api/subjects/<id>/meta/result | jq
```

## 插件持久化

插件通过 `store.registerPluginTable(pluginName, tableSuffix, ddl, options)` 注册沙箱表:

- 表名强制前缀 `plugin_<name>_<suffix>`,无法触及 testimonies 等核心表
- `{ appendOnly: true }` 禁止 update/delete(meta-perception 预测使用)
- 数据在进程重启后保持(文件 DB)

当前使用该机制的插件:
- meta-perception: `plugin_meta_perception_predictions`(append-only)、`plugin_meta_perception_results`
- gate: `plugin_gate_contest_records`(append-only)、`plugin_gate_wall_transcript`(append-only)
- silence-signal: `plugin_silence_signal_signals`

## reraised 字段

Claim 新增 `reraised?: boolean`。当一条 contested 论断满足 re-raise 条件(新增 >= 2 位不同证人的证据且 contest 次数 < 2)时,GateEngine 将其恢复为 surviving 并设 `reraised: true`。人格组装显示"重新提出:又有人提到类似的事"。

DB 层:claims 表 `reraised INTEGER` 列(migration 自动添加)。

## 测试统计

- Task 1 完成时:331 tests
- Task 2(插件持久化):+4 → 335
- Task 3(reraised):+1 → 336
- Task 5(匿名证人):+2 → 338
- Task 7(集体沉默):+12 → 350
- 全部通过,typecheck 干净(root + web)
