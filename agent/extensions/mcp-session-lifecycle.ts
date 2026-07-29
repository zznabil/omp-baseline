import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const ROOT = join(homedir(), ".omp", "run", "mcp-session-lifecycle");
const LEASES_DIR = join(ROOT, "leases");
const SERVICE_LEASES_DIR = join(ROOT, "service-leases");
const LOCKS_DIR = join(ROOT, "locks");
const SERVICES_FILE = join(ROOT, "services.json");
const LOCK_WAIT_MS = 25_000;
const SERVICE_READY_TIMEOUT_MS = 26_000;
const STATUS_KEY = "mcp-session-lifecycle";

type Lease = {
	pid: number;
	sessionId: string;
	startedAt: number;
};

type ManagedService = {
	pid: number;
	startedByBroker: boolean;
	startedAt: number;
	ready: boolean;
};

type ServiceState = Record<string, ManagedService>;

type LockOwner = {
	pid: number;
	sessionId: string;
	toolCallId: string;
	acquiredAt: number;
};
type GraphCall = {
	group: string;
	kind: "codegraph" | "review-graph";
	mutation: boolean;
	repo: string;
};

const SHARED_TOOL_GROUPS: Array<[prefix: string, group: string]> = [
	["xd://mcp__ida_pro_mcp_", "ida-pro"],
	["xd://mcp__ghidra_", "ghidra"],
	["xd://mcp__x_dbg_", "x64dbg"],
	["xd://mcp__cheat_engine_", "cheat-engine"],
];

function ensureDirectories(): void {
	mkdirSync(LEASES_DIR, { recursive: true });
	mkdirSync(LOCKS_DIR, { recursive: true });
	mkdirSync(SERVICE_LEASES_DIR, { recursive: true });
}

function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function readJson<T>(path: string, fallback: T): T {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return fallback;
	}
}

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function leasePath(sessionId: string, pid = process.pid): string {
	return join(
		LEASES_DIR,
		`${sessionId.replaceAll(/[^a-zA-Z0-9_.-]/g, "_")}-${pid}.json`,
	);
}

function pruneLeases(): Lease[] {
	ensureDirectories();
	const live: Lease[] = [];
	for (const name of readdirSync(LEASES_DIR)) {
		const path = join(LEASES_DIR, name);
		const lease = readJson<Lease | undefined>(path, undefined);
		if (!lease || !isProcessAlive(lease.pid)) {
			rmSync(path, { force: true });
			continue;
		}
		live.push(lease);
	}
	return live;
}
function serviceLeasePath(
	group: string,
	sessionId: string,
	pid = process.pid,
): string {
	const directory = join(SERVICE_LEASES_DIR, group);
	mkdirSync(directory, { recursive: true });
	return join(
		directory,
		`${sessionId.replaceAll(/[^a-zA-Z0-9_.-]/g, "_")}-${pid}.json`,
	);
}

function pruneServiceLeases(group: string): Lease[] {
	const directory = join(SERVICE_LEASES_DIR, group);
	if (!existsSync(directory)) return [];
	const live: Lease[] = [];
	for (const name of readdirSync(directory)) {
		const path = join(directory, name);
		const lease = readJson<Lease | undefined>(path, undefined);
		if (!lease || !isProcessAlive(lease.pid)) {
			rmSync(path, { force: true });
			continue;
		}
		live.push(lease);
	}
	return live;
}

function readServices(): ServiceState {
	return readJson<ServiceState>(SERVICES_FILE, {});
}

function writeServices(services: ServiceState): void {
	writeJson(SERVICES_FILE, services);
}

async function canConnect(port: number): Promise<boolean> {
	try {
		const socket = await Promise.race([
			Bun.connect({
				hostname: "127.0.0.1",
				port,
				socket: {
					data() {},
					open(connection) {
						connection.end();
					},
				},
			}),
			Bun.sleep(500).then(() => undefined),
		]);
		return socket !== undefined;
	} catch {
		return false;
	}
}

async function waitForPort(port: number): Promise<boolean> {
	const deadline = Date.now() + SERVICE_READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await canConnect(port)) return true;
		await Bun.sleep(200);
	}
	return false;
}

function spawn(command: string[], cwd = ROOT): number {
	const child = Bun.spawn(command, {
		cwd,
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
		windowsHide: true,
	});
	child.unref();
	return child.pid;
}
async function isImageRunning(imageName: string): Promise<boolean> {
	const query = Bun.spawn(
		["tasklist.exe", "/fi", `IMAGENAME eq ${imageName}`, "/fo", "csv", "/nh"],
		{ stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true },
	);
	const [output, exitCode] = await Promise.all([
		new Response(query.stdout).text(),
		query.exited,
	]);
	return (
		exitCode === 0 &&
		output.toLowerCase().includes(`"${imageName.toLowerCase()}"`)
	);
}
async function findProcessByCommandLine(
	fragment: string,
): Promise<number | undefined> {
	const escaped = fragment.replaceAll("'", "''");
	const query = Bun.spawn(
		[
			"powershell.exe",
			"-NoProfile",
			"-Command",
			`$process = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${escaped}*' } | Select-Object -First 1; if ($process) { $process.ProcessId }`,
		],
		{ stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true },
	);
	const [output, exitCode] = await Promise.all([
		new Response(query.stdout).text(),
		query.exited,
	]);
	if (exitCode !== 0) return undefined;
	const pid = Number.parseInt(output.trim(), 10);
	return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

async function minimizeWindow(pid: number): Promise<void> {
	const script = [
		`$processId = ${pid}`,
		"Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class WindowApi { [DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); }'",
		"for ($attempt = 0; $attempt -lt 25; $attempt++) {",
		"  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue",
		"  if (-not $process) { break }",
		"  if ($process.MainWindowHandle -ne 0) { [WindowApi]::ShowWindowAsync($process.MainWindowHandle, 6) | Out-Null; break }",
		"  Start-Sleep -Milliseconds 200",
		"}",
	].join("; ");
	const child = Bun.spawn(
		["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
		{ stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true },
	);
	await child.exited;
}

async function startCamofox(services: ServiceState): Promise<boolean> {
	if (await canConnect(9377)) return true;
	const existing = services.camofox;
	if (existing && isProcessAlive(existing.pid)) return existing.ready;
	const command = join(
		homedir(),
		"AppData",
		"Roaming",
		"npm",
		"camofox-browser.cmd",
	);
	if (!existsSync(command)) return false;
	const pid = spawn(["cmd.exe", "/d", "/s", "/c", command]);
	services.camofox = {
		pid,
		startedByBroker: true,
		startedAt: Date.now(),
		ready: false,
	};
	const ready = await waitForPort(9377);
	services.camofox.ready = ready;
	return ready;
}

async function startIda(services: ServiceState): Promise<boolean> {
	if (await canConnect(13337)) return true;
	const existing = services.ida;
	if (existing && isProcessAlive(existing.pid)) return existing.ready;
	const executable = "C:/Program Files/IDA Professional 9.0/ida.exe";
	const bootstrapDatabase = join(ROOT, "ida-bootstrap.i64");
	const bootstrapInput = "C:/Windows/System32/notepad.exe";
	if (!existsSync(executable) || !existsSync(bootstrapInput)) return false;
	if (!existsSync(bootstrapDatabase)) {
		for (const name of readdirSync(ROOT)) {
			if (name.startsWith("ida-bootstrap."))
				rmSync(join(ROOT, name), { force: true });
		}
	}
	const command = existsSync(bootstrapDatabase)
		? [executable, "-A", bootstrapDatabase]
		: [executable, "-A", `-o${bootstrapDatabase}`, bootstrapInput];
	const pid = spawn(command);
	await minimizeWindow(pid);
	services.ida = {
		pid,
		startedByBroker: true,
		startedAt: Date.now(),
		ready: false,
	};
	const ready = await waitForPort(13337);
	if (ready) await minimizeWindow(pid);
	services.ida.ready = ready;
	return ready;
}
async function startGhidra(services: ServiceState): Promise<boolean> {
	if (await canConnect(8089)) return true;
	const existing = services.ghidra;
	if (existing && isProcessAlive(existing.pid)) return existing.ready;
	const launcher = "C:/Tools/ghidra_12.1.2_PUBLIC/ghidraRun.bat";
	const project = join(homedir(), "omp-mcp-smoke.gpr");
	if (!existsSync(launcher) || !existsSync(project)) return false;
	const launcherPid = spawn(["cmd.exe", "/d", "/s", "/c", launcher, project]);
	services.ghidra = {
		pid: launcherPid,
		startedByBroker: true,
		startedAt: Date.now(),
		ready: false,
	};
	const ready = await waitForPort(8089);
	services.ghidra.ready = ready;
	if (!ready) return false;
	const ghidraPid = await findProcessByCommandLine("ghidra.GhidraRun");
	if (ghidraPid) await minimizeWindow(ghidraPid);
	if (ghidraPid) services.ghidra.pid = ghidraPid;
	return true;
}

async function startX64dbg(services: ServiceState): Promise<boolean> {
	const existing = services.x64dbg;
	if (existing && isProcessAlive(existing.pid)) return existing.ready;
	if (await isImageRunning("x64dbg.exe")) return true;
	const executable = join(
		homedir(),
		"AppData",
		"Local",
		"Microsoft",
		"WinGet",
		"Packages",
		"x64dbg.x64dbg_Microsoft.Winget.Source_8wekyb3d8bbwe",
		"release",
		"x64",
		"x64dbg.exe",
	);
	if (!existsSync(executable)) return false;
	const pid = spawn([executable]);
	await minimizeWindow(pid);
	services.x64dbg = {
		pid,
		startedByBroker: true,
		startedAt: Date.now(),
		ready: false,
	};
	await Bun.sleep(1_500);
	await minimizeWindow(pid);
	const ready = isProcessAlive(pid);
	services.x64dbg.ready = ready;
	return ready;
}

async function ensureCamofox(): Promise<boolean> {
	const services = readServices();
	const ready = await startCamofox(services);
	writeServices(services);
	return ready;
}

async function ensureGuiService(group: string): Promise<boolean> {
	const services = readServices();
	let ready = true;
	if (group === "ida-pro") ready = await startIda(services);
	else if (group === "ghidra") ready = await startGhidra(services);
	else if (group === "x64dbg") ready = await startX64dbg(services);
	writeServices(services);
	return ready;
}

function managedServiceKey(group: string): string {
	return group === "ida-pro" ? "ida" : group;
}

function stopManagedService(group: string): void {
	const services = readServices();
	const key = managedServiceKey(group);
	const service = services[key];
	if (service?.startedByBroker && isProcessAlive(service.pid)) {
		try {
			process.kill(service.pid);
		} catch {}
		Bun.spawn(["taskkill.exe", "/pid", String(service.pid), "/t", "/f"], {
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
			windowsHide: true,
		}).unref();
	}
	delete services[key];
	writeServices(services);
}

function mountedToolName(
	toolName: string,
	input: Record<string, unknown>,
): string {
	return toolName === "write" && typeof input.path === "string"
		? input.path
		: toolName;
}

function toolPayload(
	toolName: string,
	input: Record<string, unknown>,
): Record<string, unknown> {
	if (toolName !== "write" || typeof input.content !== "string") return input;
	try {
		const parsed = JSON.parse(input.content) as unknown;
		return parsed && typeof parsed === "object"
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

async function gitRoot(candidate: string): Promise<string> {
	const query = Bun.spawn(
		["git.exe", "-C", candidate, "rev-parse", "--show-toplevel"],
		{ stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true },
	);
	const [output, exitCode] = await Promise.all([
		new Response(query.stdout).text(),
		query.exited,
	]);
	return exitCode === 0 && output.trim()
		? resolve(output.trim())
		: resolve(candidate);
}

async function graphCallForTool(
	toolName: string,
	input: Record<string, unknown>,
	cwd: string,
): Promise<GraphCall | undefined> {
	const mountedName = mountedToolName(toolName, input);
	const kind =
		mountedName.startsWith("xd://mcp__codegraph_") ||
		mountedName.startsWith("mcp__codegraph_")
			? "codegraph"
			: mountedName.startsWith("xd://mcp__code_review_graph_") ||
					mountedName.startsWith("mcp__code_review_graph_")
				? "review-graph"
				: undefined;
	if (!kind) return undefined;

	const payload = toolPayload(toolName, input);
	const candidate = [
		payload.projectPath,
		payload.repo_root,
		payload.project_path,
		payload.repo,
		payload.repoPath,
	].find(
		(value): value is string => typeof value === "string" && value.length > 0,
	);
	const repo = await gitRoot(candidate ?? cwd);
	const mutation =
		kind === "review-graph" &&
		/(build_or_update|run_postprocess|embed_graph|apply_refactor)_tool/.test(
			mountedName,
		);
	return {
		group: `graph-${kind}-${Bun.hash(repo).toString(16)}`,
		kind,
		mutation,
		repo,
	};
}

async function runGraphCommand(command: string[]): Promise<void> {
	const child = Bun.spawn(command, {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		windowsHide: true,
	});
	const result = await Promise.race([
		Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]).then(([exitCode, stdout, stderr]) => ({ exitCode, stdout, stderr })),
		Bun.sleep(20_000).then(() => undefined),
	]);
	if (!result) {
		child.kill();
		throw new Error(`Graph refresh exceeded 20 seconds: ${command[0]}`);
	}
	if (result.exitCode !== 0) {
		const detail = (result.stderr || result.stdout).trim();
		throw new Error(
			`Graph refresh failed (${command[0]}): ${detail || `exit ${result.exitCode}`}`,
		);
	}
}

async function refreshGraph(call: GraphCall): Promise<void> {
	if (call.kind === "codegraph") {
		const initialized = existsSync(join(call.repo, ".codegraph"));
		await runGraphCommand([
			"codegraph.cmd",
			initialized ? "sync" : "init",
			call.repo,
			...(initialized ? ["--quiet"] : []),
		]);
		return;
	}
	await runGraphCommand([
		"code-review-graph.exe",
		"update",
		"--repo",
		call.repo,
		"--base",
		"HEAD",
	]);
}

function groupForToolCall(
	toolName: string,
	input: Record<string, unknown>,
): string | undefined {
	const mountedName = mountedToolName(toolName, input);
	return SHARED_TOOL_GROUPS.find(([prefix]) => {
		const directPrefix = prefix.replace("xd://", "");
		return (
			mountedName.startsWith(prefix) || mountedName.startsWith(directPrefix)
		);
	})?.[1];
}

function lockPath(group: string): string {
	return join(LOCKS_DIR, `${group}.lock`);
}

function removeStaleLock(path: string): void {
	if (!existsSync(path)) return;
	const owner = readJson<LockOwner | undefined>(
		join(path, "owner.json"),
		undefined,
	);
	if (!owner || !isProcessAlive(owner.pid))
		rmSync(path, { recursive: true, force: true });
}

async function acquireLock(group: string, owner: LockOwner): Promise<void> {
	ensureDirectories();
	const path = lockPath(group);
	const deadline = Date.now() + LOCK_WAIT_MS;
	while (Date.now() < deadline) {
		removeStaleLock(path);
		try {
			mkdirSync(path);
			writeJson(join(path, "owner.json"), owner);
			return;
		} catch {
			await Bun.sleep(75);
		}
	}
	throw new Error(`Timed out waiting for shared MCP resource: ${group}`);
}

function releaseLock(group: string, toolCallId: string): void {
	const path = lockPath(group);
	const owner = readJson<LockOwner | undefined>(
		join(path, "owner.json"),
		undefined,
	);
	if (owner?.pid === process.pid && owner.toolCallId === toolCallId) {
		rmSync(path, { recursive: true, force: true });
	}
}

function releaseOwnedLocks(): void {
	if (!existsSync(LOCKS_DIR)) return;
	for (const name of readdirSync(LOCKS_DIR)) {
		const path = join(LOCKS_DIR, name);
		const owner = readJson<LockOwner | undefined>(
			join(path, "owner.json"),
			undefined,
		);
		if (owner?.pid === process.pid)
			rmSync(path, { recursive: true, force: true });
	}
}

export default function (pi: ExtensionAPI): void {
	let sessionId = `pid-${process.pid}`;
	const locksByCall = new Map<string, string>();
	const acquiredServices = new Set<string>();

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		ensureDirectories();
		sessionId = ctx.sessionManager.getSessionId();
		pruneLeases();
		writeJson(leasePath(sessionId), {
			pid: process.pid,
			sessionId,
			startedAt: Date.now(),
		} satisfies Lease);

		const startupCallId = `startup-${sessionId}-${process.pid}`;
		await acquireLock("services", {
			pid: process.pid,
			sessionId,
			toolCallId: startupCallId,
			acquiredAt: Date.now(),
		});
		let camofoxReady = false;
		for (const group of ["ida-pro", "ghidra", "x64dbg"]) {
			if (pruneServiceLeases(group).length === 0) stopManagedService(group);
		}
		try {
			camofoxReady = await ensureCamofox();
		} finally {
			releaseLock("services", startupCallId);
		}
		const status = camofoxReady
			? "MCP lifecycle: lazy GUI"
			: "MCP unavailable: Camofox";
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("muted", status));
	});

	pi.on("tool_call", async (event, ctx) => {
		const graphCall = await graphCallForTool(
			event.toolName,
			event.input,
			ctx.cwd,
		);
		const group =
			groupForToolCall(event.toolName, event.input) ?? graphCall?.group;
		if (!group) return;
		const existingGroup = locksByCall.get(event.toolCallId);
		if (existingGroup === group) return;
		if (existingGroup)
			throw new Error(
				`Tool call ${event.toolCallId} already owns shared MCP resource: ${existingGroup}`,
			);
		await acquireLock(group, {
			pid: process.pid,
			sessionId,
			toolCallId: event.toolCallId,
			acquiredAt: Date.now(),
		});
		locksByCall.set(event.toolCallId, group);

		try {
			if (graphCall) {
				if (!graphCall.mutation) await refreshGraph(graphCall);
				return;
			}
			if (group === "cheat-engine") return;
			const serviceCallId = `service-${event.toolCallId}`;
			await acquireLock("services", {
				pid: process.pid,
				sessionId,
				toolCallId: serviceCallId,
				acquiredAt: Date.now(),
			});
			let ready = false;
			try {
				ready = await ensureGuiService(group);
			} finally {
				releaseLock("services", serviceCallId);
			}
			if (!ready) {
				stopManagedService(group);
				throw new Error(`Unable to start shared MCP resource: ${group}`);
			}
			writeJson(serviceLeasePath(group, sessionId), {
				pid: process.pid,
				sessionId,
				startedAt: Date.now(),
			} satisfies Lease);
			acquiredServices.add(group);
		} catch (error) {
			releaseLock(group, event.toolCallId);
			locksByCall.delete(event.toolCallId);
			throw error;
		}
	});

	pi.on("tool_result", (event) => {
		const group = locksByCall.get(event.toolCallId);
		if (!group) return;
		releaseLock(group, event.toolCallId);
		locksByCall.delete(event.toolCallId);
	});

	pi.on("tool_approval_resolved", (event) => {
		if (event.approved) return;
		const group = locksByCall.get(event.toolCallId);
		if (!group) return;
		releaseLock(group, event.toolCallId);
		locksByCall.delete(event.toolCallId);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		for (const group of acquiredServices) {
			rmSync(serviceLeasePath(group, sessionId), { force: true });
			if (pruneServiceLeases(group).length === 0) stopManagedService(group);
		}
		releaseOwnedLocks();
		rmSync(leasePath(sessionId), { force: true });
		const remaining = pruneLeases();
		if (remaining.length === 0) stopManagedService("camofox");
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
