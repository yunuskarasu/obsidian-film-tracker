import type { MangaMetadata } from "./mal";
import { formatNames, parseFrontmatterBlocks, serializeFrontmatterBlocks, yamlString } from "./note";

const BLOCK_KEY = "manga";
const INDENT = "  ";

/**
 * Reads `manga.mal_id` out of a note's already-parsed frontmatter, if
 * present — the single source of truth `main.ts` uses to tell a manga-only
 * Series note, an anime+manga merge, and a plain anime-only note apart, and
 * the guard behind the "Add mangaka" command (it only runs when this
 * returns non-null for the active file).
 */
export function mangaMalIdFrom(frontmatter: Record<string, unknown> | undefined): number | null {
	const manga = frontmatter?.manga;
	if (typeof manga !== "object" || manga === null) return null;
	const id: unknown = (manga as Record<string, unknown>).mal_id;
	return typeof id === "number" ? id : null;
}

/** Reads a note's own top-level `mal_id` — an anime's own id, or a mangaka's own MAL person id (see `isAnimeOnlySeriesFrontmatter`). */
export function malIdFrom(frontmatter: Record<string, unknown> | undefined): number | null {
	const id: unknown = frontmatter?.mal_id;
	return typeof id === "number" ? id : null;
}

/**
 * A not-yet-merged anime-only Series note: a top-level `mal_id`, no `manga`
 * block yet — but never a mangaka note. A mangaka note matches that exact
 * same shape, since it deliberately reuses the `mal_id` field name so it can
 * share `findNoteByMalId` with anime — so `isMangakaNote` (folder-scoped,
 * computed by the caller) rules it out here. This is what stops Add
 * anime/Add manga from ever merging into a mangaka note (a real bug: a
 * mangaka note's `mal_id` alone used to be enough to pass this check).
 */
export function isAnimeOnlySeriesFrontmatter(
	frontmatter: Record<string, unknown> | undefined,
	isMangakaNote: boolean,
): boolean {
	return !isMangakaNote && malIdFrom(frontmatter) !== null && mangaMalIdFrom(frontmatter) === null;
}

/** A not-yet-merged manga-only Series note: a `manga` block, no top-level `mal_id` yet — never a mangaka note (see `isAnimeOnlySeriesFrontmatter`). */
export function isMangaOnlySeriesFrontmatter(
	frontmatter: Record<string, unknown> | undefined,
	isMangakaNote: boolean,
): boolean {
	return !isMangakaNote && mangaMalIdFrom(frontmatter) !== null && malIdFrom(frontmatter) === null;
}

function scalarLine(key: string, value: string | number | null, indent = INDENT): string {
	if (value === null) return `${indent}${key}:`;
	return `${indent}${key}: ${typeof value === "number" ? value : yamlString(value)}`;
}

function listLines(key: string, values: string[], indent = INDENT): string[] {
	if (values.length === 0) return [`${indent}${key}:`];
	return [`${indent}${key}:`, ...values.map((value) => `${indent}  - ${yamlString(value)}`)];
}

function posterLine(posterLink: string | null): string {
	return posterLink === null ? `${INDENT}poster:` : `${INDENT}poster: ${yamlString(posterLink)}`;
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

function existingRead(blockLines: string[] | undefined): boolean {
	return readSubValue(blockLines, "read") === "true";
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
		scalarLine("mal_id", manga.malId),
		scalarLine("title", manga.title),
		scalarLine("media_type", manga.mediaType),
		scalarLine("status", manga.status),
		scalarLine("year", manga.year),
		scalarLine("chapters", manga.chapters),
		scalarLine("volumes", manga.volumes),
		...listLines("mangaka", mangakaNames),
		posterLine(posterLink),
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
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	const existingBlock = doc.blocks.get(BLOCK_KEY);
	const read = existingRead(existingBlock);
	const mangakaNames = formatNames(
		manga.mangaka.map((author) => author.name),
		isResolved,
	);
	const preservedPoster = existingPosterLine(existingBlock);
	const lines = buildBlockLines(manga, mangakaNames, null, read);
	const extra = unknownSubLines(existingBlock);

	const finalLines = [
		...(preservedPoster !== null
			? lines.map((line) => (line.trim().startsWith("poster:") ? preservedPoster : line))
			: newPosterLink !== null
				? lines.map((line) => (line.trim().startsWith("poster:") ? posterLine(newPosterLink) : line))
				: lines),
		...extra,
	];

	doc.blocks.set(BLOCK_KEY, finalLines);
	if (!doc.order.includes(BLOCK_KEY)) doc.order.push(BLOCK_KEY);

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
				rebuilt.push(...listLines("mangaka", formatNames(currentNames, isResolved)));
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

/** Flips `manga.read` in place; every other sub-field, the rest of the frontmatter and the body are untouched. */
export function toggleMangaRead(content: string): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	const block = doc.blocks.get(BLOCK_KEY);
	if (block === undefined) return content;

	const next = !existingRead(block);
	const updated = block.map((line) => (line.trim().startsWith("read:") ? readLine(next) : line));
	doc.blocks.set(BLOCK_KEY, updated);
	return serializeFrontmatterBlocks(doc);
}
