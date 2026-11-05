const CSS_ESCAPE = String.raw`\\(?:[\da-f]{1,6}(?:\r\n|[ \n\r\t\f])?|[^\n\r\f\da-f])`;
const CSS_IDENTIFIER = new RegExp(
	String.raw`(?:[-_a-z\u0080-\uFFFF]|${CSS_ESCAPE})(?:[-_a-z\d\u0080-\uFFFF]|${CSS_ESCAPE})*`,
	"iy"
);
const CSS_NUMBER = /[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?/iy;

function readToken({
	pattern,
	value,
	index,
}: {
	pattern: RegExp;
	value: string;
	index: number;
}): string {
	pattern.lastIndex = index;
	return pattern.exec(value)?.[0] ?? "";
}

function decodeIdentifier({ value }: { value: string }): string {
	return value
		.replace(
			/\\(?:([\da-f]{1,6})(?:\r\n|[ \n\r\t\f])?|([^\n\r\f]))/gi,
			(_match, hex: string | undefined, escaped: string | undefined) => {
				if (!hex) return escaped ?? "";
				const codePoint = Number.parseInt(hex, 16);
				return codePoint > 0 && codePoint <= 0x10ffff
					? String.fromCodePoint(codePoint)
					: "\uFFFD";
			}
		)
		.toLowerCase();
}

function quotedTextEnd({
	value,
	start,
}: {
	value: string;
	start: number;
}): number {
	const quote = value[start];
	let index = start + 1;
	while (index < value.length) {
		if (value[index] === "\\") {
			index += 2;
			continue;
		}
		if (value[index++] === quote) return index;
	}
	return value.length;
}

function urlEnd({ value, start }: { value: string; start: number }): number {
	let index = start + 1;
	while (index < value.length) {
		const character = value[index];
		if (character === "\\") {
			index += 2;
			continue;
		}
		if (character === '"' || character === "'") {
			index = quotedTextEnd({ value, start: index });
			continue;
		}
		if (character === ")") return index + 1;
		index += 1;
	}
	return value.length;
}

export function scaleFilterLengths({
	filter,
	factor,
}: {
	filter: string;
	factor: number;
}): string {
	const parts: string[] = [];
	let index = 0;
	while (index < filter.length) {
		const start = index;
		const character = filter[index];
		if (character === '"' || character === "'") {
			index = quotedTextEnd({ value: filter, start });
		} else if (filter.startsWith("/*", index)) {
			const end = filter.indexOf("*/", index + 2);
			index = end < 0 ? filter.length : end + 2;
		} else {
			const number = readToken({ pattern: CSS_NUMBER, value: filter, index });
			if (number) {
				index += number.length;
				const unit = readToken({
					pattern: CSS_IDENTIFIER,
					value: filter,
					index,
				});
				index += unit.length;
				const scaledLength = Number(number) * factor;
				if (
					decodeIdentifier({ value: unit }) === "px" &&
					Number.isFinite(scaledLength)
				) {
					parts.push(`${scaledLength}px`);
					continue;
				}
			} else {
				const identifier = readToken({
					pattern: CSS_IDENTIFIER,
					value: filter,
					index,
				});
				index += identifier.length || 1;
				if (
					decodeIdentifier({ value: identifier }) === "url" &&
					filter[index] === "("
				) {
					index = urlEnd({ value: filter, start: index });
				}
			}
		}
		parts.push(filter.slice(start, index));
	}
	return parts.join("");
}
