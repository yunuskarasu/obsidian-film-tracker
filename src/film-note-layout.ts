import { MarkdownView, setIcon, type App, type TFile } from "obsidian";
import { findConnections, type Connection, type FilmNoteInfo } from "./connections";
import {
	filmographyProgress,
	findFilmography,
	type FilmographyEntry,
	type FilmographyFilm,
} from "./filmography";
import {
	findMangagraphy,
	mangagraphyProgress,
	type MangagraphyEntry,
	type MangagraphyManga,
} from "./mangagraphy";
import { toggleMangaRead } from "./manga-note";
import { parseWikilink } from "./note";

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

interface Poster {
	file: TFile;
	alt: string;
}

interface MangaPanelInfo {
	title: string;
	mediaType: string | null;
	status: string | null;
	chapters: number | null;
	volumes: number | null;
	mangakaRaw: string[];
	posterLinkpath: string | null;
	read: boolean;
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
	private showConnections: boolean;
	private showFilmography: boolean;

	constructor(app: App, showConnections: boolean, showFilmography: boolean) {
		this.app = app;
		this.showConnections = showConnections;
		this.showFilmography = showFilmography;
	}

	setShowConnections(value: boolean): void {
		this.showConnections = value;
	}

	setShowFilmography(value: boolean): void {
		this.showFilmography = value;
	}

	refresh(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView) this.applyTo(view);
		}
	}

	removeAll(): void {
		for (const el of Array.from(document.querySelectorAll(`.${POSTER_CLASS}`))) {
			el.detach();
		}
		for (const el of Array.from(document.querySelectorAll(`.${CONNECTIONS_CLASS}`))) {
			el.detach();
		}
		for (const el of Array.from(document.querySelectorAll(`.${LAYOUT_CLASS}`))) {
			el.removeClass(LAYOUT_CLASS);
		}
		for (const el of Array.from(document.querySelectorAll(`.${MANGA_HOST_CLASS}`))) {
			el.removeClass(MANGA_HOST_CLASS);
		}
	}

	private applyTo(view: MarkdownView): void {
		const host = this.findHost(view);
		if (host !== null) {
			const poster = this.resolvePoster(view);
			if (poster === null) {
				this.clear(host);
			} else {
				this.showPoster(host, poster);
			}
		}

		this.applyRelatedPanel(view, host);
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
	private applyRelatedPanel(view: MarkdownView, host: HTMLElement | null): void {
		const anchor = this.findConnectionsAnchor(view);
		if (anchor === null) return;

		const file = view.file;
		if (file !== null) {
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const manga = frontmatter === undefined ? null : this.resolveMangaInfo(frontmatter);
			if (manga !== null) {
				host?.addClass(MANGA_HOST_CLASS);
				this.applyMangaPanel(anchor, file, manga);
				return;
			}
			host?.removeClass(MANGA_HOST_CLASS);

			const mangaka = frontmatter === undefined ? null : this.resolveMangakaInfo(frontmatter);
			if (mangaka !== null) {
				this.applyMangagraphy(anchor, file, mangaka);
				return;
			}

			if (frontmatter?.mal_id !== undefined) {
				// Anime-only notes have no Connections/Filmography panel.
				this.detachPanel(anchor);
				return;
			}
			const director = frontmatter === undefined ? null : this.resolveDirectorInfo(frontmatter);
			if (director !== null) {
				this.applyFilmography(anchor, file, director);
				return;
			}
		} else {
			host?.removeClass(MANGA_HOST_CLASS);
		}

		this.applyConnections(anchor, view);
	}

	private applyConnections(anchor: HTMLElement, view: MarkdownView): void {
		if (!this.showConnections) {
			this.detachPanel(anchor);
			return;
		}

		const found = this.connectionsFor(view.file);

		if (found === null || found.connections.length === 0) {
			this.detachPanel(anchor);
			return;
		}

		this.renderConnections(this.ensurePanel(anchor), found.connections, found.sourcePath);
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
			status: typeof block.status === "string" ? block.status : null,
			chapters: typeof block.chapters === "number" ? block.chapters : null,
			volumes: typeof block.volumes === "number" ? block.volumes : null,
			mangakaRaw: Array.isArray(block.mangaka)
				? block.mangaka.filter((item): item is string => typeof item === "string")
				: [],
			posterLinkpath: parseWikilink(block.poster),
			read: block.read === true,
		};
	}

	private applyMangaPanel(anchor: HTMLElement, file: TFile, info: MangaPanelInfo): void {
		const panel = this.ensurePanel(anchor);
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

		const meta = [info.mediaType, info.status].filter((value): value is string => value !== null);
		if (info.volumes !== null) meta.push(`${info.volumes} volumes`);
		if (info.chapters !== null) meta.push(`${info.chapters} chapters`);
		if (meta.length > 0) {
			details.createDiv({ text: meta.join(" · "), cls: "film-tracker-connections-shared" });
		}

		if (info.mangakaRaw.length > 0) {
			const mangaka = details.createDiv({ cls: "film-tracker-manga-mangaka" });
			info.mangakaRaw.forEach((raw, index) => {
				if (index > 0) mangaka.appendText(", ");
				this.renderNameOrLink(mangaka, raw, file.path);
			});
		}

		const readToggle = details.createEl("label", { cls: "film-tracker-manga-read" });
		const checkbox = readToggle.createEl("input", { attr: { type: "checkbox" } });
		checkbox.checked = info.read;
		readToggle.appendText(" Read");
		checkbox.addEventListener("change", () => {
			void this.app.vault.process(file, (content) => toggleMangaRead(content));
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

	private applyFilmography(
		anchor: HTMLElement,
		file: TFile,
		director: { names: Set<string> },
	): void {
		if (!this.showFilmography) {
			this.detachPanel(anchor);
			return;
		}

		const films = this.computeFilmography(director.names);
		if (films.length === 0) {
			this.detachPanel(anchor);
			return;
		}

		this.renderFilmography(this.ensurePanel(anchor), films, file.path);
	}

	/**
	 * No visibility setting of its own — mirrors the MANGA panel, which has
	 * none either, rather than `showFilmography` (that toggle is specifically
	 * about Director's own panel, and coupling it to a mangaka's panel would
	 * be a confusing surprise for anyone who turns it off).
	 */
	private applyMangagraphy(anchor: HTMLElement, file: TFile, mangaka: { names: Set<string> }): void {
		const mangas = this.computeMangagraphy(mangaka.names);
		if (mangas.length === 0) {
			this.detachPanel(anchor);
			return;
		}

		this.renderMangagraphy(this.ensurePanel(anchor), mangas, file.path);
	}

	private detachPanel(anchor: HTMLElement): void {
		anchor.parentElement?.querySelector(`:scope > .${CONNECTIONS_CLASS}`)?.detach();
	}

	private ensurePanel(anchor: HTMLElement): HTMLElement {
		const existing = anchor.parentElement?.querySelector(`:scope > .${CONNECTIONS_CLASS}`);
		if (existing instanceof HTMLElement) return existing;

		const panel = createDiv({ cls: CONNECTIONS_CLASS });
		anchor.insertAdjacentElement("afterend", panel);
		return panel;
	}

	private connectionsFor(
		file: TFile | null,
	): { connections: Connection[]; sourcePath: string } | null {
		if (file === null) return null;
		const current = this.resolveFilmInfo(file);
		if (current === null) return null;
		return { connections: this.computeConnections(file, current), sourcePath: file.path };
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

	private computeFilmography(names: Set<string>): FilmographyEntry[] {
		const films = this.app.vault
			.getMarkdownFiles()
			.map((file) => this.filmographyFilmInfo(file))
			.filter((info): info is FilmographyFilm => info !== null);

		return findFilmography(names, films);
	}

	private filmographyFilmInfo(file: TFile): FilmographyFilm | null {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (frontmatter?.tmdb_id === undefined) return null;

		const title: unknown = frontmatter.title;
		const year: unknown = frontmatter.year;
		return {
			path: file.path,
			title: typeof title === "string" && title !== "" ? title : file.basename,
			year: typeof year === "number" ? year : null,
			watched: frontmatter.watched === true,
			directors: extractNames(frontmatter.directors),
		};
	}

	private computeMangagraphy(names: Set<string>): MangagraphyEntry[] {
		const mangas = this.app.vault
			.getMarkdownFiles()
			.map((file) => this.mangagraphyMangaInfo(file))
			.filter((info): info is MangagraphyManga => info !== null);

		return findMangagraphy(names, mangas);
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
			path: file.path,
			title: typeof title === "string" && title !== "" ? title : file.basename,
			year: typeof year === "number" ? year : null,
			read: block.read === true,
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

	private computeConnections(file: TFile, current: FilmNoteInfo): Connection[] {
		const others = this.app.vault
			.getMarkdownFiles()
			.filter((candidate) => candidate.path !== file.path)
			.map((candidate) => this.resolveFilmInfo(candidate))
			.filter((info): info is FilmNoteInfo => info !== null);

		return findConnections(current, others).slice(0, MAX_CONNECTIONS);
	}

	private resolveFilmInfo(file: TFile): FilmNoteInfo | null {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const tmdbId: unknown = frontmatter?.tmdb_id;
		if (frontmatter === undefined || tmdbId === undefined || tmdbId === null) return null;

		const title: unknown = frontmatter.title;
		return {
			path: file.path,
			title: typeof title === "string" && title !== "" ? title : file.basename,
			directors: extractNames(frontmatter.directors),
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
		films: FilmographyEntry[],
		sourcePath: string,
	): void {
		const wasCollapsed = panel.hasClass("is-collapsed");
		panel.empty();
		panel.toggleClass("is-collapsed", wasCollapsed);
		const progress = filmographyProgress(films);
		this.renderPanelHeading(
			panel,
			"FILMOGRAPHY",
			progress === null ? undefined : `${progress}% watched`,
		);

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
			const link = item.createEl("a", {
				cls: "internal-link film-tracker-connections-link",
				text: manga.title,
				href: manga.path,
			});
			link.addEventListener("click", (event) => {
				event.preventDefault();
				void this.app.workspace.openLinkText(
					manga.path,
					sourcePath,
					event.ctrlKey || event.metaKey,
				);
			});
			if (manga.year !== null) {
				item.createSpan({
					cls: "film-tracker-connections-shared",
					text: ` — ${manga.year}`,
				});
			}
		}
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

		const tmdbId: unknown = frontmatter.tmdb_id;
		const malId: unknown = frontmatter.mal_id;
		if ((tmdbId === undefined || tmdbId === null) && (malId === undefined || malId === null)) {
			return null;
		}

		const linkpath = parseWikilink(frontmatter.poster);
		if (linkpath === null) return null;

		const target = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
		if (target === null) return null;

		const title: unknown = frontmatter.title;
		return { file: target, alt: typeof title === "string" ? title : file.basename };
	}
}
