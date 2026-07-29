# OMP Baseline

Public, sanitized backup of the custom Oh My Pi (OMP) MCP setup used on Windows.

## Included

- `agent/extensions/mcp-session-lifecycle.ts` — lazy MCP GUI lifecycle, per-session leases, minimized startup, shared-resource locking, and per-repository graph refreshes.
- `agent/mcp.example.json` — sanitized MCP server configuration.

## Install

1. Copy `agent/extensions/mcp-session-lifecycle.ts` to `~/.omp/agent/extensions/`.
2. Copy `agent/mcp.example.json` to `~/.omp/agent/mcp.json`.
3. Replace every `<USERPROFILE>` placeholder and adjust tool installation paths for the machine.
4. Restart OMP.

## Behavior

GUI-backed MCP hosts start only on first use, open minimized, remain shared while consuming OMP sessions are alive, and close after the final consumer exits. An agent can still foreground a host explicitly through Computer Use.

Codegraph and Code Review Graph operations are serialized per repository and refresh their indexes before read operations.

## Platform notes

This baseline targets Windows and contains installation-specific defaults for IDA Professional 9.0, Ghidra 12.1.2, x64dbg, Camofox, and the configured MCP tools. Review paths before use.
