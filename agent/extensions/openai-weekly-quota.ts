import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const STATUS_KEY = "openai-weekly-quota";
const REFRESH_MS = 5 * 60_000;

type UsageLimit = {
	scope?: { windowId?: string; tier?: string };
	amount?: { remaining?: number };
	window?: { resetsAt?: number };
};

type UsageReport = {
	limits?: UsageLimit[];
};

type UsageResponse = {
	reports?: UsageReport[];
};

type QuotaWindow = {
	remaining: number;
	resetsAt?: number;
};

type QuotaSnapshot = {
	fiveHour?: QuotaWindow;
	sevenDay?: QuotaWindow;
	spark?: QuotaWindow;
};

function formatRemainingTime(resetsAt: number | undefined): string {
	if (!resetsAt) return "";
	const totalHours = Math.max(0, Math.ceil((resetsAt - Date.now()) / 3_600_000));
	const days = Math.floor(totalHours / 24);
	const hours = totalHours % 24;
	return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}


async function getQuota(): Promise<QuotaSnapshot | null> {
	const process = Bun.spawn(["omp", "usage", "--provider", "openai-codex", "--json"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, exitCode] = await Promise.all([new Response(process.stdout).text(), process.exited]);
	if (exitCode !== 0) return null;

	const limits = (JSON.parse(stdout) as UsageResponse).reports?.flatMap(report => report.limits ?? []) ?? [];
	const fiveHourLimit = limits.find(limit => limit.scope?.windowId === "5h" && !limit.scope?.tier);
	const sevenDayLimit = limits.find(limit => limit.scope?.windowId === "7d" && !limit.scope?.tier);
	const sparkLimit = limits.find(limit => limit.scope?.windowId === "7d" && limit.scope?.tier === "spark");
	const fiveHourRemaining = fiveHourLimit?.amount?.remaining;
	const sevenDayRemaining = sevenDayLimit?.amount?.remaining;
	const sparkRemaining = sparkLimit?.amount?.remaining;
	const fiveHour =
		typeof fiveHourRemaining === "number"
			? { remaining: Math.round(fiveHourRemaining), resetsAt: fiveHourLimit?.window?.resetsAt }
			: undefined;
	const sevenDay =
		typeof sevenDayRemaining === "number"
			? { remaining: Math.round(sevenDayRemaining), resetsAt: sevenDayLimit?.window?.resetsAt }
			: undefined;
	const spark =
		typeof sparkRemaining === "number"
			? { remaining: Math.round(sparkRemaining), resetsAt: sparkLimit?.window?.resetsAt }
			: undefined;
	const quota = { fiveHour, sevenDay, spark };
	return quota.fiveHour || quota.sevenDay || quota.spark ? quota : null;
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
			const text = [
				ctx.ui.theme.fg("accent", "OpenAI"),
				renderLimit("◷", "5h", quota.fiveHour),
				renderLimit("↻", "7d", quota.sevenDay),
				renderLimit("⚡", "Spark", quota.spark),
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
