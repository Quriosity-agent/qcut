import { waitFor } from "@testing-library/react";

export async function waitForElement(
	selector: string,
	options?: Parameters<typeof waitFor>[1]
): Promise<Element> {
	const mergedOptions: Parameters<typeof waitFor>[1] = {
		timeout: 3000,
		...(options ?? {}),
	};
	return waitFor(() => {
		const element = document.querySelector(selector);
		if (!element) throw new Error(`Element "${selector}" not found`);
		return element;
	}, mergedOptions);
}

export async function waitForElements(
	selector: string,
	count: number,
	options?: Parameters<typeof waitFor>[1]
): Promise<Element[]> {
	const mergedOptions: Parameters<typeof waitFor>[1] = {
		timeout: 3000,
		...(options ?? {}),
	};
	return waitFor(() => {
		const elements = document.querySelectorAll(selector);
		if (elements.length < count) {
			throw new Error(`Expected ${count} elements, found ${elements.length}`);
		}
		return Array.from(elements);
	}, mergedOptions);
}
