import type { AnimeMetadata } from "./mal";
import {
	isEmptyValue,
	parseFrontmatterBlocks,
	sanitizeFileName,
	serializeFrontmatterBlocks,
	yamlString,
} from "./note";

export function buildAnimeFileName(title: string, year: number | null): string {
	return sanitizeFileName(year === null ? title : `${title} (${year})`);
}

function yamlList(key: string, values: string[]): string[] {
	if (values.length === 0) return [`${key}:`];
	return [`${key}:`, ...values.map((value) => `  - ${yamlString(value)}`)];
}

function yamlNumber(key: string, value: number | null): string {
	return value === null ? `${key}:` : `${key}: ${value}`;
}

function yamlOptionalString(key: string, value: string | null): string {
	return value === null ? `${key}:` : `${key}: ${yamlString(value)}`;
}

function posterLine(posterLink: string | null): string {
	return posterLink === null ? "poster:" : `poster: ${yamlString(posterLink)}`;
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
	"mal_id",
];

function ownedLines(key: AnimeOwnedKey, anime: AnimeMetadata): string[] {
	switch (key) {
		case "title":
			return [`title: ${yamlString(anime.title)}`];
		case "english_title":
			return [yamlOptionalString("english_title", anime.englishTitle)];
		case "japanese_title":
			return [yamlOptionalString("japanese_title", anime.japaneseTitle)];
		case "media_type":
			return [yamlOptionalString("media_type", anime.mediaType)];
		case "episodes":
			return [yamlNumber("episodes", anime.episodes)];
		case "genres":
			return yamlList("genres", anime.genres);
		case "studios":
			return yamlList("studios", anime.studios);
		case "status":
			return [yamlOptionalString("status", anime.status)];
		case "year":
			return [yamlNumber("year", anime.year)];
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
 * The manga block's own top-level key (see manga-note.ts). When this
 * function merges anime fields onto a manga-only Series note, every new key
 * is inserted right before it, so the merged note ends up in the same
 * canonical order as an anime-first note (manga block last) regardless of
 * which side was added first.
 */
const MANGA_BLOCK_KEY = "manga";

/**
 * Sets an owned key's lines. A key that already exists in `doc.order` is
 * left exactly where it is (refreshing an existing anime note never
 * reorders anything); a brand-new key is inserted right before the `manga`
 * block if one is present, otherwise appended at the end.
 */
function setOwnedKey(
	doc: { order: string[]; blocks: Map<string, string[]> },
	key: string,
	lines: string[],
): void {
	doc.blocks.set(key, lines);
	if (doc.order.includes(key)) return;

	const mangaIndex = doc.order.indexOf(MANGA_BLOCK_KEY);
	if (mangaIndex === -1) doc.order.push(key);
	else doc.order.splice(mangaIndex, 0, key);
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
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	for (const key of ANIME_OWNED_KEYS) {
		if (key === "mal_id" && !doc.order.includes("poster")) {
			setOwnedKey(doc, "poster", [posterLine(null)]);
		}
		setOwnedKey(doc, key, ownedLines(key, anime));
	}

	if (newPosterLink !== null && isEmptyValue(doc.blocks.get("poster"))) {
		doc.blocks.set("poster", [posterLine(newPosterLink)]);
	}

	if (!doc.order.includes("watched")) {
		setOwnedKey(doc, "watched", ["watched: false"]);
	}

	return serializeFrontmatterBlocks(doc);
}
