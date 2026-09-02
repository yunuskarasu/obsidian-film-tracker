import type { DirectorMetadata } from "./tmdb";
import {
	isEmptyValue,
	parseFrontmatterBlocks,
	sanitizeFileName,
	serializeFrontmatterBlocks,
	yamlString,
} from "./note";

export function buildDirectorFileName(name: string): string {
	return sanitizeFileName(name);
}

function yamlList(key: string, values: string[]): string[] {
	if (values.length === 0) return [`${key}:`];
	return [`${key}:`, ...values.map((value) => `  - ${yamlString(value)}`)];
}

function photoLine(photoLink: string | null): string {
	return photoLink === null ? "poster:" : `poster: ${yamlString(photoLink)}`;
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
		photoLine(photoLink),
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
 */
export function refreshDirectorFrontmatter(
	content: string,
	director: DirectorMetadata,
	newPhotoLink: string | null = null,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	for (const key of DIRECTOR_OWNED_KEYS) {
		doc.blocks.set(key, ownedLines(key, director));
		if (!doc.order.includes(key)) doc.order.push(key);
	}

	if (newPhotoLink !== null && isEmptyValue(doc.blocks.get("poster"))) {
		doc.blocks.set("poster", [photoLine(newPhotoLink)]);
		if (!doc.order.includes("poster")) doc.order.push("poster");
	}

	return serializeFrontmatterBlocks(doc);
}
