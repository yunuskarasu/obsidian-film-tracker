import { animeProgressOf } from "./anime-note";
import { readProgressOf } from "./book-note";
import type { DiaryKind } from "./diary";
import { playProgressOf } from "./game-note";
import { mangaProgressOf } from "./manga-note";
import { listenProgressOf } from "./music-note";
import type { NoteKind } from "./note-kind";
import { tvProgressOf } from "./tv-note";

/*
 * The library: every film, series, anime, manga, book, game and album in
 * the vault, as a shelf of covers. Read from the notes as they are — the
 * library writes nothing. Pure functions only: the view is in
 * library-view.ts.
 */

/** The same works the diary counts: no people, no songs. */
export type LibraryKind = DiaryKind;

/** The order of the tabs over the shelf. */
export const LIBRARY_KINDS: LibraryKind[] = ["film", "tv", "anime", "manga", "book", "game", "album"];

/** Where the user is with a work, the same four ways for every kind. */
export type LibraryStatus = "planned" | "progress" | "finished" | "dropped";

/** The order of the filters under the tabs. */
export const LIBRARY_STATUSES: LibraryStatus[] = ["planned", "progress", "finished", "dropped"];

export interface LibraryItem {
	/** The note it is written in: a series note holds an anime and its manga, two items. */
	path: string;
	kind: LibraryKind;
	title: string;
	/** Every name it goes by, the title first: what a search looks through. */
	names: string[];
	/** The link its poster or cover is under, to resolve from `path`. */
	poster: string | null;
	status: LibraryStatus;
	/** How far through it, where it is counted in episodes or chapters and has been started. */
	progress: LibraryProgress | null;
	/** The year it came out. */
	year: number | null;
	/** The day it was first finished: "2026-03-14". */
	finished: string | null;
	/** When its note was made, in milliseconds: the newest first on the shelf. */
	added: number;
}

export interface LibraryProgress {
	done: number;
	/** `null` while it is still coming out with no known length. */
	total: number | null;
	unit: "ep" | "ch";
}

type Frontmatter = Record<string, unknown>;

function text(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** A work's other names, as its note keeps them: in English, in Japanese, its own, and its aliases. */
function otherNames(frontmatter: Frontmatter): string[] {
	const names = [frontmatter.original_title, frontmatter.english_title, frontmatter.japanese_title];
	if (Array.isArray(frontmatter.aliases)) names.push(...(frontmatter.aliases as unknown[]));
	else names.push(frontmatter.aliases);
	return names.map(text).filter((name): name is string => name !== null);
}

/** The title first, then the rest, each only once. */
function namesOf(title: string, others: string[]): string[] {
	return [...new Set([title, ...others])];
}

function yearOf(value: unknown): number | null {
	if (typeof value === "number" && Number.isInteger(value)) return value;
	const match = typeof value === "string" ? value.trim().match(/^(\d{4})/) : null;
	return match === null ? null : Number(match[1]);
}

function dayOf(value: unknown): string | null {
	const match = typeof value === "string" ? value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
	return match === null ? null : `${match[1]}-${match[2]}-${match[3]}`;
}

/** Done, begun or neither: what a work counted in episodes or chapters is at. */
function counted(done: boolean, started: number): LibraryStatus {
	return done ? "finished" : started > 0 ? "progress" : "planned";
}

const READ_STATUS: Record<string, LibraryStatus> = { "to read": "planned", reading: "progress", read: "finished", dropped: "dropped" };
const PLAY_STATUS: Record<string, LibraryStatus> = { backlog: "planned", playing: "progress", completed: "finished", abandoned: "dropped" };

/**
 * What a note puts on the shelf: one work — or, for a series with its
 * manga, two, each with its own cover and its own place in it. A person's
 * or a song's note puts nothing there.
 */
export function libraryItemsOf(path: string, basename: string, kind: NoteKind, frontmatter: Frontmatter, added: number): LibraryItem[] {
	const title = text(frontmatter.title) ?? text(frontmatter.name) ?? basename;
	const poster = text(frontmatter.poster);
	const year = yearOf(frontmatter.year);
	const others = otherNames(frontmatter);
	const item = (itemKind: LibraryKind, status: LibraryStatus, finished: unknown, progress: LibraryProgress | null = null): LibraryItem => ({
		path,
		kind: itemKind,
		title,
		names: namesOf(title, others),
		poster,
		status,
		progress: status === "progress" ? progress : null,
		year,
		finished: dayOf(finished),
		added,
	});
	const manga = (): LibraryItem => {
		const side = (frontmatter.manga ?? {}) as Frontmatter;
		const progress = mangaProgressOf(frontmatter);
		const mangaTitle = text(side.title) ?? title;
		return {
			...item("manga", counted(progress.done, progress.read), side.read_date, { done: progress.read, total: progress.chapters, unit: "ch" }),
			title: mangaTitle,
			// The series' own names find its manga too.
			names: namesOf(mangaTitle, [title, ...others]),
			poster: text(side.poster) ?? poster,
			year: yearOf(side.year) ?? year,
		};
	};

	switch (kind.kind) {
		case "film":
			return [item("film", frontmatter.watched === true ? "finished" : "planned", frontmatter.watch_date)];
		case "tv": {
			const progress = tvProgressOf(frontmatter);
			const show = item("tv", counted(progress.done, progress.watched), frontmatter.watch_date, {
				done: progress.watched,
				total: progress.episodes > 0 ? progress.episodes : null,
				unit: "ep",
			});
			return kind.mangaMalId === null ? [show] : [show, manga()];
		}
		case "series": {
			const items: LibraryItem[] = [];
			if (kind.animeMalId !== null) {
				const progress = animeProgressOf(frontmatter);
				items.push(item("anime", counted(progress.done, progress.watched), frontmatter.watch_date, { done: progress.watched, total: progress.episodes, unit: "ep" }));
			}
			if (kind.mangaMalId !== null) items.push(manga());
			return items;
		}
		case "book":
			return [item("book", READ_STATUS[readProgressOf(frontmatter).status ?? ""] ?? "planned", frontmatter.finished)];
		case "game":
			return [item("game", PLAY_STATUS[playProgressOf(frontmatter).status ?? ""] ?? "planned", frontmatter.completed)];
		case "album":
			return [item("album", listenProgressOf(frontmatter).listened ? "finished" : "planned", frontmatter.listen_date)];
		default:
			return [];
	}
}

/** What the pill on a cover says: each kind in its own words. */
export function statusLabel(kind: LibraryKind, status: LibraryStatus): string {
	switch (kind) {
		case "film":
			return status === "finished" ? "Watched" : status === "dropped" ? "Dropped" : "To watch";
		case "tv":
		case "anime":
			return { planned: "To watch", progress: "Watching", finished: "Watched", dropped: "Dropped" }[status];
		case "manga":
		case "book":
			return { planned: "To read", progress: "Reading", finished: "Read", dropped: "Dropped" }[status];
		case "game":
			return { planned: "Backlog", progress: "Playing", finished: "Completed", dropped: "Abandoned" }[status];
		case "album":
			return status === "finished" ? "Listened" : "To listen";
	}
}

/** "12/24 ep", or "12 ch" for a manga with no known end. */
export function progressLabel(progress: LibraryProgress): string {
	return progress.total === null ? `${progress.done} ${progress.unit}` : `${progress.done}/${progress.total} ${progress.unit}`;
}

/** The newest note first; works added together, by title. */
export function byAdded(a: LibraryItem, b: LibraryItem): number {
	return b.added - a.added || a.title.localeCompare(b.title) || LIBRARY_KINDS.indexOf(a.kind) - LIBRARY_KINDS.indexOf(b.kind);
}

/** What the shelf can be put in order by. */
export type LibrarySort = "added" | "title" | "year" | "finished";

export const LIBRARY_SORTS: LibrarySort[] = ["added", "title", "year", "finished"];

const byTitle = (a: LibraryItem, b: LibraryItem) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });

/** The latest first, those with none last; then by title. */
function latestFirst<T extends number | string>(of: (item: LibraryItem) => T | null): (a: LibraryItem, b: LibraryItem) => number {
	return (a, b) => {
		const x = of(a);
		const y = of(b);
		if (x === y) return byTitle(a, b);
		if (x === null) return 1;
		if (y === null) return -1;
		return x < y ? 1 : -1;
	};
}

/**
 * The shelf in an order, each in its own direction: the newest note, the
 * title from A, the latest year, the latest finished. A work with no year,
 * or not finished, goes after those that have one.
 */
export function sortItems(items: LibraryItem[], sort: LibrarySort): LibraryItem[] {
	const compare = { added: byAdded, title: byTitle, year: latestFirst((item) => item.year), finished: latestFirst((item) => item.finished) }[sort];
	return [...items].sort(compare);
}

/** Text as a search compares it: no case, no accents — "Suç" is "suc", "Kürk" is "kurk". */
export function searchKey(value: string): string {
	return value
		.replace(/[ıİ]/g, "i")
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.trim();
}

/** Whether every word searched for is in one of a work's names, in any order. */
export function matchesSearch(item: LibraryItem, query: string): boolean {
	const words = searchKey(query).split(/\s+/).filter((word) => word !== "");
	if (words.length === 0) return true;
	return item.names.some((name) => {
		const key = searchKey(name);
		return words.every((word) => key.includes(word));
	});
}
