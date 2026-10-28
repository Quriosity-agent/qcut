/**
 * Keys that cannot be real. Sending one fails at the provider with an
 * answer about the provider's header format (FAL: "Expected
 * '<key_id>:<key_secret>'"), which hides that the key is the problem.
 *
 * @module electron/native-pipeline/infra/key-validity
 */

/** Placeholders tests and templates write where a key goes. */
export function placeholderKeyReason(value: string): string | undefined {
	const trimmed = value.trim();
	if (/(^|[-_])e2e$/i.test(trimmed) || /^test[-_]/i.test(trimmed)) {
		return "looks like a test placeholder (test-…/…-e2e), not a real key";
	}
	return undefined;
}

/** Why a configured key cannot work, if it cannot; by its env name. */
export function keyProblem({
	name,
	value,
}: {
	name: string;
	value: string;
}): string | undefined {
	const placeholder = placeholderKeyReason(value);
	if (placeholder) return placeholder;
	if (
		(name === "FAL_KEY" || name === "FAL_API_KEY") &&
		!/^[^\s:]+:[^\s:]+$/.test(value.trim())
	) {
		return "is not in FAL's key_id:key_secret form";
	}
	return undefined;
}
