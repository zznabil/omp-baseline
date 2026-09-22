# Minimal OMP Baseline

Windows setup containing:

- Portable OMP defaults: code mode, low verbosity, friendly personality, AST grep, checkpoints, LSP, hashline editing, and one level of nested subagents.
- Live OpenAI quota statusline: Codex weekly, Spark 5-hour, Spark weekly, and banked resets.
- [Semble](https://github.com/MinishLab/semble) 0.5.5 CLI with an OMP semantic-search skill.
- Ponytail 4.9.0 from the exact upstream main commit 974d940a1c5344210874150b98ff0d2c861fab6a, installed through OMP's Pi-compatible plugin manager. OMP loads Ponytail's Pi extension and six skills from the full pinned Git checkout.

## Install

Requirements: OMP, PowerShell 5.1+, [uv](https://docs.astral.sh/uv/). The live OpenAI quota statusline needs an authenticated openai-codex provider; Semble works without it. Ponytail is installed from its pinned public Git ref.

    ./install.ps1

The installer merges these settings into the existing OMP configuration: providers.openai-codex.codeMode=on, textVerbosity=low, personality=friendly, astGrep.enabled=true, checkpoint.enabled=true, task.enableLsp=true, task.maxRecursionDepth=1, lsp.formatOnWrite=true, lsp.diagnosticsOnEdit=true, and edit.mode=hashline. Other settings remain unchanged.

It also installs Ponytail with omp plugin install github:DietrichGebert/ponytail#974d940a1c5344210874150b98ff0d2c861fab6 --force in OMP's normal user plugin scope. Restart OMP after installation.

## Ponytail

After installation, Ponytail's persisted default is ultra unless PONYTAIL_DEFAULT_MODE overrides it. Use /ponytail, /ponytail lite, /ponytail full, /ponytail ultra, or /ponytail off. The package also provides /ponytail-review, /ponytail-audit, /ponytail-debt, /ponytail-gain, and /ponytail-help.

The installer writes defaultMode=ultra to Ponytail's persisted config. Ponytail checks PONYTAIL_DEFAULT_MODE first, then XDG_CONFIG_HOME\ponytail\config.json when XDG_CONFIG_HOME is set, then (on Windows) %APPDATA%\ponytail\config.json. If APPDATA is unavailable, it falls back to %USERPROFILE%\AppData\Roaming\ponytail\config.json. Existing config keys are preserved; the installer creates the directory and file when absent and never deletes Ponytail config.

## Installed files

- OMP user plugin entry for the pinned Ponytail package (OMP loads its Pi extension and six skills from the full Git checkout)
- ~/.omp/agent/extensions/openai-weekly-quota.ts
- ~/.agents/skills/semble/SKILL.md
- Semble CLI 0.5.5

The installer removes only the exact legacy Caveman extension and skill file. It does not remove plugin manifests, caches, Ponytail configuration, or other user data.

The quota extension runs omp usage --provider openai-codex --json after each turn and every five minutes. It displays Codex weekly usage, separate Spark 5-hour and weekly usage, and available banked resets with the nearest expiry. Missing provider values display as —; failed usage checks display OpenAI quota unavailable.

## Verification

Use `omp plugin list --json` after an authorized install to inspect the user plugin entry. Then cold-start OMP and verify the six Ponytail commands (`/ponytail`, `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain`, and `/ponytail-help`), the `off`, `lite`, `full`, and `ultra` mode switches, and the persisted ultra default (or the PONYTAIL_DEFAULT_MODE override). The quota parser can be checked without installation:

    bun test agent/extensions/openai-weekly-quota.test.ts

Installer changes must be smoke-tested with mocked `omp` and `uv` commands plus isolated `HOME` and `APPDATA`; never use the real installer as an automated test.

MCP servers, browser tooling, profiles, launchers, and health checks are intentionally excluded.