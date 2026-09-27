import type { App, TFile } from "obsidian";
import type { WorkNoteInfo } from "../connections";
import type { FilmographyWork } from "../filmography";
import type { MangagraphyManga } from "../mangagraphy";
import { classifyNote } from "../note-kind";
import { extractNames } from "./panel-plan";

/** A film or TV series note as the Connections, Filmography and TV series panels read it. */
export type ScannedWork = WorkNoteInfo & FilmographyWork & { kind: "film" | "tv" };

/**
 * The vault's films, series, albums and manga, read once per refresh and
 * shared by every open note: Connections, Filmography, Discography and
 * Mangagraphy each need the whole list, and one refresh can redraw several
 * notes.
 */
export class VaultScan {
	private readonly app: App;
	private workList: ScannedWork[] | null = null;
	private mangaList: MangagraphyManga[] | null = null;
	private albumList: FilmographyWork[] | null = null;

	constructor(app: App) {
		this.app = app;
	}

	/** Films and TV series together: Connections compares them against each other. */
	works(): ScannedWork[] {
		if (this.workList === null) {
			this.workList = this.app.vault
				.getMarkdownFiles()
				.map((file) => readWork(this.app, file))
				.filter((work): work is ScannedWork => work !== null);
		}
		return this.workList;
	}

	worksOfKind(kind: "film" | "tv"): ScannedWork[] {
		return this.works().filter((work) => work.kind === kind);
	}

	/** Album notes, read the way a person's works are: their artists are who made them. */
	albums(): FilmographyWork[] {
		if (this.albumList === null) {
			this.albumList = this.app.vault
				.getMarkdownFiles()
				.map((file) => readAlbum(this.app, file))
				.filter((album): album is FilmographyWork => album !== null);
		}
		return this.albumList;
	}

	mangas(): MangagraphyManga[] {
		if (this.mangaList === null) {
			this.mangaList = this.app.vault
				.getMarkdownFiles()
				.map((file) => readManga(this.app, file))
				.filter((manga): manga is MangagraphyManga => manga !== null);
		}
		return this.mangaList;
	}
}

/**
 * A film or TV series note, read once for every panel that compares works.
 * `credits` is who made it — a film's directors, a series' creators — which
 * is what a person note's own lists match against.
 */
export function readWork(app: App, file: TFile): ScannedWork | null {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
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

/** An album note as DISCOGRAPHY lists it; `watched` is whether it has been listened to. */
function readAlbum(app: App, file: TFile): FilmographyWork | null {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	if (frontmatter === undefined || classifyNote(frontmatter)?.kind !== "album") return null;
	const title: unknown = frontmatter.title;
	const year: unknown = frontmatter.year;
	return {
		path: file.path,
		title: typeof title === "string" && title !== "" ? title : file.basename,
		year: typeof year === "number" ? year : null,
		watched: frontmatter.listened === true,
		credits: extractNames(frontmatter.artists),
	};
}

/** A note's `manga` block as MANGAGRAPHY lists it — a manga-only note and a merged Series note look identical here. */
function readManga(app: App, file: TFile): MangagraphyManga | null {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
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
