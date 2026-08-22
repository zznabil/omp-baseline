import { describe, expect, test } from "bun:test";
import { parseQuota } from "./openai-weekly-quota";

const usage = {
	reports: [
		{
			limits: [
				{ scope: { windowId: "7d" }, amount: { remaining: 70 }, window: { resetsAt: 7000 } },
				{
					scope: { windowId: "5h", tier: "spark" },
					amount: { remaining: 99 },
					window: { resetsAt: 5000 },
				},
				{
					scope: { windowId: "7d", tier: "spark" },
					amount: { remaining: 87 },
					window: { resetsAt: 8000 },
				},
			],
			resetCredits: {
				availableCount: 2,
				credits: [
					{ status: "available", expiresAt: "2026-09-21T00:00:00Z" },
					{ status: "available", expiresAt: "2026-09-20T00:00:00Z" },
					{ status: "available", expiresAt: "invalid" },
					{ status: "used", expiresAt: "2026-09-01T00:00:00Z" },
				],
			},
		},
	],
};

describe("parseQuota", () => {
	test("separates Codex, Spark, and banked reset windows", () => {
		expect(parseQuota(usage)).toEqual({
			codexWeekly: { remaining: 70, resetsAt: 7000 },
			sparkFiveHour: { remaining: 99, resetsAt: 5000 },
			sparkWeekly: { remaining: 87, resetsAt: 8000 },
			bankedResets: { availableCount: 2, expiresAt: Date.parse("2026-09-20T00:00:00Z") },
		});
	});

	test("keeps zero banked resets available to render", () => {
		expect(parseQuota({ reports: [{ resetCredits: { availableCount: 0, credits: [] } }] })).toEqual({
			bankedResets: { availableCount: 0, expiresAt: undefined },
		});
	});

	test("returns unavailable when no supported values exist", () => {
		expect(parseQuota({ reports: [{ limits: [] }] })).toBeNull();
	});
});
