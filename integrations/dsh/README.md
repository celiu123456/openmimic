# OpenMimic + DeepSeek Harness (dsh)

Register OpenMimic's MCP server as a tool source in any dsh profile.
After installation, the model sees five tools under the `mcp__openmimic__`
namespace: `persona_list`, `persona_context`, `persona_speak`,
`testimony_submit`, `room_run`.

## Prerequisites

- Node >= 22
- dsh (`@deepseek-ai/dsh`) >= 0.1.0-rc.6 (ships `@deepseek-ai/dsh-mcp-client`)
- A cloned OpenMimic repo with `npm install` completed

## Install (3 steps)

1. **Clone and install OpenMimic** (skip if already done):

   ```sh
   git clone https://github.com/anthropics/openmimic.git
   cd openmimic && npm install
   ```

2. **Append the MCP client entry** to your dsh profile's `cordis.patch.yml`
   (e.g. `~/.dsh/profiles/headless/cordis.patch.yml`):

   ```yaml
   - insert:
       - id: mcp-openmimic
         name: '@deepseek-ai/dsh-mcp-client'
         config:
           serverName: openmimic
           transport: stdio
           command: npx
           args: ['tsx', 'server/src/mcp/main.ts']
           cwd: /absolute/path/to/openmimic
           env:
             OPENMIMIC_DB: /absolute/path/to/openmimic/data/openmimic.db
   ```

   Edit `cwd` and `OPENMIMIC_DB` to match your clone location.
   The `- insert:` directive adds a new plugin entry to the config tree.

3. **Verify** by dumping the composed config:

   ```sh
   dsh --dump-config --profile headless | grep mcp-openmimic
   ```

   You should see the `mcp-openmimic` entry in the output.

## Configuration

| Field          | Required | Description                                       |
|----------------|----------|---------------------------------------------------|
| `cwd`          | yes      | Absolute path to your OpenMimic clone              |
| `OPENMIMIC_DB` | no       | Database path; defaults to `data/openmimic.db`     |
| `LLM_BASE_URL` | no       | OpenAI-compatible endpoint for `persona_speak`     |
| `LLM_API_KEY`  | no       | API key for the upstream model                     |
| `LLM_MODEL`    | no       | Model name (e.g. `deepseek-chat`)                  |

Without LLM env vars the server still starts. `persona_list`,
`persona_context`, and `room_run` (with demo data) work without a model;
only `persona_speak` returns an error when no key is configured.

## Usage

```sh
# headless one-shot
dsh --profile headless "Use mcp__openmimic__persona_list to list available personas"

# ask a persona to speak (requires LLM env vars)
dsh --profile headless "Use mcp__openmimic__persona_speak with subjectId 'limo' and message '最近什么打算'"
```

## Uninstall

Remove the `- id: mcp-openmimic` block from your `cordis.patch.yml`. No
packages to uninstall -- the MCP client plugin is already bundled with dsh.
