export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/^\/+|\/+$/g, "")
		.normalize("NFC");
}

export function requestUrl(): never {
	throw new Error("requestUrl is not available in unit tests");
}

export class MarkdownView {}
