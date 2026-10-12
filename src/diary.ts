import type { NoteKind } from "./note-kind";

/*
 * The diary: every film, series, anime, manga, album, game and book the
 * user finished, by the day they did. Read from the notes as they are —
 * the diary writes nothing. Pure functions only: the view is in
 * diary-view.ts.
 */

export type DiaryKind = "film" | "tv" | "anime" | "manga" | "album" | "game" | "book";

/** The order the kinds are counted in, on the cover and each month's page. */
export const DIARY_KINDS: DiaryKind[] = ["film", "tv", "anime", "manga", "book", "game", "album"];

export interface DiaryEntry {
	/** The note it is written in. */
	path: string;
	kind: DiaryKind;
	title: string;
	/** "2026-03-14". */
	date: string;
	/** What was finished, where it isn't the whole work: "Season 2". */
	detail: string | null;
	/** The link its poster or cover is under, to resolve from `path`. */
	poster: string | null;
}

type Frontmatter = Record<string, unknown>;

/** "2026-03-14", or a date and time Obsidian wrote: the day alone. */
function dayOf(value: unknown): string | null {
	const match = typeof value === "string" ? value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
	return match === null ? null : `${match[1]}-${match[2]}-${match[3]}`;
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function block(value: unknown): Frontmatter | null {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Frontmatter) : null;
}

/**
 * The days a note says something was finished: a film or an anime watched,
 * each season of a series, a manga or a book read, a game completed, an
 * album listened to. Only the first day is ever kept in a note, so a work
 * seen again shows on the day it was first finished.
 */
export function diaryEntriesOf(path: string, basename: string, kind: NoteKind, frontmatter: Frontmatter): DiaryEntry[] {
	const title = text(frontmatter.title) ?? text(frontmatter.name) ?? basename;
	const poster = text(frontmatter.poster);
	const entries: DiaryEntry[] = [];
	const add = (entryKind: DiaryKind, date: unknown, detail: string | null = null, entryTitle = title, entryPoster = poster) => {
		const day = dayOf(date);
		if (day !== null) entries.push({ path, kind: entryKind, title: entryTitle, date: day, detail, poster: entryPoster });
	};
	const manga = () => {
		const side = block(frontmatter.manga);
		if (side !== null) add("manga", side.read_date, null, text(side.title) ?? title, text(side.poster) ?? poster);
	};

	switch (kind.kind) {
		case "film":
			add("film", frontmatter.watch_date);
			break;
		case "tv": {
			const seasons = Array.isArray(frontmatter.seasons) ? frontmatter.seasons : [];
			const seasonDays = new Set<string>();
			for (const raw of seasons) {
				const season = block(raw);
				const day = dayOf(season?.watch_date);
				if (season === null || day === null) continue;
				seasonDays.add(day);
				const number = typeof season.season === "number" ? season.season : null;
				add("tv", day, text(season.name) ?? (number === null ? null : `Season ${number}`));
			}
			// The whole series, finished on a day no season was: one with no seasons written, say.
			const whole = dayOf(frontmatter.watch_date);
			if (whole !== null && !seasonDays.has(whole)) add("tv", whole);
			if (kind.mangaMalId !== null) manga();
			break;
		}
		case "series":
			if (kind.animeMalId !== null) add("anime", frontmatter.watch_date);
			if (kind.mangaMalId !== null) manga();
			break;
		case "album":
			add("album", frontmatter.listen_date);
			break;
		case "game":
			add("game", frontmatter.completed);
			break;
		case "book":
			add("book", frontmatter.finished);
			break;
		default:
			break;
	}
	return entries;
}

/** One month of a year: its entries, the earliest day first. */
export interface DiaryMonth {
	/** 0 for January. */
	month: number;
	entries: DiaryEntry[];
}

/** A year's entries by month, only the months with any, January first. */
export function monthsOf(entries: DiaryEntry[], year: number): DiaryMonth[] {
	const months: DiaryMonth[] = [];
	const prefix = `${year}-`;
	const sorted = entries.filter((entry) => entry.date.startsWith(prefix)).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
	for (const entry of sorted) {
		const month = Number(entry.date.slice(5, 7)) - 1;
		const last = months[months.length - 1];
		if (last?.month === month) last.entries.push(entry);
		else months.push({ month, entries: [entry] });
	}
	return months;
}

/** How many of each kind: what a cover and a month's page count. */
export function countByKind(entries: DiaryEntry[]): Map<DiaryKind, number> {
	const counts = new Map<DiaryKind, number>();
	for (const kind of DIARY_KINDS) {
		const count = entries.filter((entry) => entry.kind === kind).length;
		if (count > 0) counts.set(kind, count);
	}
	return counts;
}

/** The years the diary has anything in, the latest first. */
export function yearsOf(entries: DiaryEntry[]): number[] {
	return [...new Set(entries.map((entry) => Number(entry.date.slice(0, 4))))].sort((a, b) => b - a);
}

/** A list cut into pages of `size`. */
export function pagesOf<T>(items: T[], size: number): T[][] {
	const pages: T[][] = [];
	for (let index = 0; index < items.length; index += size) pages.push(items.slice(index, index + size));
	return pages;
}
