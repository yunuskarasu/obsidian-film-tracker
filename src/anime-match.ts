import { listValues, parseWikilink } from "./note";

/**
 * Whether a show TMDB lists as Japanese animation is already in the vault as
 * an anime note. There is no id the two catalogues share — TMDB knows
 * nothing about MyAnimeList's numbering — so titles are all there is to go
 * on, and a match here only ever asks the user a question (see
 * `tv-actions.ts`), never decides anything by itself.
 */

const SHORT_TITLE = 4;

/**
 * A title reduced to what two catalogues can be expected to agree on:
 * one case, one width for the kana and Latin letters CJK titles mix, and
 * nothing that is only punctuation or spacing. "Yuu☆Yuu☆Hakusho" and
 * "Yu Yu Hakusho" still differ, which is why a match is a question.
 */
export function normalizeTitle(title: string): string {
	return title
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

/** Every title a note or a show goes by, normalized, blanks dropped. */
function titleSet(titles: (string | null | undefined)[]): string[] {
	const seen = new Set<string>();
	for (const title of titles) {
		if (typeof title !== "string") continue;
		const normalized = normalizeTitle(parseWikilink(title) ?? title);
		if (normalized !== "") seen.add(normalized);
	}
	return [...seen];
}

/**
 * What may follow a title and still be the same work: MyAnimeList gives each
 * season its own entry ("Attack on Titan Season 3", "… 2nd Season", "… Part
 * 2"), while TMDB keeps them all under the one show.
 */
const SEASON_SUFFIX = /^(season|part|final|s?\d)/;

/**
 * Whether two works look like the same one — the titles equal, or one of
 * them that title plus a season. A title that merely starts with the other
 * ("Attack" against "Attack on Titan") is not the same work, and neither is
 * a sequel under its own name ("Naruto Shippuuden").
 */
function sameWork(one: string, other: string): boolean {
	if (one === other) return true;
	const [shorter, longer] = one.length <= other.length ? [one, other] : [other, one];
	if (shorter.length < SHORT_TITLE || !longer.startsWith(shorter)) return false;
	return SEASON_SUFFIX.test(longer.slice(shorter.length));
}

/** The titles an anime note goes by: what MyAnimeList gave it, plus any alias. */
export function animeNoteTitles(frontmatter: Record<string, unknown> | undefined): string[] {
	if (frontmatter === undefined) return [];
	const titles = [
		frontmatter.title,
		frontmatter.english_title,
		frontmatter.japanese_title,
		...listValues(frontmatter.aliases),
	];
	return titleSet(titles.map((title) => (typeof title === "string" ? title : null)));
}

/** The titles a TV note goes by: what TMDB gave it, plus any alias. */
export function tvNoteTitles(frontmatter: Record<string, unknown> | undefined): string[] {
	if (frontmatter === undefined) return [];
	const titles = [frontmatter.title, frontmatter.original_title, ...listValues(frontmatter.aliases)];
	return titleSet(titles.map((title) => (typeof title === "string" ? title : null)));
}

/** The titles MyAnimeList gives an anime. */
export function animeTitles(anime: { title: string; englishTitle: string | null; japaneseTitle: string | null }): string[] {
	return titleSet([anime.title, anime.englishTitle, anime.japaneseTitle]);
}

/** The titles a TMDB show goes by. */
export function showTitles(show: { title: string; originalTitle: string }): string[] {
	return titleSet([show.title, show.originalTitle]);
}

export function looksLikeSameWork(show: string[], anime: string[]): boolean {
	return show.some((one) => anime.some((other) => sameWork(one, other)));
}
