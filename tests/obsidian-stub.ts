import { parse } from "yaml";

/**
 * Obsidian parses a note's properties itself; in tests the `yaml` package stands
 * in for it. Both reject the same malformed YAML, which is what the code
 * under test cares about.
 */
export function parseYaml(text: string): unknown {
	return parse(text) as unknown;
}

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

/*
 * Enough of the rest of Obsidian for main.ts to load in a test, so that what
 * it registers can be written down (see registrations.test.ts). None of it
 * draws anything.
 */

/** A menu that keeps what it was given: each item's title and icon, and its separators. */
export class Menu {
	static readonly made: Menu[] = [];
	readonly items: { title: string; icon: string | null; checked?: boolean; section?: string; disabled?: boolean }[] = [];
	/** What clicking each item would run, in the same order; a separator has none. */
	readonly clicks: ((() => unknown) | null)[] = [];
	shown = false;

	constructor() {
		Menu.made.push(this);
	}

	addItem(build: (item: MenuItem) => unknown): this {
		const item = new MenuItem();
		build(item);
		this.items.push(item.recorded());
		this.clicks.push(item.click);
		return this;
	}

	addSeparator(): this {
		this.items.push({ title: "---", icon: null });
		this.clicks.push(null);
		return this;
	}

	showAtMouseEvent(): this {
		this.shown = true;
		return this;
	}

	showAtPosition(): this {
		this.shown = true;
		return this;
	}
}

export class MenuItem {
	private title = "";
	private icon: string | null = null;
	private checked: boolean | undefined;
	private section: string | undefined;
	private disabled = false;
	click: (() => unknown) | null = null;

	setTitle(title: string): this {
		this.title = title;
		return this;
	}

	setIcon(icon: string | null): this {
		this.icon = icon;
		return this;
	}

	setChecked(checked: boolean | null): this {
		this.checked = checked ?? undefined;
		return this;
	}

	setSection(section: string): this {
		this.section = section;
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		return this;
	}

	setWarning(): this {
		return this;
	}

	onClick(click: () => unknown): this {
		this.click = click;
		return this;
	}

	recorded(): { title: string; icon: string | null; checked?: boolean; section?: string; disabled?: boolean } {
		return {
			title: this.title,
			icon: this.icon,
			...(this.checked === undefined ? {} : { checked: this.checked }),
			...(this.section === undefined ? {} : { section: this.section }),
			...(this.disabled ? { disabled: true } : {}),
		};
	}
}

export class Component {
	register(_cb: () => unknown): void {}
	registerEvent(_ref: unknown): void {}
	registerDomEvent(): void {}
	registerInterval(id: number): number {
		return id;
	}
	addChild<T>(child: T): T {
		return child;
	}
	load(): void {}
	unload(): void {}
}

/** The plugin's base: everything it hands over is kept, to be written down rather than run. */
export class Plugin extends Component {
	readonly app: unknown;
	readonly manifest: unknown;
	readonly commands: Record<string, unknown>[] = [];
	readonly ribbons: { icon: string; title: string; open: (event: unknown) => unknown }[] = [];
	readonly views: string[] = [];
	readonly settingTabs: unknown[] = [];
	readonly domEvents: string[] = [];

	constructor(app: unknown, manifest: unknown) {
		super();
		this.app = app;
		this.manifest = manifest;
	}

	addCommand(command: Record<string, unknown>): Record<string, unknown> {
		this.commands.push(command);
		return command;
	}

	addRibbonIcon(icon: string, title: string, open: (event: unknown) => unknown): unknown {
		this.ribbons.push({ icon, title, open });
		return {};
	}

	registerView(type: string): void {
		this.views.push(type);
	}

	addSettingTab(tab: unknown): void {
		this.settingTabs.push(tab);
	}

	registerDomEvent(_el?: unknown, type?: string): void {
		this.domEvents.push(type ?? "");
	}

	async loadData(): Promise<unknown> {
		return null;
	}

	async saveData(): Promise<void> {}
}

export class ItemView extends Component {}
/** A dialog that never shows: opening one only writes down which it was. */
export class Modal {
	static readonly opened: string[] = [];

	constructor(readonly app: unknown) {}

	open(): void {
		Modal.opened.push(this.constructor.name);
	}

	close(): void {}
}
export class SuggestModal<T> extends Modal {
	declare readonly item?: T;
	readonly inputEl = { value: "" };
	emptyStateText = "";
	limit = 0;
	setPlaceholder(_text: string): void {}
	setInstructions(_instructions: unknown[]): void {}
}
export class FuzzySuggestModal<T> extends SuggestModal<T> {}

export const Platform = { isMobile: false, isPhone: false, isDesktop: true, isDesktopApp: true };
export const Keymap = { isModEvent: () => false };
export function setIcon(): void {}

/** A debounced function that never fires on its own: the tests call nothing that waits for one. */
export function debounce<T extends unknown[]>(run: (...args: T) => unknown): ((...args: T) => void) & { cancel(): void; run(): void } {
	const debounced = (() => {}) as ((...args: T) => void) & { cancel(): void; run(): void };
	debounced.cancel = () => {};
	debounced.run = () => void run;
	return debounced;
}

export const moment = Object.assign(() => ({ format: () => "2026-10-12" }), { locale: () => "en" });
