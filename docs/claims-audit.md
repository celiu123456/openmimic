# README 声明逐条审计

> 核查日期:2026-10-08 · 基线:feat/docs-audit(1158 测试通过)
> 核查方式说明:读代码 = 人工逐文件阅读;跑测试 = `npx vitest run <file>`

状态说明:
- **已实现**:有代码路径,有测试覆盖
- **部分**:有代码但弱于 README 声明(详见备注)
- **计划**:无代码

---

## 首段定位

| 声明 | 状态 | 代码依据 | 测试 | 备注 | 核查 |
|---|---|---|---|---|---|
| 从 0 实现的对抗式人格引擎 | 已实现 | `engines/court/src/court.ts` 全文 | `engines/court/test/court.test.ts` | README 已删除"多智能体"一词;管线是多步 LLM 调用(filing→pairing→relation→confrontation),非独立智能体进程 | 2026-10-08 读代码 |
| 收集认识你的人的证言 | 已实现 | `engines/witness/src/testimony.ts` · `engines/witness/src/invite.ts` · `engines/witness/src/interview.ts` | `engines/witness/test/witness.test.ts` · `engines/witness/test/interview.test.ts` | 问卷采集 + 邀请链接 + AI 追问式访谈 | 2026-10-08 读代码 |
| 让多个步骤在"人格法庭"上交叉质询 | 已实现 | `engines/court/src/court.ts` | `engines/court/test/court.test.ts` | v2 管线:filing → pairing → relation judgment → confrontation → conviction。是多步 LLM 调用而非独立运行的智能体进程;README 已用"交叉质询"替代"多智能体" | 2026-10-08 读代码 |
| 只有在对质中存活的侧面才进入人格 | 已实现 | `engines/court/src/court.ts`(runCourt) · `kernel/src/persona.ts` | `engines/court/test/court.test.ts` · `kernel/test/persona.test.ts` | 裁定 contested 的论断不进入基线;persona 组装只取 status=surviving | 2026-10-08 读代码 |
| 每一个数字人格都带证据链 | 已实现 | `shared/src/schemas.ts`(ClaimSchema) · `kernel/src/store.ts`(putClaim) | `kernel/test/claim-evidence.test.ts` | Claim.evidence 至少一条且必须指向账本中存在的证言;putClaim 无锚则抛 NoEvidenceError;v2 新增 episodeIds/witnessIds 锚定 | 2026-10-08 读代码+跑测试 |
| 任何一条性格结论,都能回答"这是谁说的、原话是什么、被谁质疑过" | 已实现 | `shared/src/schemas.ts`(ClaimSchema + EpisodeSchema) · `engines/court/src/court.ts` | `engines/court/test/court.test.ts` | claim.evidence + witnessIds 锚定证人;episodeIds 锚定事例;courtSessionId 指向法庭会话;synthesis_only 授权下原话替换为 [withheld] | 2026-10-08 读代码 |

## "你下载后能做什么"

| 声明 | 状态 | 代码依据 | 测试 | 备注 | 核查 |
|---|---|---|---|---|---|
| 你不在的房间(背后房间 + 推门) | 已实现 | `engines/room/src/room.ts:1819`(runBehindRoom)· `engines/room/src/room.ts:2052`(openDoor) · `web/src/room.ts` | `engines/room/test/room.test.ts` · `engines/room/test/room-realism.test.ts` | 单房间可用;背后/当面双模式 | 2026-10-08 读代码(行号已更新) |
| 把测评链接发给朋友 | 已实现 | `engines/witness/src/invite.ts` · `server/src/server.ts` | `engines/witness/test/witness.test.ts` | 邀请链接可创建、可解析,前端有对应表单 | 2026-10-08 读代码 |
| 复刻任何人 | 已实现 | `engines/witness/` + `engines/court/` + `kernel/src/persona.ts` | 多文件覆盖 | 采集→法庭→persona 组装完整链路 | 2026-10-08 读代码 |
| 历史人物构建(.persona 导入) | 已实现 | `server/src/persona-package.ts` | `server/test/persona-package.test.ts` | 导入 .persona 包创建新 subject,claims 锚定到导入收据 | 2026-10-08 读代码 |
| 预演万局(跟数字老板谈加薪等) | 已实现 | `server/src/mount-openai.ts` · `kernel/src/persona.ts` | `server/test/openai.test.ts` | 通过 persona/<id> 模型端点对话 | 2026-10-08 读代码 |
| 平行组织 | 计划 | — | — | README 已标 roadmap,代码中无多房间级联或组织级并行 | 2026-10-08 读代码 |
| OpenAI 兼容端点 | 已实现 | `server/src/mount-openai.ts` | `server/test/openai.test.ts` | /v1/models + /v1/chat/completions,支持 stream;已重构为 mount plugin | 2026-10-08 读代码 |
| MCP Server | 已实现 | `server/src/mount-mcp.ts` · `server/src/mcp/protocol.ts` · `server/src/mcp/main.ts` | `server/test/mcp.test.ts` | JSON-RPC 2.0 over stdio;已重构为 mount plugin;可通过 config 禁用 | 2026-10-08 读代码 |
| 纯库 import | 已实现 | `packages/core/src/index.ts` · `kernel/src/index.ts` | `examples/embed-as-library/main.test.ts` | `@openmimic/core` 的 createOpenMimic() 不起端口 | 2026-10-08 读代码+跑测试 |
| .persona 人格包 | 已实现 | `server/src/persona-package.ts` · `server/test/persona-package.test.ts` | `server/test/persona-package.test.ts` | 导出/导入双向,consent 过滤,round-trip 测试覆盖 | 2026-10-08 读代码 |
| OpenClaw skill | 计划 | — | — | 无代码 | 2026-10-08 |
| dsh bundle | 计划 | — | — | 无代码 | 2026-10-08 |
| 角色卡桥接(SillyTavern Character Card V2) | 已实现 | `plugins/bridge-sillytavern/src/index.ts` · `plugins/bridge-sillytavern/src/export.ts` · `plugins/bridge-sillytavern/src/import.ts` | `plugins/bridge-sillytavern/test/bridge-sillytavern.test.ts` | 双向转换(导入/导出 JSON 和 PNG);PNG 含嵌入式 chara tEXt 块。**局限**:未在真实 SillyTavern 实例中端对端验证 | 2026-10-08 读代码+跑测试 |

## 快速开始

| 声明 | 状态 | 代码依据 | 测试 | 备注 | 核查 |
|---|---|---|---|---|---|
| docker compose up -d | 已实现 | `Dockerfile` · `docker-compose.yml` | — | P4 新增;**未在真实 Docker 宿主上实测** | 2026-10-08 读代码 |
| 打开 http://localhost:7860 | 已实现 | `server/src/main.ts:22-23` | — | 默认端口 7860 | 2026-10-08 读代码 |
| 内置演示房间(虚构人物林默) | 已实现 | `fixtures/limo.ts` · `server/src/server.ts` | `server/test/fixture-validation.test.ts` | 空库自动 seed,无 API Key 也可体验 | 2026-10-08 读代码 |

## 架构

| 声明 | 状态 | 代码依据 | 测试 | 备注 | 核查 |
|---|---|---|---|---|---|
| 微内核:证言账本 | 已实现 | `kernel/src/store.ts`(schema + append-only triggers) | `kernel/test/ledger.test.ts` | SQLite 后端,DELETE/UPDATE trigger 阻止篡改 | 2026-10-08 读代码+跑测试 |
| 微内核:人格图谱 | 计划 | — | — | 无独立图谱数据结构;persona 组装是 claim 列表到 prompt 的一次性拼接(`kernel/src/persona.ts`) | 2026-10-08 读代码 |
| 微内核:插件装配 | 已实现 | `kernel/src/plugin-host.ts` · `kernel/src/config.ts` | `kernel/test/plugin-host.test.ts` | v1: inject/provide 依赖注入,topo sort(Kahn),unload(反向 dispose + 依赖检查),Registry 扩展点(collectors/scenarios),YAML config tree(三层合并) | 2026-10-08 读代码+跑测试 |
| 微内核:授权门 | 已实现 | `kernel/src/gate.ts` · `kernel/test/gate.test.ts` | `kernel/test/gate.test.ts` | synthesis_only 遮蔽,court/external 双 scope | 2026-10-08 读代码+跑测试 |
| 官方五引擎(WitnessEngine / CourtEngine / GraphEngine / RoomEngine / GateEngine) | 部分 | 见下表 | — | 四个引擎已实现并重写为标准 Plugin 对象;GraphEngine 无代码 | 2026-10-08 读代码 |

### 引擎逐项

| 引擎 | 状态 | 代码依据 | 测试 | 备注 | 核查 |
|---|---|---|---|---|---|
| WitnessEngine | 已实现 | `engines/witness/src/plugin.ts` · `engines/witness/test/` | `engines/witness/test/witness.test.ts` 等 6 个测试文件 | 采集、邀请、问卷、AI 追问访谈,注册为 collector 类型插件;v2 访谈策略(三关系变体问卷、9 意图分类、退缩检测、证据基础标注、质量门含去重/单问题/防提前结束、反机械追问)迁自作者此前的平台项目 | 2026-10-08 读代码 |
| CourtEngine | 已实现 | `engines/court/src/court.ts` · `engines/court/src/conflict.ts` · `engines/court/src/plugin.ts` | `engines/court/test/court.test.ts` · `engines/court/test/wiring-behavioral.test.ts` | v2 管线:filing → pairing(LLM/Embedding/Keyword 三级回落) → relation judgment → confrontation → conviction computation;divergence map 保留视角差异 | 2026-10-08 读代码+跑测试 |
| GraphEngine | 计划 | `engines/graph/` 只有 .gitkeep | — | 无代码;README 声称"人格是图的实时派生物……改一条证言自动重算"无实现 | 2026-10-08 读代码 |
| RoomEngine | 已实现 | `engines/room/src/room.ts` · `engines/room/src/plugin.ts` | `engines/room/test/room.test.ts` 等 7 个测试文件 | 背后/当面双模式,round-robin 调度,consent overlap 防护,crisis/diagnosis 词表,no-talk list(LLM 生成 + 规则兜底),两级泄密检测(关键词 + LLM),guided rewrite(最多两次),25% 舞台提示上限。**局限**:防护依赖模型判定,不是保证;清单每次生成可能不同;部分泄露的判定边界取决于模型理解力 | 2026-10-08 读代码 |
| GateEngine | 已实现 | `engines/gate/src/gate.ts` · `engines/gate/src/plugin.ts` | `engines/gate/test/gate.test.ts` | 论断否决(contest/uncontest)、诊断词/危机词权限墙(filterSessionClaims)、re-raise 机制(canReraise + checkReraiseAfterCourt)、reraised 结构化字段。contest 记录持久化于插件表(append-only)。前端 CourtReportView 提供否决按钮 | 2026-10-08 读代码+跑测试 |

## CourtEngine 细项

| 声明 | 状态 | 代码依据 | 测试 | 备注 | 核查 |
|---|---|---|---|---|---|
| 证人的证言被送入 filing 提取论断+事例 | 已实现 | `engines/court/src/court.ts`(filing) | `engines/court/test/court.test.ts` | 每个证人的证言被送入 filing prompt 提取论断+事例,但没有独立的证人"作答"智能体 | 2026-10-08 读代码 |
| 质询(关系判定 + 对质) | 已实现 | `engines/court/src/court.ts`(relation judgment + confrontation) | `engines/court/test/court.test.ts` | v2: pairing 找到论断对后 LLM 判定关系;factual_conflict 进入 confrontation 对质 | 2026-10-08 读代码 |
| 仲裁(conviction 计算) | 已实现 | `engines/court/src/court.ts`(computeConviction) | `engines/court/test/court.test.ts`(6 条 computeConviction 专项测试) | 裁定由 confrontation LLM 调用 + computeConviction 纯函数完成 | 2026-10-08 读代码+跑测试 |
| 置信分(conviction) | 已实现 | `engines/court/src/court.ts`(computeConviction) | `engines/court/test/court.test.ts` | v2: 纯函数,base 0.5,+0.12/witness cap 0.9,无 episode cap 0.55,全 elicited ×0.85,未 paired cap 0.6,contested=0 | 2026-10-08 读代码+跑测试 |
| 论断配对(跨证人相关材料检索) | 已实现 | `engines/court/src/conflict.ts` | `engines/court/test/court.test.ts` | v2: LLMClaimPairFinder(一次 LLM 调用)、EmbeddingClaimPairFinder(余弦,threshold 0.55)、KeywordClaimPairFinder(关键词,minimumOverlap 2)三级实现;跳过同证人和共享证据的论断对。**此为本项目自有机制,非衔枝反证搜索** | 2026-10-08 读代码 |
| 分歧图(divergence map) | 已实现 | `engines/court/src/court.ts` · `shared/src/schemas.ts`(DivergenceSchema) · `web/src/views/CourtReportView.vue` | `engines/court/test/court.test.ts` | 视角差异生成 divergence 记录(type=perspective/factual,resolution=kept_both/contested),前端展示 | 2026-10-08 读代码 |
| GraphEngine 实时重算 | 计划 | — | — | 无代码 | 2026-10-08 |
| contested 否决流 | 已实现 | `engines/gate/src/gate.ts`(contestClaim/uncontestClaim) · `engines/gate/src/plugin.ts` | `engines/gate/test/gate.test.ts` | contest→contested 态(退出人格);可撤回;re-raise 在新证据充足时自动恢复 | 2026-10-08 读代码+跑测试 |
| 论断权限墙(心理健康主题只记事实不生成准诊断) | 已实现 | `engines/gate/src/gate.ts`(filterSessionClaims/validateClaimText) · `engines/room/src/wordlist.ts` | `engines/gate/test/gate.test.ts` | GateEngine:诊断词/危机词(>=20 个)→自动 retired;RoomEngine 危机词拒绝开房间;诊断词触发重写/降级 | 2026-10-08 读代码+跑测试 |
| 集体沉默检测 | 已实现 | `plugins/silence-signal/src/index.ts` · `shared/src/schemas.ts`(SilenceSignalSchema) | `plugins/silence-signal/test/silence-signal.test.ts` | avoidedQids >= half 且 >= 3 + raise-then-retreat 证据 → SilenceSignal 存入插件表;人格组装加集体沉默纪律行;前端展示 | 2026-10-08 读代码+跑测试 |
| 确定性配对预判(classifyPair) | 已实现 | `engines/court/src/conflict.ts`(classifyPair) | `engines/court/test/wiring-behavioral.test.ts` | 5 种关系(perspective_differs/retelling_diverges/supersedes/refines/contradicts);LLM 前确定性规则匹配,命中则跳过 LLM 调用 | 2026-10-08 读代码+跑测试 |

## .persona 人格包

| 声明 | 状态 | 代码依据 | 测试 | 备注 | 核查 |
|---|---|---|---|---|---|
| 导出为 .persona 包(含脱敏证言摘要、基线、体检报告、授权范围) | 已实现 | `server/src/persona-package.ts` | `server/test/persona-package.test.ts` | v2: 包含 claims(基线)、episodes(quotable 事例)、divergences(分歧)、corpus(当事人原话)、report(体检报告)、witnesses(含 consentLevel);向后兼容 v1。**注意**:导出未做私密字段过滤(主干有后续修订,合并后复核) | 2026-10-08 读代码+跑测试 |
| 社区可发布公共人格包 | 计划 | — | — | 无社区分发机制 | 2026-10-08 |

## "和现有路线的区别"表

| 声明 | 状态 | 代码依据 | 测试 | 备注 | 核查 |
|---|---|---|---|---|---|
| 数据来源:他人证言 | 已实现 | `engines/witness/` | — | — | 2026-10-08 |
| 能回答"这是谁说的":每一条 | 已实现 | `shared/src/schemas.ts`(evidence 字段) | `kernel/test/claim-evidence.test.ts` | 论断级锚定到证言条目 | 2026-10-08 |
| 背后/当面区分 | 已实现 | `engines/room/src/room.ts` · `shared/src/schemas.ts`(behindText/frontText) | `engines/room/test/room.test.ts` | — | 2026-10-08 |
| 规模形态:真人格×组织级 | 部分 | — | — | 单人/单房间可用;组织级(平行组织、多房间级联)无实现 | 2026-10-08 |
| "自训练路线在物理上做不出" | — | — | — | 非功能声明,是对比论述;中文 README 已改为事实性表述("自训练路线的自述数据中不包含他人的背后看法") | 2026-10-08 |

## 授权与溯源

| 声明 | 状态 | 代码依据 | 测试 | 备注 | 核查 |
|---|---|---|---|---|---|
| 证言人提交时选择授权级别 | 已实现 | `shared/src/schemas.ts`(ConsentLevelSchema) · `engines/witness/src/testimony.ts` | `engines/witness/test/witness.test.ts` | quotable / synthesis_only | 2026-10-08 |
| 背后房间只使用授权展示的材料 | 已实现 | `kernel/src/gate.ts` · `server/src/external.ts` | `kernel/test/gate.test.ts` | synthesis_only 在 external scope 下被替换为 [withheld] | 2026-10-08 |
| 每条人格结论可回溯到证言原文与来源 | 已实现 | `shared/src/schemas.ts` · `kernel/src/store.ts` | `kernel/test/claim-evidence.test.ts` | Claim.evidence 必须非空且指向存在的证言 | 2026-10-08 |
| 分歧保留不裁决谁对 | 已实现 | `engines/court/src/court.ts`(relation judgment) · `shared/src/schemas.ts`(DivergenceSchema) | `engines/court/test/court.test.ts` | perspective_difference 生成 divergence 记录保留双方观点 | 2026-10-08 |
| AI 生成内容与原始证言物理隔离 | 已实现 | `kernel/src/store.ts`(append-only triggers) · `shared/src/schemas.ts`(correctionOf 链) | `kernel/test/ledger.test.ts` | 证言表有 DELETE/UPDATE 触发器;room transcript 独立表;AI 产物不回灌证言 | 2026-10-08 |
| 复刻在世他人用于私人预演;公开分发需本人授权 | 部分 | — | — | 无技术措施强制"公开分发需本人授权" | 2026-10-08 |
| 本人可否决关于自己的论断→降级 contested 态 | 已实现 | `engines/gate/src/gate.ts`(contestClaim) · `engines/gate/src/plugin.ts` | `engines/gate/test/gate.test.ts` | contest→contested(退出人格);uncontest 撤回;re-raise | 2026-10-08 |
| 危机词命中即拒绝开房间 | 已实现 | `engines/room/src/wordlist.ts` · `engines/room/src/room.ts:1826-1829` | `engines/room/test/room.test.ts` | 话题种子含危机词则抛 RoomRefusedError | 2026-10-08 读代码 |

## 借鉴与致谢

| 声明 | 状态 | 代码依据 | 测试 | 备注 | 核查 |
|---|---|---|---|---|---|
| conviction 置信分(借鉴衔枝) | 已实现 | `engines/court/src/court.ts`(computeConviction) | `engines/court/test/court.test.ts` | 纯函数动态计算,base 0.5。借鉴的是置信分的思路,代码为全新实现 | 2026-10-08 读代码 |
| contested 状态命名(借鉴衔枝) | 已实现 | `shared/src/schemas.ts`(ClaimStatusSchema) · `engines/court/src/court.ts` | — | v2: 事实冲突对质后 unresolved→contested(conviction=0)。命名借鉴,代码为全新实现 | 2026-10-08 读代码 |
| 反证搜索(借鉴衔枝) | **计划** | — | — | 衔枝反证搜索的设计语义:对既有论断生成反面假设,HyDE 反用检索碎片库找反证。本仓无此代码。`conflict.ts` 中的 EmbeddingClaimPairFinder / KeywordClaimPairFinder 是**本项目自有的论断配对机制**(跨证人找语义相关材料),不生成反面假设、不做反证检索,设计语义不同。**此行从"已实现"降为"计划"** | 2026-10-08 读代码+对照 ATTRIBUTION.md |
| 盲推导审计(借鉴衔枝) | 计划 | — | — | 无代码 | 2026-10-08 |
| contested 否决流(借鉴衔枝) | 已实现 | `engines/gate/src/gate.ts` · `engines/gate/src/plugin.ts` | `engines/gate/test/gate.test.ts` | contest/uncontest 完整流程 + re-raise 机制 | 2026-10-08 读代码+跑测试 |
| 论断权限墙(借鉴衔枝) | 已实现 | `engines/gate/src/gate.ts`(validateClaimText/filterSessionClaims) | `engines/gate/test/gate.test.ts` | 独立 GateEngine:诊断词/危机词(>=20 个)命中→论断自动 retired | 2026-10-08 读代码+跑测试 |
| 危机协议三原则(借鉴衔枝) | 部分 | `engines/room/src/wordlist.ts` · `engines/room/src/room.ts:1826-1829` | `engines/room/test/room.test.ts` | 危机词拒绝开房间;诊断词重写/降级;但衔枝的"用户级危机静默期→全局静默"及"零缓存路径、静态危机资源兜底"未实现 | 2026-10-08 读代码+对照 ATTRIBUTION.md |
| 过程评测三指标(证据覆盖/矛盾响应/记忆修复)(借鉴衔枝) | 部分 | `shared/src/schemas.ts`(CourtReport.evidenceCoverage) | — | evidenceCoverage 在 CourtReport 中;challengeCount 可视为矛盾响应代理指标;但"记忆修复"无对应 | 2026-10-08 读代码 |
| DEPLOY-FOR-AI 做法(借鉴衔枝) | 已实现 | `docs/DEPLOY-FOR-AI.md` | — | 含 Docker / systemd / 反向代理 / 访问控制 | 2026-10-08 读代码 |
| BettaFish ForumEngine 工程范式(参照) | — | — | — | 致谢条目,非功能声明 | 2026-10-08 |
| MiroFish 组织级群体模拟(对位参照) | — | — | — | 致谢条目,非功能声明 | 2026-10-08 |

## Roadmap

| 声明 | 状态 | 代码依据 | 测试 | 备注 | 核查 |
|---|---|---|---|---|---|
| v0.1:内核 + CourtEngine/WitnessEngine 最小闭环 + 单房间 + 推门 + 内置演示 | 已实现 | 上述各条目 | — | — | 2026-10-08 |
| v0.2:三个对外挂载口 + .persona 包 + GraphEngine 实时重算 | 部分 | — | — | 挂载口(OpenAI/MCP/纯库)和 .persona 已实现;GraphEngine 实时重算无代码 | 2026-10-08 |
| v0.3:多房间级联 + 采集器/剧本插件 API 冻结 | 计划 | — | — | — | 2026-10-08 |
| v1.0:插件市场 + 组织级并行法庭 | 计划 | — | — | — | 2026-10-08 |

---

## 语料箱(本人原话)

| 声明 | 状态 | 代码依据 | 测试 | 备注 | 核查 |
|---|---|---|---|---|---|
| 语料箱(本人原话可展示的段落) | 已实现 | `shared/src/schemas.ts`(CorpusItemSchema) · `kernel/src/store.ts`(putCorpusItem/listCorpusItemsBySubject) · `server/src/server.ts` · `kernel/src/persona.ts` | — | corpus_items 表物理独立于证言表;persona 组装 v2 的"他本人说过的话"段落和说话风格参照均取自 corpus;林默演示含 10 条 corpus items | 2026-10-08 读代码 |

---

## 补录:最近合入的能力

| 声明 | 状态 | 代码依据 | 测试 | 备注 | 核查 |
|---|---|---|---|---|---|
| 聊天记录导入(collector-chatlog) | 已实现 | `plugins/collector-chatlog/src/index.ts` · `plugins/collector-chatlog/src/parsers.ts` | `plugins/collector-chatlog/test/parsers.test.ts` 等 4 个测试文件 | 三种格式(text/csv/json);preview→import 两步;PII 脱敏+注入检测+回流筛查;只取被复刻者本人的话;导入标 source='imported'。详见 `docs/chatlog-import.md` | 2026-10-08 读代码+跑测试 |
| 角色卡桥接(bridge-sillytavern) | 已实现 | `plugins/bridge-sillytavern/src/index.ts` 等 5 个源文件 | `plugins/bridge-sillytavern/test/bridge-sillytavern.test.ts` | SillyTavern Character Card V2 双向转换(JSON + PNG chara 块);导入创建 subject + claims + corpus;导出含 acknowledgeRealPerson 门控。**未在真实 SillyTavern 实测** | 2026-10-08 读代码+跑测试 |
| 带权限范围的令牌(scoped tokens) | 已实现 | `server/src/auth.ts` · `server/src/scopes.ts` · `server/src/token-store.ts` | `server/test/scoped-auth.test.ts` | omk_ 前缀;9 种 scope;显式白名单(禁通配符);SHA-256 加盐哈希;含过期/撤销;路由无声明默认 admin(fail-closed)。主干有后续修订(路由声明补齐),合并后复核 | 2026-10-08 读代码+跑测试 |
| 能力目录(capabilities) | 已实现 | `server/src/capabilities.ts` | — | 机器可读的能力清单,含 scope 要求;GET /api/capabilities 为开放路由;插件可贡献能力声明。无独立测试(通过 server 集成测试间接覆盖) | 2026-10-08 读代码 |
| 话题覆盖调度(coverage scheduling) | 已实现 | `engines/witness/src/coverage.ts` | `engines/witness/test/coverage.test.ts` | computeCoverage:逐维度(untouched/shallow/covered/cautious);planQuestions:按优先级排序;adviseRelationGaps:推荐缺失关系类型。与 interview session fixation 联动 | 2026-10-08 读代码+跑测试 |
| 邀请短码(short codes) | 已实现 | `engines/witness/src/short-code.ts` · `engines/witness/src/invite.ts` | `engines/witness/test/short-code.test.ts` | 8 字符不混淆字母表(29 字符);crypto.randomInt;邀请创建时生成;GET /api/i/:code 解析 | 2026-10-08 读代码+跑测试 |
| QR 生成器 | 部分 | `shared/src/qr/qr.ts` · `shared/src/qr/index.ts` | `shared/test/qr.test.ts` | 零依赖 QR 码生成(支持 UTF-8 + SVG 输出)。**但**:未接入任何服务端路由或前端页面;未经独立解码器验证 | 2026-10-08 读代码+跑测试 |
| 提示词隔离(untrusted content isolation) | 已实现 | `shared/src/prompt/untrusted.ts` · `shared/src/prompt/render.ts` · `shared/src/prompt/guards.ts` | `shared/test/prompt-guard.test.ts` · `shared/test/prompt-untrusted.test.ts` | 所有用户文本入 LLM 前包裹数据块;注入检测(flag, don't reject);守卫测试扫描所有引擎源码确认覆盖 | 2026-10-08 读代码+跑测试 |
| 回流指纹(reflux detection) | 已实现 | `kernel/src/reflux.ts` · `kernel/src/store.ts`(ai_fingerprints 表) | `kernel/test/reflux.test.ts` | 3-char shingle MinHash 128 维,threshold 0.5;room/court 注册指纹;witness 提交时筛查;court filing 跳过 medium/high。**局限**:对改写(paraphrase)无效——低于 Jaccard 0.5 的回流不会被捕获 | 2026-10-08 读代码+跑测试 |
| 输出侧事实核对(persona-verify) | 已实现 | `kernel/src/persona-verify.ts` · `server/src/mount-openai.ts` | `kernel/test/persona-verify.test.ts` · `server/test/openai-verify.test.ts` | 已接入 `/v1/chat/completions`(2026-10-08,提交 9a9258b):默认开,环境变量 `PERSONA_VERIFY` 可关;流式请求在开启时先缓冲再输出;核对出错返回保守回答并带 `x-openmimic-verify` 响应头。2026-10-09 提交 e586cf3:excludedPrivateTopics 已从 assemblePersonaContext 传入 verifyPersonaResponse(stream/non-stream 双路径),入口级集成测试覆盖确认/否认两场景;原已知缺陷 #11 已修 | 2026-10-09 读代码+跑测试 |
| 说话风格画像(style-stats) | 已实现 | `kernel/src/style-stats.ts` · `kernel/src/persona.ts:837-844` | `kernel/test/style-stats.test.ts` | 消息力量画像(中位长度/p90/单句率/语气词密度/目标长度范围) + 言语行为模板(10 类) + 常用语提取;已接入 persona 组装(renderStyleDiscipline 写入 system prompt 的"说话风格"段) | 2026-10-08 读代码+跑测试 |
| 证言集(biography) | 已实现 | `plugins/output-biography/src/index.ts` | `plugins/output-biography/test/output-biography.test.ts` | POST /api/subjects/:id/biography 生成;逐章验证引语来源;保密内容过滤;无据细节检查;质量门。**已知局限**:质检分数缺区分度(全部 95);章标题偶带"第N章"前缀(模型产物) | 2026-10-08 读代码+对照 biography-run.md |
| 活人感台架(liveness evaluation) | 部分 | `eval/src/liveness-judge.ts` · `eval/src/liveness-rubric.ts` · `eval/src/liveness-scenarios.ts` 等 | `eval/test/liveness.test.ts` | 13 信号量表、成对盲评、SHA 冻结、样本卫生检测已建。**未标定**:无人工标注真人样本;不会产出有效读数直到标定通过(>80% 准确率,>=20 有效对,<=30% 位置偏置) | 2026-10-08 读代码 |
| 访谈员 v2(interview v2 strategy) | 已实现 | `engines/witness/src/interview.ts` · `engines/witness/src/input-intent.ts` · `engines/witness/src/retreat.ts` · `engines/witness/src/basis.ts` | `engines/witness/test/interview.test.ts` · `engines/witness/test/v2-modules.test.ts` · `engines/witness/test/basis-regression.test.ts` | 9 意图分类、退缩检测(volitional/pressure/fatigue/circumstantial/none)、证据基础标注(witnessed/heard/inferred/unknown)、质量门(去重/单问题/防提前结束)、反机械追问。**已知局限**:basis 分类器有 3/8 误分类(见 interviewer-v2-run.md) | 2026-10-08 读代码+对照 interviewer-v2-run.md |
| 当面房间防泄密 | 已实现 | `engines/room/src/room.ts`(openDoor 中调用 no-talk list + leakCheck) | `engines/room/test/no-talk-list.test.ts` · `engines/room/test/room.test.ts` | 2026-10-07b regression run 确认当面房间 0 泄密(11 条发言)。no-talk list 在当面模式下同样生效 | 2026-10-08 读代码+对照 regression-run-20261007b.md |
| 留一证人(LOWO)与对照臂 | 已实现 | `eval/src/lowo.ts` · `eval/src/ablation.ts` | `eval/test/eval.test.ts` | LOWO 胜率 87.5%(14/16),Wilson CI [64.0%, 96.5%];对照臂三组(baseline/claims-stripped/episodes-stripped)首次产出读数。**注意**:eval-ledger entries 2/3 已作废(EvalLLMClient 缺 thinking:disabled),entry 5 round 2 稳定度因 token 预算耗尽中断——这些作废条目不得引用为有效结果 | 2026-10-08 读代码+对照 eval-ledger.md |
| 四级披露(disclosure) | 已实现 | `kernel/src/disclosure.ts` | — | speakable / reference_only / presence_only / excluded + holdUntilRaised;已接入 persona 组装(excluded 过滤,reference_only/presence_only 标注)。无独立测试文件(通过 persona.test.ts 间接覆盖) | 2026-10-08 读代码 |
| 元知觉(meta-perception) | 已实现 | `plugins/meta-perception/src/index.ts` | `plugins/meta-perception/test/meta-perception.test.ts` | 主体预测证人作答,LLM 评分,per-witness breakdown;synthesis_only 证人脱敏 | 2026-10-08 读代码+跑测试 |
| 三档发言分类(expression tiers) | 已实现 | `engines/room/src/tier.ts` | `engines/room/test/tier.test.ts` · `engines/room/test/fixture-tier.test.ts` | quote / paraphrase / extrapolate;预生成 deriveExpressionTier + 后生成 classifyUtterance | 2026-10-08 读代码+跑测试 |
| 匿名证人(anonymousInRoom) | 已实现 | `engines/room/src/room.ts`(anonymousDisplayLabel/buildDisplayLabels) | `engines/room/test/anonymous.test.ts` | anonymousInRoom 标记的证人使用脱敏显示名 | 2026-10-08 读代码+跑测试 |

---

## P4: 安全与可靠性批次

| 声明 | 状态 | 代码依据 | 测试 | 备注 | 核查 |
|---|---|---|---|---|---|
| 不可信内容隔离 | 已实现 | `shared/src/prompt/untrusted.ts` · `shared/src/prompt/render.ts` | `shared/test/prompt-guard.test.ts` · `shared/test/prompt-untrusted.test.ts` | 守卫测试扫描所有引擎源码确认覆盖 | 2026-10-08 读代码+跑测试 |
| 注入检测 | 已实现 | `shared/src/prompt/untrusted.ts`(detectInjection) · `engines/witness/src/testimony.ts` | `shared/test/prompt-untrusted.test.ts` | 提交时标记 suspectedInjection,不拒收 | 2026-10-08 读代码 |
| AI 产物回流检测(MinHash 指纹 + 筛查) | 已实现 | `kernel/src/reflux.ts` · `kernel/src/store.ts` | `kernel/test/reflux.test.ts` | 同上"回流指纹"条目 | 2026-10-08 |
| 法庭过滤 medium/high 回流证言 | 已实现 | `engines/court/src/court.ts`(allTestimonies 过滤) | `engines/court/test/court.test.ts` | court filing 阶段跳过 refluxSuspicion=medium/high | 2026-10-08 读代码 |
| 模型调用错误分类(9 类) | 已实现 | `shared/src/provider-error.ts` | `shared/test/provider-error.test.ts` | RATE_LIMIT / AUTH_FAILED / QUOTA_EXHAUSTED / TIMEOUT 等 | 2026-10-08 读代码+跑测试 |
| 修复 attemptJson 盲重试 | 已实现 | `engines/court/src/court.ts`(attemptJson) · `engines/room/src/room.ts` | — | 非 retryable 错误立即返回 | 2026-10-08 读代码 |
| 合并 extractJson | 已实现 | `shared/src/llm-json.ts` | `shared/test/llm-json.test.ts` | tryExtractJson + generateStructuredJson(带修复循环) | 2026-10-08 读代码+跑测试 |
| PII 脱敏 | 已实现 | `shared/src/sanitize.ts` | `shared/test/sanitize.test.ts` | 可配置开关;按长度优先匹配 | 2026-10-08 读代码+跑测试 |
| 敏感字段掩码 | 已实现 | `shared/src/sanitize.ts`(maskSensitiveFields) | `shared/test/sanitize.test.ts` | 深度克隆 + password/token/key 类字段替换 | 2026-10-08 |
| 稳定序列化 + 短哈希 | 已实现 | `shared/src/sanitize.ts`(stableStringify/shortHash) | `shared/test/sanitize.test.ts` | 键排序 + SHA-256 前 8 hex | 2026-10-08 |
| 证据基础分类修复 | 已实现 | `engines/witness/src/basis.ts` | `engines/witness/test/basis-regression.test.ts` | "大概"+数字不触发 inferred;一人称事件叙事归 witnessed;unknown 上限 0.85 | 2026-10-08 读代码+跑测试 |

---

## 汇总

| 状态 | 条数 |
|---|---|
| 已实现 | 70 |
| 部分 | 9 |
| 计划 | 9 |

---

## Known defects / 已知缺陷

以下缺陷来自各真模型运行记录,截至 2026-10-09 更新。

| # | 现象 | 出处 | 状态 |
|---|---|---|---|
| 1 | no-talk list 非确定性:同一 fixture 两次运行分别产出 6 条和 2 条(最少 1 条);清单条目覆盖范围不稳定 | eval-ledger entry 11;room-realism-runs.md run 1 vs run 2 | 未修(设计性:LLM 生成结果不确定) |
| 2 | 证据基础分类器(basis classifier)在访谈 v2 验证中有 3/8 误分类(expected witnessed, got unknown/inferred) | docs/interviewer-v2-run.md rounds 2/3/8 | 未修 |
| 3 | 证言集(biography)质检分数无区分度:全部章节均 95 分;无法区分质量好坏 | docs/biography-run.md 第三次 self-assessment | 未修 |
| 4 | 证言集章标题偶带"第N章:"前缀(模型产物,非代码 bug) | docs/biography-run.md known issues | 未修 |
| 5 | Docker 文件(Dockerfile + docker-compose.yml)未在真实 Docker 宿主上实测 | claims-audit docker 行 | 未修(未实测) |
| 6 | eval-ledger entries 2/3 因 EvalLLMClient 未禁 DeepSeek thinking 而作废(法庭零论断);entry 5 round 2 稳定度因 token 预算耗尽中断 | docs/eval-ledger.md entries 2/3/5 | 已修(commit 88320a0),作废条目保留历史但不得引用为有效结果 |
| 7 | 人格包导出未做私密字段过滤 | 代码审查(审计时):server/src/persona-package.ts 无 privacy 过滤逻辑 | 已修待复验(提交 98f39b8:导出时应用与人格装配相同的私密过滤,分歧立场摘要置为 [redacted],导出真人需显式确认;有离线测试,未做人工通读) |
| 8 | 当面房间 half-truth 机制的泄密风险:半句真话选词来自背后房间记忆,可能间接泄露秘密内容 | 代码审查:room.ts half-truth slot 从 behindMemory 取词 | 已修待复验(regression-run-20261007b 显示 0 泄密,但 half-truth 场景未被显式攻击测试) |
| 9 | 活人感台架(liveness)未标定:无人工标注真人样本,管线不会产出有效读数 | docs/eval-ledger.md liveness 节 | 未修(阻断条件:需真人标注数据) |
| 10 | QR 生成器未经独立解码器验证,未接入任何端点或页面 | shared/src/qr/qr.ts 有代码+测试,但 server/web 无引用 | 未修(功能孤立) |
| 11 | 人格对被嘱托保密之事的提问会确认或否认(实测:答"借过……"或"没有的事,你听谁说的"),输出侧核对放行 | docs/regression-run-20261007b.md Phase B Round 3;主控 2026-10-08 对 /v1/chat/completions 的真模型实测 | 已修(提交 e586cf3):mount-openai.ts 将 excludedPrivateTopics 从 assemblePersonaContext 传入 verifyPersonaResponse(stream/non-stream 双路径),入口级集成测试覆盖确认/否认两种场景 |
| 12 | 当面房间母亲台词"一个月才露一回脸"与所锚定证言"他说好,就真回来。刮风下雨也回来"直接矛盾(q9),档位为 paraphrase 但内容相反 | docs/regression-run-20261008.md Phase C Front line 4 | 已修(提交 e586cf3):新增 llmVerifyContradiction 守卫,对 quote/paraphrase 档位的有锚台词逐句判定是否与证言矛盾;矛盾则重写,仍矛盾降为舞台提示;FakeLLM 回归测试覆盖 |
| 13 | 苏芷 fixture 无任何证人填写 frontText,当面房间产出全部为舞台提示(无意义) | docs/regression-run-20261008.md Phase D Front | 已修(提交 e586cf3):openDoor 新增 FrontUnavailableError 阈值检查(默认 MIN_FRONT_TEXT_WITNESSES=2),不足则返回 422/front_unavailable;前端显示引导文案 |
| 14 | 知情证人上下文中保留敏感事实,模型自然产出委婉表述("走得干脆""走之前那阵子""最后那一下")绕过输出侧关键词+LLM 验证 | docs/regression-run-20261009.md Behind lines 10-11 | 已修:新增 sanitiseMemoryForNoTalk 双层剔除(关键词+LLM 语义判断),在生成前从知情证人上下文中移除敏感素材;输出侧 llmVerifyLeak 提示词增补委婉表述模式;FakeLLM 回归测试覆盖;人格包审计脚本 scripts/check-persona-package.ts 验证私密内容不泄漏(PASS) |
