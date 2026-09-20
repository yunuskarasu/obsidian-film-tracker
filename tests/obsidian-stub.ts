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

/** A link's file part, without its #heading or #^block. */
export function getLinkpath(linktext: string): string {
	const hash = linktext.indexOf("#");
	return hash === -1 ? linktext : linktext.slice(0, hash);
}

export class MarkdownView {}

/** Every Notice shown, in order — cleared by each test that checks them. */
export class Notice {
	static readonly shown: string[] = [];

	constructor(message: string) {
		Notice.shown.push(message);
	}
}

export class TAbstractFile {
	readonly path: string;
	readonly name: string;

	constructor(path: string) {
		this.path = path;
		this.name = path.slice(path.lastIndexOf("/") + 1);
	}
}

export class TFile extends TAbstractFile {
	readonly basename: string;
	readonly extension: string;

	constructor(path: string) {
		super(path);
		const dot = this.name.lastIndexOf(".");
		this.basename = dot === -1 ? this.name : this.name.slice(0, dot);
		this.extension = dot === -1 ? "" : this.name.slice(dot + 1);
	}
}

export class TFolder extends TAbstractFile {}

/** Only for modules that declare a settings tab; the tests never open one. Keeps `app`, which the tab reads. */
export class PluginSettingTab {
	readonly app: unknown;

	constructor(app: unknown) {
		this.app = app;
	}
}
export class Setting {}
export class SecretComponent {}

/** Subclassed by the folder suggester in settings.ts, never instantiated here. */
export class AbstractInputSuggest {
	constructor(
		readonly app: unknown,
		readonly inputEl: unknown,
	) {}

	setValue(_value: string): void {}

	close(): void {}
}

/** The tests run as the newest Obsidian; secrets.ts takes its keychain as an argument. */
export function requireApiVersion(): boolean {
	return true;
}
