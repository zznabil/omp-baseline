import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";

const STATUS_KEY = "caveman-ultra";
const SKILL_PATH = join(homedir(), ".agents", "skills", "caveman", "SKILL.md");
const FALLBACK_INSTRUCTIONS = "Use ultra-terse prose. Keep all technical substance, evidence, risks, and exact technical text. Remove filler and repeated facts.";

export default function (pi: ExtensionAPI) {
	let instructions = FALLBACK_INSTRUCTIONS;

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		try {
			instructions = await Bun.file(SKILL_PATH).text();
		} catch {
			instructions = FALLBACK_INSTRUCTIONS;
		}
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("muted", "Caveman: ULTRA"));
	});

	pi.on("before_agent_start", async event => {
		const base = event?.systemPrompt ? `${event.systemPrompt}\n\n` : "";
		return { systemPrompt: `${base}${instructions}\n\nCurrent intensity: ultra.` };
	});

	pi.on("session_shutdown", async (_event, ctx: ExtensionContext) => {
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
