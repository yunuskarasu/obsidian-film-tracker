import type { DirectorMetadata } from "./tmdb";
import {
	isEmptyValue,
	listValues,
	mergeAliases,
	parseFrontmatterBlocks,
	posterLine,
	sanitizeFileName,
	serializeFrontmatterBlocks,
	yamlList,
	yamlString,
} from "./note";

export function buildDirectorFileName(name: string): string {
	return sanitizeFileName(name);
}

/** Fields the plugin owns: refreshing rewrites these and nothing else. */
export type DirectorOwnedKey =
	| "name"
	| "original_name"
	| "aliases"
	| "birthday"
	| "deathday"
	| "place_of_birth"
	| "tmdb_id";

export const DIRECTOR_OWNED_KEYS: readonly DirectorOwnedKey[] = [
	"name",
	"original_name",
	"aliases",
	"birthday",
	"deathday",
	"place_of_birth",
	"tmdb_id",
];

function ownedLines(key: DirectorOwnedKey, director: DirectorMetadata): string[] {
	switch (key) {
		case "name":
			return [`name: ${yamlString(director.name)}`];
		case "original_name":
			return director.originalName === null
				? ["original_name:"]
				: [`original_name: ${yamlString(director.originalName)}`];
		case "aliases":
			return yamlList("aliases", director.aliases);
		case "birthday":
			return [`birthday: ${director.birthday ?? ""}`];
		case "deathday":
			return [`deathday: ${director.deathday ?? ""}`];
		case "place_of_birth":
			return director.placeOfBirth === null
				? ["place_of_birth:"]
				: [`place_of_birth: ${yamlString(director.placeOfBirth)}`];
		case "tmdb_id":
			return [`tmdb_id: ${director.tmdbId}`];
	}
}

export function buildDirectorFrontmatter(
	director: DirectorMetadata,
	photoLink: string | null,
): string {
	const lines = [
		"---",
		...ownedLines("name", director),
		...ownedLines("original_name", director),
		...ownedLines("aliases", director),
		...ownedLines("birthday", director),
		...ownedLines("deathday", director),
		...ownedLines("place_of_birth", director),
		posterLine(photoLink),
		...ownedLines("tmdb_id", director),
		"---",
	];
	return lines.join("\n");
}

/**
 * The body is left empty on purpose: the photo is rendered from the `poster`
 * property next to the note's properties, so everything below belongs to the
 * user — the same reasoning as a film note's body.
 */
export function buildDirectorNoteContent(
	director: DirectorMetadata,
	rawPhotoLink: string | null,
): string {
	const link = rawPhotoLink === null ? null : rawPhotoLink.replace(/^!/, "");
	return `${buildDirectorFrontmatter(director, link)}\n`;
}

/**
 * Rewrites the plugin-owned director fields from fresh API data. Any
 * property the user added, and the body, are preserved exactly, and so is
 * the order of the existing keys — same rule as a film note's refresh.
 *
 * `previous` works as it does for a film (see `refreshFrontmatter`): the
 * aliases the user added are kept. What gets replaced is the old `name` and
 * `original_name`, plus any of TMDB's `also_known_as` spellings — the full
 * list an early version of the plugin wrote into `aliases`.
 */
export function refreshDirectorFrontmatter(
	content: string,
	director: DirectorMetadata,
	newPhotoLink: string | null = null,
	previous?: Record<string, unknown>,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	for (const key of DIRECTOR_OWNED_KEYS) {
		doc.blocks.set(key, ownedLines(key, director));
		if (!doc.order.includes(key)) doc.order.push(key);
	}

	if (previous !== undefined) {
		const aliases = mergeAliases(director.aliases, listValues(previous.aliases), [
			...listValues(previous.name),
			...listValues(previous.original_name),
			...director.alsoKnownAs,
		]);
		doc.blocks.set("aliases", yamlList("aliases", aliases));
	}

	if (newPhotoLink !== null && isEmptyValue(doc.blocks.get("poster"))) {
		doc.blocks.set("poster", [posterLine(newPhotoLink)]);
		if (!doc.order.includes("poster")) doc.order.push("poster");
	}

	return serializeFrontmatterBlocks(doc);
}
