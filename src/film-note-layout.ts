import { MarkdownView, setIcon, type App, type TFile } from "obsidian";
import { animeProgressOf } from "./anime-note";
import { findConnections, type Connection, type WorkNoteInfo } from "./connections";
import {
	filmographyProgress,
	findFilmography,
	type FilmographyEntry,
	type FilmographyWork,
} from "./filmography";
import {
	findMangagraphy,
	mangagraphyProgress,
	type MangagraphyEntry,
	type MangagraphyManga,
} from "./mangagraphy";
import { formatMediaType, formatStatus } from "./mal";
import { parseLinkTarget, parseWikilink } from "./note";
import { classifyNote } from "./note-kind";
import type { FilmTrackerSettings } from "./settings";
import { tvProgressOf, type TvSeasonEntry } from "./tv-note";

const POSTER_CLASS = "film-tracker-poster";
const LAYOUT_CLASS = "film-tracker-layout";
const POSTER_PATH_ATTR = "data-film-tracker-poster";
const CONNECTIONS_CLASS = "film-tracker-connections";
const MAX_CONNECTIONS = 20;
/**
 * Marks the same host element `LAYOUT_CLASS` lives on, scoping the CSS rule
 * that hides the native `manga` property row (Obsidian has no widget for a
 * nested object property, so it renders as raw JSON) to Series notes only —
 * a note elsewhere in the vault with its own unrelated `manga` property is
 * never touched, since this class is never added to its host.
 */
const MANGA_HOST_CLASS = "film-tracker-has-manga";
const PROGRESS_CLASS = "film-tracker-progress";
/**
 * The same idea as `MANGA_HOST_CLASS` for a TV note's `seasons` block: a list
 * of objects has no widget of its own either, and the SEASONS panel below is
 * the readable view of it.
 */
const SEASONS_HOST_CLASS = "film-tracker-has-seasons";

interface Poster {
	file: TFile;
	alt: string;
}

/** A film or TV series note as the Connections, Filmography and TV series panels read it. */
type ScannedWork = WorkNoteInfo & FilmographyWork & { kind: "film" | "tv" };

/**
 * The panels a note can have, in the order they are drawn. A TV note can have
 * three of them — its seasons, its manga, then what it shares with the rest
 * of the vault — and a person note two, their films and their series, so each
 * keeps a box of its own. `main` is the single box every other note has.
 */
const PANEL_SLOTS = ["seasons", "manga", "main", "shows"] as const;
type PanelSlot = (typeof PANEL_SLOTS)[number];

function panelClass(slot: PanelSlot): string {
	return `film-tracker-panel-${slot}`;
}

/**
 * The vault's films and manga, read once per `refresh` and shared by every
 * open note: Connections, Filmography and Mangagraphy each need the whole
 * list, and one refresh can redraw several notes.
 */
class VaultScan {
	private readonly read: {
		work: (file: TFile) => ScannedWork | null;
		manga: (file: TFile) => MangagraphyManga | null;
	};
	private readonly files: () => TFile[];
	private workList: ScannedWork[] | null = null;
	private mangaList: MangagraphyManga[] | null = null;

	constructor(
		files: () => TFile[],
		read: { work: (file: TFile) => ScannedWork | null; manga: (file: TFile) => MangagraphyManga | null },
	) {
		this.files = files;
		this.read = read;
	}

	/** Films and TV series together: Connections compares them against each other. */
	works(): ScannedWork[] {
		if (this.workList === null) {
			this.workList = this.files()
				.map(this.read.work)
				.filter((work): work is ScannedWork => work !== null);
		}
		return this.workList;
	}

	worksOfKind(kind: "film" | "tv"): ScannedWork[] {
		return this.works().filter((work) => work.kind === kind);
	}

	mangas(): MangagraphyManga[] {
		if (this.mangaList === null) {
			this.mangaList = this.files()
				.map(this.read.manga)
				.filter((manga): manga is MangagraphyManga => manga !== null);
		}
		return this.mangaList;
	}
}

/**
 * What the panels' and the poster's own controls do. A panel only renders
 * them and reports the click — every note is rewritten by `main.ts`, which
 * owns API access and every write to the vault. That includes the Read
 * checkbox: the same manga can sit on several Series notes, and `setRead`
 * updates them all.
 */
export interface MangaPanelActions {
	change: (file: TFile) => void;
	remove: (file: TFile) => void;
	addAdaptation: (file: TFile) => void;
	setRead: (file: TFile, read: boolean) => void;
	/** "+1 chapter" beside the Read checkbox — the same command the palette offers. */
	readChapter: (file: TFile) => void;
	/** The buttons under an anime, film or TV note's poster. */
	watchEpisode: (file: TFile) => void;
	watchedToday: (file: TFile) => void;
	/** "+1" on one season of a TV note, on the SEASONS panel. */
	watchSeason: (file: TFile, season: number) => void;
	/** That panel's own checkbox: a season watched in full, or back to nothing. */
	setSeasonWatched: (file: TFile, season: number, watched: boolean) => void;
}

/**
 * What to draw under a note's poster: how far through the episodes it is, and
 * which of the two buttons are worth offering. `null` for a note this doesn't
 * apply to — a director, a mangaka, a manga-only Series note.
 */
export interface WatchControls {
	label: string | null;
	percent: string | null;
	canWatchEpisode: boolean;
	canMarkWatched: boolean;
}

export function watchControlsFor(frontmatter: Record<string, unknown> | undefined): WatchControls | null {
	const kind = classifyNote(frontmatter);
	if (kind === null) return null;

	const watched = frontmatter?.watched === true;
	if (kind.kind === "film") {
		return { label: null, percent: null, canWatchEpisode: false, canMarkWatched: !watched };
	}
	if (kind.kind === "tv") {
		const progress = tvProgressOf(frontmatter);
		const count = progressLabel(progress.watched, progress.episodes, "episode");
		return {
			label: count === null ? null : [seasonAndEpisode(progress.position), count].filter((part) => part !== null).join(" · "),
			percent: progressPercent(progress.watched, progress.episodes),
			canWatchEpisode: progress.more,
			canMarkWatched: !watched,
		};
	}
	if (kind.kind !== "series" || kind.animeMalId === null) return null;

	const progress = animeProgressOf(frontmatter);
	const complete = progress.episodes !== null && progress.watched >= progress.episodes;
	return {
		label: progressLabel(progress.watched, progress.episodes, "episode"),
		percent: progressPercent(progress.watched, progress.episodes),
		canWatchEpisode: !complete,
		canMarkWatched: !watched,
	};
}

/**
 * The poster a note's own properties point at, or `null` for a note this
 * plugin doesn't own. Which notes those are is `classifyNote`'s answer and
 * nothing else: reading the id keys here meant a TV note — which carries
 * neither `tmdb_id` nor `mal_id` — never showed its poster at all.
 */
export function posterLinkpathOf(frontmatter: Record<string, unknown> | undefined): string | null {
	if (classifyNote(frontmatter) === null) return null;
	return parseLinkTarget(frontmatter?.poster);
}

/** Where a TV note stands, in the form a viewer counts in: "S3E6". */
export function seasonAndEpisode(position: { season: number; episode: number } | null): string | null {
	return position === null ? null : `S${position.season}E${position.episode}`;
}

/** A season's own line in the SEASONS panel: "Season 4 · Night Country · 2024 · 6 episodes". */
export function seasonSummary(season: TvSeasonEntry): string {
	const count = `${season.episodes} ${season.episodes === 1 ? "episode" : "episodes"}`;
	return [`Season ${season.season}`, season.name, season.year === null ? null : String(season.year), count]
		.filter((part): part is string => part !== null)
		.join(" · ");
}

interface MangaPanelInfo {
	title: string;
	mediaType: string | null;
	year: number | null;
	endYear: number | null;
	status: string | null;
	chapters: number | null;
	chaptersRead: number | null;
	volumes: number | null;
	mangakaRaw: string[];
	posterLinkpath: string | null;
	read: boolean;
	readDate: string | null;
}

/**
 * The years a work ran: "1990–1994", or just the one year when it is still
 * running, finished inside that year, or MAL only knows the one.
 */
function years(year: number | null, endYear: number | null): string | null {
	if (year === null) return endYear === null ? null : String(endYear);
	return endYear === null || endYear === year ? String(year) : `${year}–${endYear}`;
}

/**
 * The line under the MANGA panel's title: "Manga · 1998 · Currently
 * publishing · 37 volumes · 390 chapters". Whatever MAL left blank is left
 * out. The panel is the only place these show, since the nested `manga`
 * property is hidden (see `MANGA_HOST_CLASS`).
 */
export function mangaSummary(
	info: Pick<MangaPanelInfo, "mediaType" | "year" | "endYear" | "status" | "volumes" | "chapters">,
): string {
	const count = (n: number, noun: string) => `${n} ${n === 1 ? noun : `${noun}s`}`;
	return [
		formatMediaType(info.mediaType),
		years(info.year, info.endYear),
		formatStatus(info.status),
		info.volumes === null ? null : count(info.volumes, "volume"),
		info.chapters === null ? null : count(info.chapters, "chapter"),
	]
		.filter((part): part is string => part !== null)
		.join(" · ");
}

/**
 * How far through something the note is: "48 / 148 episodes", or "48
 * episodes" while MAL doesn't know the length. `null` when nothing has been
 * watched or read yet — an untouched note shows no bar at all.
 */
export function progressLabel(done: number, total: number | null, noun: string): string | null {
	if (done <= 0) return null;
	if (total === null) return `${done} ${done === 1 ? noun : `${noun}s`}`;
	return `${done} / ${total} ${noun}s`;
}

/** The share of the bar to fill, as a percentage, or `null` when the length is unknown. */
function progressPercent(done: number, total: number | null): string | null {
	if (total === null || total <= 0) return null;
	return `${Math.round((Math.min(done, total) / total) * 100)}%`;
}

/**
 * The count, with a filled bar under it where the length is known. The fill
 * is a CSS variable rather than an inline width, so the styling stays in
 * styles.css where a theme can reach it.
 */
function renderProgressBar(container: HTMLElement, label: string, percent: string | null): void {
	container.createDiv({ cls: "film-tracker-progress-label", text: label });
	if (percent === null) return;
	const track = container.createDiv({ cls: "film-tracker-progress-track" });
	track.createDiv({ cls: "film-tracker-progress-fill" }).setCssProps({ "--film-tracker-progress": percent });
}

function extractNames(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string")
		.map((item) => (parseWikilink(item) ?? item).trim())
		.filter((name) => name !== "");
}

/**
 * Renders the poster next to the note's properties.
 *
 * The poster is added as a *sibling* of Obsidian's properties widget rather
 * than inside the note body, which is what makes a two-column grid possible:
 * in live preview the entire body lives in a single node, so nothing inside it
 * can be placed beside the properties. Obsidian's own widget is never moved,
 * wrapped or rebuilt — only a sibling and a class are added — so properties
 * stay fully editable.
 */
export class FilmNoteLayout {
	private readonly app: App;
	private readonly settings: () => FilmTrackerSettings;
	private readonly mangaActions: MangaPanelActions;
	/** Set once the plugin unloads: a refresh still scheduled after that must not draw anything back. */
	private disposed = false;

	constructor(app: App, settings: () => FilmTrackerSettings, mangaActions: MangaPanelActions) {
		this.app = app;
		this.settings = settings;
		this.mangaActions = mangaActions;
	}

	refresh(): void {
		if (this.disposed) return;
		const scan = new VaultScan(() => this.app.vault.getMarkdownFiles(), {
			work: (file) => this.resolveWorkInfo(file),
			manga: (file) => this.mangagraphyMangaInfo(file),
		});
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView) this.applyTo(view, scan);
		}
	}

	/**
	 * Takes every poster and panel back out, in pop-out windows too — each
	 * window has its own document, so the open notes' own containers are
	 * searched as well as the main one.
	 */
	removeAll(): void {
		this.disposed = true;
		const roots: ParentNode[] = [document];
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) roots.push(leaf.view.containerEl);

		for (const root of roots) {
			root.querySelectorAll(`.${POSTER_CLASS}, .${CONNECTIONS_CLASS}`).forEach((el) => el.detach());
			root.querySelectorAll(`.${LAYOUT_CLASS}`).forEach((el) => el.removeClass(LAYOUT_CLASS));
			root.querySelectorAll(`.${MANGA_HOST_CLASS}`).forEach((el) => el.removeClass(MANGA_HOST_CLASS));
			root.querySelectorAll(`.${SEASONS_HOST_CLASS}`).forEach((el) => el.removeClass(SEASONS_HOST_CLASS));
		}
	}

	private applyTo(view: MarkdownView, scan: VaultScan): void {
		const host = this.findHost(view);
		if (host !== null) {
			const poster = this.resolvePoster(view);
			if (poster === null) {
				this.clear(host);
			} else {
				this.showPoster(host, poster);
				this.showWatchProgress(host, view.file);
			}
		}

		this.applyRelatedPanel(view, host, scan);
		view.contentEl.dataset.filmTrackerDrawn = String(this.drawnIn(view));
	}

	/** How many of this plugin's own elements the view holds right now. */
	private drawnIn(view: MarkdownView): number {
		return view.contentEl.querySelectorAll(`.${POSTER_CLASS}, .${CONNECTIONS_CLASS}`).length;
	}

	/**
	 * Draws again if something drawn before has since been taken out of the
	 * page. Reading view builds and discards the note as it is scrolled, and
	 * the poster and the panels are inserted beside its header rather than
	 * being part of it — scrolling to the bottom of a long note dropped them,
	 * and scrolling back only brought Obsidian's own part of it back.
	 *
	 * The check is a count of elements, so it costs nothing on the scroll
	 * events that find everything in place; only a real loss reads the vault.
	 */
	redrawIfMissing(): void {
		if (this.disposed) return;

		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;

			const drawn = Number(view.contentEl.dataset.filmTrackerDrawn ?? "0");
			if (drawn > 0 && this.drawnIn(view) < drawn) {
				this.refresh();
				return;
			}
		}
	}

	/**
	 * Whether `panel` already shows exactly what `signature` describes. A
	 * refresh runs on every metadata change in the vault; rebuilding a panel
	 * that hasn't changed would make it flicker and would drop whatever the
	 * user is hovering or clicking — the Read checkbox, a link's preview.
	 */
	private unchanged(panel: HTMLElement, signature: string): boolean {
		if (panel.dataset.filmTrackerSignature === signature) return true;
		panel.dataset.filmTrackerSignature = signature;
		return false;
	}

	private showPoster(host: HTMLElement, poster: Poster): void {
		host.addClass(LAYOUT_CLASS);

		const existing = host.querySelector(`.${POSTER_CLASS}`);
		const container =
			existing instanceof HTMLElement ? existing : host.createDiv({ cls: POSTER_CLASS });

		if (container.getAttribute(POSTER_PATH_ATTR) === poster.file.path) return;

		container.setAttribute(POSTER_PATH_ATTR, poster.file.path);
		container.empty();
		container.createEl("img", {
			attr: { src: this.app.vault.getResourcePath(poster.file), alt: poster.alt },
		});
	}

	/**
	 * The bar under an anime note's poster — "48 / 148 episodes". It lives
	 * inside the poster's own container, so it goes wherever the poster goes
	 * and is taken away with it; a note that has watched nothing yet, or no
	 * `episodes_watched` at all, shows none.
	 */
	private showWatchProgress(host: HTMLElement, file: TFile | null): void {
		const container = host.querySelector(`.${POSTER_CLASS}`);
		if (!(container instanceof HTMLElement)) return;

		const controls =
			file === null ? null : watchControlsFor(this.app.metadataCache.getFileCache(file)?.frontmatter);

		const existing = container.querySelector(`.${PROGRESS_CLASS}`);
		const nothingToShow =
			controls === null || (controls.label === null && !controls.canWatchEpisode && !controls.canMarkWatched);
		if (file === null || controls === null || nothingToShow) {
			existing?.detach();
			return;
		}
		const signature = JSON.stringify(controls);
		if (existing instanceof HTMLElement && existing.dataset.filmTrackerSignature === signature) return;

		existing?.detach();
		const wrap = container.createDiv({ cls: PROGRESS_CLASS });
		wrap.dataset.filmTrackerSignature = signature;
		if (controls.label !== null) renderProgressBar(wrap, controls.label, controls.percent);

		const buttons = wrap.createDiv({ cls: "film-tracker-progress-actions" });
		if (controls.canWatchEpisode) {
			this.renderMangaAction(buttons, "+1 episode", () => this.mangaActions.watchEpisode(file));
		}
		if (controls.canMarkWatched) {
			this.renderMangaAction(buttons, "Watched today", () => this.mangaActions.watchedToday(file));
		}
	}

	private clear(host: HTMLElement): void {
		host.removeClass(LAYOUT_CLASS);
		host.querySelector(`.${POSTER_CLASS}`)?.detach();
	}

	/**
	 * A film note gets Connections (films sharing a director, composer or
	 * cast member); a director note gets Filmography (their own films)
	 * instead — same panel, same collapsible box, mutually exclusive since a
	 * note is never both. Reading view has no single host that wraps both
	 * the header and the body, so the panel is inserted as the header's next
	 * sibling instead of living inside the same grid the poster uses.
	 */
	private applyRelatedPanel(view: MarkdownView, host: HTMLElement | null, scan: VaultScan): void {
		const anchor = this.findConnectionsAnchor(view);
		if (anchor === null) return;

		const file = view.file;
		if (file === null) {
			host?.removeClass(MANGA_HOST_CLASS);
			host?.removeClass(SEASONS_HOST_CLASS);
			this.detachPanelsExcept(anchor, []);
			return;
		}

		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const manga = frontmatter === undefined ? null : this.resolveMangaInfo(frontmatter);
		const kind = classifyNote(frontmatter);
		host?.toggleClass(MANGA_HOST_CLASS, manga !== null);
		host?.toggleClass(SEASONS_HOST_CLASS, kind?.kind === "tv");

		if (kind?.kind === "tv") {
			// A TV note can have all three: its seasons, the manga it adapts,
			// and what it shares with the rest of the vault. Each keeps its own
			// box, in that order.
			this.detachPanelsExcept(anchor, ["seasons", "manga", "main"]);
			this.applySeasonsPanel(anchor, file, frontmatter ?? {});
			if (manga !== null) this.applyMangaPanel(anchor, file, manga);
			else this.panelOf(anchor, "manga")?.detach();
			this.applyConnections(anchor, view, scan);
			return;
		}

		if (manga !== null) {
			this.detachPanelsExcept(anchor, ["manga"]);
			this.applyMangaPanel(anchor, file, manga);
			return;
		}

		const mangaka = frontmatter === undefined ? null : this.resolveMangakaInfo(frontmatter);
		if (mangaka !== null) {
			this.detachPanelsExcept(anchor, ["main"]);
			this.applyMangagraphy(anchor, file, mangaka, scan);
			return;
		}

		if (frontmatter?.mal_id !== undefined) {
			// Anime-only notes have none of these panels.
			this.detachPanelsExcept(anchor, []);
			return;
		}

		const person = frontmatter === undefined ? null : this.resolveDirectorInfo(frontmatter);
		if (person !== null) {
			// Their films, then the series they created, each in its own box.
			this.detachPanelsExcept(anchor, ["main", "shows"]);
			this.applyFilmography(anchor, file, person, scan);
			return;
		}

		this.detachPanelsExcept(anchor, ["main"]);
		this.applyConnections(anchor, view, scan);
	}

	private applyConnections(anchor: HTMLElement, view: MarkdownView, scan: VaultScan): void {
		const found = this.settings().showConnections ? this.connectionsFor(view.file, scan) : null;

		if (found === null || found.connections.length === 0) {
			this.panelOf(anchor, "main")?.detach();
			return;
		}

		this.renderConnections(this.ensurePanel(anchor, "main"), found.connections, found.sourcePath);
	}

	/** Reads the `manga` nested block straight from parsed frontmatter — no raw-text parsing needed for rendering. */
	private resolveMangaInfo(frontmatter: Record<string, unknown>): MangaPanelInfo | null {
		const manga = frontmatter.manga;
		if (typeof manga !== "object" || manga === null) return null;
		const block = manga as Record<string, unknown>;
		if (typeof block.mal_id !== "number") return null;

		return {
			title: typeof block.title === "string" ? block.title : "",
			mediaType: typeof block.media_type === "string" ? block.media_type : null,
			year: typeof block.year === "number" ? block.year : null,
			endYear: typeof block.end_year === "number" ? block.end_year : null,
			status: typeof block.status === "string" ? block.status : null,
			chapters: typeof block.chapters === "number" ? block.chapters : null,
			chaptersRead: typeof block.chapters_read === "number" ? block.chapters_read : null,
			volumes: typeof block.volumes === "number" ? block.volumes : null,
			mangakaRaw: Array.isArray(block.mangaka)
				? block.mangaka.filter((item): item is string => typeof item === "string")
				: [],
			posterLinkpath: parseLinkTarget(block.poster),
			read: block.read === true,
			readDate: typeof block.read_date === "string" && block.read_date.trim() !== "" ? block.read_date : null,
		};
	}

	private applyMangaPanel(anchor: HTMLElement, file: TFile, info: MangaPanelInfo): void {
		const panel = this.ensurePanel(anchor, "manga");
		// What the panel shows also depends on which links resolve right now:
		// the poster, and a mangaka whose note has just been created.
		const posterPath = this.resolveLinkedFile(info.posterLinkpath, file.path)?.path ?? null;
		const mangakaTargets = info.mangakaRaw.map((raw) => {
			const linkpath = parseWikilink(raw);
			return linkpath === null ? null : (this.resolveLinkedFile(linkpath, file.path)?.path ?? null);
		});
		if (this.unchanged(panel, JSON.stringify(["manga", file.path, info, posterPath, mangakaTargets]))) return;

		const wasCollapsed = panel.hasClass("is-collapsed");
		panel.empty();
		panel.toggleClass("is-collapsed", wasCollapsed);
		this.renderPanelHeading(panel, "MANGA");

		const body = panel.createDiv({ cls: "film-tracker-connections-list film-tracker-manga-body" });

		const posterFile = this.resolveLinkedFile(info.posterLinkpath, file.path);
		if (posterFile !== null) {
			body.createDiv({ cls: "film-tracker-manga-poster" }).createEl("img", {
				attr: { src: this.app.vault.getResourcePath(posterFile), alt: `${info.title} poster` },
			});
		}

		const details = body.createDiv({ cls: "film-tracker-manga-details" });
		if (info.title !== "") {
			details.createDiv({ text: info.title, cls: "film-tracker-manga-title" });
		}

		const summary = mangaSummary(info);
		if (summary !== "") {
			details.createDiv({ text: summary, cls: "film-tracker-connections-shared" });
		}

		if (info.mangakaRaw.length > 0) {
			const mangaka = details.createDiv({ cls: "film-tracker-manga-mangaka" });
			info.mangakaRaw.forEach((raw, index) => {
				if (index > 0) mangaka.appendText(", ");
				this.renderNameOrLink(mangaka, raw, file.path);
			});
		}

		const chapterLabel = progressLabel(info.chaptersRead ?? 0, info.chapters, "chapter");
		if (chapterLabel !== null) {
			const progress = details.createDiv({ cls: PROGRESS_CLASS });
			renderProgressBar(progress, chapterLabel, progressPercent(info.chaptersRead ?? 0, info.chapters));
		}

		const readRow = details.createDiv({ cls: "film-tracker-manga-read-row" });
		const readToggle = readRow.createEl("label", { cls: "film-tracker-manga-read" });
		const checkbox = readToggle.createEl("input", { attr: { type: "checkbox" } });
		checkbox.checked = info.read;
		readToggle.appendText(info.read && info.readDate !== null ? ` Read on ${info.readDate}` : " Read");
		checkbox.addEventListener("change", () => {
			this.mangaActions.setRead(file, checkbox.checked);
		});

		// Nothing left to count once the last chapter is in.
		const chaptersLeft = info.chapters === null || (info.chaptersRead ?? 0) < info.chapters;
		if (!info.read && chaptersLeft) {
			this.renderMangaAction(readRow, "+1 chapter", () => this.mangaActions.readChapter(file));
		}

		const actions = details.createDiv({ cls: "film-tracker-manga-actions" });
		this.renderMangaAction(actions, "Add adaptation", () => this.mangaActions.addAdaptation(file));
		this.renderMangaAction(actions, "Change manga", () => this.mangaActions.change(file));
		this.renderMangaAction(actions, "Remove manga", () => this.mangaActions.remove(file));
	}

	/**
	 * The SEASONS panel: one row per season, with how much of it has been
	 * watched, a checkbox that ticks the whole season off and a "+1". The
	 * seasons are where a TV note keeps what was watched, so this is the
	 * panel that writes it — the bar under the poster only reads them.
	 */
	private applySeasonsPanel(anchor: HTMLElement, file: TFile, frontmatter: Record<string, unknown>): void {
		const progress = tvProgressOf(frontmatter);
		if (!this.settings().showSeasons || progress.seasons.length === 0) {
			this.panelOf(anchor, "seasons")?.detach();
			return;
		}

		const panel = this.ensurePanel(anchor, "seasons");
		if (this.unchanged(panel, JSON.stringify(["seasons", file.path, progress]))) return;

		const wasCollapsed = panel.hasClass("is-collapsed");
		panel.empty();
		panel.toggleClass("is-collapsed", wasCollapsed);
		this.renderPanelHeading(
			panel,
			"SEASONS",
			progressLabel(progress.watched, progress.episodes, "episode") ?? undefined,
		);

		const list = panel.createDiv({ cls: "film-tracker-connections-list film-tracker-seasons" });
		for (const season of progress.seasons) {
			this.renderSeasonRow(list, file, season);
		}
	}

	private renderSeasonRow(list: HTMLElement, file: TFile, season: TvSeasonEntry): void {
		const complete = season.watched >= season.episodes;
		const row = list.createDiv({ cls: "film-tracker-season" });

		const toggle = row.createEl("label", { cls: "film-tracker-manga-read film-tracker-season-tick" });
		const checkbox = toggle.createEl("input", { attr: { type: "checkbox" } });
		checkbox.checked = complete;
		checkbox.addEventListener("change", () => {
			this.mangaActions.setSeasonWatched(file, season.season, checkbox.checked);
		});

		const details = row.createDiv({ cls: "film-tracker-season-details" });
		details.createDiv({ cls: "film-tracker-season-title", text: seasonSummary(season) });
		const label = progressLabel(season.watched, season.episodes, "episode");
		if (label !== null) {
			renderProgressBar(
				details.createDiv({ cls: PROGRESS_CLASS }),
				complete && season.watchDate !== null ? `${label} · ${season.watchDate}` : label,
				progressPercent(season.watched, season.episodes),
			);
		}

		if (!complete) {
			this.renderMangaAction(row.createDiv({ cls: "film-tracker-season-actions" }), "+1", () =>
				this.mangaActions.watchSeason(file, season.season),
			);
		}
	}

	private renderMangaAction(container: HTMLElement, label: string, onClick: () => void): void {
		const button = container.createEl("button", {
			cls: "film-tracker-manga-action",
			text: label,
		});
		button.addEventListener("click", (event) => {
			event.preventDefault();
			onClick();
		});
	}

	/** Renders a mangaka name as a clickable internal link when its wikilink currently resolves, plain text otherwise. */
	private renderNameOrLink(container: HTMLElement, raw: string, sourcePath: string): void {
		const linkpath = parseWikilink(raw);
		const target = linkpath === null ? null : this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
		if (target === null) {
			container.createSpan({ text: linkpath ?? raw });
			return;
		}
		const link = container.createEl("a", {
			cls: "internal-link film-tracker-connections-link",
			text: target.basename,
			href: target.path,
		});
		link.addEventListener("click", (event) => {
			event.preventDefault();
			void this.app.workspace.openLinkText(target.path, sourcePath, event.ctrlKey || event.metaKey);
		});
	}

	private resolveLinkedFile(linkpath: string | null, sourcePath: string): TFile | null {
		if (linkpath === null) return null;
		return this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
	}

	/**
	 * A person note's own works: the films they directed, and under them the
	 * TV series they created. Two lists rather than one, since a percentage
	 * over both would say nothing — a five-season series and a film are not
	 * the same unit.
	 */
	private applyFilmography(
		anchor: HTMLElement,
		file: TFile,
		person: { names: Set<string> },
		scan: VaultScan,
	): void {
		const settings = this.settings();
		this.applyWorkList(anchor, "main", "FILMOGRAPHY", settings.showFilmography, person, file, scan, "film");
		this.applyWorkList(anchor, "shows", "TV SERIES", settings.showTvSeries, person, file, scan, "tv");
	}

	private applyWorkList(
		anchor: HTMLElement,
		slot: PanelSlot,
		heading: string,
		shown: boolean,
		person: { names: Set<string> },
		file: TFile,
		scan: VaultScan,
		kind: "film" | "tv",
	): void {
		const works = shown ? findFilmography(person.names, scan.worksOfKind(kind)) : [];
		if (works.length === 0) {
			this.panelOf(anchor, slot)?.detach();
			return;
		}

		this.renderFilmography(this.ensurePanel(anchor, slot), heading, works, file.path);
	}

	/**
	 * No visibility setting of its own — mirrors the MANGA panel, which has
	 * none either, rather than `showFilmography` (that toggle is specifically
	 * about Director's own panel, and coupling it to a mangaka's panel would
	 * be a confusing surprise for anyone who turns it off).
	 */
	private applyMangagraphy(
		anchor: HTMLElement,
		file: TFile,
		mangaka: { names: Set<string> },
		scan: VaultScan,
	): void {
		const mangas = findMangagraphy(mangaka.names, scan.mangas());
		if (mangas.length === 0) {
			this.panelOf(anchor, "main")?.detach();
			return;
		}

		this.renderMangagraphy(this.ensurePanel(anchor, "main"), mangas, file.path);
	}

	/** Takes away every panel this note doesn't have, so nothing is left behind from the last one. */
	private detachPanelsExcept(anchor: HTMLElement, kept: PanelSlot[]): void {
		for (const slot of PANEL_SLOTS) {
			if (!kept.includes(slot)) this.panelOf(anchor, slot)?.detach();
		}
	}

	private panelOf(anchor: HTMLElement, slot: PanelSlot): HTMLElement | null {
		const found = anchor.parentElement?.querySelector(`:scope > .${panelClass(slot)}`);
		return found instanceof HTMLElement ? found : null;
	}

	/**
	 * The box for one slot, created where its order says: after the last panel
	 * that comes before it, or right after the properties when it is the first.
	 */
	private ensurePanel(anchor: HTMLElement, slot: PanelSlot): HTMLElement {
		const existing = this.panelOf(anchor, slot);
		if (existing !== null) return existing;

		const panel = createDiv({ cls: `${CONNECTIONS_CLASS} ${panelClass(slot)}` });
		let after: HTMLElement = anchor;
		for (const before of PANEL_SLOTS.slice(0, PANEL_SLOTS.indexOf(slot))) {
			after = this.panelOf(anchor, before) ?? after;
		}
		after.insertAdjacentElement("afterend", panel);
		return panel;
	}

	private connectionsFor(
		file: TFile | null,
		scan: VaultScan,
	): { connections: Connection[]; sourcePath: string } | null {
		if (file === null) return null;
		const current = this.resolveWorkInfo(file);
		if (current === null) return null;
		const others = scan.works().filter((work) => work.path !== file.path);
		return { connections: findConnections(current, others).slice(0, MAX_CONNECTIONS), sourcePath: file.path };
	}

	/**
	 * A director note has `name` + `tmdb_id` but never `directors` — a film
	 * note always writes `directors`, even as an empty list. `aliases`
	 * (which already includes `name` itself, and `original_name` when one
	 * was found) is the full set of spellings a film's `directors` entry
	 * might match.
	 */
	private resolveDirectorInfo(frontmatter: Record<string, unknown>): { names: Set<string> } | null {
		if (frontmatter.directors !== undefined) return null;
		const name: unknown = frontmatter.name;
		if (typeof name !== "string" || name.trim() === "") return null;

		const names = new Set([name.trim(), ...extractNames(frontmatter.aliases)]);
		return { names };
	}

	/**
	 * A mangaka note has `name` + `mal_id` but never `title` — an anime or
	 * Series note always has `title`, even a manga-only one (see
	 * `resolveMangaInfo`, checked earlier). No `aliases` set here: MAL's
	 * `/people/{id}` gives no alternate-name equivalent to carry (confirmed —
	 * `alternate_names` came back empty in testing), unlike TMDB for
	 * directors.
	 */
	private resolveMangakaInfo(frontmatter: Record<string, unknown>): { names: Set<string> } | null {
		if (frontmatter.title !== undefined) return null;
		const malId: unknown = frontmatter.mal_id;
		if (typeof malId !== "number") return null;
		const name: unknown = frontmatter.name;
		if (typeof name !== "string" || name.trim() === "") return null;

		return { names: new Set([name.trim()]) };
	}

	/** Reads the nested `manga` block the same way `resolveMangaInfo` does — a manga-only note and a merged Series note look identical here. */
	private mangagraphyMangaInfo(file: TFile): MangagraphyManga | null {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const manga: unknown = frontmatter?.manga;
		if (typeof manga !== "object" || manga === null) return null;
		const block = manga as Record<string, unknown>;
		if (typeof block.mal_id !== "number") return null;

		const title: unknown = block.title;
		const year: unknown = block.year;
		return {
			malId: block.mal_id,
			path: file.path,
			title: typeof title === "string" && title !== "" ? title : file.basename,
			year: typeof year === "number" ? year : null,
			read: block.read === true,
			adapted: typeof frontmatter?.mal_id === "number" || typeof frontmatter?.tmdb_tv_id === "number",
			mangaka: extractNames(block.mangaka),
		};
	}

	/** The element the connections/filmography panel is inserted immediately after. */
	private findConnectionsAnchor(view: MarkdownView): HTMLElement | null {
		const selector =
			view.getMode() === "preview"
				? ".markdown-preview-sizer > .mod-header"
				: ".cm-sizer > .metadata-container";
		const anchor = view.contentEl.querySelector(selector);
		return anchor instanceof HTMLElement ? anchor : null;
	}

	/**
	 * A film or TV series note, read once for every panel that compares works.
	 * `credits` is who made it — a film's directors, a series' creators — which
	 * is what a person note's own lists match against.
	 */
	private resolveWorkInfo(file: TFile): ScannedWork | null {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const kind = classifyNote(frontmatter)?.kind;
		if (frontmatter === undefined || (kind !== "film" && kind !== "tv")) return null;

		const title: unknown = frontmatter.title;
		const year: unknown = frontmatter.year;
		const directors = extractNames(frontmatter.directors);
		const creators = extractNames(frontmatter.creators);
		return {
			kind,
			path: file.path,
			title: typeof title === "string" && title !== "" ? title : file.basename,
			year: typeof year === "number" ? year : null,
			watched: frontmatter.watched === true,
			directors,
			creators,
			credits: kind === "film" ? directors : creators,
			cast: extractNames(frontmatter.cast),
			composers: extractNames(frontmatter.composers),
		};
	}

	/**
	 * Collapse state lives only on the panel's own class, so it survives
	 * `empty()` in the caller as long as the panel element itself is reused
	 * (see `ensurePanel`) — the same way Obsidian's Properties widget keeps
	 * its own collapsed state across re-renders.
	 */
	private renderPanelHeading(panel: HTMLElement, label: string, suffix?: string): void {
		const heading = panel.createDiv({ cls: "film-tracker-connections-heading" });
		const collapseIcon = heading.createSpan({ cls: "film-tracker-connections-collapse-icon" });
		setIcon(collapseIcon, "right-triangle");
		// Uppercased in markup rather than via CSS text-transform: the CSS
		// transform runs under the vault's locale, and Turkish uppercases "i"
		// to "İ" (dotted), turning "Connections" into "CONNECTİONS".
		heading.createSpan({ text: label });
		if (suffix !== undefined) {
			heading.createSpan({ cls: "film-tracker-connections-progress", text: suffix });
		}
		heading.addEventListener("click", () => {
			panel.toggleClass("is-collapsed", !panel.hasClass("is-collapsed"));
		});
	}

	private renderConnections(
		panel: HTMLElement,
		connections: Connection[],
		sourcePath: string,
	): void {
		const shown = connections.map((connection) => [
			connection.file.path,
			connection.file.title,
			connection.shared.map((credit) => credit.name),
		]);
		if (this.unchanged(panel, JSON.stringify(["connections", sourcePath, shown]))) return;

		const wasCollapsed = panel.hasClass("is-collapsed");
		panel.empty();
		panel.toggleClass("is-collapsed", wasCollapsed);
		this.renderPanelHeading(panel, "CONNECTIONS");

		const list = panel.createEl("ul", { cls: "film-tracker-connections-list" });
		for (const connection of connections) {
			const item = list.createEl("li");
			const link = item.createEl("a", {
				cls: "internal-link film-tracker-connections-link",
				text: connection.file.title,
				href: connection.file.path,
			});
			link.addEventListener("click", (event) => {
				event.preventDefault();
				void this.app.workspace.openLinkText(
					connection.file.path,
					sourcePath,
					event.ctrlKey || event.metaKey,
				);
			});
			item.createSpan({
				cls: "film-tracker-connections-shared",
				text: ` — ${connection.shared.map((credit) => credit.name).join(", ")}`,
			});
		}
	}

	private renderFilmography(
		panel: HTMLElement,
		heading: string,
		films: FilmographyEntry[],
		sourcePath: string,
	): void {
		if (this.unchanged(panel, JSON.stringify([heading, sourcePath, films]))) return;

		const wasCollapsed = panel.hasClass("is-collapsed");
		panel.empty();
		panel.toggleClass("is-collapsed", wasCollapsed);
		const progress = filmographyProgress(films);
		this.renderPanelHeading(panel, heading, progress === null ? undefined : `${progress}% watched`);

		const list = panel.createEl("ul", { cls: "film-tracker-connections-list" });
		for (const film of films) {
			const item = list.createEl("li");
			const link = item.createEl("a", {
				cls: "internal-link film-tracker-connections-link",
				text: film.title,
				href: film.path,
			});
			link.addEventListener("click", (event) => {
				event.preventDefault();
				void this.app.workspace.openLinkText(
					film.path,
					sourcePath,
					event.ctrlKey || event.metaKey,
				);
			});
			if (film.year !== null) {
				item.createSpan({
					cls: "film-tracker-connections-shared",
					text: ` — ${film.year}`,
				});
			}
		}
	}

	private renderMangagraphy(
		panel: HTMLElement,
		mangas: MangagraphyEntry[],
		sourcePath: string,
	): void {
		if (this.unchanged(panel, JSON.stringify(["mangagraphy", sourcePath, mangas]))) return;

		const wasCollapsed = panel.hasClass("is-collapsed");
		panel.empty();
		panel.toggleClass("is-collapsed", wasCollapsed);
		const progress = mangagraphyProgress(mangas);
		this.renderPanelHeading(
			panel,
			"MANGAGRAPHY",
			progress === null ? undefined : `${progress}% read`,
		);

		const list = panel.createEl("ul", { cls: "film-tracker-connections-list" });
		for (const manga of mangas) {
			const item = list.createEl("li");
			const [primaryPath, ...otherPaths] = manga.paths;
			this.renderPathLink(item, manga.title, primaryPath, sourcePath);
			if (manga.year !== null) {
				item.createSpan({
					cls: "film-tracker-connections-shared",
					text: ` — ${manga.year}`,
				});
			}
			// The same manga on more than one Series note — one per
			// adaptation — is listed once, with the other notes alongside.
			if (otherPaths.length > 0) {
				const others = item.createSpan({ cls: "film-tracker-connections-shared", text: " · also in " });
				otherPaths.forEach((path, index) => {
					if (index > 0) others.appendText(", ");
					const file = this.app.vault.getFileByPath(path);
					this.renderPathLink(others, file?.basename ?? path, path, sourcePath);
				});
			}
		}
	}

	private renderPathLink(container: HTMLElement, text: string, path: string, sourcePath: string): void {
		const link = container.createEl("a", {
			cls: "internal-link film-tracker-connections-link",
			text,
			href: path,
		});
		link.addEventListener("click", (event) => {
			event.preventDefault();
			void this.app.workspace.openLinkText(path, sourcePath, event.ctrlKey || event.metaKey);
		});
	}

	private findHost(view: MarkdownView): HTMLElement | null {
		const selector =
			view.getMode() === "preview" ? ".markdown-preview-sizer > .mod-header" : ".cm-sizer";
		const host = view.contentEl.querySelector(selector);
		return host instanceof HTMLElement ? host : null;
	}

	private resolvePoster(view: MarkdownView): Poster | null {
		const file = view.file;
		if (file === null) return null;

		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (frontmatter === undefined) return null;

		const linkpath = posterLinkpathOf(frontmatter);
		if (linkpath === null) return null;

		const target = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
		if (target === null) return null;

		const title: unknown = frontmatter.title;
		return { file: target, alt: typeof title === "string" ? title : file.basename };
	}
}
