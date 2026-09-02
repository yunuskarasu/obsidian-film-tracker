import { normalizePath } from "obsidian";

export interface FilmMetadata {
	title: string;
	originalTitle: string;
	year: number | null;
	directors: string[];
	genres: string[];
	cast: string[];
	composers: string[];
	runtime: number | null;
	tmdbId: number;
	posterPath: string | null;
}

/**
 * Which name fields become wikilinks, whether the optional cast/composers
 * fields are written at all, and how to tell whether a note exists.
 */
export interface LinkOptions {
	directors: boolean;
	genres: boolean;
	cast: boolean;
	composers: boolean;
	addCast: boolean;
	addComposers: boolean;
	castCount: number;
	isResolved: (name: string) => boolean;
}

export const NO_LINKS: LinkOptions = {
	directors: false,
	genres: false,
	cast: false,
	composers: false,
	addCast: false,
	addComposers: false,
	castCount: 0,
	isResolved: () => false,
};

const WIKILINK_BREAKERS = /[[\]#^|]/g;
const FILESYSTEM_ILLEGAL = /[/\\:*?"<>]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const YAML_KEYWORDS = /^(true|false|null|yes|no|on|off|~)$/i;

export function sanitizeFileName(name: string): string {
	const cleaned = name
		.replace(WIKILINK_BREAKERS, "")
		.replace(FILESYSTEM_ILLEGAL, " ")
		.replace(/\s+/g, " ")
		.replace(/^[.\s]+/, "")
		.replace(/[.\s]+$/, "");

	if (!cleaned) return "Untitled";
	return WINDOWS_RESERVED.test(cleaned) ? `${cleaned}_` : cleaned;
}

export function buildFileName(title: string, year: number | null): string {
	return sanitizeFileName(year === null ? title : `${title} (${year})`);
}

/** Extracts the target of a `[[link]]` or `[[link|alias]]` value. */
export function parseWikilink(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const match = value.trim().match(/^\[\[([^\]|]+)(\|[^\]]*)?\]\]$/);
	return match === null ? null : match[1].trim();
}

/**
 * Turns names into wikilinks, but only where a note by that name already
 * exists. Names already written as links are left alone.
 */
export function formatNames(names: string[], isResolved: (name: string) => boolean): string[] {
	return names.map((name) => {
		if (parseWikilink(name) !== null) return name;
		const target = name.replace(WIKILINK_BREAKERS, "").trim();
		return target !== "" && isResolved(target) ? `[[${target}]]` : name;
	});
}

export function needsQuoting(value: string): boolean {
	if (value === "") return true;
	if (/^\s|\s$/.test(value)) return true;
	if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return true;
	if (value.includes(": ") || value.includes(" #") || value.endsWith(":")) return true;
	if (YAML_KEYWORDS.test(value)) return true;
	return !Number.isNaN(Number(value));
}

function quote(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function yamlString(value: string): string {
	return needsQuoting(value) ? quote(value) : value;
}

function yamlList(key: string, values: string[]): string[] {
	if (values.length === 0) return [`${key}:`];
	return [`${key}:`, ...values.map((value) => `  - ${yamlString(value)}`)];
}

function yamlNumber(key: string, value: number | null): string {
	return value === null ? `${key}:` : `${key}: ${value}`;
}

/** Aliases for the note: title and original title, deduped and with blanks dropped. */
export function buildAliases(title: string, originalTitle: string | null): string[] {
	const names = [title, originalTitle].filter(
		(name): name is string => !!name && name.trim().length > 0,
	);
	return [...new Set(names.map((name) => name.trim()))];
}

/** Fields the plugin owns: refreshing rewrites these and nothing else. */
export type OwnedKey =
	| "title"
	| "original_title"
	| "aliases"
	| "year"
	| "directors"
	| "genres"
	| "cast"
	| "composers"
	| "runtime"
	| "tmdb_id";

export const OWNED_KEYS: readonly OwnedKey[] = [
	"title",
	"original_title",
	"aliases",
	"year",
	"directors",
	"genres",
	"runtime",
	"tmdb_id",
];

/**
 * `cast` and `composers` are optional: unlike the fields above, they are only
 * owned (added, and rewritten on refresh) while their setting is on. Turning
 * a setting off leaves whatever is already in the note untouched.
 */
function ownedKeysFor(links: LinkOptions): OwnedKey[] {
	const keys = [...OWNED_KEYS];
	if (links.addCast) keys.push("cast");
	if (links.addComposers) keys.push("composers");
	return keys;
}

function ownedLines(key: OwnedKey, film: FilmMetadata, links: LinkOptions): string[] {
	switch (key) {
		case "title":
			return [`title: ${yamlString(film.title)}`];
		case "original_title":
			return [`original_title: ${yamlString(film.originalTitle)}`];
		case "aliases":
			return yamlList("aliases", buildAliases(film.title, film.originalTitle));
		case "year":
			return [yamlNumber("year", film.year)];
		case "directors":
			return yamlList(
				"directors",
				links.directors ? formatNames(film.directors, links.isResolved) : film.directors,
			);
		case "genres":
			return yamlList(
				"genres",
				links.genres ? formatNames(film.genres, links.isResolved) : film.genres,
			);
		case "cast": {
			const cast = film.cast.slice(0, links.castCount);
			return yamlList("cast", links.cast ? formatNames(cast, links.isResolved) : cast);
		}
		case "composers":
			return yamlList(
				"composers",
				links.composers ? formatNames(film.composers, links.isResolved) : film.composers,
			);
		case "runtime":
			return [yamlNumber("runtime", film.runtime)];
		case "tmdb_id":
			return [`tmdb_id: ${film.tmdbId}`];
	}
}

function posterLine(posterLink: string | null): string {
	return posterLink === null ? "poster:" : `poster: ${quote(posterLink)}`;
}

export function buildFrontmatter(
	film: FilmMetadata,
	posterLink: string | null,
	links: LinkOptions = NO_LINKS,
): string {
	const lines = [
		"---",
		...ownedLines("title", film, links),
		...ownedLines("original_title", film, links),
		...ownedLines("aliases", film, links),
		...ownedLines("year", film, links),
		...ownedLines("directors", film, links),
		...ownedLines("genres", film, links),
	];
	if (links.addCast) lines.push(...ownedLines("cast", film, links));
	if (links.addComposers) lines.push(...ownedLines("composers", film, links));
	lines.push(
		...ownedLines("runtime", film, links),
		posterLine(posterLink),
		...ownedLines("tmdb_id", film, links),
		"watch_date:",
		"watched: false",
		"---",
	);
	return lines.join("\n");
}

/**
 * The body is left empty on purpose: the poster is rendered from the `poster`
 * property next to the note's properties, so everything below belongs to the
 * user.
 */
export function buildNoteContent(
	film: FilmMetadata,
	rawPosterLink: string | null,
	links: LinkOptions = NO_LINKS,
): string {
	const link = rawPosterLink === null ? null : rawPosterLink.replace(/^!/, "");
	return `${buildFrontmatter(film, link, links)}\n`;
}

interface FrontmatterDoc {
	order: string[];
	blocks: Map<string, string[]>;
	body: string;
}

function topLevelKey(line: string): string | null {
	if (line === "" || /^[\s#-]/.test(line)) return null;
	const colon = line.indexOf(":");
	return colon > 0 ? line.slice(0, colon).trim() : null;
}

/**
 * Splits a note into its top-level frontmatter blocks and its body, keeping
 * every raw line. Rewriting one block therefore leaves every other key — and
 * the body — byte for byte identical, which is what lets a refresh touch only
 * the fields the plugin owns.
 */
export function parseFrontmatterBlocks(content: string): FrontmatterDoc | null {
	const lines = content.split("\n");
	if (lines[0] !== "---") return null;

	const end = lines.indexOf("---", 1);
	if (end === -1) return null;

	const order: string[] = [];
	const blocks = new Map<string, string[]>();
	let current: string | null = null;

	for (const line of lines.slice(1, end)) {
		const key = topLevelKey(line);
		if (key !== null) {
			current = key;
			order.push(key);
			blocks.set(key, [line]);
		} else if (current !== null) {
			blocks.get(current)?.push(line);
		}
	}

	return { order, blocks, body: lines.slice(end + 1).join("\n") };
}

export function serializeFrontmatterBlocks(doc: FrontmatterDoc): string {
	const lines: string[] = ["---"];
	for (const key of doc.order) {
		lines.push(...(doc.blocks.get(key) ?? []));
	}
	lines.push("---");
	return [...lines, doc.body].join("\n");
}

export function isEmptyValue(block: string[] | undefined): boolean {
	if (block === undefined) return true;
	if (block.length > 1) return false;
	const colon = block[0].indexOf(":");
	return block[0].slice(colon + 1).trim() === "";
}

/**
 * Rewrites the plugin-owned fields from fresh API data. `watch_date`, the body
 * and any property the user added are preserved exactly, and so is the order
 * of the existing keys.
 */
export function refreshFrontmatter(
	content: string,
	film: FilmMetadata,
	links: LinkOptions = NO_LINKS,
	newPosterLink: string | null = null,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	for (const key of ownedKeysFor(links)) {
		doc.blocks.set(key, ownedLines(key, film, links));
		if (!doc.order.includes(key)) doc.order.push(key);
	}

	if (newPosterLink !== null && isEmptyValue(doc.blocks.get("poster"))) {
		doc.blocks.set("poster", [posterLine(newPosterLink)]);
		if (!doc.order.includes("poster")) doc.order.push("poster");
	}

	return serializeFrontmatterBlocks(doc);
}

/**
 * Converts plain names in the given list fields into wikilinks where a note by
 * that name now exists. Existing links are never unwrapped.
 */
export function relinkFrontmatter(
	content: string,
	values: Partial<Record<"directors" | "genres" | "cast" | "composers", string[]>>,
	isResolved: (name: string) => boolean,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	for (const [key, names] of Object.entries(values)) {
		if (names === undefined || !doc.order.includes(key)) continue;
		doc.blocks.set(key, yamlList(key, formatNames(names, isResolved)));
	}

	return serializeFrontmatterBlocks(doc);
}

/**
 * Fills in `watch_date` when it is empty; an existing one is never
 * overwritten, the same rule the poster follows on refresh.
 */
export function setWatchDate(content: string, date: string): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;
	if (!isEmptyValue(doc.blocks.get("watch_date"))) return content;

	doc.blocks.set("watch_date", [`watch_date: ${date}`]);
	if (!doc.order.includes("watch_date")) doc.order.push("watch_date");

	return serializeFrontmatterBlocks(doc);
}

export function joinPath(folder: string, name: string): string {
	const trimmed = folder.trim();
	return normalizePath(trimmed === "" ? name : `${trimmed}/${name}`);
}
