import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const STATUS_KEY = "openai-weekly-quota";
const REFRESH_MS = 5 * 60_000;
const USAGE_TIMEOUT_MS = 10_000;

type UsageLimit = {
	scope?: { windowId?: string; tier?: string };
	amount?: { remaining?: number };
	window?: { resetsAt?: number };
};

type ResetCredit = {
	expiresAt?: string;
	status?: string;
};

type UsageReport = {
	limits?: UsageLimit[];
	resetCredits?: {
		availableCount?: number;
		credits?: ResetCredit[];
	};
};

type UsageResponse = {
	reports?: UsageReport[];
};

type QuotaWindow = {
	remaining: number;
	resetsAt?: number;
};

type QuotaSnapshot = {
	codexWeekly?: QuotaWindow;
	sparkFiveHour?: QuotaWindow;
	sparkWeekly?: QuotaWindow;
	bankedResets?: {
		availableCount: number;
		expiresAt?: number;
	};
};

function formatRemainingTime(resetsAt: number | undefined): string {
	if (!resetsAt) return "";
	const totalHours = Math.max(0, Math.ceil((resetsAt - Date.now()) / 3_600_000));
	const days = Math.floor(totalHours / 24);
	const hours = totalHours % 24;
	return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

function toQuotaWindow(limit: UsageLimit | undefined): QuotaWindow | undefined {
	const remaining = limit?.amount?.remaining;
	return typeof remaining === "number"
		? { remaining: Math.round(remaining), resetsAt: limit?.window?.resetsAt }
		: undefined;
}
export function parseQuota(response: UsageResponse): QuotaSnapshot | null {
	const reports = response.reports ?? [];
	const limits = reports.flatMap(report => report.limits ?? []);
	const codexWeekly = toQuotaWindow(
		limits.find(limit => limit.scope?.windowId === "7d" && !limit.scope?.tier),
	);
	const sparkFiveHour = toQuotaWindow(
		limits.find(limit => limit.scope?.windowId === "5h" && limit.scope?.tier === "spark"),
	);
	const sparkWeekly = toQuotaWindow(
		limits.find(limit => limit.scope?.windowId === "7d" && limit.scope?.tier === "spark"),
	);
	const resetCredits = reports.find(report => report.resetCredits)?.resetCredits;
	const availableCount = resetCredits?.availableCount;
	const expirations = (resetCredits?.credits ?? [])
		.flatMap(credit =>
			credit.status === "available" && credit.expiresAt ? [Date.parse(credit.expiresAt)] : [],
		)
		.filter(Number.isFinite);
	const bankedResets =
		typeof availableCount === "number"
			? {
					availableCount,
					expiresAt: expirations.length > 0 ? Math.min(...expirations) : undefined,
				}
			: undefined;
	const quota = { codexWeekly, sparkFiveHour, sparkWeekly, bankedResets };
	return quota.codexWeekly || quota.sparkFiveHour || quota.sparkWeekly || quota.bankedResets ? quota : null;
}

async function getQuota(): Promise<QuotaSnapshot | null> {
	const controller = new AbortController();
	const process = Bun.spawn(["omp", "usage", "--provider", "openai-codex", "--json"], {
		stdout: "pipe",
		stderr: "pipe",
		signal: controller.signal,
	});
	// Bound the fetch: a wedged `omp usage` must not freeze the status line or
	// hold the refreshing guard forever. Abort kills the child via the signal;
	// the explicit kill covers runtimes where spawn ignores the signal.
	const timer = setTimeout(() => {
		controller.abort();
		try {
			process.kill();
		} catch {}
	}, USAGE_TIMEOUT_MS);
	try {
		const [stdout, exitCode] = await Promise.all([
			new Response(process.stdout).text(),
			process.exited,
		]);
		if (exitCode !== 0) return null;
		return parseQuota(JSON.parse(stdout) as UsageResponse);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

export default function (pi: ExtensionAPI) {
	let refreshTimer: Timer | undefined;
	let refreshing = false;

	const refresh = async (ctx: ExtensionContext) => {
		if (refreshing) return;
		refreshing = true;
		try {
			const quota = await getQuota();
			if (!quota) {
				ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("muted", "OpenAI quota unavailable"));
				return;
			}
			const renderLimit = (icon: string, label: string, window: QuotaWindow | undefined) => {
				const prefix = [ctx.ui.theme.fg("accent", icon), ctx.ui.theme.fg("muted", label)].join(" ");
				if (!window) return `${prefix} ${ctx.ui.theme.fg("muted", "—")}`;
				const color = window.remaining <= 10 ? "error" : window.remaining <= 25 ? "warning" : "success";
				const reset = formatRemainingTime(window.resetsAt);
				return [
					prefix,
					ctx.ui.theme.fg(color, `${window.remaining}%`),
					reset ? ctx.ui.theme.fg("muted", `· ${reset}`) : "",
				]
					.filter(Boolean)
					.join(" ");
			};
			const separator = ctx.ui.theme.fg("muted", " │ ");
			const bankedResets = quota.bankedResets;
			const resetExpiry = formatRemainingTime(bankedResets?.expiresAt);
			const text = [
				ctx.ui.theme.fg("accent", "OpenAI"),
				renderLimit("↻", "Codex 7d", quota.codexWeekly),
				renderLimit("⚡", "Spark 5h", quota.sparkFiveHour),
				renderLimit("⚡", "Spark 7d", quota.sparkWeekly),
				[
					ctx.ui.theme.fg("accent", "◆"),
					ctx.ui.theme.fg("muted", "Banked resets"),
					bankedResets
						? ctx.ui.theme.fg(bankedResets.availableCount > 0 ? "success" : "muted", String(bankedResets.availableCount))
						: ctx.ui.theme.fg("muted", "—"),
					resetExpiry ? ctx.ui.theme.fg("muted", `· ${resetExpiry}`) : "",
				]
					.filter(Boolean)
					.join(" "),
			].join(separator);
			ctx.ui.setStatus(STATUS_KEY, text);
		} catch {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("muted", "OpenAI quota unavailable"));
		} finally {
			refreshing = false;
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		await refresh(ctx);
		refreshTimer = setInterval(() => void refresh(ctx), REFRESH_MS);
	});

	pi.on("turn_end", async (_event, ctx) => {
		await refresh(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = undefined;
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
