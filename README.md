# OpenMimic

> **状态:早期开发中(v0.0.2-p4),下表为逐项实现状态** — 详见 [docs/claims-audit.md](docs/claims-audit.md)(截至 2026-10-08 核查)

**通用人格仿真引擎:复刻任何人,预演万局。**

*A general-purpose persona engine. Rebuild anyone. Rehearse anything.*

从 0 实现的对抗式人格引擎。它不用你的自述训练"你"——它收集认识你的人的证言,从每位证人的证言中提取候选论断和具体事例(episode),用 embedding 或关键词重叠找到不同证人之间的相关材料后做关系判定(agreement / perspective_difference / factual_conflict / unrelated)。事实性冲突进入对质;视角差异作为分歧(divergence)保留而非裁决;一致观点合并强化。存活的论断带 conviction 置信分入库,每一个数字人格都带证据链:任何一条性格结论,都能回答"这是谁说的、原话是什么、被谁质疑过"(论断级锚定到证言条目和事例)。

把一个人复刻出来,你可以:围观他不在场时别人怎么聊他,推门进去看所有人当面换一套说法,在重要对话发生前先和"他"过一遍。平行组织(把一整个团队复刻后预演决策)见 Roadmap。

## 你下载后能做什么

**你不在的房间(可用)** — 把测评链接发给 5-10 个朋友,每人 3 分钟提交关于你的证言。收齐后打开房间:他们的数字分身正在里面聊你,你在玻璃外看着。然后按下唯一的按钮——推门进去。同一群人,话全变了。当面一套与背后一套,第一次同时摆在你眼前。(背后房间只使用证言人明确授权展示的内容,见「授权与溯源」)

**复刻任何人(可用)** — 复刻"别人"不需要对方参与:你和同事们对老板的证言,就是语料。和朋友眼中的自己对话,给去世的亲人留一个由全家证言拼成的形象,或者用史料证言构建历史人物(历史人物没有自述数据,只有他证——本引擎是对口的构建方式)。

**预演万局(可用)** — 跟数字老板谈加薪,看他从哪里反驳;见客户前把提案过一遍,看他在哪页皱眉;把评审会六个人全复刻出来,把方案扔进去,看谁第一个开炮、理由是什么。

**平行组织(计划)** — 导入一个 50 人团队,全员互相证言,50 场法庭并行开审,得到一个平行组织。扔进去一句"下季度裁员 10%",看背后的房间们怎么连锁反应:谁先慌、谁串联、消息沿哪条人际链泄出去。MiroFish 用百万个 prompt 设定的智能体模拟社会;OpenMimic 用一屋子有证据基础的真人格,模拟你真实所在的那个组织。

**装进任何应用** — 本机起一个 OpenAI 兼容端点(可用),`BASE_URL` 一指、模型名填 `persona/<name>`,任何现存 AI 应用开口就是这个人,零代码。另有 MCP Server(可用)、纯库 import(可用,`@openmimic/core` 的 `createOpenMimic()` 不起端口不开服务器)两种挂载方式;`.persona` 人格包可导出导入(可用)。OpenClaw skill(计划)、dsh bundle(计划)尚未实现。

## 快速开始

```bash
git clone https://github.com/celiu123456/openmimic.git
cd openmimic
npm install
npx tsx server/src/main.ts
# 打开 http://localhost:7860
```

**不需要任何 API Key 即可体验**:内置一个预制演示房间(虚构人物与预生成证言),房间、推门、证据链全流程可玩;也可以当场创建新的被复刻者、生成邀请链接、填写证言。要让法庭和房间真正运行,在 `.env` 填一个任意 OpenAI 兼容接口:

```env
LLM_BASE_URL=https://api.your-provider.com/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=your-model
```

**公网部署**:设置 `OPENMIMIC_ADMIN_TOKEN` 环境变量启用访问控制(管理操作需口令,朋友凭邀请链接填写证言)。详见 [docs/DEPLOY-FOR-AI.md](docs/DEPLOY-FOR-AI.md)。也提供 Dockerfile 和 docker-compose.yml。

把人格当模型调用:

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:7860/v1", api_key="-")
resp = client.chat.completions.create(
    model="persona/my-boss",
    messages=[{"role": "user", "content": "我想聊聊调薪的事。"}],
)
```

## 架构:微内核,万物皆插件

内核只做四件事:**证言账本、人格组装、插件装配、授权门**。其余一切都是插件——**包括官方引擎本身**,它们与第三方插件走同一条装配路径,没有后门。

```
            ┌────────────────────────────────────────────────┐
  向内扩展   │  插件层(统一 manifest)                        │
  (社区)   │  采集器: 逐轮访谈/聊天导入/访谈转写/游戏化测评    │
            │  质询策略: 温和核对/激进对质/自定义审讯风格    │
            │  房间剧本: 评审会/相亲/同学会/自定义剧本        │
            │  桥接器: 衔枝Twig/MiroFish/OASIS/Mem0 适配      │
            ├────────────────────────────────────────────────┤
  官方引擎   │  WitnessEngine · CourtEngine · GraphEngine     │
  (也是插件)│  RoomEngine · GateEngine                       │
            ├────────────────────────────────────────────────┤
  微内核     │  证言账本 | 人格组装 | 插件装配 | 授权门        │
            ├────────────────────────────────────────────────┤
  向外挂载   │  OpenAI兼容端点 | MCP Server | 纯库 import     │
  (被嵌入) │  + .persona 人格包（人格本身可分发）            │
            └────────────────────────────────────────────────┘
```

**独立跑,是产品;被嵌入,是服务;被扩展,是生态。三个身份共用同一套插件协议。**

### 现状表

| 组件 | 状态 |
|---|---|
| 证言账本(append-only ledger + SQLite triggers) | 已实现 |
| 授权门(synthesis_only 遮蔽,court/external 双 scope) | 已实现 |
| 插件装配(v1: inject/provide 依赖注入,topo sort,unload,Registry 扩展点,config tree) | 已实现 |
| 人格组装(async, witness-relation-grouped claims + round-robin episodes + divergences + corpus → 6000 char system prompt) | 已实现 |
| WitnessEngine(采集 + 邀请 + v4 逐轮生成访谈;题库版保留兼容) | 已实现 |
| CourtEngine(v2: filing with episodes + LLM/embedding/keyword pairing + relation judgment + confrontation + divergence map + conviction computation) | 已实现 |
| RoomEngine(背后/当面双模式 + 危机词 + 诊断词防护 + 跨证人泄密保护) | 已实现 |
| GraphEngine(证言图谱,改一条证言自动重算关联人格) | 计划 |
| GateEngine(contested 否决流 + 论断权限墙 + re-raise 机制) | 已实现 |
| 元知觉(meta-perception: 主体预测证人作答,LLM 评分,per-witness breakdown) | 已实现 |
| 集体沉默信号(silence-signal: avoidedQids 统计,>= half 且 >= 3 → SilenceSignal) | 已实现 |
| 插件持久化(registerPluginTable: 沙箱表 + append-only 可选) | 已实现 |
| 第三方插件位(社区采集器、剧本、桥接器) | 已实现(三个示例插件) |

### 引擎表

| 引擎 | 职责 |
|---|---|
| **WitnessEngine** | 证言采集与立场标注:v4 逐轮生成访谈(单模型完整历史,无固定题库);题库版(v3)保留兼容。每条证言记录来源、关系、立场,原文永久可溯 |
| **CourtEngine** | v2 对抗式质询管线:4 阶段——(1) filing: 从每位证人的证言中提取候选论断和 episode(具体事例,必须是证言原文的逐字子串),per-item lenient parsing(单条无效不废弃全部);(2) pairing: 首选 LLMClaimPairFinder(一次 LLM 调用找语义相关对),次选 embedding 余弦,末选关键词重叠;(3) relation judgment: LLM 判定论断对关系(agreement / perspective_difference / factual_conflict / unrelated),perspective_difference 要求同一行为维度且方向不同,事实冲突进入 confrontation 对质;(4) conviction computation: 纯函数,base 0.5,按证人数/episode/配对状态计算置信分。视角差异生成 divergence 记录保留双方观点;一致论断合并证据。体检报告(CourtReport)含存活/限定/争议/退役论断数、episode 数、divergence 数 |
| **GraphEngine** | 计划:证言图谱,使人格成为图的实时派生物(改一条证言自动重算关联人格)。当前无代码 |
| **RoomEngine** | 房间模拟:背后/当面双模式群体对话;危机词命中拒绝开房间,诊断词触发重写或降级为舞台指令;跨证人泄密保护——LLM 生成 no-talk list(仅收高代价秘密:明确嘱托保密 + 推翻在场证人对重大现状的认知;双次生成取并集上限 8 条;规则兜底不受上限挤出) + 两级检测(关键词快扫 + LLM 语义判断含部分泄露,fail-closed) + guided rewrite(用安全素材引导重写最多两次,失败才降为舞台提示) + 25% 舞台提示上限。**局限**:防护依赖模型判定,不是保证;清单每次生成可能不同;部分泄露判定边界(如"换城市"vs"换节奏")取决于模型理解力 |
| **GateEngine** | 论断否决(contest/uncontest)、诊断词/危机词权限墙、re-raise 机制(contested 论断在新证据充足时自动恢复)。contest 记录持久化于插件表(append-only)。前端 CourtReportView 提供 "我不同意" 按钮与撤回功能 |

## .persona 人格包

人格是可分发的文件。构建完成的人格可导出为 `.persona` 包(version 2),包含:surviving claims(基线)、quotable episodes(事例)、divergences(分歧)、corpus items(当事人本人原话,作为说话风格参照)、体检报告(CourtReport)、证人元信息(关系 / 立场 / 授权级别);原始证言不随包分发。包格式向后兼容 version 1。他人下载即可导入并生成房间或通过 OpenAI 端点对话。社区分发机制(计划)。

## 和现有路线的区别

| | 数据来源 | 能回答"这是谁说的" | 分歧处理 | 背后/当面区分 | 规模形态 |
|---|---|---|---|---|---|
| 自训练分身(Second-Me 类) | 本人自述数据 | ✗ | 无分歧(单源) | ✗ | 单人 |
| 记忆层(Mem0 类) | 交互事实 | 部分 | 覆盖或丢弃 | ✗ | 单 agent |
| 群体模拟(MiroFish 类) | prompt 设定 | ✗ | 无分歧(设定) | ✗ | 百万量级设定体 |
| **OpenMimic** | **他人证言** | **每一条**[^1] | **保留双方观点(divergence map)**[^2] | **✓** | **单人/单房间(组织级见 Roadmap)** |

[^1]: 论断级锚定到证言条目和 episode。
[^2]: 视角差异保留不裁决;事实冲突经对质后标 contested 或 qualified。

自训练路线的自述数据中不包含他人的背后看法,因此无法构建"你不在的房间"。

## 授权与溯源(不可妥协项)

以下条目由代码与测试强制执行:

- 证言账本只追加:SQLite triggers 阻止 UPDATE/DELETE,TypeScript API 不暴露修改方法;
- 无锚拒收:claim 的 evidence 列表不得为空,且每个 id 必须指向账本中存在的证言,否则 putClaim 抛 NoEvidenceError;
- synthesis_only 遮蔽:外部 scope 下 synthesis_only 证人的原话被替换为 `[withheld]`;
- AI 产物不入证言表:房间 transcript 存独立表,不回灌 append-only 证言账本。

以下条目由 GateEngine 实现:

- 本人否决关于自己的论断→降级 contested 态,从人格画像中移除(可撤回);
- 诊断词/危机词命中的论断自动退役(retired),不进入人格画像。

以下条目为设计意图,尚无技术措施强制:

- 复刻在世他人用于私人预演场景;公开分发他人人格包需获本人授权。

## 借鉴与致谢

**已实现并借鉴:**

- conviction 置信分的思路、`contested` 状态命名、`contested` 否决流(contest/uncontest + re-raise)、论断权限墙(诊断词/危机词过滤)、危机词熔断思路借鉴自 [衔枝 Twig](https://github.com/qimingjiu/twig-memory)(MIT)。本项目将其从「单 AI 对一个人的纵向理解审计」扩展为「多信源证言之间的横向对质」,代码为全新实现;对照与范围见其 [ATTRIBUTION.md](https://github.com/qimingjiu/twig-memory/blob/main/ATTRIBUTION.md)。
- 危机协议三原则(Twig §7):词表预扫描(多语言扩展)、危机模式系统提示词(温暖/陪伴/不推开/不编造热线号码)、静态帮助资源兜底、危机静默期、零缓存路径、访谈安全信号分支、审计表(仅时间+类型,不记原文)。已实现于 GateEngine 插件层 + 服务端聊天入口;Room 引擎的危机词拒绝是先前独立实现。
- 过程评测三指标(Twig §6 化用):证据覆盖三元素版(支撑/反面/情境)、矛盾响应(12 场景 × 8 行为类型)、记忆修复(6 个旧态取代场景)。已有代码框架和 FakeLLM 结构测试;未接真模型运行,账簿标"未运行:等真人数据"。
- DEPLOY-FOR-AI 的 onboarding 做法学自衔枝。

论断配对(跨证人找语义相关论断,用 LLM / embedding / 关键词三级回落)是本项目自有机制,不是衔枝反证搜索的实现。

v4 逐轮访谈方式(单模型每轮一次调用,无 planner)和守卫正则(单问题/去重/收尾语阻断)迁自作者此前的平台项目。提示约束借鉴动机式访谈(Miller & Rollnick, 2013)、关键事件法(Flanagan, 1954)和认知访谈(Fisher & Geiselman, 1992)文献(见 [docs/REFERENCES.md](docs/REFERENCES.md))。

**计划借鉴(尚未实现):**

- 反证搜索(对既有论断先生成反面假设、再检索反证并强制回应)、盲推导审计同源自衔枝设计文档。

**参照项目:**

- 多智能体辩论融合的工程范式见 [BettaFish](https://github.com/666ghj/BettaFish) ForumEngine;组织级群体模拟的对位参照为 [MiroFish](https://github.com/666ghj/MiroFish)。

## Roadmap

### 已完成

- 内核:证言账本(append-only + triggers)、授权门(synthesis_only 遮蔽)、插件装配 v1(inject/provide 依赖注入、topo sort、unload、Registry 扩展点、YAML config tree)、人格组装 v2(async, audience-grouped claims + episodes + divergences + corpus, 6000 char budget)
- WitnessEngine:证言采集、邀请链接、v4 逐轮生成访谈(单模型每轮一次调用,system prompt + 完整历史 + 最新用户语句 → 一句承接 + 一个问题;informant / self 两种模式在创建邀请时选定;服务端零模型守卫:单问题校验、近 12 条去重、收尾语阻断、一次修复后 503;模型不决定终点);题库版(v3)保留兼容,标记 deprecated;v4 逐轮访谈方式(单模型每轮、无 planner)和守卫正则迁自作者此前的平台项目,提示约束借鉴动机式访谈、关键事件法和认知访谈文献(见 docs/REFERENCES.md)
- CourtEngine v2:filing with episodes + embedding/keyword pairing + relation judgment + confrontation + divergence map + conviction computation(纯函数)
- RoomEngine:背后/当面双模式 + 危机词拒绝 + 诊断词重写/降级 + 跨证人泄密保护(高代价 no-talk list + 部分泄露检测 + guided rewrite + 25% 舞台上限)
- 对外挂载:OpenAI 兼容端点、MCP Server(stdio)、纯库 import(`@openmimic/core` createOpenMimic)
- .persona 人格包 v2 导出/导入(含 consent 过滤、episodes、divergences、corpus)
- 语料箱(corpus):当事人本人原话,作为说话风格参照,物理上独立于证言表
- Embedding 冲突检索:EmbeddingClaimPairFinder(余弦相似度)和 KeywordClaimPairFinder(关键词重叠)双实现
- 内置演示(虚构人物林默,18 episodes + 5 divergences + 10 corpus items,无 API Key 可体验)
- 三个示例插件:collector-freetext(自由文本证言)、scenario-review(评审会剧本)、example-bridge(法庭完成→webhook)
- YAML 配置树:openmimic.yml → openmimic.local.yml → OPENMIMIC_CONFIG 三层合并
- P3a:房间发言三档分类(quote / paraphrase / extrapolate),匿名证人(anonymousInRoom)显示脱敏
- P3b:元知觉插件(meta-perception),预测→LLM 评分→per-witness 分项,synthesis_only 证人脱敏
- P3c-c1:集体沉默信号(silence-signal),avoidedQids >= half 且 >= 3 → SilenceSignal,人格纪律一行
- GateEngine:论断否决(contest/uncontest) + 诊断词/危机词权限墙 + re-raise + reraised 结构化字段
- 插件持久化:store.registerPluginTable(沙箱表,表名强制前缀,无法触及证言表,可选 append-only)
- P4:安全与可靠性批次(从此前平台项目迁移 + 新增)
  - 不可信内容隔离:所有用户文本入 LLM 前包裹数据块 + 注入检测 + 守卫指令
  - AI 产物回流检测:3-char shingle MinHash(128 维)指纹 + 提交时筛查 + 法庭过滤
  - 模型调用可靠性:9 类错误分类 + retry-after 解析 + 修复 attemptJson 盲重试 + 合并 extractJson
  - PII 脱敏:手机/邮箱/身份证/银行卡/凭据泄露正则 + 敏感字段掩码 + 稳定序列化
  - 证据基础分类修复:"大概/差不多"+数字不触发 inferred、一人称事件叙事归 witnessed、unknown 上限 0.6→0.85
- 聊天记录导入(collector-chatlog):text/csv/json 三格式;preview→import 两步;PII 脱敏 + 注入检测 + 回流筛查
- 角色卡桥接(bridge-sillytavern):SillyTavern Character Card V2 双向转换(JSON + PNG chara tEXt 块)
- 证言集(output-biography):逐章引语验证 + 保密内容过滤 + 无据细节检查 + 主体否决
- 带权限范围的令牌(scoped tokens):omk_ 前缀;9 种 scope;显式白名单(禁通配符);SHA-256 加盐;fail-closed
- 能力目录:机器可读能力清单(含 scope 要求),GET /api/capabilities
- 话题覆盖(coverage):computeCoverage 逐维度状态(untouched/shallow/covered/cautious)和缺失关系推荐。在 v4 访谈中仅作为 system prompt 内一行"尚未聊到的方面"可选提示,不是调度器;planQuestions / session fixation 仅用于题库版(v3)路径
- 邀请短码:8 字符不混淆字母表(29 字符);已接入邀请链接
- 提示词隔离:所有用户文本入 LLM 前包裹数据块 + 注入检测(flag, don't reject) + 守卫扫描
- 说话风格画像(style-stats):消息力量画像 + 言语行为模板(10 类) + 常用语;已接入 persona 组装
- 四级披露(disclosure):speakable / reference_only / presence_only / excluded + holdUntilRaised
- 访谈员 v2:9 意图分类、退缩检测(5 类)、证据基础标注(4 类)、质量门(去重/单问题/防提前结束)、反机械追问
- 留一证人(LOWO)评测 + 对照臂(baseline/claims-stripped/episodes-stripped)
- 当面房间防泄密:no-talk list(LLM 生成 + 规则兜底) + 两级泄密检测 + guided rewrite(最多两次)
- 危机协议(GateEngine + 聊天入口):词表预扫描(中英日韩)、危机模式系统提示词(温暖/陪伴/不推开)、静态帮助资源(不编造热线)、10 分钟静默期、零缓存路径、访谈安全信号分支、审计表(仅时间+类型)
- 回流指纹增强:两层筛查(MinHash + 稀有短语/数字/专有名词匹配 + 可选 LLM 确认);四级检测(原文/轻改写/重改写/无关)
- 过程评测框架:证据覆盖三元素版 + 矛盾响应 12 场景 × 8 行为类型 + 记忆修复 6 场景;FakeLLM 结构测试通过,未接真模型

### 计划

- GraphEngine:证言图谱,人格作为图的实时派生物
- 平行组织:多房间级联,组织级并行法庭
- 插件市场
- OpenClaw skill、dsh bundle
- 社区人格包分发机制
- 反证搜索、盲推导审计
- 过程评测三指标完整实现
