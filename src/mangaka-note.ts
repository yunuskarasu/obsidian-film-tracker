import type { MangakaMetadata } from "./mal";
import {
	isEmptyValue,
	parseFrontmatterBlocks,
	sanitizeFileName,
	serializeFrontmatterBlocks,
	yamlString,
} from "./note";

export function buildMangakaFileName(name: string): string {
	return sanitizeFileName(name);
}

function photoLine(photoLink: string | null): string {
	return photoLink === null ? "poster:" : `poster: ${yamlString(photoLink)}`;
}

/**
 * Fields the plugin owns: refreshing rewrites these and nothing else. Kept
 * deliberately smaller than a director's — MAL's `/people/{id}` endpoint
 * only ever returns a name, a birthday and a photo (`alternate_names` and
 * `about` were requested during testing and came back empty), so there is
 * no MAL-sourced equivalent of a director's `original_name`, `aliases`,
 * `deathday` or `place_of_birth` to carry.
 */
export type MangakaOwnedKey = "name" | "birthday" | "mal_id";

export const MANGAKA_OWNED_KEYS: readonly MangakaOwnedKey[] = ["name", "birthday", "mal_id"];

function ownedLines(key: MangakaOwnedKey, mangaka: MangakaMetadata): string[] {
	switch (key) {
		case "name":
			return [`name: ${yamlString(mangaka.name)}`];
		case "birthday":
			return [`birthday: ${mangaka.birthday ?? ""}`];
		case "mal_id":
			return [`mal_id: ${mangaka.malId}`];
	}
}

export function buildMangakaFrontmatter(mangaka: MangakaMetadata, photoLink: string | null): string {
	const lines = [
		"---",
		...ownedLines("name", mangaka),
		...ownedLines("birthday", mangaka),
		photoLine(photoLink),
		...ownedLines("mal_id", mangaka),
		"---",
	];
	return lines.join("\n");
}

/**
 * The body is left empty on purpose: the photo is rendered from the `poster`
 * property next to the note's properties, so everything below belongs to
 * the user — the same reasoning as a film or director note's body.
 */
export function buildMangakaNoteContent(mangaka: MangakaMetadata, rawPhotoLink: string | null): string {
	const link = rawPhotoLink === null ? null : rawPhotoLink.replace(/^!/, "");
	return `${buildMangakaFrontmatter(mangaka, link)}\n`;
}

/**
 * Rewrites the plugin-owned mangaka fields from fresh MAL data. Any property
 * the user added, and the body, are preserved exactly, and so is the order
 * of the existing keys — same rule as a director note's refresh.
 */
export function refreshMangakaFrontmatter(
	content: string,
	mangaka: MangakaMetadata,
	newPhotoLink: string | null = null,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	for (const key of MANGAKA_OWNED_KEYS) {
		doc.blocks.set(key, ownedLines(key, mangaka));
		if (!doc.order.includes(key)) doc.order.push(key);
	}

	if (newPhotoLink !== null && isEmptyValue(doc.blocks.get("poster"))) {
		doc.blocks.set("poster", [photoLine(newPhotoLink)]);
		if (!doc.order.includes("poster")) doc.order.push("poster");
	}

	return serializeFrontmatterBlocks(doc);
}
