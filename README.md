# Minimal OMP Baseline

Windows setup containing only:

- Portable OMP defaults: code mode, low verbosity, friendly personality, AST grep, checkpoints, LSP, hashline editing, and one level of nested subagents.
- Live OpenAI quota statusline: Codex weekly, Spark 5-hour, Spark weekly, and banked resets.
- [Ponytail](https://github.com/dietrichgebert/ponytail) 4.10.0 in ultra mode (MIT).
- [Semble](https://github.com/MinishLab/semble) 0.5.5 CLI with an OMP semantic-search skill.

## Install

Requirements: OMP, PowerShell 5.1+, [uv](https://docs.astral.sh/uv/). Live OpenAI quota statusline needs authenticated `openai-codex` provider; Ponytail and Semble work without it.

```powershell
./install.ps1
```

Restart OMP after installation.

The installer merges these settings into the existing OMP configuration: `providers.openai-codex.codeMode=on`, `textVerbosity=low`, `personality=friendly`, `astGrep.enabled=true`, `checkpoint.enabled=true`, `task.enableLsp=true`, `task.maxRecursionDepth=1`, `lsp.formatOnWrite=true`, `lsp.diagnosticsOnEdit=true`, and `edit.mode=hashline`. Other settings remain unchanged.

## Installed files

- `~/.omp/agent/extensions/openai-weekly-quota.ts`
- `~/.agents/skills/semble/SKILL.md`
- `%APPDATA%/ponytail/config.json` (`defaultMode: ultra`)
- OMP plugin `@dietrichgebert/ponytail@4.10.0` ([upstream](https://github.com/dietrichgebert/ponytail), MIT)
- Semble CLI `0.5.5`

The installer removes the exact legacy Caveman extension and skill file. It does not remove plugin manifests, caches, or other user data.

The quota extension runs `omp usage --provider openai-codex --json` after each turn and every five minutes. It displays Codex weekly usage, separate Spark 5-hour and weekly usage, and available banked resets with the nearest expiry. Missing provider values display as `—`; failed usage checks display `OpenAI quota unavailable`.

MCP servers, browser tooling, profiles, launchers, and health checks are intentionally excluded.
