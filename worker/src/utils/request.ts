
export const MAX_REQUEST_BYTES = 8192;

export async function readJsonBody(
	request: Request
): Promise<
	| { ok: true; body: unknown }
	| { ok: false; error: string; status: number }
> {
	const lengthHeader = request.headers.get("content-length");

	if (
		lengthHeader !== null &&
		Number(lengthHeader) > MAX_REQUEST_BYTES
	) {
		return {
			ok: false,
			error: "REQUEST_TOO_LARGE",
			status: 413,
		};
	}

	const reader = request.body?.getReader();

	if (!reader) {
		return { ok: false, error: "INVALID_JSON", status: 400 };
	}

	const chunks: Uint8Array[] = [];
	let total = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();

			if (done) break;

			total += value.byteLength;

			if (total > MAX_REQUEST_BYTES) {
				await reader.cancel();
				return {
					ok: false,
					error: "REQUEST_TOO_LARGE",
					status: 413,
				};
			}

			chunks.push(value);
		}

		const bytes = new Uint8Array(total);
		let offset = 0;

		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}

		return {
			ok: true,
			body: JSON.parse(new TextDecoder().decode(bytes)),
		};
	} catch {
		return {
			ok: false,
			error: "INVALID_JSON",
			status: 400,
		};
	} finally {
		reader.releaseLock();
	}
}
