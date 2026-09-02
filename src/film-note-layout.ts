import { MarkdownView, setIcon, type App, type TFile } from "obsidian";
import { findConnections, type Connection, type FilmNoteInfo } from "./connections";
import {
	filmographyProgress,
	findFilmography,
	type FilmographyEntry,
	type FilmographyFilm,
} from "./filmography";
import { parseWikilink } from "./note";

const POSTER_CLASS = "film-tracker-poster";
const LAYOUT_CLASS = "film-tracker-layout";
const POSTER_PATH_ATTR = "data-film-tracker-poster";
const CONNECTIONS_CLASS = "film-tracker-connections";
const MAX_CONNECTIONS = 20;

interface Poster {
	file: TFile;
	alt: string;
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

		this.applyRelatedPanel(view);
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
	private applyRelatedPanel(view: MarkdownView): void {
		const anchor = this.findConnectionsAnchor(view);
		if (anchor === null) return;

		const file = view.file;
		if (file !== null) {
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const director = frontmatter === undefined ? null : this.resolveDirectorInfo(frontmatter);
			if (director !== null) {
				this.applyFilmography(anchor, file, director);
				return;
			}
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
		if (tmdbId === undefined || tmdbId === null) return null;

		const linkpath = parseWikilink(frontmatter.poster);
		if (linkpath === null) return null;

		const target = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
		if (target === null) return null;

		const title: unknown = frontmatter.title;
		return { file: target, alt: typeof title === "string" ? title : file.basename };
	}
}
