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

/**
 * The order a freshly written `manga:` block puts its sub-fields in. A
 * sub-field the block doesn't have yet is placed by this list, the same
 * neighbour rule the anime side's fields follow.
 */
const MANGA_SUBKEY_ORDER: readonly string[] = [
	"mal_id",
	"title",
	"media_type",
	"status",
	"year",
	"end_year",
	"chapters",
	"chapters_read",
	"volumes",
	"mangaka",
	"poster",
	"read",
	"read_date",
];

/** Sub-fields under `manga:` that this plugin owns and rewrites on every refresh. */
const MANGA_KNOWN_SUBKEYS = new Set(MANGA_SUBKEY_ORDER);

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

/**
 * Where a sub-field the block doesn't have yet goes: right before the first
 * one that comes after it in `MANGA_SUBKEY_ORDER`, so `chapters_read` added
 * to an older block lands beside `chapters` rather than at the end. A
 * sub-field of the user's own is stepped over, never reordered.
 */
function subInsertionIndex(blockLines: string[], key: string): number {
	const canonical = MANGA_SUBKEY_ORDER.indexOf(key);
	if (canonical !== -1) {
		for (let index = 1; index < blockLines.length; index += 1) {
			const other = MANGA_SUBKEY_ORDER.indexOf(mangaSubKey(blockLines[index]) ?? "");
			if (other > canonical) return index;
		}
	}
	return blockLines.length;
}

/** Writes one sub-field's line, in place where it exists and in canonical order where it doesn't. `null` takes it out. */
function setSubLine(blockLines: string[], key: string, line: string | null): string[] {
	const lines = [...blockLines];
	const index = lines.findIndex((raw) => mangaSubKey(raw) === key);
	if (index !== -1) {
		if (line === null) lines.splice(index, 1);
		else lines[index] = line;
		return lines;
	}

	if (line !== null) lines.splice(subInsertionIndex(lines, key), 0, line);
	return lines;
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

	let finalLines = [
		...(preservedPoster !== null
			? lines.map((line) => (line.trim().startsWith("poster:") ? preservedPoster : line))
			: newPosterLink !== null
				? lines.map((line) => (line.trim().startsWith("poster:") ? posterLine(newPosterLink, INDENT) : line))
				: lines),
		...extra,
	];

	// How far the reader has got, and when they finished: theirs, like `read`,
	// so a refresh carries them over rather than writing them fresh from MAL.
	for (const key of ["chapters_read", "read_date"]) {
		const value = readSubValue(existingBlock, key);
		if (value !== null) finalLines = setSubLine(finalLines, key, `${INDENT}${key}: ${value}`);
	}

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
 * back. Ticking also fills in `read_date` and `chapters_read` where the
 * caller supplies them, and unticking clears the date — a finishing date
 * describes something that is no longer true. Every other sub-field, the rest
 * of the frontmatter and the body are untouched.
 */
export function setMangaRead(content: string, read: boolean, options: MangaReadOptions = {}): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	const block = doc.blocks.get(BLOCK_KEY);
	if (block === undefined) return content;

	let updated = setSubLine(block, "read", readLine(read));
	if (read) {
		// An existing date is the day it was first finished — kept, the way a
		// film's `watch_date` is, so rereading doesn't overwrite it.
		const date = options.date ?? null;
		if (date !== null && readSubValue(updated, "read_date") === null) {
			updated = setSubLine(updated, "read_date", `${INDENT}read_date: ${date}`);
		}
		const chapters = options.chapters ?? null;
		if (chapters !== null) {
			updated = setSubLine(updated, "chapters_read", yamlScalar("chapters_read", chapters, INDENT));
		}
	} else {
		// Unticked again: a finishing date describes something that is no
		// longer true. How far the reader got is left alone.
		updated = setSubLine(updated, "read_date", null);
	}

	doc.blocks.set(BLOCK_KEY, updated);
	return serializeFrontmatterBlocks(doc);
}

/** What `setMangaRead` writes beside `read` when it is being ticked. */
export interface MangaReadOptions {
	/** The day it was finished, written to `read_date` — but never over one already there. */
	date?: string | null;
	/** The manga's length: given, finishing it fills `chapters_read` in too. */
	chapters?: number | null;
}

/**
 * How far through a manga the note says it is. `chapters_read` is the
 * reader's own count, which a refresh carries over untouched, and `chapters`
 * is MAL's length — `null` for anything still being published.
 */
export interface MangaProgress {
	read: number;
	chapters: number | null;
	done: boolean;
}

export function mangaProgressOf(frontmatter: Record<string, unknown> | undefined): MangaProgress {
	const manga = frontmatter?.manga;
	const block = typeof manga === "object" && manga !== null ? (manga as Record<string, unknown>) : {};
	const count = (value: unknown) =>
		typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
	return {
		read: count(block.chapters_read) ?? 0,
		chapters: count(block.chapters),
		done: block.read === true,
	};
}

/**
 * Sets `chapters_read`. Reaching the last chapter marks the manga read as
 * well, so the chapter that finishes it never leaves the note complete but
 * unticked. The caller syncs that across every note carrying this manga.
 */
export function setMangaProgress(
	content: string,
	read: number,
	chapters: number | null,
	date: string | null,
): string {
	if (chapters !== null && read >= chapters) return setMangaRead(content, true, { date, chapters });

	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	const block = doc.blocks.get(BLOCK_KEY);
	if (block === undefined) return content;

	doc.blocks.set(BLOCK_KEY, setSubLine(block, "chapters_read", yamlScalar("chapters_read", read, INDENT)));
	return serializeFrontmatterBlocks(doc);
}
