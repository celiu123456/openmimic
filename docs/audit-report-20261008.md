# 文档审计报告 2026-10-08

核查人:自动化审计(人工逐文件阅读 + vitest 测试)
基线:feat/docs-audit 分支,1158 测试通过 / 1 环境性失败(sqlite disk I/O)

---

## 1. 核查范围

逐行读 `docs/claims-audit.md` 旧版(232 行,57 已实现 / 4 部分 / 8 计划),对每一条:

- 确认代码文件存在、行号是否漂移
- 确认有无测试覆盖(无测试的"已实现"降级为"部分")
- 确认声明语义与代码行为一致
- 对衔枝(Twig)归因条目,对照 ATTRIBUTION.md 验证设计语义

新增"核查日期 + 核查方式"列。

---

## 2. 发现的差异

### 2.1 状态降级(docs say yes, code says no / partial)

| 条目 | 旧状态 | 新状态 | 原因 |
|---|---|---|---|
| 反证搜索(借鉴衔枝) | 已实现 | **计划** | 代码中无反面假设生成、无 HyDE 反用检索;conflict.ts 的 EmbeddingClaimPairFinder 是论断配对(跨证人找语义相关材料),设计语义不同 |
| QR 生成器 | (缺行) | **部分** | 代码+测试存在,但未接入任何端点或页面;未经独立解码器验证 |
| 输出侧事实核对(persona-verify) | (缺行) | **部分** | 库函数可用且有测试,但未接入 mount-openai 端点;仅回归脚本手动调用 |
| 活人感台架(liveness) | (缺行) | **部分** | 台架代码完整(13 信号量表、成对盲评、SHA 冻结),但未标定(无人工标注真人样本);不会产出有效读数 |
| 危机协议三原则(借鉴衔枝) | (混在其他行) | **部分** | 危机词拒绝+诊断词降级已有;但衔枝的"用户级危机静默期→全局静默"及"零缓存路径、静态危机资源兜底"未实现 |
| 过程评测三指标(借鉴衔枝) | (混在计划) | **部分** | evidenceCoverage 已有;矛盾响应有代理指标;记忆修复无对应 |
| 规模形态 | — | **部分** | 单人/单房间可用;组织级无实现 |

### 2.2 状态升级(docs say no, code says yes)

| 条目 | 旧状态 | 新状态 | 原因 |
|---|---|---|---|
| contested 否决流(借鉴衔枝) | 计划 | **已实现** | 中文 README"计划借鉴"节错误列入;代码 engines/gate/src/gate.ts 已完整实现 contest/uncontest + re-raise |
| 论断权限墙(借鉴衔枝) | 计划 | **已实现** | 同上;GateEngine 中 validateClaimText + filterSessionClaims 已实现 |
| DEPLOY-FOR-AI(借鉴衔枝) | 计划 | **已实现** | docs/DEPLOY-FOR-AI.md 已存在 |
| GateEngine | (planned) | **已实现** | ARCHITECTURE.md 目录布局标"(planned)",实际代码完整 |

### 2.3 行号漂移

| 条目 | 旧行号 | 实际行号 |
|---|---|---|
| runBehindRoom (room.ts) | 358-418 | 1819 |
| openDoor (room.ts) | 435-479 | 2052 |

### 2.4 数字不一致

| 条目 | 旧值 | 实际值 |
|---|---|---|
| 测试通过数(表头) | 696 | 1158(vitest 实跑) |

---

## 3. 新增行(补录最近合入的能力)

共新增 15 个条目:

1. 聊天记录导入(collector-chatlog) — 已实现
2. 角色卡桥接(bridge-sillytavern) — 已实现
3. 带权限范围的令牌(scoped tokens) — 已实现
4. 能力目录(capabilities) — 已实现
5. 话题覆盖调度(coverage scheduling) — 已实现
6. 邀请短码(short codes) — 已实现
7. QR 生成器 — 部分(孤立代码)
8. 提示词隔离(untrusted content isolation) — 已实现
9. 回流指纹(reflux detection) — 已实现
10. 输出侧事实核对(persona-verify) — 部分(未接入端点)
11. 说话风格画像(style-stats) — 已实现
12. 证言集(biography) — 已实现
13. 活人感台架(liveness) — 部分(未标定)
14. 访谈员 v2(interview v2) — 已实现
15. 当面房间防泄密 — 已实现
16. 留一证人(LOWO)与对照臂 — 已实现
17. 四级披露(disclosure) — 已实现
18. 元知觉(meta-perception) — 已实现
19. 三档发言分类(expression tiers) — 已实现
20. 匿名证人(anonymousInRoom) — 已实现

---

## 4. Known defects 节(新增)

从以下真模型运行记录提取 11 条已知缺陷:

- `docs/regression-run-20261007b.md`(6-issue fix wave)
- `docs/regression-run-20261007.md`
- `docs/regression-run-20261006.md`
- `docs/regression-run-20261006b.md`
- `docs/regression-run-20261006d.md`
- `docs/room-realism-runs.md`(6 run batches)
- `docs/biography-run.md`(3 runs)
- `docs/interviewer-v2-run.md`(8 rounds)
- `docs/eval-ledger.md`

---

## 5. 文档同步

| 文件 | 改动 |
|---|---|
| `docs/claims-audit.md` | 全面重写:修正状态、更新行号、新增条目、新增 Known defects 节、新增核查列 |
| `README.md` | 修正"借鉴与致谢"节(contested 否决流/论断权限墙/DEPLOY-FOR-AI 从"计划"移到"已实现";明确论断配对≠反证搜索);已完成节补录 14 项 |
| `README.en.md` | 更新插件计数(3→8);其余已与 claims-audit 一致无需改动 |
| `docs/en/_claims-check.md` | 重新生成,95 条全部对齐 |
| `docs/ARCHITECTURE.md` | GateEngine 去掉"(planned)"标注;目录布局补录 5 个生产插件 |

---

## 6. 状态汇总变化

| | 旧 | 新 |
|---|---|---|
| 已实现 | 57 | 70 |
| 部分 | 4 | 9 |
| 计划 | 8 | 9 |
| 总条目 | 69 | 88 |

---

## 7. 需主控复核的事项

1. **反证搜索降级**:从"已实现"降为"计划"。请确认项目对衔枝反证搜索的定义理解是否一致(对既有论断生成反面假设→HyDE 反用检索碎片库找反证 vs. 跨证人论断配对)。
2. **persona-verify 是否应接入端点**:当前为库函数,仅回归脚本手动调用。是否接入 mount-openai 作为可选的输出侧核对?
3. **QR 生成器孤立代码**:有代码+测试但无端点引用,是否列入 roadmap 或移除?
4. **人格包隐私过滤**:主干有后续修订(feat 分支),合并后需复核导出是否正确过滤 doNotRaiseToSubject 答案。
5. **Docker 未实测**:Dockerfile + docker-compose.yml 存在但未在真实 Docker 宿主实测。
6. **活人感台架阻断**:需真人标注数据才能标定(>80% 准确率 / >=20 有效对 / <=30% 位置偏置)。
7. **eval-ledger 作废条目**:entries 2/3 已因 EvalLLMClient 缺 thinking:disabled 作废;entry 5 round 2 中断。不得引用为有效结果。
