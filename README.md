# OMP Baseline

Public, sanitized backup of a lean, profile-aware Oh My Pi setup for Windows.

## Included

- `agent/config.example.yml` — lean core configuration.
- `agent/mcp-core.example.json` — core profile with MCP servers disabled.
- `profiles/*/agent` — research, browser, reverse-engineering, and full profile overlays.
- `agent/extensions/mcp-session-lifecycle.ts` — lazy GUI startup, shared leases, minimized windows, and serialized mutable tools.
- `agent/extensions/openai-weekly-quota.ts` — live OpenAI 5-hour, 7-day, and Spark quota status.
- `agent/extensions/omp-survival-health.ts` — profile-aware configuration, model, broker, and MCP health status.
- `powershell/omp-profiles.ps1` — `omp`, `omp-research`, `omp-browser`, `omp-reverse`, and `omp-full` launchers.

## Install

1. Copy `agent/config.example.yml` to `~/.omp/agent/config.yml`.
2. Copy `agent/mcp-core.example.json` to `~/.omp/agent/mcp.json`.
3. Copy all three extensions to `~/.omp/agent/extensions/`.
4. Copy each `profiles/<name>/agent/overlay.yml` to `~/.omp/profiles/<name>/agent/overlay.yml`.
5. Copy each profile's `mcp.example.json` to the same directory as `mcp.json`.
6. Replace every `<USERPROFILE>` placeholder and adjust tool installation paths.
7. Append `powershell/omp-profiles.ps1` to `$PROFILE`.
8. Restart PowerShell and OMP.

## Status

- `OMP <profile> ✓` — all checks passed.
- `OMP <profile> ◌` — expected MCP servers are still connecting.
- `OMP <profile> !N` — `N` checks failed; run `/omp-health` for details.

The quota line reports OpenAI 5-hour, 7-day, and Spark windows when the provider returns them.

## Behavior

The default `omp` command stays lean. Specialist launchers enable only their matching tools, skills, and MCP servers.

GUI-backed MCP hosts start on first use, open minimized, remain shared while consuming OMP sessions are alive, and close after the final consumer exits. An agent can still foreground a host explicitly through Computer Use.

Codegraph and Code Review Graph operations are serialized per repository and refresh their indexes before read operations.

## Platform notes

This baseline targets Windows and contains installation-specific defaults for IDA Professional 9.0, Ghidra 12.1.2, x64dbg, Camofox, and the configured MCP tools. Review paths before use.
