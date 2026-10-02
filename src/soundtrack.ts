import type { AlbumSearchResult } from "./music";
import { listValues } from "./note";
import type { NoteKind } from "./note-kind";
import { extractNames } from "./panels/panel-plan";

/*
 * Soundtracks: which album notes are the music of which film, TV series,
 * anime or game. The link lives on the album note alone, as `soundtrack_of`, so a
 * film's own note is never written; its SOUNDTRACK panel is worked out from
 * the albums that point at it. Pure functions only — the lookups are in
 * wikidata.ts and musicbrainz.ts.
 */

/**
 * A film, a TV series, an anime or a game, by the id its note is known by —
 * what a soundtrack can be the music of. Wikidata knows a game by IGDB's
 * `slug` — "hollow-knight", the end of its page's address — rather than its
 * number, so a game carries both, as far as they are known.
 */
export type SoundtrackWork =
	| { kind: "film"; tmdbId: number }
	| { kind: "tv"; tmdbTvId: number }
	| { kind: "anime"; malId: number }
	| { kind: "game"; igdbId: number | null; slug: string | null };

/** IGDB's slug of a game, from the address of its page: "https://www.igdb.com/games/hollow-knight". */
export function igdbSlugOf(url: unknown): string | null {
	if (typeof url !== "string") return null;
	const match = url.match(/igdb\.com\/games\/([^/?#\s]+)/i);
	return match === null ? null : match[1];
}

/**
 * What a note is as a work with a soundtrack: `null` for a manga-only note,
 * a person, an album… A game's slug is read from its note's `url`, when the
 * note is given.
 */
export function soundtrackWorkOf(note: NoteKind | null, frontmatter?: Record<string, unknown>): SoundtrackWork | null {
	if (note?.kind === "film") return { kind: "film", tmdbId: note.tmdbId };
	if (note?.kind === "tv") return { kind: "tv", tmdbTvId: note.tmdbTvId };
	if (note?.kind === "series" && note.animeMalId !== null) return { kind: "anime", malId: note.animeMalId };
	if (note?.kind === "game") return { kind: "game", igdbId: note.igdbId, slug: igdbSlugOf(frontmatter?.url) };
	return null;
}

/** Whether two works are the same one: a game by either of its ids. */
export function sameWork(a: SoundtrackWork, b: SoundtrackWork): boolean {
	if (a.kind === "film" && b.kind === "film") return a.tmdbId === b.tmdbId;
	if (a.kind === "tv" && b.kind === "tv") return a.tmdbTvId === b.tmdbTvId;
	if (a.kind === "anime" && b.kind === "anime") return a.malId === b.malId;
	if (a.kind === "game" && b.kind === "game") {
		return (a.slug !== null && a.slug === b.slug) || (a.igdbId !== null && a.igdbId === b.igdbId);
	}
	return false;
}

/** The property an album note names its works in. */
export const SOUNDTRACK_KEY = "soundtrack_of";

/** The works an album note's `soundtrack_of` names, as written: `[[Spirited Away (2001)]]`. */
export function soundtrackLinksOf(frontmatter: Record<string, unknown> | undefined): string[] {
	return listValues(frontmatter?.[SOUNDTRACK_KEY]);
}

/** How many titles a work is looked for by at most: every search is a second at MusicBrainz's pace. */
const MAX_TITLES = 3;

/**
 * The titles a work's soundtrack may be filed under: its title, then its
 * title in its own language — a Japanese soundtrack is filed under 進撃の巨人,
 * never under "Attack on Titan" — then its English one. Each once.
 */
export function workTitles(frontmatter: Record<string, unknown> | undefined): string[] {
	const titles: string[] = [];
	for (const key of ["title", "original_title", "japanese_title", "english_title"]) {
		const value: unknown = frontmatter?.[key];
		if (typeof value !== "string" || value.trim() === "") continue;
		const title = value.trim();
		if (!titles.some((known) => known.toLowerCase() === title.toLowerCase())) titles.push(title);
	}
	return titles.slice(0, MAX_TITLES);
}

/** MusicBrainz's search for soundtracks by one title — the title as a phrase, so "Stalker" isn't every word of it. */
export function soundtrackQuery(title: string): string {
	return `releasegroup:"${title.replace(/["\\]/g, "\\$&")}" AND secondarytype:soundtrack`;
}

/** An album a MusicBrainz search found, with how well it matched: 100 is best. */
export interface ScoredAlbum {
	album: AlbumSearchResult;
	score: number;
}

/** One row of "Find soundtrack…": an album, and who says it is this work's. */
export interface SoundtrackChoice {
	album: AlbumSearchResult;
	source: "Wikidata" | "MusicBrainz";
}

/** What the search results are weighed against: the work's year, and its composers when the note has them. */
export interface WorkFacts {
	year: number | null;
	composers: string[];
}

export function workFactsOf(frontmatter: Record<string, unknown> | undefined): WorkFacts {
	const year: unknown = frontmatter?.year;
	return { year: typeof year === "number" ? year : null, composers: extractNames(frontmatter?.composers) };
}

/**
 * The rows "Find soundtrack…" offers, best first. Wikidata's answers are a
 * work's own soundtracks for certain, and come first. MusicBrainz's search
 * only matches titles, so its results are weighed: an album from before the
 * work is left out (a soundtrack never comes first; a reissue decades later
 * is common), and one by a composer the note names goes to the top of them.
 * The rest keep MusicBrainz's own order. No album is offered twice.
 */
export function soundtrackChoices(wikidata: AlbumSearchResult[], searches: ScoredAlbum[][], work: WorkFacts): SoundtrackChoice[] {
	const seen = new Set<string>();
	const choices: SoundtrackChoice[] = [];
	for (const album of wikidata) {
		if (seen.has(album.id)) continue;
		seen.add(album.id);
		choices.push({ album, source: "Wikidata" });
	}

	const composers = new Set(work.composers.map((name) => name.toLowerCase()));
	const byComposer = (album: AlbumSearchResult) =>
		composers.size > 0 && album.artists.split(/\s*(?:,|&|\bfeat\.|\band\b)\s*/i).some((name) => composers.has(name.trim().toLowerCase()));

	const found: ScoredAlbum[] = [];
	for (const result of searches.flat()) {
		if (seen.has(result.album.id)) continue;
		if (work.year !== null && result.album.year !== null && result.album.year < work.year - 1) continue;
		seen.add(result.album.id);
		found.push(result);
	}
	found.sort((a, b) => Number(byComposer(b.album)) - Number(byComposer(a.album)) || b.score - a.score);
	return [...choices, ...found.map(({ album }) => ({ album, source: "MusicBrainz" as const }))];
}

/** A film, TV series or anime note, as SCORES reads it. */
export interface ScoreWork {
	path: string;
	title: string;
	year: number | null;
	watched: boolean;
	kind: SoundtrackWork["kind"];
	/** The note's own `composers` — only a film has them, and only with Add composers on. */
	composers: string[];
}

/** An album note, as far as SCORES goes: who made it, and the notes it is the soundtrack of. */
export interface ScoreAlbum {
	credits: string[];
	soundtrackOf: string[];
}

/**
 * An artist's scores in the vault: the works whose `composers` name them,
 * and the works an album of theirs is the soundtrack of — the only way an
 * anime or a TV series can say who scored it. `names` is every name the
 * artist note goes by. Each work once, oldest first.
 */
export function findScores(names: Set<string>, works: ScoreWork[], albums: ScoreAlbum[]): ScoreWork[] {
	const byName = (list: string[]) => list.some((name) => names.has(name));
	const scored = new Set(albums.filter((album) => byName(album.credits)).flatMap((album) => album.soundtrackOf));
	return works
		.filter((work) => byName(work.composers) || scored.has(work.path))
		.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.title.localeCompare(b.title));
}
