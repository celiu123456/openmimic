# README 声明逐条审计

> 生成时间:2026-10-05 · 基线:main(189 测试)

状态说明:
- **已实现**:有代码路径,有测试覆盖
- **部分**:有代码但弱于 README 声明(详见备注)
- **计划**:无代码

---

## 首段定位

| 声明 | 状态 | 代码依据 | 备注 |
|---|---|---|---|
| 从 0 实现的对抗式多智能体人格引擎 | 部分 | `engines/court/src/court.ts` 全文 | 有对抗式管线,但"多智能体"实际是多次 LLM 调用(立案一次 + 每条论断质询一次),没有独立运行的智能体进程 |
| 收集认识你的人的证言 | 已实现 | `engines/witness/src/testimony.ts` · `engines/witness/src/invite.ts` · `engines/witness/src/interview.ts` | 问卷采集 + 邀请链接 + AI 追问式访谈 |
| 让多个智能体在"人格法庭"上交叉质询 | 部分 | `engines/court/src/court.ts` | v2 管线:filing(LLM 提取论断+事例) → pairing(embedding/关键词) → relation judgment(LLM 判定 agreement/perspective_difference/factual_conflict/unrelated) → confrontation(事实冲突进 LLM 对质)。仍非独立运行的智能体进程,是多步 LLM 调用 |
| 只有在对质中存活的侧面才进入人格 | 已实现 | `engines/court/src/court.ts`(runCourt) · `kernel/src/persona.ts` | 裁定 contested 的论断不进入基线;persona 组装只取 status=surviving |
| 每一个数字人格都带证据链 | 已实现 | `shared/src/schemas.ts`(ClaimSchema) · `kernel/src/store.ts`(putClaim) | Claim.evidence 至少一条且必须指向账本中存在的证言;putClaim 无锚则抛 NoEvidenceError;v2 新增 episodeIds/witnessIds 锚定 |
| 任何一条性格结论,都能回答"这是谁说的、原话是什么、被谁质疑过" | 已实现 | `shared/src/schemas.ts`(ClaimSchema + EpisodeSchema) · `engines/court/src/court.ts` | claim.evidence + witnessIds 锚定证人;episodeIds 锚定事例(证言原文逐字子串);courtSessionId 指向法庭会话(质疑记录在 transcript + divergences);synthesis_only 授权下原话替换为 [withheld] |

## "你下载后能做什么"

| 声明 | 状态 | 代码依据 | 备注 |
|---|---|---|---|
| 你不在的房间(背后房间 + 推门) | 已实现 | `engines/room/src/room.ts:358-418`(behind)· `engines/room/src/room.ts:435-479`(openDoor) · `web/src/room.ts` | 单房间可用;背后/当面双模式 |
| 把测评链接发给朋友 | 已实现 | `engines/witness/src/invite.ts` · `server/src/server.ts:217-225` | 邀请链接可创建、可解析,前端有对应表单 |
| 复刻任何人 | 已实现 | `engines/witness/` + `engines/court/` + `kernel/src/persona.ts:166-243` | 采集→法庭→persona 组装完整链路 |
| 历史人物构建(.persona 导入) | 已实现 | `server/src/persona-package.ts:212-280` | 导入 .persona 包创建新 subject,claims 锚定到导入收据 |
| 预演万局(跟数字老板谈加薪等) | 已实现 | `server/src/server.ts:497-601`(OpenAI 兼容端点) · `kernel/src/persona.ts` | 通过 persona/<id> 模型端点对话 |
| 平行组织 | 计划 | — | README 已标 roadmap,代码中无多房间级联或组织级并行 |
| OpenAI 兼容端点 | 已实现 | `server/src/server.ts:478-601` | /v1/models + /v1/chat/completions,支持 stream |
| MCP Server | 已实现 | `server/src/mcp/protocol.ts` · `server/src/mcp/main.ts` | JSON-RPC 2.0 over stdio,手写实现,有测试(`server/test/mcp.test.ts`) |
| 纯库 import | 已实现 | `kernel/src/index.ts` · 各 engine `index.ts` | 每个包可独立 import |
| .persona 人格包 | 已实现 | `server/src/persona-package.ts` · `server/test/persona-package.test.ts` | 导出/导入双向,consent 过滤,round-trip 测试覆盖 |
| OpenClaw skill | 计划 | — | 无代码 |
| dsh bundle | 计划 | — | 无代码 |
| 角色卡转换器 | 计划 | — | 无代码(README 未显式提及此项,但属"装进任何应用"的隐含承诺) |

## 快速开始

| 声明 | 状态 | 代码依据 | 备注 |
|---|---|---|---|
| docker compose up -d | 计划 | — | 仓库根目录无 docker-compose.yml 或 Dockerfile |
| 打开 http://localhost:7860 | 已实现 | `server/src/main.ts:22-23` | 默认端口 7860 |
| 内置演示房间(虚构人物林默) | 已实现 | `fixtures/limo.ts` · `server/src/server.ts:703-704` | 空库自动 seed,无 API Key 也可体验 |

## 架构

| 声明 | 状态 | 代码依据 | 备注 |
|---|---|---|---|
| 微内核:证言账本 | 已实现 | `kernel/src/store.ts:127-195`(schema + append-only triggers) | SQLite 后端,DELETE/UPDATE trigger 阻止篡改 |
| 微内核:人格图谱 | 计划 | — | 无独立图谱数据结构;persona 组装是 claim 列表到 prompt 的一次性拼接(`kernel/src/persona.ts`) |
| 微内核:插件装配 | 部分 | `kernel/src/plugin-host.ts` | 最小版:注册 manifest + setup 回调;无依赖注入、无卸载、无生命周期管理 |
| 微内核:授权门 | 已实现 | `kernel/src/gate.ts` · `kernel/test/gate.test.ts` | synthesis_only 遮蔽,court/external 双 scope |
| 官方五引擎(WitnessEngine / CourtEngine / GraphEngine / RoomEngine / GateEngine) | 部分 | 见下表 | 只有三个引擎有代码;GraphEngine 和 GateEngine 作为独立引擎目录为空 |

### 引擎逐项

| 引擎 | 状态 | 代码依据 | 备注 |
|---|---|---|---|
| WitnessEngine | 已实现 | `engines/witness/src/plugin.ts` · `engines/witness/test/` | 采集、邀请、问卷、AI 追问访谈,注册为 collector 类型插件 |
| CourtEngine | 已实现 | `engines/court/src/court.ts` · `engines/court/src/conflict.ts` · `engines/court/src/plugin.ts` · `engines/court/test/court.test.ts` | v2 管线:filing(提取论断+事例) → pairing(EmbeddingClaimPairFinder/KeywordClaimPairFinder) → relation judgment → confrontation → conviction computation;divergence map 保留视角差异;仍为多步 LLM 调用而非独立智能体进程 |
| GraphEngine | 计划 | `engines/graph/` 只有 .gitkeep | 无代码;README 声称"人格是图的实时派生物……改一条证言自动重算"无实现 |
| RoomEngine | 已实现 | `engines/room/src/room.ts` · `engines/room/src/plugin.ts` · `engines/room/test/room.test.ts` | 背后/当面双模式,round-robin 调度,consent overlap 防护,crisis/diagnosis 词表 |
| GateEngine(独立引擎) | 计划 | `engines/gate/` 只有 .gitkeep | 授权逻辑在 `kernel/src/gate.ts`,但未封装为独立引擎插件;否决流 / contested 流程 / 论断权限墙均无实现 |

## CourtEngine 细项

| 声明 | 状态 | 代码依据 | 备注 |
|---|---|---|---|
| 证人智能体(各持一位真实证言人的材料) | 部分 | `engines/court/src/court.ts`(filing) | 每个证人的证言被送入 filing prompt 提取论断+事例,但没有独立的证人"作答"智能体 |
| 质询智能体(专攻证言间矛盾) | 已实现 | `engines/court/src/court.ts`(relation judgment + confrontation) | v2: pairing 找到论断对后 LLM 判定关系;factual_conflict 进入 confrontation 对质 |
| 仲裁智能体(裁定哪些侧面成立) | 部分 | `engines/court/src/court.ts`(computeConviction) | 裁定由 confrontation LLM 调用 + computeConviction 纯函数完成,没有独立仲裁角色 |
| 置信分(conviction) | 已实现 | `engines/court/src/court.ts`(computeConviction) | v2: 纯函数,base 0.5,+0.12/witness cap 0.9,无 episode cap 0.55,全 elicited ×0.85,未 paired cap 0.6,contested=0;有 6 条 computeConviction 专项测试 |
| 冲突检索(用于找质询材料) | 已实现 | `engines/court/src/conflict.ts` | v2: EmbeddingClaimPairFinder(余弦相似度,threshold 0.55)和 KeywordClaimPairFinder(关键词重叠,minimumOverlap 2)双实现;跳过同证人和共享证据的论断对 |
| 分歧图(divergence map) | 已实现 | `engines/court/src/court.ts` · `shared/src/schemas.ts`(DivergenceSchema) · `server/src/server.ts`(GET /api/subjects/:id/divergences) · `web/src/views/CourtReportView.vue` | 视角差异生成 divergence 记录(type=perspective/factual,resolution=kept_both/contested),前端 /court/:id 页面展示(红=事实冲突,蓝=视角差异) |
| GraphEngine 实时重算 | 计划 | — | 无代码 |
| contested 否决流 | 部分 | `engines/court/src/court.ts`(confrontation) · `shared/src/schemas.ts` | v2: 事实冲突经 confrontation 对质后,unresolved 的论断自动标 contested(conviction=0);本人手动否决流程仍无代码 |
| 论断权限墙(心理健康主题只记事实不生成准诊断) | 部分 | `engines/room/src/wordlist.ts` · `engines/room/src/room.ts` | 危机词拒绝开房间;诊断词触发重写/降级;但这是 RoomEngine 的行为,不是独立的 GateEngine 权限墙 |
| 集体沉默检测 | 部分 | `shared/src/schemas.ts` · `web/src/answers.ts` | avoidedQids 在证言上记录跳过的问题 id;前端采集并传入;但无消费端 |

## .persona 人格包

| 声明 | 状态 | 代码依据 | 备注 |
|---|---|---|---|
| 导出为 .persona 包(含脱敏证言摘要、基线、体检报告、授权范围) | 已实现 | `server/src/persona-package.ts` | v2: 包含 claims(基线)、episodes(quotable 事例)、divergences(分歧)、corpus(当事人原话,作 styleSamples)、report(体检报告)、witnesses(含 consentLevel);向后兼容 v1 |
| 社区可发布公共人格包 | 计划 | — | 无社区分发机制 |

## "和现有路线的区别"表

| 声明 | 状态 | 代码依据 | 备注 |
|---|---|---|---|
| 数据来源:他人证言 | 已实现 | `engines/witness/` | — |
| 能回答"这是谁说的":每一条 | 已实现 | `shared/src/schemas.ts:136`(evidence 字段) | 论断级锚定到证言条目 |
| 背后/当面区分 | 已实现 | `engines/room/src/room.ts` · `shared/src/schemas.ts:95-96`(behindText/frontText) | — |
| 规模形态:真人格×组织级 | 部分 | — | 单人/单房间可用;组织级(平行组织、多房间级联)无实现 |
| "自训练路线在物理上做不出" | — | — | 措辞问题:非功能声明,是对比论述;"物理上做不出"为绝对化措辞 |

## 授权与溯源

| 声明 | 状态 | 代码依据 | 备注 |
|---|---|---|---|
| 证言人提交时选择授权级别 | 已实现 | `shared/src/schemas.ts:53`(ConsentLevelSchema: quotable / synthesis_only) · `engines/witness/src/testimony.ts` | — |
| 背后房间只使用授权展示的材料 | 已实现 | `kernel/src/gate.ts:23-52` · `server/src/external.ts:71-104` | synthesis_only 在 external scope 下被替换为 [withheld] |
| 每条人格结论可回溯到证言原文与来源 | 已实现 | `shared/src/schemas.ts:136` · `kernel/src/store.ts:628-633` | Claim.evidence 必须非空且指向存在的证言 |
| 分歧保留不裁决谁对 | 已实现 | `engines/court/src/court.ts`(relation judgment) · `shared/src/schemas.ts`(DivergenceSchema) | v2: perspective_difference 生成 divergence 记录保留双方观点(resolution=kept_both);factual_conflict 经对质后 qualified 或 contested;引擎不替用户裁决事实 |
| AI 生成内容与原始证言物理隔离 | 已实现 | `kernel/src/store.ts:184-195`(append-only triggers) · `shared/src/schemas.ts:104-105`(correctionOf 链) | 证言表有 DELETE/UPDATE 触发器;room transcript 是独立表;AI 产物不回灌证言 |
| 复刻在世他人用于私人预演;公开分发需本人授权 | 部分 | — | 无技术措施强制"公开分发需本人授权"——这是文字声明,不是代码强制 |
| 本人可否决关于自己的论断→降级 contested 态 | 部分 | `shared/src/schemas.ts`(ClaimStatusSchema) · `engines/court/src/court.ts`(confrontation) | v2: 事实冲突经 confrontation 对质后 unresolved 的论断自动标 contested(conviction=0);本人手动否决流程尚无代码 |
| 危机词命中即切危机模式 | 已实现 | `engines/room/src/wordlist.ts:18-43` · `engines/room/src/room.ts:365-370` | 话题种子含危机词则拒绝开房间 |

## 借鉴与致谢

| 声明 | 状态 | 代码依据 | 备注 |
|---|---|---|---|
| conviction 置信分(借鉴衔枝) | 已实现 | `engines/court/src/court.ts`(computeConviction) | v2: 纯函数动态计算,base 0.5,按证人数/episode/pairing 状态调整 |
| contested 状态命名(借鉴衔枝) | 已实现 | `shared/src/schemas.ts`(ClaimStatusSchema) · `engines/court/src/court.ts` | v2: 事实冲突对质后 unresolved→contested(conviction=0) |
| 反证搜索(借鉴衔枝) | 已实现 | `engines/court/src/conflict.ts` | v2: EmbeddingClaimPairFinder + KeywordClaimPairFinder 双实现 |
| 盲推导审计(借鉴衔枝) | 计划 | — | 无代码 |
| contested 否决流(借鉴衔枝) | 计划 | — | 枚举值有,流程无 |
| 论断权限墙(借鉴衔枝) | 计划 | — | 危机词在 RoomEngine 中,但非独立权限墙 |
| 危机协议三原则(借鉴衔枝) | 部分 | `engines/room/src/wordlist.ts` · `engines/room/src/room.ts:365-370` | 危机词拒绝开房;诊断词重写/降级;但"三原则"整体未完整体现 |
| 过程评测三指标(证据覆盖/矛盾响应/记忆修复)(借鉴衔枝) | 部分 | `shared/src/schemas.ts:162-172`(CourtReport.evidenceCoverage 等) | evidenceCoverage 在 CourtReport 中;challengeCount 可视为矛盾响应代理指标;但"记忆修复"无对应 |
| DEPLOY-FOR-AI 做法(借鉴衔枝) | 计划 | — | 仓库中不存在 docs/DEPLOY-FOR-AI.md |
| BettaFish ForumEngine 工程范式(参照) | — | — | 致谢条目,非功能声明 |
| MiroFish 组织级群体模拟(对位参照) | — | — | 致谢条目,非功能声明 |

## Roadmap

| 声明 | 状态 | 代码依据 | 备注 |
|---|---|---|---|
| v0.1:内核 + CourtEngine/WitnessEngine 最小闭环 + 单房间 + 推门 + 内置演示 | 已实现 | 上述各条目 | — |
| v0.2:三个对外挂载口 + .persona 包 + GraphEngine 实时重算 | 部分 | — | 挂载口(OpenAI/MCP/纯库)和 .persona 已实现;GraphEngine 实时重算无代码 |
| v0.3:多房间级联 + 采集器/剧本插件 API 冻结 | 计划 | — | — |
| v1.0:插件市场 + 组织级并行法庭 | 计划 | — | — |

---

## 语料箱(本人原话)

| 声明 | 状态 | 代码依据 | 备注 |
|---|---|---|---|
| 语料箱(本人原话可展示的段落) | 已实现 | `shared/src/schemas.ts`(CorpusItemSchema) · `kernel/src/store.ts`(putCorpusItem/listCorpusItemsBySubject) · `server/src/server.ts`(POST/GET /api/subjects/:id/corpus) · `kernel/src/persona.ts` | corpus_items 表物理独立于证言表;persona 组装 v2 的"他本人说过的话"段落和说话风格参照均取自 corpus;林默演示含 10 条 corpus items |

---

## 汇总

| 状态 | 条数 |
|---|---|
| 已实现 | 35 |
| 部分 | 10 |
| 计划 | 12 |
