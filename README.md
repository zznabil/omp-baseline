# Minimal OMP Baseline

Windows setup containing only:

- Live OpenAI quota statusline: 5-hour, 7-day, and Spark windows.
- [Ponytail](https://github.com/DietrichGebert/ponytail) 4.9.0 in ultra mode.
- [Caveman](https://github.com/JuliusBrussee/caveman) 1.10.0 skill in ultra mode.

## Install

Requirements: OMP, PowerShell 5.1+, and an authenticated `openai-codex` provider.

```powershell
./install.ps1
```

Restart OMP after installation.

## Installed files

- `~/.omp/agent/extensions/openai-weekly-quota.ts`
- `~/.omp/agent/extensions/caveman-ultra.ts`
- `~/.agents/skills/caveman/SKILL.md`
- `%APPDATA%/ponytail/config.json`
- OMP plugin `@dietrichgebert/ponytail@4.9.0`

The quota extension runs `omp usage --provider openai-codex --json` after each turn and every five minutes. Missing provider windows display as `—`; failed usage checks display `OpenAI quota unavailable`.

Caveman Proxy, MCP servers, browser tooling, profiles, launchers, and health checks are intentionally excluded.
