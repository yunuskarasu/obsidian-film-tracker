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

/**
 * "Title (Year)". A title that already ends in its own year keeps it once:
 * MyAnimeList tells a remake apart by writing the year into the title itself
 * ("Hunter x Hunter (2011)"), which used to come out as "(2011) (2011)".
 */
export function buildFileName(title: string, year: number | null): string {
	if (year === null || title.trimEnd().endsWith(`(${year})`)) return sanitizeFileName(title);
	return sanitizeFileName(`${title} (${year})`);
}

/** Extracts the target of a `[[link]]` or `[[link|alias]]` value. */
export function parseWikilink(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const match = value.trim().match(/^\[\[([^\]|]+)(\|[^\]]*)?\]\]$/);
	return match === null ? null : match[1].trim();
}

/**
 * The file a poster property points at, however its link was written. The
 * plugin writes wikilinks, but earlier versions let `generateMarkdownLink`
 * decide, and with Obsidian's "Use [[Wikilinks]]" setting turned off that
 * produced a Markdown link — `[x.jpg](Attachments/Am%C3%A9lie%20(2001).jpg)` —
 * which `parseWikilink` alone never recognized, so the poster never showed.
 */
export function parseLinkTarget(value: unknown): string | null {
	const wikilink = parseWikilink(value);
	if (wikilink !== null) return wikilink;
	if (typeof value !== "string") return null;

	const match = value.trim().match(/^!?\[[^\]]*\]\((.+)\)$/);
	if (match === null) return null;

	let target = match[1].trim();
	if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1).trim();
	try {
		target = decodeURI(target);
	} catch {
		// A stray "%" that starts no escape sequence: use the path as written.
	}
	return target === "" ? null : target;
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

/**
 * Refresh never unwraps a link: a name the list had as a link before —
 * `previous` is what it held — stays one, written exactly as it was, alias
 * and all. That holds with its "Link …" setting off, and for a link whose
 * note doesn't exist yet. Every other name is left as `names` has it.
 */
export function keepLinks(names: string[], previous: unknown): string[] {
	const linked = new Map<string, string>();
	for (const value of listValues(previous)) {
		const target = parseWikilink(value);
		if (target !== null) linked.set(linkKey(target), value);
	}
	if (linked.size === 0) return names;
	return names.map((name) => linked.get(linkKey(parseWikilink(name) ?? name)) ?? name);
}

/** What a name and a link to its note have in common, however the link spells the path, heading or case. */
function linkKey(target: string): string {
	const path = target.split("#")[0];
	const name = path.slice(path.lastIndexOf("/") + 1).replace(/.md$/i, "");
	return name.replace(WIKILINK_BREAKERS, "").trim().toLowerCase();
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

/**
 * `key: value`, quoted when YAML needs it, or a bare `key:` for no value.
 * `indent` places the line under a parent key, the way a Series note's
 * `manga:` block holds its own fields.
 */
export function yamlScalar(key: string, value: string | number | null, indent = ""): string {
	if (value === null) return `${indent}${key}:`;
	return `${indent}${key}: ${typeof value === "number" ? value : yamlString(value)}`;
}

/** A list under `key`, one item per line, or a bare `key:` when there are none. */
export function yamlList(key: string, values: string[], indent = ""): string[] {
	if (values.length === 0) return [`${indent}${key}:`];
	return [`${indent}${key}:`, ...values.map((value) => `${indent}  - ${yamlString(value)}`)];
}

/** The `poster` property: a film's or an anime's poster, a person's photo, or the manga side's own cover. */
export function posterLine(posterLink: string | null, indent = ""): string {
	return yamlScalar("poster", posterLink, indent);
}

/** Aliases for the note: title and original title, deduped and with blanks dropped. */
export function buildAliases(title: string, originalTitle: string | null): string[] {
	const names = [title, originalTitle].filter(
		(name): name is string => !!name && name.trim().length > 0,
	);
	return [...new Set(names.map((name) => name.trim()))];
}

/**
 * A list property's items as text, from the value Obsidian parsed: a lone
 * value counts as a one-item list, and an item YAML read as a number or a
 * boolean (an unquoted `- 2001`) is kept as its text rather than dropped.
 */
export function listValues(value: unknown): string[] {
	const items: unknown[] = Array.isArray(value) ? value : [value];
	return items
		.filter(
			(item): item is string | number | boolean =>
				typeof item === "string" || typeof item === "number" || typeof item === "boolean",
		)
		.map((item) => String(item).trim())
		.filter((item) => item !== "");
}

/**
 * The `aliases` a refresh writes: the freshly generated ones first, then
 * every alias the user added, in their own order. `replaced` is what the
 * plugin generated last time (the old title and original title), dropped
 * so that a title TMDB has since changed doesn't linger — anything else in
 * the list belongs to the user and is always kept.
 */
export function mergeAliases(generated: string[], existing: string[], replaced: string[]): string[] {
	const dropped = new Set(replaced);
	return [...new Set([...generated, ...existing.filter((alias) => !dropped.has(alias))])];
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

function ownedLines(
	key: OwnedKey,
	film: FilmMetadata,
	links: LinkOptions,
	previous?: Record<string, unknown>,
): string[] {
	// A list as the note shows it: linked where its setting says, and on a
	// refresh never unlinked (see `keepLinks`).
	const names = (list: "directors" | "genres" | "cast" | "composers", values: string[], link: boolean) =>
		yamlList(list, keepLinks(link ? formatNames(values, links.isResolved) : values, previous?.[list]));
	switch (key) {
		case "title":
			return [`title: ${yamlString(film.title)}`];
		case "original_title":
			return [`original_title: ${yamlString(film.originalTitle)}`];
		case "aliases":
			return yamlList("aliases", buildAliases(film.title, film.originalTitle));
		case "year":
			return [yamlScalar("year", film.year)];
		case "directors":
			return names("directors", film.directors, links.directors);
		case "genres":
			return names("genres", film.genres, links.genres);
		case "cast":
			return names("cast", film.cast.slice(0, links.castCount), links.cast);
		case "composers":
			return names("composers", film.composers, links.composers);
		case "runtime":
			return [yamlScalar("runtime", film.runtime)];
		case "tmdb_id":
			return [`tmdb_id: ${film.tmdbId}`];
	}
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
	/**
	 * Whatever comes before the first key — a comment, a blank line — kept
	 * as it is and written back first.
	 */
	preamble: string[];
	order: string[];
	blocks: Map<string, string[]>;
	body: string;
	/** The line ending the frontmatter was written with, restored on the way back out. */
	eol: "\n" | "\r\n";
}

function topLevelKey(line: string): string | null {
	if (line === "" || /^[\s#-]/.test(line)) return null;
	const colon = line.indexOf(":");
	return colon > 0 ? line.slice(0, colon).trim() : null;
}

function withoutCarriageReturn(line: string): string {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/**
 * Splits a note into its top-level frontmatter blocks and its body, keeping
 * every raw line. Rewriting one block therefore leaves every other key — and
 * the body — byte for byte identical, which is what lets a refresh touch only
 * the fields the plugin owns.
 *
 * A note saved with Windows (CRLF) line endings — by another editor, or by
 * git's `core.autocrlf` — is read the same way: the frontmatter lines are held
 * without their `\r`, `eol` remembers which ending to write them back with,
 * and the body keeps its own line endings untouched.
 */
export function parseFrontmatterBlocks(content: string): FrontmatterDoc | null {
	const lines = content.split("\n");
	if (withoutCarriageReturn(lines[0]) !== "---") return null;

	const end = lines.findIndex((line, index) => index > 0 && withoutCarriageReturn(line) === "---");
	if (end === -1) return null;

	const preamble: string[] = [];
	const order: string[] = [];
	const blocks = new Map<string, string[]>();
	let current: string | null = null;

	for (const raw of lines.slice(1, end)) {
		const line = withoutCarriageReturn(raw);
		const key = topLevelKey(line);
		if (key !== null) {
			current = key;
			order.push(key);
			blocks.set(key, [line]);
		} else if (current !== null) {
			blocks.get(current)?.push(line);
		} else {
			preamble.push(line);
		}
	}

	return {
		preamble,
		order,
		blocks,
		body: lines.slice(end + 1).join("\n"),
		eol: lines[0].endsWith("\r") ? "\r\n" : "\n",
	};
}

export function serializeFrontmatterBlocks(doc: FrontmatterDoc): string {
	const lines: string[] = ["---", ...doc.preamble];
	for (const key of doc.order) {
		lines.push(...(doc.blocks.get(key) ?? []));
	}
	lines.push("---");
	return `${lines.join(doc.eol)}${doc.eol}${doc.body}`;
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
 *
 * `previous` is the note's frontmatter as Obsidian parsed it before this
 * refresh. `aliases` is a list the user adds to as well, so with `previous`
 * only the aliases the plugin wrote (the old title and original title) are
 * replaced and every other alias is kept — see `mergeAliases`. Without it
 * there is nothing to tell the two apart by, and the list is rebuilt from
 * TMDB alone.
 */
export function refreshFrontmatter(
	content: string,
	film: FilmMetadata,
	links: LinkOptions = NO_LINKS,
	newPosterLink: string | null = null,
	previous?: Record<string, unknown>,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	for (const key of ownedKeysFor(links)) {
		doc.blocks.set(key, ownedLines(key, film, links, previous));
		if (!doc.order.includes(key)) doc.order.push(key);
	}

	if (previous !== undefined) {
		const aliases = mergeAliases(
			buildAliases(film.title, film.originalTitle),
			listValues(previous.aliases),
			[...listValues(previous.title), ...listValues(previous.original_title)],
		);
		doc.blocks.set("aliases", yamlList("aliases", aliases));
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

/**
 * Ticks `watched` — what the Letterboxd import does for a film its export
 * says was seen. It only ever turns the checkbox on: a note already ticked
 * comes back unchanged, and nothing here ever unticks one.
 */
export function markWatched(content: string): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	const block = doc.blocks.get("watched");
	if (block !== undefined && /^true$/i.test(block[0].slice(block[0].indexOf(":") + 1).trim())) {
		return content;
	}

	doc.blocks.set("watched", ["watched: true"]);
	if (!doc.order.includes("watched")) doc.order.push("watched");

	return serializeFrontmatterBlocks(doc);
}

export function joinPath(folder: string, name: string): string {
	const trimmed = folder.trim();
	return normalizePath(trimmed === "" ? name : `${trimmed}/${name}`);
}

/**
 * Who holds a path a new note might take: nobody, another of the plugin's
 * own notes, or some other note (the user's own, most likely).
 */
export type PathOccupant = "free" | "plugin" | "other";

export type NotePathChoice = { path: string } | { conflict: string };

/**
 * Where a new note goes, trying `names` (without ".md") in order. A name
 * held by another of the plugin's notes means a different work with the same
 * title — the same work would already have been found by its id — so the
 * next name is tried, and past the last one a numbered version of it
 * ("Title (2011) 2"). A name held by any other note comes back as a conflict
 * instead: that note may be the user's own on this very work, and the plugin
 * never writes a second one beside it. Numbered names are the plugin's own
 * scheme, so there any occupant is simply stepped over.
 */
export function chooseNotePath(
	folder: string,
	names: string[],
	occupant: (path: string) => PathOccupant,
): NotePathChoice {
	for (const name of names) {
		const path = joinPath(folder, `${name}.md`);
		const held = occupant(path);
		if (held === "free") return { path };
		if (held === "other") return { conflict: path };
	}

	const last = names[names.length - 1];
	let index = 2;
	while (occupant(joinPath(folder, `${last} ${index}.md`)) !== "free") index += 1;
	return { path: joinPath(folder, `${last} ${index}.md`) };
}
