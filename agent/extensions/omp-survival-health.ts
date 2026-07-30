import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Socket } from "node:net";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const STATUS_KEY = "omp-survival-health";
const MCP_EVENT = "mcp:connection-status";
const REFRESH_MS = 60_000;
const MCP_GRACE_MS = 30_000;
const ROOT = join(homedir(), ".omp");
const AGENT = join(ROOT, "agent");
const POWERSHELL_PROFILE = join(homedir(), "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
const PROFILE_NAMES = ["research", "browser", "reverse", "full"] as const;

type ProfileName = "core" | (typeof PROFILE_NAMES)[number];
type McpStatusEvent =
	| { type: "connecting"; serverNames: string[] }
	| { type: "connected"; serverName: string }
	| { type: "failed"; serverName: string; error: string };

type HealthSnapshot = {
	profile: ProfileName;
	state: "healthy" | "pending" | "failed";
	details: string[];
};

const EXPECTED_MCP: Record<ProfileName, readonly string[]> = {
	core: [],
	research: ["deepwiki", "github", "microsoft-learn", "octocode", "openai-websearch"],
	browser: ["camofox", "cua-driver"],
	reverse: ["cheat-engine", "ghidra", "ida-pro-mcp", "x64dbg"],
	full: [
		"obscura",
		"camofox",
		"x64dbg",
		"cheat-engine",
		"ghidra",
		"deepwiki",
		"microsoft-learn",
		"cua-driver",
		"markitdown",
		"semble",
		"code-review-graph",
		"octocode",
		"serena",
		"openai-websearch",
	],
};

function currentProfile(): ProfileName {
	const value = process.env.OMP_PROFILE;
	return PROFILE_NAMES.includes(value as (typeof PROFILE_NAMES)[number])
		? (value as ProfileName)
		: "core";
}

function readText(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

function fileProblems(profile: ProfileName): string[] {
	const problems: string[] = [];
	const baseConfig = readText(join(AGENT, "config.yml"));
	if (!baseConfig) problems.push("missing agent/config.yml");
	else if (!/^\s*xdevDocs:\s*catalog\s*$/m.test(baseConfig)) problems.push("xdevDocs is not catalog");

	const coreMcp = readText(join(AGENT, "mcp.json"));
	if (!coreMcp) problems.push("missing agent/mcp.json");
	else {
		try {
			JSON.parse(coreMcp);
		} catch {
			problems.push("invalid agent/mcp.json");
		}
	}

	for (const name of PROFILE_NAMES) {
		for (const file of ["overlay.yml", "mcp.json"]) {
			const path = join(ROOT, "profiles", name, "agent", file);
			if (!existsSync(path)) problems.push(`missing ${name}/${file}`);
			else if (file === "mcp.json") {
				try {
					JSON.parse(readFileSync(path, "utf8"));
				} catch {
					problems.push(`invalid ${name}/mcp.json`);
				}
			}
		}
	}

	for (const file of ["mcp-session-lifecycle.ts", "openai-weekly-quota.ts", "omp-survival-health.ts"]) {
		if (!existsSync(join(AGENT, "extensions", file))) problems.push(`missing extension ${file}`);
	}

	if (process.platform === "win32") {
		const shellProfile = readText(POWERSHELL_PROFILE);
		if (!shellProfile?.includes("# >>> OMP lean profiles >>>")) problems.push("missing PowerShell launcher block");
		for (const name of PROFILE_NAMES) {
			if (!shellProfile?.includes(`function omp-${name}`)) problems.push(`missing omp-${name} launcher`);
		}
	}

	if (profile !== "core") {
		if (!process.env.OMP_AUTH_BROKER_URL) problems.push("auth broker URL missing");
		if (!process.env.OMP_AUTH_BROKER_TOKEN) problems.push("auth broker token missing");
	}
	return problems;
}

function brokerReachable(): Promise<boolean> {
	const { promise, resolve } = Promise.withResolvers<boolean>();
	const socket = new Socket();
	let settled = false;
	const finish = (result: boolean) => {
		if (settled) return;
		settled = true;
		socket.destroy();
		resolve(result);
	};
	socket.setTimeout(500);
	socket.once("connect", () => finish(true));
	socket.once("timeout", () => finish(false));
	socket.once("error", () => finish(false));
	socket.connect(8765, "127.0.0.1");
	return promise;
}

function isMcpStatusEvent(value: unknown): value is McpStatusEvent {
	if (!value || typeof value !== "object") return false;
	const event = value as Partial<McpStatusEvent>;
	if (event.type === "connecting") return Array.isArray(event.serverNames);
	if (event.type === "connected") return typeof event.serverName === "string";
	return event.type === "failed" && typeof event.serverName === "string" && typeof event.error === "string";
}

export default function (pi: ExtensionAPI): void {
	const profile = currentProfile();
	const connected = new Set<string>();
	const pending = new Set<string>();
	const failed = new Map<string, string>();
	let startedAt = Date.now();
	let refreshTimer: NodeJS.Timeout | undefined;
	let graceTimer: NodeJS.Timeout | undefined;
	let latest: HealthSnapshot = { profile, state: "pending", details: ["checking configuration"] };
	let lastContext: ExtensionContext | undefined;

	const render = (ctx: ExtensionContext, snapshot: HealthSnapshot) => {
		const label = `OMP ${snapshot.profile}`;
		if (snapshot.state === "healthy") {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("success", `${label} ✓`));
		} else if (snapshot.state === "pending") {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", `${label} ◌`));
		} else {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", `${label} !${snapshot.details.length}`));
		}
	};

	const refresh = async (ctx: ExtensionContext) => {
		lastContext = ctx;
		const details = fileProblems(profile);
		if (!ctx.model) details.push("model unavailable");
		if (profile !== "core" && !(await brokerReachable())) details.push("auth broker unreachable");

		for (const [name, error] of failed) details.push(`${name} failed: ${error}`);
		const expected = EXPECTED_MCP[profile];
		const missing = expected.filter(name => !connected.has(name));
		const insideGrace = Date.now() - startedAt < MCP_GRACE_MS;
		if (!insideGrace) {
			for (const name of missing) {
				if (!failed.has(name)) details.push(`${name} not connected`);
			}
		}

		const isPending = details.length === 0 && (insideGrace && missing.length > 0 || pending.size > 0);
		latest = {
			profile,
			state: details.length > 0 ? "failed" : isPending ? "pending" : "healthy",
			details: details.length > 0 ? details : isPending ? [`waiting for ${missing.length || pending.size} MCP server(s)`] : ["all checks passed"],
		};
		render(ctx, latest);
	};

	const unsubscribeMcp = pi.events.on(MCP_EVENT, value => {
		if (!isMcpStatusEvent(value)) return;
		if (value.type === "connecting") {
			for (const name of value.serverNames) pending.add(name);
		} else if (value.type === "connected") {
			pending.delete(value.serverName);
			failed.delete(value.serverName);
			connected.add(value.serverName);
		} else {
			pending.delete(value.serverName);
			connected.delete(value.serverName);
			failed.set(value.serverName, value.error);
		}
		if (lastContext) void refresh(lastContext);
	});

	pi.registerCommand("omp-health", {
		description: "Show OMP profile survival and connection health",
		handler: async (_args, ctx) => {
			await refresh(ctx);
			const heading = latest.state === "healthy" ? "OMP health: all checks passed" : `OMP health: ${latest.state}`;
			ctx.ui.notify([heading, `Profile: ${latest.profile}`, ...latest.details.map(item => `• ${item}`)].join("\n"), latest.state === "failed" ? "error" : latest.state === "pending" ? "warning" : "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		startedAt = Date.now();
		await refresh(ctx);
		graceTimer = setTimeout(() => void refresh(ctx), MCP_GRACE_MS);
		refreshTimer = setInterval(() => void refresh(ctx), REFRESH_MS);
	});

	pi.on("turn_end", async (_event, ctx) => {
		await refresh(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		clearInterval(refreshTimer);
		clearTimeout(graceTimer);
		refreshTimer = undefined;
		graceTimer = undefined;
		unsubscribeMcp();
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
