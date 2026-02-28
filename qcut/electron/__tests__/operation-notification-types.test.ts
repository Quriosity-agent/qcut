import { describe, expect, it } from "vitest";
import {
	NOTIFIABLE_EVENT_CATEGORIES,
	NOTIFIABLE_OPERATIONS,
	getNotifiableOperation,
} from "../types/operation-notification";

describe("operation-notification types", () => {
	it("covers every whitelisted event category", () => {
		for (const category of NOTIFIABLE_EVENT_CATEGORIES) {
			const hasCoverage = NOTIFIABLE_OPERATIONS.some(
				(entry) => entry.category === category
			);
			expect(hasCoverage).toBe(true);
		}
	});

	it("keeps category-action mappings unique", () => {
		const seen = new Set<string>();
		for (const entry of NOTIFIABLE_OPERATIONS) {
			const key = `${entry.category}::${entry.action}`;
			expect(seen.has(key)).toBe(false);
			seen.add(key);
		}
	});

	it("resolves each notifiable operation by category/action", () => {
		for (const entry of NOTIFIABLE_OPERATIONS) {
			const resolved = getNotifiableOperation({
				category: entry.category,
				action: entry.action,
			});
			expect(resolved).toEqual(entry);
		}
	});
});
