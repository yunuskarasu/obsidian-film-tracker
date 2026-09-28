import type { App, TFile } from "obsidian";
import type { WorkNoteInfo } from "../connections";
import type { FilmographyWork } from "../filmography";
import type { MangagraphyManga } from "../mangagraphy";
import { parseLinkTarget } from "../note";
import { resolveLinkedFile } from "./kit";
import { classifyNote } from "../note-kind";
import { soundtrackLinksOf, soundtrackWorkOf, type ScoreWork } from "../soundtrack";
import { extractNames } from "./panel-plan";

/** A song note as TRACKLIST finds it: the album note it links, and where on that album it sits. */
export interface ScannedSong {
	path: string;
	albumPath: string | null;
	disc: number | null;
	n: number | null;
}

/**
 * An album note as DISCOGRAPHY and SOUNDTRACK list it. `soundtrackOf` is
 * the paths of the notes its `soundtrack_of` links, where they resolve.
 */
export type ScannedAlbum = FilmographyWork & { soundtrackOf: string[] };

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
	private albumList: ScannedAlbum[] | null = null;
	private songList: ScannedSong[] | null = null;
	private scoreWorkList: ScoreWork[] | null = null;

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
	albums(): ScannedAlbum[] {
		if (this.albumList === null) {
			this.albumList = this.app.vault
				.getMarkdownFiles()
				.map((file) => readAlbum(this.app, file))
				.filter((album): album is ScannedAlbum => album !== null);
		}
		return this.albumList;
	}

	/** The albums whose `soundtrack_of` links the note at `path`, oldest first. */
	soundtracksOf(path: string): ScannedAlbum[] {
		return this.albums()
			.filter((album) => album.soundtrackOf.includes(path))
			.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.title.localeCompare(b.title));
	}

	/** Films, TV series and anime together: what an artist's SCORES can list. */
	scoreWorks(): ScoreWork[] {
		if (this.scoreWorkList === null) {
			this.scoreWorkList = this.app.vault
				.getMarkdownFiles()
				.map((file) => readScoreWork(this.app, file))
				.filter((work): work is ScoreWork => work !== null);
		}
		return this.scoreWorkList;
	}

	/** Song notes, each with the album note it was added from. */
	songs(): ScannedSong[] {
		if (this.songList === null) {
			this.songList = this.app.vault
				.getMarkdownFiles()
				.map((file) => readSong(this.app, file))
				.filter((song): song is ScannedSong => song !== null);
		}
		return this.songList;
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
function readAlbum(app: App, file: TFile): ScannedAlbum | null {
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
		soundtrackOf: soundtrackLinksOf(frontmatter)
			.map((link) => resolveLinkedFile(app, parseLinkTarget(link) ?? link, file.path)?.path ?? null)
			.filter((path): path is string => path !== null),
	};
}

function readScoreWork(app: App, file: TFile): ScoreWork | null {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	const work = soundtrackWorkOf(classifyNote(frontmatter));
	if (frontmatter === undefined || work === null) return null;
	const title: unknown = frontmatter.title;
	const year: unknown = frontmatter.year;
	return {
		path: file.path,
		title: typeof title === "string" && title !== "" ? title : file.basename,
		year: typeof year === "number" ? year : null,
		watched: frontmatter.watched === true,
		kind: work.kind,
		composers: extractNames(frontmatter.composers),
	};
}

function readSong(app: App, file: TFile): ScannedSong | null {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	if (frontmatter === undefined || classifyNote(frontmatter)?.kind !== "song") return null;
	const linkpath = parseLinkTarget(frontmatter.album);
	const album = linkpath === null ? null : app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
	const disc: unknown = frontmatter.disc;
	const track: unknown = frontmatter.track;
	return {
		path: file.path,
		albumPath: album?.path ?? null,
		disc: typeof disc === "number" ? disc : null,
		n: typeof track === "number" ? track : null,
	};
}

/** The song note of one of an album's track lines, if there is one: it links the album, at the same disc and number. */
export function songNoteFor(songs: ScannedSong[], albumPath: string, track: { disc: number | null; n: number }): string | null {
	const found = songs.find(
		(song) => song.albumPath === albumPath && song.n === track.n && (song.disc ?? 1) === (track.disc ?? 1),
	);
	return found?.path ?? null;
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
