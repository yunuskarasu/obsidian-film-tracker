import type { AnimeMetadata } from "./mal";
import {
	buildFileName,
	isEmptyValue,
	keepLinks,
	parseFrontmatterBlocks,
	posterLine,
	serializeFrontmatterBlocks,
	yamlList,
	yamlScalar,
	yamlString,
} from "./note";

/** Named the way a film note is — including a title that already carries its year (see `buildFileName`). */
export function buildAnimeFileName(title: string, year: number | null): string {
	return buildFileName(title, year);
}

/** Fields the plugin owns: refreshing rewrites these and nothing else. */
export type AnimeOwnedKey =
	| "title"
	| "english_title"
	| "japanese_title"
	| "media_type"
	| "episodes"
	| "genres"
	| "studios"
	| "status"
	| "year"
	| "end_year"
	| "mal_id";

export const ANIME_OWNED_KEYS: readonly AnimeOwnedKey[] = [
	"title",
	"english_title",
	"japanese_title",
	"media_type",
	"episodes",
	"genres",
	"studios",
	"status",
	"year",
	"end_year",
	"mal_id",
];

/** `previous`, on a refresh, is the note's frontmatter before it: a genre or studio linked there stays linked (see `keepLinks`). */
function ownedLines(key: AnimeOwnedKey, anime: AnimeMetadata, previous?: Record<string, unknown>): string[] {
	switch (key) {
		case "title":
			return [`title: ${yamlString(anime.title)}`];
		case "english_title":
			return [yamlScalar("english_title", anime.englishTitle)];
		case "japanese_title":
			return [yamlScalar("japanese_title", anime.japaneseTitle)];
		case "media_type":
			return [yamlScalar("media_type", anime.mediaType)];
		case "episodes":
			return [yamlScalar("episodes", anime.episodes)];
		case "genres":
			return yamlList("genres", keepLinks(anime.genres, previous?.genres));
		case "studios":
			return yamlList("studios", keepLinks(anime.studios, previous?.studios));
		case "status":
			return [yamlScalar("status", anime.status)];
		case "year":
			return [yamlScalar("year", anime.year)];
		case "end_year":
			return [yamlScalar("end_year", anime.endYear)];
		case "mal_id":
			return [`mal_id: ${anime.malId}`];
	}
}

export function buildAnimeFrontmatter(anime: AnimeMetadata, posterLink: string | null): string {
	const lines = [
		"---",
		...ownedLines("title", anime),
		...ownedLines("english_title", anime),
		...ownedLines("japanese_title", anime),
		...ownedLines("media_type", anime),
		...ownedLines("episodes", anime),
		...ownedLines("genres", anime),
		...ownedLines("studios", anime),
		...ownedLines("status", anime),
		...ownedLines("year", anime),
		...ownedLines("end_year", anime),
		posterLine(posterLink),
		...ownedLines("mal_id", anime),
		"watched: false",
		"---",
	];
	return lines.join("\n");
}

/**
 * The body is left empty on purpose, same as a film note: the poster is
 * rendered from the `poster` property next to the note's properties, and
 * everything below belongs to the user.
 */
export function buildAnimeNoteContent(anime: AnimeMetadata, rawPosterLink: string | null): string {
	const link = rawPosterLink === null ? null : rawPosterLink.replace(/^!/, "");
	return `${buildAnimeFrontmatter(anime, link)}\n`;
}

/**
 * The manga block's own top-level key (see manga-note.ts). It always stays
 * last: when anime fields are merged onto a manga-only Series note, a new key
 * with nowhere else to go is inserted right before it, so the merged note ends
 * up in the same canonical order as an anime-first note regardless of which
 * side was added first.
 */
const MANGA_BLOCK_KEY = "manga";

/**
 * The order a brand-new anime note writes its fields in — `poster` and
 * `watched` included, which `ANIME_OWNED_KEYS` leaves out because a refresh
 * only ever seeds them, never rewrites them.
 */
const ANIME_FIELD_ORDER: readonly string[] = [
	"title",
	"english_title",
	"japanese_title",
	"media_type",
	"episodes",
	"genres",
	"studios",
	"status",
	"year",
	"end_year",
	"poster",
	"mal_id",
	"watched",
];

/**
 * Where a key the note doesn't have yet belongs: right after the nearest
 * field before it in `ANIME_FIELD_ORDER` that the note does have, or failing
 * that right before the nearest field after it. A note written before
 * `end_year` existed therefore gets it beside `year` rather than at the end.
 * Anything else goes before the `manga` block, or last.
 */
function insertionIndex(order: string[], key: string): number {
	const canonical = ANIME_FIELD_ORDER.indexOf(key);
	if (canonical !== -1) {
		for (let before = canonical - 1; before >= 0; before -= 1) {
			const at = order.indexOf(ANIME_FIELD_ORDER[before]);
			if (at !== -1) return at + 1;
		}
		for (let after = canonical + 1; after < ANIME_FIELD_ORDER.length; after += 1) {
			const at = order.indexOf(ANIME_FIELD_ORDER[after]);
			if (at !== -1) return at;
		}
	}

	const mangaIndex = order.indexOf(MANGA_BLOCK_KEY);
	return mangaIndex === -1 ? order.length : mangaIndex;
}

/**
 * Sets an owned key's lines. A key that already exists in `doc.order` is
 * left exactly where it is — refreshing an existing anime note never reorders
 * anything — and a brand-new key is placed by `insertionIndex`.
 */
function setOwnedKey(
	doc: { order: string[]; blocks: Map<string, string[]> },
	key: string,
	lines: string[],
): void {
	doc.blocks.set(key, lines);
	if (doc.order.includes(key)) return;

	doc.order.splice(insertionIndex(doc.order, key), 0, key);
}

/**
 * Rewrites the plugin-owned anime fields from fresh MAL data. `watched`, the
 * body and any property the user added are preserved exactly, and so is the
 * order of the existing keys — same rule as a film note's refresh.
 *
 * Also handles merging anime onto a manga-only Series note: `poster` and
 * `watched` don't exist yet on that note, so they are seeded (`watched` to
 * `false`, same as a brand-new anime note) rather than skipped, and every
 * newly-inserted key lands before the existing `manga` block.
 */
export function refreshAnimeFrontmatter(
	content: string,
	anime: AnimeMetadata,
	newPosterLink: string | null = null,
	previous?: Record<string, unknown>,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	for (const key of ANIME_OWNED_KEYS) {
		if (key === "mal_id" && !doc.order.includes("poster")) {
			setOwnedKey(doc, "poster", [posterLine(null)]);
		}
		setOwnedKey(doc, key, ownedLines(key, anime, previous));
	}

	if (newPosterLink !== null && isEmptyValue(doc.blocks.get("poster"))) {
		doc.blocks.set("poster", [posterLine(newPosterLink)]);
	}

	if (!doc.order.includes("watched")) {
		setOwnedKey(doc, "watched", ["watched: false"]);
	}

	return serializeFrontmatterBlocks(doc);
}
