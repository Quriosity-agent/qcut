/** Retains pipe chunks until one exact protocol response can be assembled. */
export class FilterResponseBuffer {
	private chunks: Buffer[] = [];
	private firstOffset = 0;
	private byteLength = 0;
	private readonly maximumBytes: number;

	constructor({ maximumBytes }: { maximumBytes: number }) {
		if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1)
			throw new Error("Invalid Metal response buffer limit.");
		this.maximumBytes = maximumBytes;
	}

	append({ chunk }: { chunk: Buffer }) {
		if (chunk.length > this.maximumBytes - this.byteLength)
			throw new Error("Invalid Metal frame response.");
		if (chunk.length === 0) return;
		this.chunks.push(chunk);
		this.byteLength += chunk.length;
	}

	read({ size }: { size: number }): Buffer | undefined {
		if (!Number.isSafeInteger(size) || size < 1 || size > this.maximumBytes)
			throw new Error("Invalid Metal response size.");
		if (this.byteLength < size) return;
		// Each received byte is copied at most once, regardless of pipe fragmentation.
		const result = Buffer.allocUnsafe(size);
		let written = 0;
		let consumed = 0;
		while (written < size) {
			const chunk = this.chunks[consumed];
			const count = Math.min(chunk.length - this.firstOffset, size - written);
			chunk.copy(result, written, this.firstOffset, this.firstOffset + count);
			written += count;
			this.firstOffset += count;
			if (this.firstOffset === chunk.length) {
				consumed += 1;
				this.firstOffset = 0;
			}
		}
		this.chunks = this.chunks.slice(consumed);
		this.byteLength -= size;
		return result;
	}

	clear() {
		this.chunks = [];
		this.firstOffset = 0;
		this.byteLength = 0;
	}
}
