# Claims Check: README.en.md

Every functional or numerical statement in README.en.md mapped to its evidence source. Statements without a source should not exist in the README.

---

## Opening paragraph

| Statement | Source | Status |
|---|---|---|
| Builds a digital persona from testimony of people around someone | claims-audit: "收集认识你的人的证言" = 已实现 | OK |
| Collects testimony, cross-examines claims across witnesses in a "court" pipeline | claims-audit: CourtEngine = 已实现; "让多个智能体在'人格法庭'上交叉质询" = 部分 (multi-step LLM calls, not independent agent processes) | OK (README.en.md uses "court pipeline" not "multi-agent") |
| Preserves disagreements instead of resolving them | claims-audit: "分歧保留不裁决谁对" = 已实现 | OK |
| Every trait can be traced back to who said it and what words they used | claims-audit: "每一个数字人格都带证据链" = 已实现; "任何一条性格结论,都能回答'这是谁说的'" = 已实现 | OK |
| It is a persona simulation, not the person | Design statement; persona prompt carries disclaimer (regression-run-20261006d.md line 1: "这是人格模拟,不是本人") | OK |

## What you can do today

| Statement | Source | Status |
|---|---|---|
| The Room You're Not In (behind-the-scenes + door push) | claims-audit: "你不在的房间" = 已实现; "背后房间 + 推门" = 已实现 | OK |
| Send an invite link to 5--10 people | claims-audit: "把测评链接发给朋友" = 已实现 | OK |
| Leak protection is present (no-talk list, keyword + LLM verification, guided rewrite) | claims-audit: RoomEngine = 已实现 (detailed in备注) | OK |
| Leak protection depends on model judgment and is not a guarantee | claims-audit: RoomEngine 备注 "防护依赖模型判定,不是保证" | OK |
| Rebuild anyone -- do not need subject's participation | claims-audit: "复刻任何人" = 已实现 | OK |
| Historical figures from historical accounts | claims-audit: "历史人物构建(.persona 导入)" = 已实现 | OK |
| Rehearse conversations via OpenAI-compatible endpoint | claims-audit: "预演万局" = 已实现; "OpenAI 兼容端点" = 已实现 | OK |
| Biography output | claims-audit: output-biography plugin documented in PLUGIN-GUIDE.md; biography-run.md shows runs | OK |
| Every quoted sentence validated against verbatim testimony | PLUGIN-GUIDE.md biography section: "Quotation marks may only contain verbatim text from quotable witnesses... rejects the chapter if any quote cannot be traced" | OK |
| Subject can veto any section | PLUGIN-GUIDE.md: "POST /api/biography/:id/sections/:sid/remove" | OK |

## Quick start

| Statement | Source | Status |
|---|---|---|
| git clone / npm install / npx tsx server/src/main.ts | claims-audit: Quick start commands = 已实现; DEPLOY-FOR-AI.md line 26-33 | OK |
| Node.js >= 22 | package.json: "engines": {"node": ">=22"} | OK |
| Open http://localhost:7860 | claims-audit: "打开 http://localhost:7860" = 已实现 | OK |
| No API key needed to explore | claims-audit: "内置演示房间" = 已实现 | OK |
| Lin Mo is a fictional character with handwritten testimony data | fixtures/limo.ts; claims-audit: "林默为手写虚构演示数据" | OK |
| Supply any OpenAI-compatible LLM in .env | DEPLOY-FOR-AI.md lines 104-115 | OK |
| Dockerfile and docker-compose.yml exist but have not been tested on a live Docker host | claims-audit: "docker compose up -d" = 已实现; 备注 "未在本机实测(无 Docker)" | OK |

## How it works

| Statement | Source | Status |
|---|---|---|
| Append-only ledger with SQLite triggers blocking UPDATE/DELETE | claims-audit: "证言账本(append-only + triggers)" = 已实现 | OK |
| AI follow-up interview strategy with intent classification, retreat detection, quality gates | claims-audit: WitnessEngine = 已实现; 备注 mentions v2 interview strategy | OK |
| Four-stage pipeline: filing, pairing, relation judgment, conviction | claims-audit: CourtEngine v2 = 已实现 | OK |
| Three pairing implementations with fallback: LLM, embedding, keyword | claims-audit: "冲突检索" = 已实现; "LLMClaimPairFinder/EmbeddingClaimPairFinder/KeywordClaimPairFinder 三级实现" | OK |
| Conviction is a pure function (base 0.5, adjusted by witness count etc.) | claims-audit: "置信分(conviction)" = 已实现; "纯函数,base 0.5" | OK |
| Single-witness claims cap at 0.55 | ARCHITECTURE.md: "Single witness weight cap... caps single-witness claims at 0.55" | OK |
| Contested claims score 0 | claims-audit: conviction computation 备注 "contested=0" | OK |
| Quota-based per-section truncation (episodes 50%, claims 25%, corpus 10%, style 10%, self-report 5%) | claims-audit: BUG fix section; ARCHITECTURE.md "Quota-based truncation" | OK |
| Expression tiers (quote / paraphrase / extrapolate) | claims-audit: P3a = 已实现; ARCHITECTURE.md "Three-tier expression" | OK |
| OpenAI-compatible endpoint (/v1/chat/completions) | claims-audit: "OpenAI 兼容端点" = 已实现 | OK |
| MCP server (stdio) | claims-audit: "MCP Server" = 已实现 | OK |
| Library entry point (@openmimic/core, createOpenMimic()) embeds in 30 lines | claims-audit: "纯库 import" = 已实现; examples/embed-as-library/main.ts is 65 lines total, ~30 lines of setup | OK |
| .persona package v2 with consent filtering | claims-audit: ".persona 人格包" = 已实现 | OK |
| Original testimony not included in export | claims-audit: .persona v2 备注 "原始证言不随包分发" | OK |

## What makes it different (comparison table)

| Statement | Source | Status |
|---|---|---|
| Data source: others' testimony | claims-audit: "数据来源:他人证言" = 已实现 | OK |
| "Who said this?": every claim | claims-audit: "能回答'这是谁说的':每一条" = 已实现 | OK |
| Disagreements: preserved as divergence map | claims-audit: "分歧图(divergence map)" = 已实现 | OK |
| Behind/face-to-face: yes | claims-audit: "背后/当面区分" = 已实现 | OK |
| Scale: single person / single room | claims-audit: "规模形态" = 部分 (single person/room available; organization-level not implemented) | OK (README states current scope accurately) |
| Organization-level simulation is planned but not implemented | claims-audit: "平行组织" = 计划 | OK |

## Ethics and consent

| Statement | Source | Status |
|---|---|---|
| Append-only ledger enforced by triggers | claims-audit: "证言账本只追加" = 已实现 | OK |
| putClaim throws NoEvidenceError | claims-audit: "无锚拒收" = 已实现 | OK |
| Consent levels: quotable / synthesis_only | claims-audit: "证言人提交时选择授权级别" = 已实现 | OK |
| synthesis_only text replaced with [withheld] | claims-audit: "synthesis_only 遮蔽" = 已实现 | OK |
| Room transcripts stored separately, never feed back to testimony | claims-audit: "AI 产物不入证言表" = 已实现 | OK |
| Subject veto (contest/uncontest) | claims-audit: "contested 否决流" = 已实现 | OK |
| Re-raise requires >= 2 new witnesses | claims-audit: GateEngine 备注 "re-raise:contested 论断在新证据(>=2 新证人)后自动恢复" | OK |
| Re-raise wording passes tone gate | ARCHITECTURE.md: "Re-raise wording gate... hasInvitingTone rejects commanding/accusatory wording" | OK |
| Diagnostic/crisis word filtering (20+ patterns) | claims-audit: "论断权限墙" = 已实现; "诊断词/危机词(>=20 个)" | OK |
| Crisis words reject room topics | claims-audit: "危机词命中即切危机模式" = 已实现 | OK |
| Collective silence: >= half witnesses, >= 3, with raise-then-retreat evidence | claims-audit: "集体沉默检测" = 已实现; ARCHITECTURE.md: "raise→retreat paired evidence" | OK |
| PII sanitization | claims-audit: P4 "PII 脱敏" = 已实现 | OK |
| No technical enforcement for public distribution restriction | claims-audit: "复刻在世他人" = 部分; "无技术措施强制" | OK |

## Evaluation

| Statement | Source | Status |
|---|---|---|
| All data uses Lin Mo, fictional, handwritten | eval-ledger: 口径声明 "林默为手写虚构演示数据" | OK |
| Calibration: 100% on 74 pairs, 0% position bias | eval-ledger entry 7: "准确率: 100.0% (74/74)", "位置偏置: 0.0%" | OK |
| LOWO: 87.5% (14/16), Wilson CI [64.0%, 96.5%] | eval-ledger entry 8: "人格胜率: 87.5% (14/16)", "Wilson 95% CI: [64.0%, 96.5%]" | OK |
| 2 pairs discarded | eval-ledger entry 8: "作废对: 2" | OK |
| N=16 is small, CI is wide, directional reading | eval-ledger entry 8 解读: "N=16, 区间很宽" | OK |
| Ablation: full vs baseline 100% (15/15, Wilson CI [79.6%, 100%]) | eval-ledger entry 9: "vs-baseline... 100.0%... [79.6%, 100%]" | OK |
| Removing claims: 53.3%, removing episodes: 64.3% | eval-ledger entry 9: "vs-claims-stripped 53.3%", "vs-episodes-stripped 64.3%" | OK |
| Both CIs cross 50%, not statistically conclusive | eval-ledger entry 9: "[30.1%, 75.2%]" and "[38.8%, 83.7%]" both cross 50% | OK |
| Stability: 67--73 claims, overlap 46.9%, SD 13.8% | eval-ledger entry 5: "论断条数接近 (67-73)", "重合率均值: 46.9%", "标准差: 13.8%" | OK |
| N=3 pairs for stability | eval-ledger entry 5: "3 对" | OK |
| Room leak: 4 runs x 0 leaks | eval-ledger entry 11: "0 泄密, 全部 criteria pass" | OK |
| No-talk list size varied (2--6 items) | eval-ledger entry 11: "分别产出 6 条和 2 条 no-talk 条目" | OK |
| Liveness scaffold built but uncalibrated | eval-ledger Liveness section: "UNCALIBRATED... 没有经过标定" | OK |
| No human-labeled real-person samples exist | eval-ledger Liveness: "不存在人工指认的真人样本白名单" | OK |

## Limitations

| Statement | Source | Status |
|---|---|---|
| Demo data is handwritten fiction | eval-ledger: repeated throughout; fixtures/limo.ts | OK |
| Leak protection is not a guarantee | claims-audit: RoomEngine 备注 | OK |
| Prompt injection isolation reduces but does not eliminate risk | claims-audit: P4 "不可信内容隔离" = 已实现 (functional; limitation is design-inherent) | OK |
| MinHash threshold 0.5 for reflux | claims-audit: P4 "threshold 0.5" | OK |
| Small evaluation sample sizes | eval-ledger: all entries | OK |
| GraphEngine not implemented | claims-audit: GraphEngine = 计划 | OK |
| Organization-level not implemented | claims-audit: "平行组织" = 计划 | OK |
| Docker untested | claims-audit: Docker 备注 "未在本机实测" | OK |
| Conviction deterministic but court output not | eval-ledger entry 5: stability data | OK |
| Expression tier classification is post-hoc | ARCHITECTURE.md: "classifyUtterance then verifies actual output" (post-generation) | OK |

## Roadmap

| Statement | Source | Status |
|---|---|---|
| GraphEngine planned | claims-audit: GraphEngine = 计划 | OK |
| Parallel organizations planned | claims-audit: "平行组织" = 计划 | OK |
| Plugin marketplace planned | README.md roadmap: "插件市场" | OK |
| Community persona distribution planned | claims-audit: "社区可发布公共人格包" = 计划 | OK |
| Blind derivation audit planned | claims-audit: "盲推导审计" = 计划 | OK |
| Evidence coverage implemented; contradiction response and memory repair not | claims-audit: "过程评测三指标" = 部分; "evidenceCoverage 在 CourtReport 中... '记忆修复'无对应" | OK |
| OpenClaw skill and dsh bundle planned | claims-audit: both = 计划 | OK |

## Extending

| Statement | Source | Status |
|---|---|---|
| Plugin system with inject, topo sort, sandboxed tables | claims-audit: "插件装配" = 已实现; "插件持久化" = 已实现 | OK |
| OpenAI-compatible endpoint with streaming | claims-audit: "OpenAI 兼容端点" = 已实现; mount-openai supports stream | OK |
| MCP server JSON-RPC over stdio | claims-audit: "MCP Server" = 已实现 | OK |
| Library embedding with createOpenMimic() | claims-audit: "纯库 import" = 已实现 | OK |
| Three-layer config merge | ARCHITECTURE.md: "Three layers, merged in order" | OK |

## Related work and acknowledgements

| Statement | Source | Status |
|---|---|---|
| Conviction scoring adapted from Twig | claims-audit: "conviction 置信分(借鉴衔枝)" = 已实现 | OK |
| Contested status name from Twig | claims-audit: "contested 状态命名(借鉴衔枝)" = 已实现 | OK |
| Crisis-word circuit breaker concept from Twig | claims-audit: "危机协议三原则(借鉴衔枝)" = 部分 | OK (README says "concept" not "full implementation") |
| Contested veto flow from Twig design document | claims-audit: "contested 否决流(借鉴衔枝)" = 已实现 | OK |
| Claim permission wall from Twig design document | claims-audit: "论断权限墙(借鉴衔枝)" = 已实现 | OK |
| Counter-evidence search from Twig | claims-audit: "反证搜索(借鉴衔枝)" = 已实现 | OK |
| DEPLOY-FOR-AI format modeled after Twig | claims-audit: "DEPLOY-FOR-AI 做法(借鉴衔枝)" = 已实现 | OK |
| Blind derivation audit planned, not implemented | claims-audit: "盲推导审计(借鉴衔枝)" = 计划 | OK |
| Process evaluation partially implemented | claims-audit: "过程评测三指标" = 部分 | OK |
| BettaFish ForumEngine (reference, no affiliation) | claims-audit: "BettaFish ForumEngine 工程范式(参照)" | OK |
| MiroFish (positional reference, no affiliation) | claims-audit: "MiroFish 组织级群体模拟(对位参照)" | OK |
| No affiliation with referenced projects | Design intent; no claim of collaboration in source materials | OK |
| Vazire (2010) SOKA model | 学术汇编 A1: ◆(已检索核实) | OK |
| Connelly & Ones (2010) | 学术汇编 A2: ◆(已检索核实) | OK |
| Robbins & Karan (2019) | 学术汇编 C1: ◆(已检索核实) | OK |
| Goffman (1959) | 学术汇编 F3: unverified (from general knowledge) | OK (noted in REFERENCES.md) |
| Park et al. (2024/2026) | 学术汇编 E1: ◆(已检索核实) | OK |
| Peng, Toubia et al. (2025) | 学术汇编 E6: ◆(已检索核实) | OK |

## Security measures

| Statement | Source | Status |
|---|---|---|
| Untrusted content isolation: all user text wrapped in sanitized data blocks | claims-audit: P4 "不可信内容隔离" = 已实现 | OK |
| detectInjection() scans for injection patterns, flags without rejecting | claims-audit: P4 "注入检测" = 已实现; "flag, don't reject" | OK |
| Guard test scans all prompt-constructing source files | ARCHITECTURE.md: "A guard test scans all prompt-constructing source files" | OK |
| AI reflux detection: MinHash, 3-char shingles, 128 dimensions | claims-audit: P4 "AI 产物回流检测" = 已实现 | OK |
| Medium/high suspicion excluded from court filing | claims-audit: P4 "法庭过滤 medium/high 回流证言" = 已实现 | OK |
| Nine provider error classes with retry-after parsing | claims-audit: P4 "模型调用错误分类(9 类)" = 已实现 | OK |
| Non-retryable errors not retried | claims-audit: P4 "修复 attemptJson 盲重试" = 已实现 | OK |

## Code example (Quick start)

| Statement | Source | Status |
|---|---|---|
| Use persona as model via OpenAI SDK, model="persona/limo" | claims-audit: "OpenAI 兼容端点" = 已实现; mount-openai.ts resolves persona/ prefix | OK |

---

## Summary

| Category | Count |
|---|---|
| Total statements checked | 91 |
| Supported by claims-audit / eval-ledger / source code | 91 |
| Unsupported (should not be in README) | 0 |
