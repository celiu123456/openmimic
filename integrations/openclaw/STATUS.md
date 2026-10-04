未实测:本机未安装 OpenClaw

## 实测时要核的三件事

1. **`transport` 字段是否必需**:Web 文档显示 OpenClaw 的 `mcpServers`
   配置支持 `"stdio"` 和 `"http"` 两种 transport。部分示例省略了 `transport`
   字段(可能默认 stdio),部分示例显式写了。需在真实 OpenClaw 上验证省略时
   是否报错。

2. **工作目录 (`cwd`) 字段是否支持**:OpenClaw 的 `mcpServers` 配置文档中
   未明确列出 `cwd` 字段(dsh 和 Claude Desktop 都支持)。当前 SKILL.md 的
   安装说明要求用户从 OpenMimic 根目录启动,但如果 OpenClaw 支持 `cwd`,
   可以在配置中直接指定,更方便。待核对官方文档。

3. **环境变量展开语法**:`${LLM_API_KEY}` 引用格式来自第三方博客文档。
   需验证 OpenClaw 是否真的支持 `${VAR}` 语法从宿主环境展开变量,还是需要
   硬编码值或使用其他机制。待核对官方文档。

## 格式字段依据

| 字段 | 来源 | 置信度 |
|------|------|--------|
| `name` | clawhub/docs/skill-format.md (GitHub) | 高 |
| `description` | clawhub/docs/skill-format.md | 高 |
| `version` | clawhub/docs/skill-format.md | 高 |
| `metadata.openclaw.requires.bins` | clawhub/docs/skill-format.md | 高 |
| `metadata.openclaw.requires.env` | clawhub/docs/skill-format.md | 高 |
| `metadata.openclaw.primaryEnv` | clawhub/docs/skill-format.md | 中 (示例有,规范未明确必需) |
| `metadata.openclaw.homepage` | clawhub/docs/skill-format.md | 中 (文档有列出,未见广泛使用) |
| `mcpServers` JSON 格式 | openclawmcp.com + docs.openclaw.ai | 高 |
| `transport: "stdio"` | openclawmcp.com 示例 | 高 |
| `env` 字段 | openclawmcp.com 示例 | 高 |
| `${VAR}` 展开语法 | openclawmcp.com 博客 | 低,待核对官方文档 |
| `cwd` 字段 | 未在 OpenClaw 文档中见到 | 未知,待核对 |
