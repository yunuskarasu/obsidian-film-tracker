import type { MangaMetadata } from "./mal";
import {
	formatNames,
	keepLinks,
	parseFrontmatterBlocks,
	posterLine,
	serializeFrontmatterBlocks,
	yamlList,
	yamlScalar,
} from "./note";

const BLOCK_KEY = "manga";
const INDENT = "  ";

/**
 * Reads `manga.mal_id` out of a note's already-parsed frontmatter, if
 * present — the manga side of a Series note, which `classifyNote` (see
 * note-kind.ts) uses to tell a manga-only Series note, an anime+manga merge
 * and a plain anime-only note apart.
 */
export function mangaMalIdFrom(frontmatter: Record<string, unknown> | undefined): number | null {
	const manga = frontmatter?.manga;
	if (typeof manga !== "object" || manga === null) return null;
	const id: unknown = (manga as Record<string, unknown>).mal_id;
	return typeof id === "number" ? id : null;
}

/**
 * Reads a note's own top-level `mal_id` — an anime's own id, or a mangaka's
 * own MAL person id. Which of the two it is comes from `classifyNote`.
 */
export function malIdFrom(frontmatter: Record<string, unknown> | undefined): number | null {
	const id: unknown = frontmatter?.mal_id;
	return typeof id === "number" ? id : null;
}

/** `read` is a real YAML boolean, written as a raw literal — never run through `yamlString`, which would quote it as text. */
function readLine(read: boolean): string {
	return `${INDENT}read: ${read ? "true" : "false"}`;
}

/** Reads one `key: value` sub-line's raw value out of an existing `manga:` block, if present. */
function readSubValue(blockLines: string[] | undefined, key: string): string | null {
	if (blockLines === undefined) return null;
	const line = blockLines.find((raw) => raw.trim().startsWith(`${key}:`));
	if (line === undefined) return null;
	const value = line.slice(line.indexOf(":") + 1).trim();
	return value === "" ? null : value;
}

/**
 * The index of the block's own `read:` line. A `read:` nested deeper — under
 * a sub-field the user added — is theirs and never counts.
 */
function readLineIndex(blockLines: string[]): number {
	return blockLines.findIndex((line) => mangaSubKey(line) === "read");
}

function existingRead(blockLines: string[] | undefined): boolean {
	if (blockLines === undefined) return false;
	const index = readLineIndex(blockLines);
	if (index === -1) return false;
	const line = blockLines[index];
	return /^true$/i.test(line.slice(line.indexOf(":") + 1).trim());
}

function existingPosterLine(blockLines: string[] | undefined): string | null {
	const value = readSubValue(blockLines, "poster");
	return value === null ? null : `${INDENT}poster: ${value}`;
}

/** Sub-fields under `manga:` that this plugin owns and rewrites on every refresh. */
const MANGA_KNOWN_SUBKEYS = new Set([
	"mal_id",
	"title",
	"media_type",
	"status",
	"year",
	"end_year",
	"chapters",
	"volumes",
	"mangaka",
	"poster",
	"read",
]);

/** Sub-key of one raw line inside a `manga:` block, the same one-level-deeper version of `topLevelKey` in note.ts: a line belongs to a new sub-field only if it sits exactly at the block's own indent and isn't a nested list item. */
function mangaSubKey(line: string): string | null {
	if (!line.startsWith(INDENT)) return null;
	const rest = line.slice(INDENT.length);
	if (rest === "" || /^[\s#-]/.test(rest)) return null;
	const colon = rest.indexOf(":");
	return colon > 0 ? rest.slice(0, colon).trim() : null;
}

/**
 * Any sub-field under an existing `manga:` block that this plugin doesn't
 * own — a field the user hand-added (e.g. `rating`, `tags`). Returned as
 * raw lines, in their original relative order, so `applyMangaBlock` can
 * append them back untouched instead of silently dropping them.
 */
function unknownSubLines(blockLines: string[] | undefined): string[] {
	if (blockLines === undefined) return [];

	const extra: string[] = [];
	let keep = false;
	for (const line of blockLines.slice(1)) {
		const key = mangaSubKey(line);
		if (key !== null) keep = !MANGA_KNOWN_SUBKEYS.has(key);
		if (keep) extra.push(line);
	}
	return extra;
}

function buildBlockLines(
	manga: MangaMetadata,
	mangakaNames: string[],
	posterLink: string | null,
	read: boolean,
): string[] {
	return [
		`${BLOCK_KEY}:`,
		yamlScalar("mal_id", manga.malId, INDENT),
		yamlScalar("title", manga.title, INDENT),
		yamlScalar("media_type", manga.mediaType, INDENT),
		yamlScalar("status", manga.status, INDENT),
		yamlScalar("year", manga.year, INDENT),
		yamlScalar("end_year", manga.endYear, INDENT),
		yamlScalar("chapters", manga.chapters, INDENT),
		yamlScalar("volumes", manga.volumes, INDENT),
		...yamlList("mangaka", mangakaNames, INDENT),
		posterLine(posterLink, INDENT),
		readLine(read),
	];
}

/**
 * Creates or refreshes the `manga:` block on a Series note. `read` and an
 * already-saved poster are preserved exactly, the same "never overwrite what
 * the user (or a previous run) already set" rule the anime side and the
 * top-level poster follow; every other plugin-owned sub-field is rewritten
 * fresh from MAL. Any sub-field the plugin doesn't know about — the user
 * hand-adding something like `manga.rating` — is kept as-is, appended after
 * the plugin-owned ones, instead of being silently dropped.
 *
 * Works on a brand-new empty skeleton (`"---\n---\n"`) just as well as on an
 * existing note, so "create" and "refresh" are the same call — the top-level
 * anime fields and the body are never touched.
 */
export function applyMangaBlock(
	content: string,
	manga: MangaMetadata,
	newPosterLink: string | null,
	isResolved: (name: string) => boolean,
	previous?: Record<string, unknown>,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	const existingBlock = doc.blocks.get(BLOCK_KEY);
	const read = existingRead(existingBlock);
	const previousManga: unknown = previous?.manga;
	const mangakaNames = keepLinks(
		formatNames(
			manga.mangaka.map((author) => author.name),
			isResolved,
		),
		typeof previousManga === "object" && previousManga !== null
			? (previousManga as Record<string, unknown>).mangaka
			: undefined,
	);
	const preservedPoster = existingPosterLine(existingBlock);
	const lines = buildBlockLines(manga, mangakaNames, null, read);
	const extra = unknownSubLines(existingBlock);

	const finalLines = [
		...(preservedPoster !== null
			? lines.map((line) => (line.trim().startsWith("poster:") ? preservedPoster : line))
			: newPosterLink !== null
				? lines.map((line) => (line.trim().startsWith("poster:") ? posterLine(newPosterLink, INDENT) : line))
				: lines),
		...extra,
	];

	doc.blocks.set(BLOCK_KEY, finalLines);
	if (!doc.order.includes(BLOCK_KEY)) doc.order.push(BLOCK_KEY);

	return serializeFrontmatterBlocks(doc);
}

/**
 * Replaces the whole `manga:` block with a different manga — the fix for a
 * Series note that ended up linked to the wrong one. Unlike
 * `applyMangaBlock`, nothing from the old block is carried over: `read`
 * starts at false and the poster is the new manga's, because every one of
 * those values described a different work. Sub-fields the user hand-added
 * under `manga` go with it for the same reason.
 *
 * Everything outside the block is untouched — the anime fields, the note's
 * own poster, `watched`, any property the user added, the body, and the
 * position `manga:` already holds in the frontmatter.
 */
export function replaceMangaBlock(
	content: string,
	manga: MangaMetadata,
	posterLink: string | null,
	isResolved: (name: string) => boolean,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	const mangakaNames = formatNames(
		manga.mangaka.map((author) => author.name),
		isResolved,
	);
	doc.blocks.set(BLOCK_KEY, buildBlockLines(manga, mangakaNames, posterLink, false));
	if (!doc.order.includes(BLOCK_KEY)) doc.order.push(BLOCK_KEY);

	return serializeFrontmatterBlocks(doc);
}

/**
 * Drops the `manga:` block entirely, leaving an anime+manga Series note as
 * the anime-only note it was before the merge. Only that one top-level key
 * is removed: the anime fields, poster, `watched`, every other property and
 * the body all stay exactly as they are.
 */
export function removeMangaBlock(content: string): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null || !doc.blocks.has(BLOCK_KEY)) return content;

	doc.blocks.delete(BLOCK_KEY);
	doc.order = doc.order.filter((key) => key !== BLOCK_KEY);

	return serializeFrontmatterBlocks(doc);
}

/**
 * Rewrites just the `manga.mangaka` list in place — the exact same
 * `formatNames`/`isResolved` rule `applyMangaBlock` already applies to a
 * freshly-fetched manga, without touching MAL or any other sub-field. Used
 * to catch up OTHER notes when a mangaka note is created elsewhere in the
 * vault: `currentNames` is whatever the note's `manga.mangaka` already holds
 * (read from parsed frontmatter by the caller, the same way `relinkAll`
 * reads a film's `directors` before calling `relinkFrontmatter`), so a name
 * already linked, or one that still doesn't resolve, is left exactly as is.
 */
export function relinkMangaka(
	content: string,
	currentNames: string[],
	isResolved: (name: string) => boolean,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	const block = doc.blocks.get(BLOCK_KEY);
	if (block === undefined) return content;

	const rebuilt: string[] = [];
	let skipping = false;
	let replaced = false;
	for (const line of block) {
		const key = mangaSubKey(line);
		if (key !== null) {
			skipping = key === "mangaka";
			if (skipping) {
				rebuilt.push(...yamlList("mangaka", formatNames(currentNames, isResolved), INDENT));
				replaced = true;
				continue;
			}
		}
		if (!skipping) rebuilt.push(line);
	}
	if (!replaced) return content;

	doc.blocks.set(BLOCK_KEY, rebuilt);
	return serializeFrontmatterBlocks(doc);
}

/**
 * Sets `manga.read` — what the MANGA panel's Read checkbox writes, to every
 * note that carries the same manga (see main.ts). An explicit value rather
 * than a flip, so notes that disagreed end up agreeing, and two quick clicks
 * can't leave the file and the checkbox out of step. Only the block's own
 * `read:` line is written (see `readLineIndex`); a block that lost it gets it
 * back. Every other sub-field, the rest of the frontmatter and the body are
 * untouched.
 */
export function setMangaRead(content: string, read: boolean): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	const block = doc.blocks.get(BLOCK_KEY);
	if (block === undefined) return content;

	const updated = [...block];
	const index = readLineIndex(updated);
	if (index === -1) updated.push(readLine(read));
	else updated[index] = readLine(read);

	doc.blocks.set(BLOCK_KEY, updated);
	return serializeFrontmatterBlocks(doc);
}
