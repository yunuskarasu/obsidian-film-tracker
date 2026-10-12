import { debounce, ItemView, Keymap, Menu, Platform, setIcon, TFile, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { KIND_LOOK } from "./diary-view";
import {
	LIBRARY_KINDS,
	LIBRARY_SORTS,
	LIBRARY_STATUSES,
	matchesSearch,
	progressLabel,
	sortItems,
	statusLabel,
	type LibraryItem,
	type LibraryKind,
	type LibrarySort,
	type LibraryStatus,
} from "./library";
import type { LibrarySize } from "./settings";

export const LIBRARY_VIEW = "film-tracker-library";

/** What the library reads from the vault, and where it keeps the size of its covers: tests and the plugin hand it in. */
export interface LibrarySource {
	items(): LibraryItem[];
	/** The address an item's poster or cover shows from, if its file is there. */
	imageUrl(item: LibraryItem): string | null;
	size(): LibrarySize;
	setSize(size: LibrarySize): void;
}

/** A tab over the shelf: everything, or one kind. */
type Shelf = LibraryKind | "all";
/** A filter under the tabs: every status, or one. */
type StatusFilter = LibraryStatus | "all";

/** What a tab — and, on the shelf of everything, a card — calls each kind. */
const KIND_NAME: Record<LibraryKind, { one: string; tab: string }> = {
	film: { one: "Film", tab: "Films" },
	tv: { one: "TV series", tab: "TV series" },
	anime: { one: "Anime", tab: "Anime" },
	manga: { one: "Manga", tab: "Manga" },
	book: { one: "Book", tab: "Books" },
	game: { one: "Game", tab: "Games" },
	album: { one: "Album", tab: "Albums" },
};

/** What a filter calls the status it shows: the same words for every kind. */
const STATUS_NAME: Record<StatusFilter, string> = {
	all: "All",
	planned: "Planned",
	progress: "In progress",
	finished: "Finished",
	dropped: "Dropped",
};

const SORT_NAME: Record<LibrarySort, string> = {
	added: "Recently added",
	title: "Title",
	year: "Release year",
	finished: "Recently finished",
};

/** Each size's icon, by the names Obsidian has known it by: the first one it has is drawn. */
const SIZES: { size: LibrarySize; icons: string[]; label: string }[] = [
	{ size: "small", icons: ["grid-3x3", "grid-3x-3", "grid"], label: "Small covers" },
	{ size: "medium", icons: ["grid-2x2", "grid-2x-2", "layout-grid"], label: "Medium covers" },
	{ size: "large", icons: ["square"], label: "Large covers" },
];

/** How long a pause in typing is before the shelf is searched again, in milliseconds. */
const SEARCH_PAUSE_MS = 150;
/** On a phone, how many covers a size fits across the screen held upright. */
const PHONE_COLUMNS: Record<LibrarySize, number> = { small: 4, medium: 3, large: 2 };
/** On a phone, between two covers side by side, in pixels: styles.css has the same. */
const PHONE_GAP_PX = 10;
/** How long a finger rests on a cover before its menu opens, in milliseconds. */
const LONG_PRESS_MS = 500;
/** How far a finger can move and still be pressing, not scrolling. */
const PRESS_SLOP_PX = 10;
/** How far the shelf scrolls before a phone's filters slide away, or come back. */
const TUCK_SCROLL_PX = 6;

/**
 * The library: every work in the vault as a cover on a shelf — all of them,
 * or one kind at a time; every status, or one; found by any of its names;
 * the newest first, or by title, year or the day it was finished. Each cover
 * says where the user is with it, and for a series or a manga begun, how
 * far. A click opens the note in this tab, a click with Ctrl or Cmd in
 * another, and a right-click shows the note's own menu. It follows the
 * vault: a note added, marked or removed shows on the shelf within a second.
 *
 * On a phone a size is a number of covers across the screen held upright —
 * on its side, more fit — and the filters slide away as the shelf scrolls
 * down, back as it scrolls up; the tabs stay. On a phone or a tablet a cover
 * held down shows the note's menu.
 */
export class LibraryView extends ItemView {
	navigation = true;
	private readonly source: LibrarySource;
	private shelf: Shelf = "all";
	private status: StatusFilter = "all";
	private sort: LibrarySort = "added";
	/** What is searched for: never kept, so the library always opens on everything. */
	private query = "";
	private items: LibraryItem[] = [];
	/** What the shelf was last drawn from, to tell whether a change in the vault changed it. */
	private drawnFrom = "";
	private tabsEl: HTMLElement | null = null;
	private statusesEl: HTMLElement | null = null;
	private shelfEl: HTMLElement | null = null;
	private toolbarEl: HTMLElement | null = null;
	/** Where the shelf was scrolled to last, to tell which way it goes. */
	private lastScroll = 0;

	constructor(leaf: WorkspaceLeaf, source: LibrarySource) {
		super(leaf);
		this.source = source;
	}

	getViewType(): string {
		return LIBRARY_VIEW;
	}

	getDisplayText(): string {
		return "Library";
	}

	getIcon(): string {
		return "library";
	}

	/** The tab, the filter and the order it was in, kept with the workspace — and in the history, for the back button. */
	getState(): Record<string, unknown> {
		return { ...super.getState(), shelf: this.shelf, status: this.status, sort: this.sort };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const kept = (state ?? {}) as { shelf?: unknown; status?: unknown; sort?: unknown };
		if (kept.shelf === "all" || LIBRARY_KINDS.includes(kept.shelf as LibraryKind)) this.shelf = kept.shelf as Shelf;
		if (kept.status === "all" || LIBRARY_STATUSES.includes(kept.status as LibraryStatus)) this.status = kept.status as StatusFilter;
		if (LIBRARY_SORTS.includes(kept.sort as LibrarySort)) this.sort = kept.sort as LibrarySort;
		await super.setState(state, result);
		if (this.drawnFrom !== "") this.render();
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("film-tracker-library");
		// Every word in it is English: capitals by English rules.
		this.contentEl.setAttr("lang", "en");
		const refresh = debounce(() => this.refresh(), 600, true);
		this.registerEvent(this.app.metadataCache.on("changed", refresh));
		this.registerEvent(this.app.vault.on("delete", refresh));
		this.registerEvent(this.app.vault.on("rename", refresh));
		if (Platform.isPhone) this.registerDomEvent(this.contentEl, "scroll", () => this.tuck(), { passive: true });
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	onResize(): void {
		this.layout();
	}

	/** On a phone: the covers as wide as their number across the screen upright, and how far the filters slide away. */
	private layout(): void {
		if (!Platform.isPhone) return;
		const padding = parseFloat(getComputedStyle(this.contentEl).paddingLeft) + parseFloat(getComputedStyle(this.contentEl).paddingRight);
		const upright = Math.min(window.screen.width, window.screen.height) - padding;
		const columns = PHONE_COLUMNS[this.source.size()];
		const width = Math.floor((upright - (columns - 1) * PHONE_GAP_PX) / columns) - 1;
		this.contentEl.setCssProps({ "--film-tracker-library-card": `${width}px` });
		// Tucked, the bar rises by the tab's own margin and everything over the tabs: the tabs end up at the top.
		const filters = this.toolbarEl?.querySelector<HTMLElement>(".film-tracker-library-row:last-child");
		if (this.toolbarEl !== null && filters) {
			const margin = parseFloat(getComputedStyle(this.contentEl).paddingTop) || 0;
			this.toolbarEl.setCssProps({ "--film-tracker-library-tuck": `${margin + filters.offsetTop + filters.offsetHeight}px` });
		}
	}

	/**
	 * On a phone: the filters out of the way while the shelf scrolls down,
	 * back as soon as it scrolls up, or is at the top. Past either end —
	 * an iPhone lets the shelf stretch there and spring back — is the end
	 * itself: springing back from the bottom isn't scrolling up.
	 */
	private tuck(): void {
		const toolbar = this.toolbarEl;
		if (toolbar === null) return;
		const end = Math.max(0, this.contentEl.scrollHeight - this.contentEl.clientHeight);
		const y = Math.min(Math.max(this.contentEl.scrollTop, 0), end);
		const moved = y - this.lastScroll;
		if (Math.abs(moved) < TUCK_SCROLL_PX && y > 0) return;
		this.lastScroll = y;
		const typing = toolbar.contains(activeDocument.activeElement);
		toolbar.toggleClass("is-tucked", y > 0 && moved > 0 && !typing);
	}

	/** Drawn again when what the shelf holds changed, scrolled where it was. */
	private refresh(): void {
		if (JSON.stringify(this.source.items()) !== this.drawnFrom) this.render();
	}

	/** The whole tab: the bars over the shelf, and the shelf. The search box keeps what is typed in it, and its focus. */
	private render(): void {
		this.items = this.source.items();
		this.drawnFrom = JSON.stringify(this.items);
		const searching = this.contentEl.querySelector(".film-tracker-library-search") === activeDocument.activeElement;
		const scrolled = this.contentEl.scrollTop;
		this.contentEl.empty();
		this.contentEl.setCssProps({ "--film-tracker-library-card": this.cardWidth() });
		// Covers this narrow get the smaller pill: the small ones, and on a phone the middle ones too.
		this.contentEl.toggleClass("is-small", this.source.size() === "small" || (Platform.isPhone && this.source.size() === "medium"));

		const toolbar = this.contentEl.createDiv({ cls: "film-tracker-library-toolbar" });
		this.toolbarEl = toolbar;
		this.lastScroll = 0;
		const top = toolbar.createDiv({ cls: "film-tracker-library-row" });
		this.tabsEl = top.createDiv({ cls: "film-tracker-library-tabs" });
		const sizes = top.createDiv({ cls: "film-tracker-library-sizes" });
		for (const { size, icons, label } of SIZES) {
			const button = sizes.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
			button.toggleClass("is-active", this.source.size() === size);
			for (const icon of icons) {
				setIcon(button, icon);
				if (button.childElementCount > 0) break;
			}
			button.addEventListener("click", () => {
				this.source.setSize(size);
				this.render();
			});
		}

		const second = toolbar.createDiv({ cls: "film-tracker-library-row" });
		this.statusesEl = second.createDiv({ cls: "film-tracker-library-statuses" });
		// The search and the order keep together, under the filters when there is no room beside them.
		const find = second.createDiv({ cls: "film-tracker-library-find" });
		const search = find.createEl("input", {
			cls: "film-tracker-library-search",
			attr: { type: "search", placeholder: "Search…", "aria-label": "Search the library", spellcheck: "false" },
		});
		search.value = this.query;
		const searchNow = debounce(
			() => {
				this.query = search.value;
				this.contentEl.scrollTop = 0;
				this.draw();
			},
			SEARCH_PAUSE_MS,
			true,
		);
		search.addEventListener("input", () => searchNow());
		search.addEventListener("keydown", (event) => {
			if (event.key !== "Escape" || search.value === "") return;
			event.preventDefault();
			search.value = "";
			searchNow();
		});
		const order = find.createEl("select", { cls: ["dropdown", "film-tracker-library-sort"], attr: { "aria-label": "Sort by" } });
		for (const sort of LIBRARY_SORTS) order.createEl("option", { text: SORT_NAME[sort], attr: { value: sort } });
		order.value = this.sort;
		order.addEventListener("change", () => {
			this.sort = order.value as LibrarySort;
			this.contentEl.scrollTop = 0;
			this.draw();
			this.app.workspace.requestSaveLayout();
		});

		this.shelfEl = this.contentEl.createDiv();
		this.draw();
		if (searching) {
			search.focus();
			search.setSelectionRange(search.value.length, search.value.length);
		}
		this.contentEl.scrollTop = scrolled;
		this.lastScroll = scrolled;
		this.layout();
	}

	/**
	 * The tabs, the filters and the shelf, for what is picked and searched
	 * for. A tab counts what it would show with the filter and the search as
	 * they are; a filter, what it would show on the tab as it is.
	 */
	private draw(): void {
		const { tabsEl, statusesEl, shelfEl } = this;
		if (tabsEl === null || statusesEl === null || shelfEl === null) return;
		const found = this.items.filter((item) => matchesSearch(item, this.query));
		const onShelf = (item: LibraryItem) => this.shelf === "all" || item.kind === this.shelf;
		const inStatus = (item: LibraryItem) => this.status === "all" || item.status === this.status;

		tabsEl.empty();
		const tabbed = found.filter(inStatus);
		this.choice(tabsEl, "film-tracker-library-tab", this.shelf === "all", "All", tabbed.length, null, () => (this.shelf = "all"));
		for (const kind of LIBRARY_KINDS) {
			const n = tabbed.filter((item) => item.kind === kind).length;
			this.choice(tabsEl, "film-tracker-library-tab", this.shelf === kind, KIND_NAME[kind].tab, n, KIND_LOOK[kind].icon, () => (this.shelf = kind));
		}

		statusesEl.empty();
		const shelved = found.filter(onShelf);
		for (const status of ["all", ...LIBRARY_STATUSES] as StatusFilter[]) {
			const n = status === "all" ? shelved.length : shelved.filter((item) => item.status === status).length;
			this.choice(statusesEl, ["film-tracker-library-status", `is-${status}`], this.status === status, STATUS_NAME[status], n, null, () => (this.status = status));
		}

		shelfEl.empty();
		const shown = sortItems(shelved.filter(inStatus), this.sort);
		if (shown.length > 0) {
			const grid = shelfEl.createDiv({ cls: "film-tracker-library-grid" });
			for (const item of shown) this.card(grid, item);
		} else {
			this.showEmpty(shelfEl);
		}
	}

	private cardWidth(): string {
		return { small: "110px", medium: "150px", large: "200px" }[this.source.size()];
	}

	/** A tab or a filter: picked, it shows its part of the shelf from the top. */
	private choice(parent: HTMLElement, cls: string | string[], picked: boolean, name: string, n: number, icon: string | null, pick: () => void): void {
		const button = parent.createEl("button", { cls });
		button.toggleClass("is-active", picked);
		button.toggleClass("is-none", n === 0);
		if (icon !== null) setIcon(button.createSpan({ cls: "film-tracker-library-tab-icon" }), icon);
		button.createSpan({ text: name });
		button.createSpan({ cls: "film-tracker-library-tab-count", text: String(n) });
		button.addEventListener("click", () => {
			if (picked) return;
			pick();
			this.contentEl.scrollTop = 0;
			this.draw();
			this.app.workspace.requestSaveLayout();
		});
	}

	/** Nothing to show: an empty vault, a kind with nothing yet, or nothing found — with a way back to everything. */
	private showEmpty(parent: HTMLElement): void {
		const empty = parent.createDiv({ cls: "film-tracker-library-empty" });
		setIcon(empty.createDiv({ cls: "film-tracker-library-empty-icon" }), this.shelf === "all" ? "library" : KIND_LOOK[this.shelf].icon);
		const searched = this.query.trim() !== "";
		if (this.items.length === 0) {
			empty.createDiv({ text: "Your library is empty. Add a film, a series, an anime, a manga, a book, a game or an album from the ribbon menu." });
			return;
		}
		if (!searched && this.status === "all" && this.shelf !== "all") {
			empty.createDiv({ text: `No ${KIND_NAME[this.shelf].tab.toLowerCase()} yet.` });
			return;
		}
		empty.createDiv({ text: searched ? `No matches for "${this.query.trim()}".` : `Nothing here is ${STATUS_NAME[this.status].toLowerCase()}.` });
		const clear = empty.createEl("button", { text: searched ? "Clear the search and the filter" : "Show every status" });
		clear.addEventListener("click", () => {
			this.query = "";
			this.status = "all";
			const search = this.contentEl.querySelector<HTMLInputElement>(".film-tracker-library-search");
			if (search !== null) search.value = "";
			this.draw();
			this.app.workspace.requestSaveLayout();
		});
	}

	private card(grid: HTMLElement, item: LibraryItem): void {
		const card = grid.createDiv({ cls: "film-tracker-library-card", attr: { tabindex: "0", role: "link", "aria-label": item.title } });
		const cover = card.createDiv({ cls: "film-tracker-library-cover" });
		const url = this.source.imageUrl(item);
		if (url === null) {
			cover.addClass("is-empty");
			setIcon(cover.createDiv({ cls: "film-tracker-library-placeholder" }), KIND_LOOK[item.kind].icon);
		} else {
			// A square album cover in the middle of the card, its own colours blurred above and under it.
			if (item.kind === "album") {
				cover.addClass("is-square");
				cover.createEl("img", { cls: "film-tracker-library-backdrop", attr: { src: url, alt: "", "aria-hidden": "true", loading: "lazy", draggable: "false" } });
			}
			cover.createEl("img", { cls: "film-tracker-library-image", attr: { src: url, alt: item.title, loading: "lazy", draggable: "false" } });
		}
		cover.createDiv({ cls: ["film-tracker-library-pill", `is-${item.status}`], text: statusLabel(item.kind, item.status) });
		if (item.progress !== null && item.progress.total !== null && item.progress.total > 0) {
			const share = Math.min(1, item.progress.done / item.progress.total);
			cover.createDiv({ cls: "film-tracker-library-progress" }).createDiv({ cls: "film-tracker-library-progress-done" }).setCssProps({ "--done": `${(share * 100).toFixed(1)}%` });
		}

		card.createDiv({ cls: "film-tracker-library-title", text: item.title });
		const meta = card.createDiv({ cls: "film-tracker-library-meta" });
		if (this.shelf === "all") {
			meta.createSpan({ cls: `film-tracker-library-swatch film-tracker-diary-kind-${item.kind}` });
		}
		const parts = [this.shelf === "all" ? KIND_NAME[item.kind].one : null, item.year === null ? null : String(item.year), item.progress === null ? null : progressLabel(item.progress)];
		meta.createSpan({ text: parts.filter((part) => part !== null).join(" · ") });

		// On a phone or a tablet, a cover held down shows the note's menu, and the tap that ends it opens nothing.
		let pressed = false;
		if (Platform.isMobile) {
			let timer = 0;
			let start: { x: number; y: number } | null = null;
			const cancel = () => window.clearTimeout(timer);
			card.addEventListener(
				"touchstart",
				(event) => {
					const touch = event.touches[0];
					if (touch === undefined || event.touches.length > 1) return cancel();
					const at = { x: touch.clientX, y: touch.clientY };
					start = at;
					pressed = false;
					cancel();
					timer = window.setTimeout(() => {
						pressed = true;
						this.noteMenu(item, (menu) => menu.showAtPosition(at));
					}, LONG_PRESS_MS);
				},
				{ passive: true },
			);
			card.addEventListener(
				"touchmove",
				(event) => {
					const touch = event.touches[0];
					if (start === null || touch === undefined) return;
					if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > PRESS_SLOP_PX) cancel();
				},
				{ passive: true },
			);
			card.addEventListener("touchend", cancel);
			card.addEventListener("touchcancel", cancel);
		}
		card.addEventListener("click", (event) => {
			if (pressed) {
				pressed = false;
				event.preventDefault();
				return;
			}
			this.openNote(item, event);
		});
		card.addEventListener("keydown", (event) => {
			if (event.key !== "Enter") return;
			event.preventDefault();
			this.openNote(item, event);
		});
		card.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			// A phone or a tablet has its own long press above; Android would send this one as well.
			if (!Platform.isMobile) this.noteMenu(item, (menu) => menu.showAtMouseEvent(event));
		});
		card.addEventListener("mouseover", (event) =>
			this.app.workspace.trigger("hover-link", { event, source: LIBRARY_VIEW, hoverParent: this, targetEl: card, linktext: item.path }),
		);
	}

	/** The note, in this tab — or, with Ctrl or Cmd held, in another, the library staying open. */
	private openNote(item: LibraryItem, event: MouseEvent | KeyboardEvent): void {
		const file = this.app.vault.getAbstractFileByPath(item.path);
		if (!(file instanceof TFile)) return;
		const where = Keymap.isModEvent(event);
		void (where === false ? this.leaf : this.app.workspace.getLeaf(where)).openFile(file);
	}

	/** The note's own menu, as the file list shows it: the plugin's items for its kind among Obsidian's. */
	private noteMenu(item: LibraryItem, show: (menu: Menu) => void): void {
		const file = this.app.vault.getAbstractFileByPath(item.path);
		if (!(file instanceof TFile)) return;
		const menu = new Menu();
		this.app.workspace.trigger("file-menu", menu, file, LIBRARY_VIEW, this.leaf);
		show(menu);
	}
}
