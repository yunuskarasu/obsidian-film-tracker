import { debounce, ItemView, Keymap, Menu, Platform, setIcon, type WorkspaceLeaf } from "obsidian";
import { countByKind, DIARY_KINDS, monthsOf, pagesOf, yearsOf, type DiaryEntry, type DiaryKind, type DiaryMonth } from "./diary";

export const DIARY_VIEW = "film-tracker-diary";

/** What the diary reads from the vault: tests and the plugin hand it in. */
export interface DiarySource {
	entries(): DiaryEntry[];
	/** The address an entry's poster or cover shows from, if its file is there. */
	imageUrl(entry: DiaryEntry): string | null;
}

/** How each kind is named and drawn. */
const KIND_LOOK: Record<DiaryKind, { icon: string; one: string; many: string }> = {
	film: { icon: "film", one: "film", many: "films" },
	tv: { icon: "monitor", one: "season", many: "seasons" },
	anime: { icon: "tv", one: "anime", many: "anime" },
	manga: { icon: "book", one: "manga", many: "manga" },
	book: { icon: "book-open", one: "book", many: "books" },
	game: { icon: "gamepad-2", one: "game", many: "games" },
	album: { icon: "disc", one: "album", many: "albums" },
};

/** What an entry's line says it was. */
const KIND_NAME: Record<DiaryKind, string> = {
	film: "Film",
	tv: "TV series",
	anime: "Anime",
	manga: "Manga",
	book: "Book",
	game: "Game",
	album: "Album",
};

/** Entries a page holds: every page is drawn to one size, scaled with the window. */
const ENTRIES_A_PAGE = 4;
/** The covers on the book's own cover. */
const COLLAGE = 9;
/** A page's width to its height. */
const PAGE_RATIO = 0.7;
/** How long a leaf takes to turn, in milliseconds — styles.css has the same. */
const TURN_MS = 800;
/** Between the leaves turned one after another on the way to a page. */
const STAGGER_MS = 90;
/** Narrower than this, the book shows one page at a time: a phone, or a tab in a split. */
const SINGLE_PAGE_BELOW_PX = 760;
/** How far a finger has to move for a swipe to turn a page. */
const SWIPE_PX = 40;

const monthName = (month: number) => new Date(2000, month, 1).toLocaleString("en", { month: "long" });
/** "2026-03-14" as a day of the calendar, where the user is. */
const dayOf = (date: string) => new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
/** "March 14". */
const longDate = (date: string) => dayOf(date).toLocaleString("en", { month: "long", day: "numeric" });
const count = (kind: DiaryKind, n: number) => `${n} ${n === 1 ? KIND_LOOK[kind].one : KIND_LOOK[kind].many}`;

/** One page: drawn into its face of a leaf, and named for the bar under the book. */
interface Page {
	label: string;
	draw: (el: HTMLElement) => void;
	/** The book's own boards, not paper. */
	board?: boolean;
	/** A page with no number on it: the endpaper. */
	unnumbered?: boolean;
}

/**
 * The diary as a book: a cover with the year on it, the contents, the year
 * at a glance, then a spread a month — its calendar and counts on the left,
 * what was finished, day by day, on the right and the pages after — and the
 * year in numbers at the end. A leaf turns over its spine, by a click on a
 * page, the arrows under the book, or the arrow keys.
 *
 * Where there is no room for two pages — a phone, a narrow tab — the book
 * shows one at a time, each turned away to show the next, by a tap or a
 * swipe. It follows the vault: a note marked finished, or a date changed,
 * shows on its day within a second.
 */
export class DiaryView extends ItemView {
	private readonly source: DiarySource;
	private bookEl: HTMLElement | null = null;
	private labelEl: HTMLElement | null = null;
	private leaves: HTMLElement[] = [];
	private pages: Page[] = [];
	/** How many leaves are turned: 0 is the book closed, on its cover. */
	private turned = 0;
	private year = new Date().getFullYear();
	private walking = 0;
	/** One page at a time, rather than two side by side. */
	private single = false;
	/** What the book was last drawn from, to tell whether a change in the vault changed it. */
	private drawnFrom = "";
	private monthStarts = new Map<number, number>();

	constructor(leaf: WorkspaceLeaf, source: DiarySource) {
		super(leaf);
		this.source = source;
	}

	getViewType(): string {
		return DIARY_VIEW;
	}

	getDisplayText(): string {
		return "Diary";
	}

	getIcon(): string {
		return "book-open-text";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("film-tracker-diary");
		// Every word in it is English: capitals by English rules, DIARY rather than the Turkish DİARY.
		this.contentEl.setAttr("lang", "en");
		this.contentEl.tabIndex = 0;
		this.registerDomEvent(this.contentEl, "keydown", (event) => this.onKey(event));
		let touchX: number | null = null;
		this.registerDomEvent(this.contentEl, "touchstart", (event) => (touchX = event.touches[0]?.clientX ?? null), { passive: true });
		this.registerDomEvent(this.contentEl, "touchend", (event) => {
			const endX = event.changedTouches[0]?.clientX;
			if (touchX === null || endX === undefined || Math.abs(endX - touchX) < SWIPE_PX) return;
			this.turnTo(this.turned + (endX < touchX ? 1 : -1));
			touchX = null;
		});

		const refresh = debounce(() => this.refresh(), 600, true);
		this.registerEvent(this.app.metadataCache.on("changed", refresh));
		this.registerEvent(this.app.vault.on("delete", refresh));
		this.registerEvent(this.app.vault.on("rename", refresh));
		this.single = this.wantsSingle();
		this.render();
	}

	/** Drawn again when the vault's entries changed, on the page it was open at. */
	private refresh(): void {
		if (JSON.stringify(this.source.entries()) !== this.drawnFrom) this.render();
	}

	private wantsSingle(): boolean {
		return Platform.isPhone || this.contentEl.clientWidth < SINGLE_PAGE_BELOW_PX;
	}

	async onClose(): Promise<void> {
		window.clearTimeout(this.walking);
		this.contentEl.empty();
	}

	onResize(): void {
		this.layout();
	}

	private render(): void {
		window.clearTimeout(this.walking);
		const entries = this.source.entries();
		this.drawnFrom = JSON.stringify(entries);
		const years = yearsOf(entries);
		if (!years.includes(this.year) && years.length > 0) this.year = years[0];
		this.pages = this.planPages(entries.filter((entry) => entry.date.startsWith(`${this.year}-`)));

		this.contentEl.empty();
		const stage = this.contentEl.createDiv({ cls: "film-tracker-diary-stage" });
		this.bookEl = stage.createDiv({ cls: "film-tracker-diary-book" });
		this.bookEl.toggleClass("is-single", this.single);
		this.leaves = [];
		// Two pages a leaf, back to back — or, one at a time, a leaf a page.
		const step = this.single ? 1 : 2;
		for (let index = 0; index < this.pages.length; index += step) {
			const leaf = this.bookEl.createDiv({ cls: "film-tracker-diary-leaf" });
			this.face(leaf, "film-tracker-diary-front", this.pages[index], index);
			if (!this.single) this.face(leaf, "film-tracker-diary-back", this.pages[index + 1], index + 1);
			const leafIndex = this.leaves.length;
			leaf.addEventListener("click", (event) => {
				if ((event.target as HTMLElement).closest("a, button, .film-tracker-diary-entry, .film-tracker-diary-jump") !== null) return;
				// One page at a time, its left third goes back.
				const back = this.single ? event.clientX < leaf.getBoundingClientRect().left + leaf.clientWidth / 3 : leafIndex < this.turned;
				this.turnTo(this.turned + (back ? -1 : 1));
			});
			this.leaves.push(leaf);
		}

		const bar = this.contentEl.createDiv({ cls: "film-tracker-diary-bar" });
		const start = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Back to the cover" } });
		setIcon(start, "chevron-first");
		start.addEventListener("click", () => this.turnTo(0));
		const back = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Previous page" } });
		setIcon(back, "chevron-left");
		back.addEventListener("click", () => this.turnTo(this.turned - 1));
		this.labelEl = bar.createSpan({ cls: "film-tracker-diary-label" });
		const next = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Next page" } });
		setIcon(next, "chevron-right");
		next.addEventListener("click", () => this.turnTo(this.turned + 1));
		// Always there, across from the button for the cover: with one year only, that year is all it lists.
		const pick = bar.createEl("button", { cls: "film-tracker-diary-year", text: String(this.year), attr: { "aria-label": "Another year" } });
		setIcon(pick.createSpan({ cls: "film-tracker-diary-year-icon" }), "chevron-down");
		pick.addEventListener("click", (event) => this.pickYear(event, years.length > 0 ? years : [this.year], entries));

		this.turned = Math.min(this.turned, this.single ? this.leaves.length - 1 : this.leaves.length);
		this.place();
		this.layout();
	}

	/** The years with anything in them, each with how much: the one picked opens shut, on its cover. */
	private pickYear(event: MouseEvent, years: number[], entries: DiaryEntry[]): void {
		const menu = new Menu();
		for (const year of years) {
			const n = entries.filter((entry) => entry.date.startsWith(`${year}-`)).length;
			menu.addItem((item) =>
				item
					.setTitle(`${year} · ${n}`)
					.setChecked(year === this.year)
					.onClick(() => {
						this.year = year;
						this.turned = 0;
						this.render();
					}),
			);
		}
		menu.showAtMouseEvent(event);
	}

	private face(leaf: HTMLElement, cls: string, page: Page | undefined, index: number): void {
		const face = leaf.createDiv({ cls: ["film-tracker-diary-face", cls] });
		if (page === undefined) return;
		face.toggleClass("film-tracker-diary-board", page.board === true);
		const sheet = face.createDiv({ cls: "film-tracker-diary-sheet" });
		page.draw(sheet);
		if (page.board !== true && page.unnumbered !== true && index > 0) face.createDiv({ cls: "film-tracker-diary-folio", text: String(index) });
	}

	/** Every page of the year, in order: a month starts on a left-hand page, and the last page is the back cover. */
	private planPages(entries: DiaryEntry[]): Page[] {
		const months = monthsOf(entries, this.year);
		const pages: Page[] = [
			{ label: `${this.year}`, board: true, draw: (el) => this.drawCover(el, entries) },
			{ label: "Contents", draw: (el) => this.drawContents(el, months) },
			{ label: `${this.year} at a glance`, draw: (el) => this.drawGlance(el, months) },
		];
		const starts = new Map<number, number>();
		for (const month of months) {
			// A left-hand page has an odd number: the cover is page 0, on the right.
			if (pages.length % 2 === 0 && !this.single) pages.push(this.blankPage());
			starts.set(month.month, pages.length);
			const label = `${monthName(month.month)} ${this.year}`;
			pages.push({ label, draw: (el) => this.drawMonth(el, month) });
			for (const [index, part] of pagesOf(month.entries, ENTRIES_A_PAGE).entries()) {
				pages.push({ label, draw: (el) => this.drawEntries(el, month, part, index > 0) });
			}
		}
		this.monthStarts = starts;
		if (pages.length % 2 === 0 && !this.single) pages.push(this.blankPage());
		pages.push({ label: `${this.year} in numbers`, draw: (el) => this.drawNumbers(el, entries, months) });
		pages.push({ label: "", unnumbered: true, draw: (el) => this.drawEndpaper(el) });
		pages.push({ label: "", board: true, draw: (el) => this.drawBackCover(el) });
		return pages;
	}

	private blankPage(): Page {
		return { label: "", draw: (el) => el.addClass("film-tracker-diary-ruled") };
	}

	private drawCover(el: HTMLElement, entries: DiaryEntry[]): void {
		el.addClass("film-tracker-diary-cover");
		el.createDiv({ cls: "film-tracker-diary-cover-kicker", text: "Diary" });
		el.createDiv({ cls: "film-tracker-diary-cover-year", text: String(this.year) });
		const withCovers = entries.filter((entry) => this.source.imageUrl(entry) !== null).slice(0, COLLAGE);
		const collage = el.createDiv({ cls: "film-tracker-diary-collage" });
		for (const entry of withCovers) this.image(collage, entry, "film-tracker-diary-collage-cell");
		if (withCovers.length === 0) collage.addClass("is-empty");
		const totals = el.createDiv({ cls: "film-tracker-diary-cover-totals" });
		const counts = countByKind(entries);
		if (counts.size === 0) totals.setText(`Nothing finished in ${this.year} yet`);
		for (const [kind, n] of counts) {
			const item = totals.createSpan({ cls: "film-tracker-diary-total" });
			setIcon(item.createSpan(), KIND_LOOK[kind].icon);
			item.createSpan({ text: count(kind, n) });
		}
	}

	private drawContents(el: HTMLElement, months: DiaryMonth[]): void {
		el.createDiv({ cls: "film-tracker-diary-heading", text: "Contents" });
		const list = el.createDiv({ cls: "film-tracker-diary-contents" });
		const line = (name: string, detail: string, page: number) => {
			const row = list.createDiv({ cls: "film-tracker-diary-jump" });
			row.createSpan({ cls: "film-tracker-diary-contents-name", text: name });
			row.createSpan({ cls: "film-tracker-diary-contents-detail", text: detail });
			row.createSpan({ cls: "film-tracker-diary-contents-leader" });
			row.createSpan({ cls: "film-tracker-diary-contents-page", text: String(page) });
			row.addEventListener("click", () => this.showPage(page));
		};
		line("At a glance", "", 2);
		for (const month of months) {
			const page = this.monthStarts.get(month.month) ?? 2;
			line(monthName(month.month), `${month.entries.length}`, page);
		}
		line("The year in numbers", "", this.pages.length - 3);
	}

	private drawGlance(el: HTMLElement, months: DiaryMonth[]): void {
		el.createDiv({ cls: "film-tracker-diary-heading", text: `${this.year} at a glance` });
		const chart = el.createDiv({ cls: "film-tracker-diary-glance" });
		const most = Math.max(1, ...months.map((month) => month.entries.length));
		for (let month = 0; month < 12; month++) {
			const found = months.find((candidate) => candidate.month === month);
			const n = found?.entries.length ?? 0;
			const column = chart.createDiv({ cls: "film-tracker-diary-glance-column" });
			column.createDiv({ cls: "film-tracker-diary-glance-count", text: n === 0 ? "" : String(n) });
			const bar = column.createDiv({ cls: "film-tracker-diary-glance-bar" });
			for (const kind of DIARY_KINDS) {
				const part = found?.entries.filter((entry) => entry.kind === kind).length ?? 0;
				if (part > 0) bar.createDiv({ cls: `film-tracker-diary-glance-part film-tracker-diary-kind-${kind}` }).setCssProps({ "--part": `${(part / most) * 100}%` });
			}
			column.createDiv({ cls: "film-tracker-diary-glance-month", text: monthName(month).slice(0, 1) });
			if (found !== undefined) {
				column.addClass("film-tracker-diary-jump");
				column.setAttr("aria-label", `${monthName(month)}: ${n}`);
				column.addEventListener("click", () => this.showPage(this.monthStarts.get(month) ?? 2));
			}
		}
		this.legend(el, months.flatMap((month) => month.entries));
	}

	private legend(el: HTMLElement, entries: DiaryEntry[]): void {
		const legend = el.createDiv({ cls: "film-tracker-diary-legend" });
		for (const [kind, n] of countByKind(entries)) {
			const item = legend.createSpan({ cls: "film-tracker-diary-legend-item" });
			item.createSpan({ cls: `film-tracker-diary-swatch film-tracker-diary-kind-${kind}` });
			item.createSpan({ text: count(kind, n) });
		}
	}

	private drawMonth(el: HTMLElement, month: DiaryMonth): void {
		el.createDiv({ cls: "film-tracker-diary-month-year", text: String(this.year) });
		el.createDiv({ cls: "film-tracker-diary-month-name", text: monthName(month.month) });

		// Monday first, a dot on every day something was finished.
		const calendar = el.createDiv({ cls: "film-tracker-diary-calendar" });
		for (const day of ["M", "T", "W", "T", "F", "S", "S"]) calendar.createDiv({ cls: "film-tracker-diary-calendar-head", text: day });
		const pad = (n: number) => String(n).padStart(2, "0");
		const leading = (new Date(this.year, month.month, 1).getDay() + 6) % 7;
		for (let blank = 0; blank < leading; blank++) calendar.createDiv();
		const days = new Date(this.year, month.month + 1, 0).getDate();
		for (let day = 1; day <= days; day++) {
			const date = `${this.year}-${pad(month.month + 1)}-${pad(day)}`;
			const finished = month.entries.filter((entry) => entry.date === date);
			const cell = calendar.createDiv({ cls: "film-tracker-diary-calendar-day", text: String(day) });
			if (finished.length > 0) {
				cell.addClass("is-marked", `film-tracker-diary-kind-${finished[0].kind}`);
				cell.setAttr("aria-label", finished.map((entry) => entry.title).join(", "));
			}
		}

		this.legend(el, month.entries);

		const covers = month.entries.filter((entry) => this.source.imageUrl(entry) !== null).slice(0, 3);
		const stack = el.createDiv({ cls: "film-tracker-diary-polaroids" });
		for (const entry of covers) {
			const frame = stack.createDiv({ cls: "film-tracker-diary-polaroid" });
			this.image(frame, entry, "film-tracker-diary-polaroid-image");
		}
	}

	private drawEntries(el: HTMLElement, month: DiaryMonth, entries: DiaryEntry[], continued: boolean): void {
		el.createDiv({ cls: "film-tracker-diary-running-head", text: `${monthName(month.month)}${continued ? ", continued" : ""}` });
		const list = el.createDiv({ cls: "film-tracker-diary-entries" });
		let lastDate = "";
		for (const entry of entries) {
			const row = list.createDiv({ cls: "film-tracker-diary-entry" });
			const day = row.createDiv({ cls: "film-tracker-diary-entry-day" });
			if (entry.date !== lastDate) {
				const date = dayOf(entry.date);
				day.createDiv({ cls: "film-tracker-diary-entry-date", text: String(date.getDate()) });
				day.createDiv({ cls: "film-tracker-diary-entry-weekday", text: date.toLocaleString("en", { weekday: "short" }) });
			}
			lastDate = entry.date;
			const cover = row.createDiv({ cls: "film-tracker-diary-entry-cover" });
			if (!this.image(cover, entry, "film-tracker-diary-entry-image")) setIcon(cover, KIND_LOOK[entry.kind].icon);
			const body = row.createDiv({ cls: "film-tracker-diary-entry-body" });
			body.createDiv({ cls: "film-tracker-diary-entry-title", text: entry.title });
			const meta = body.createDiv({ cls: "film-tracker-diary-entry-meta" });
			meta.createSpan({ cls: `film-tracker-diary-swatch film-tracker-diary-kind-${entry.kind}` });
			meta.createSpan({ text: entry.detail === null ? KIND_NAME[entry.kind] : `${KIND_NAME[entry.kind]} · ${entry.detail}` });
			// A new tab, unless a modifier asks for a split or a window: the diary stays open beside the note.
			row.addEventListener("click", (event) => {
				const where = Keymap.isModEvent(event);
				void this.app.workspace.openLinkText(entry.path, "", where === false ? "tab" : where);
			});
			row.addEventListener("mouseover", (event) =>
				this.app.workspace.trigger("hover-link", { event, source: DIARY_VIEW, hoverParent: this, targetEl: row, linktext: entry.path }),
			);
		}
	}

	private drawNumbers(el: HTMLElement, entries: DiaryEntry[], months: DiaryMonth[]): void {
		el.createDiv({ cls: "film-tracker-diary-heading", text: `${this.year} in numbers` });
		const grid = el.createDiv({ cls: "film-tracker-diary-numbers" });
		for (const [kind, n] of countByKind(entries)) {
			const cell = grid.createDiv({ cls: "film-tracker-diary-number" });
			setIcon(cell.createDiv({ cls: `film-tracker-diary-number-icon film-tracker-diary-kind-${kind}` }), KIND_LOOK[kind].icon);
			cell.createDiv({ cls: "film-tracker-diary-number-value", text: String(n) });
			cell.createDiv({ cls: "film-tracker-diary-number-label", text: n === 1 ? KIND_LOOK[kind].one : KIND_LOOK[kind].many });
		}
		const facts = el.createDiv({ cls: "film-tracker-diary-facts" });
		const busiest = [...months].sort((a, b) => b.entries.length - a.entries.length)[0];
		if (busiest !== undefined) facts.createDiv({ text: `The busiest month was ${monthName(busiest.month)}, with ${busiest.entries.length}.` });
		const first = months[0]?.entries[0];
		const last = months[months.length - 1]?.entries.slice(-1)[0];
		if (first !== undefined) facts.createDiv({ text: `It began with ${first.title}, on ${longDate(first.date)}.` });
		if (last !== undefined && last !== first) facts.createDiv({ text: `The latest is ${last.title}, on ${longDate(last.date)}.` });
	}

	private drawEndpaper(el: HTMLElement): void {
		el.addClass("film-tracker-diary-endpaper");
	}

	private drawBackCover(el: HTMLElement): void {
		el.addClass("film-tracker-diary-cover", "film-tracker-diary-back-cover");
		setIcon(el.createDiv({ cls: "film-tracker-diary-emblem" }), "book-open-text");
	}

	/** An entry's poster or cover in `parent`; `false` when it has none to show. */
	private image(parent: HTMLElement, entry: DiaryEntry, cls: string): boolean {
		const url = this.source.imageUrl(entry);
		if (url === null) return false;
		parent.createEl("img", { cls, attr: { src: url, alt: entry.title, loading: "lazy", draggable: "false" } });
		return true;
	}

	/** Turns the leaves until `page` shows: the right-hand pages are the fronts of leaves, the left-hand ones their backs. */
	private showPage(page: number): void {
		this.turnTo(this.single ? page : page % 2 === 0 ? page / 2 : (page + 1) / 2);
	}

	/** Turns leaf after leaf, forward or back, until `target` of them are turned. */
	private turnTo(target: number): void {
		// One page at a time, the last page stays: it has nothing under it to show.
		const goal = Math.max(0, Math.min(this.single ? this.leaves.length - 1 : this.leaves.length, target));
		window.clearTimeout(this.walking);
		const step = () => {
			if (this.turned === goal) return;
			const forward = goal > this.turned;
			const leaf = this.leaves[forward ? this.turned : this.turned - 1];
			this.turned += forward ? 1 : -1;
			// Above both piles while it turns, then in its place on the other.
			leaf.setCssProps({ "--film-tracker-diary-z": String(this.leaves.length + 1) });
			leaf.addClass("is-top");
			leaf.toggleClass("is-turned", forward);
			this.updateBar();
			this.placeBook();
			window.setTimeout(() => this.place(), TURN_MS);
			if (this.turned !== goal) this.walking = window.setTimeout(step, STAGGER_MS);
		};
		step();
	}

	/** Each leaf in its pile: the turned ones on the left, the last turned on top; the rest on the right, the next one on top. */
	private place(): void {
		this.leaves.forEach((leaf, index) => {
			const turned = index < this.turned;
			leaf.toggleClass("is-turned", turned);
			leaf.toggleClass("is-top", index === this.turned - 1 || index === this.turned);
			leaf.setCssProps({ "--film-tracker-diary-z": String(turned ? index + 1 : this.leaves.length - index) });
		});
		this.placeBook();
		this.updateBar();
	}

	/** Shut, the book sits on the middle of the page — its cover, or its back cover. */
	private placeBook(): void {
		const shift = this.single ? "0%" : this.turned === 0 ? "-25%" : this.turned === this.leaves.length ? "25%" : "0%";
		this.bookEl?.setCssProps({ "--film-tracker-diary-shift": shift });
	}

	private updateBar(): void {
		if (this.single) {
			this.labelEl?.setText(this.pages[this.turned]?.label ?? "");
			return;
		}
		const left = this.pages[this.turned * 2 - 1];
		const right = this.pages[this.turned * 2];
		this.labelEl?.setText(right?.label || left?.label || "");
	}

	/** The book as large as the tab allows, every page in proportion. */
	private layout(): void {
		if (this.bookEl === null) return;
		const single = this.wantsSingle();
		if (single !== this.single) {
			// The same place in the book: a spread's left-hand page, or the spread a page is on.
			const page = this.single ? this.turned : this.turned === 0 ? 0 : Math.min(this.turned * 2 - 1, this.pages.length - 1);
			this.single = single;
			this.turned = single ? page : page % 2 === 0 ? page / 2 : (page + 1) / 2;
			this.render();
			return;
		}
		const width = this.contentEl.clientWidth * 0.94;
		const height = (this.contentEl.clientHeight - 56) * 0.94;
		const pageHeight = Math.max(240, Math.min(height, width / (single ? 1 : 2) / PAGE_RATIO));
		this.bookEl.setCssProps({
			"--film-tracker-diary-page-h": `${Math.round(pageHeight)}px`,
			"--film-tracker-diary-page-w": `${Math.round(pageHeight * PAGE_RATIO)}px`,
			"--film-tracker-diary-unit": `${(pageHeight / 44).toFixed(2)}px`,
		});
	}

	private onKey(event: KeyboardEvent): void {
		if (event.key === "ArrowRight" || event.key === "PageDown") this.turnTo(this.turned + 1);
		else if (event.key === "ArrowLeft" || event.key === "PageUp") this.turnTo(this.turned - 1);
		else if (event.key === "Home") this.turnTo(0);
		else if (event.key === "End") this.turnTo(this.leaves.length);
		else return;
		event.preventDefault();
	}
}
