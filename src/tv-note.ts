import { parseYaml } from "obsidian";
import {
	buildAliases,
	formatNames,
	isEmptyValue,
	keepLinks,
	listValues,
	mergeAliases,
	needsQuoting,
	parseFrontmatterBlocks,
	posterLine,
	serializeFrontmatterBlocks,
	yamlList,
	yamlScalar,
	yamlString,
	type LinkOptions,
	NO_LINKS,
} from "./note";
import type { TvMetadata, TvSeason } from "./tmdb-tv";

/** Named the way a film note is: "Breaking Bad (2008)". */
export { buildFileName as buildTvFileName } from "./note";

/** Fields the plugin owns: refreshing rewrites these and nothing else. */
export type TvOwnedKey =
	| "title"
	| "original_title"
	| "aliases"
	| "year"
	| "end_year"
	| "creators"
	| "genres"
	| "cast"
	| "networks"
	| "status"
	| "episodes"
	| "tmdb_tv_id";

export const TV_OWNED_KEYS: readonly TvOwnedKey[] = [
	"title",
	"original_title",
	"aliases",
	"year",
	"end_year",
	"creators",
	"genres",
	"networks",
	"status",
	"episodes",
	"tmdb_tv_id",
];

/**
 * The order a brand-new TV note writes its fields in. `seasons` stays last,
 * the way a Series note's `manga` block does: it is the one block that spans
 * several lines, and a key the note doesn't have yet is inserted before it.
 */
const TV_FIELD_ORDER: readonly string[] = [
	"title",
	"original_title",
	"aliases",
	"year",
	"end_year",
	"creators",
	"genres",
	"cast",
	"networks",
	"status",
	"episodes",
	"episodes_watched",
	"poster",
	"tmdb_tv_id",
	"watch_start",
	"watch_date",
	"watched",
	"seasons",
];

const SEASONS_KEY = "seasons";

/** The statuses a note's own `status` gives a show that nothing more will air of. */
const FINISHED_STATUSES = ["ended", "canceled", "cancelled"];

/**
 * A season as the note keeps it: what TMDB knows (`season`, `name`, `year`,
 * `episodes`) and what the user does (`watched`, `watchDate`). `extra` holds
 * any other key found on that season's line, so a field of the user's own
 * survives every rewrite.
 */
export interface TvSeasonEntry {
	season: number;
	name: string | null;
	year: number | null;
	episodes: number;
	watched: number;
	watchDate: string | null;
	extra: Record<string, unknown>;
}

/** A note split into its frontmatter blocks, as `parseFrontmatterBlocks` hands it over. */
type Doc = NonNullable<ReturnType<typeof parseFrontmatterBlocks>>;

/** A whole, non-negative count, or `null` for anything else a property might hold. */
function count(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
	return Math.floor(value);
}

/** A date property as text: Obsidian hands one over as a string, another YAML reader as a `Date`. */
function dateText(value: unknown): string | null {
	if (typeof value === "string") return value.trim() === "" ? null : value.trim();
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	return null;
}

/**
 * A value inside a `{ … }` season line. Flow style has more characters it
 * cannot take plainly than a normal YAML value — a comma or a brace would
 * end the entry — so those are quoted on top of what `needsQuoting` catches.
 */
function flowValue(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	if (typeof value !== "string") return JSON.stringify(value);
	// A JSON string is a valid double-quoted YAML one, and gives the value
	// back exactly: nothing is added to it, however often it is written.
	return needsQuoting(value) || /[,[\]{}]/.test(value) ? JSON.stringify(value) : value;
}

function flowEntry(pairs: [string, unknown][]): string {
	const written = pairs
		.filter(([, value]) => value !== null && value !== undefined)
		.map(([key, value]) => `${key}: ${flowValue(value)}`);
	return `  - { ${written.join(", ")} }`;
}

/** The `seasons:` block, one line per season. */
export function seasonLines(seasons: TvSeasonEntry[]): string[] {
	return [
		`${SEASONS_KEY}:`,
		...seasons.map((season) =>
			flowEntry([
				["season", season.season],
				["name", season.name],
				["year", season.year],
				["episodes", season.episodes],
				["watched", season.watched],
				["watch_date", season.watchDate],
				...Object.entries(season.extra),
			]),
		),
	];
}

const KNOWN_SEASON_KEYS = ["season", "name", "year", "episodes", "watched", "watch_date"];

function toSeasonEntry(value: unknown): TvSeasonEntry | null {
	if (typeof value !== "object" || value === null) return null;
	const raw = value as Record<string, unknown>;
	const season = count(raw.season);
	if (season === null) return null;

	const name = typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name.trim() : null;
	const extra: Record<string, unknown> = {};
	for (const [key, own] of Object.entries(raw)) {
		if (!KNOWN_SEASON_KEYS.includes(key)) extra[key] = own;
	}
	return {
		season,
		name,
		year: count(raw.year),
		episodes: count(raw.episodes) ?? 0,
		watched: count(raw.watched) ?? 0,
		watchDate: dateText(raw.watch_date),
		extra,
	};
}

/**
 * The seasons a note holds. `null` means the block is there but could not be
 * read — hand-edited into something YAML rejects — and every caller leaves
 * the note alone rather than writing over what it can't understand. A note
 * with no block at all has no seasons, which is not the same thing.
 */
export function readSeasons(text: string[] | undefined): TvSeasonEntry[] | null {
	if (text === undefined) return [];
	let parsed: unknown;
	try {
		parsed = parseYaml(text.join("\n")) as unknown;
	} catch {
		return null;
	}
	const list: unknown = (parsed as Record<string, unknown> | null)?.[SEASONS_KEY];
	if (list === null || list === undefined) return [];
	if (!Array.isArray(list)) return null;

	const seasons: TvSeasonEntry[] = [];
	for (const item of list) {
		const season = toSeasonEntry(item);
		if (season === null) return null;
		seasons.push(season);
	}
	return seasons.sort((a, b) => a.season - b.season);
}

/**
 * Fresh season data merged onto what the note has: TMDB owns the number,
 * name, year and length, the note owns how much of it was watched. A season
 * TMDB no longer lists is kept exactly as it is — someone watched it, and
 * that is not TMDB's to take away.
 */
export function mergeSeasons(existing: TvSeasonEntry[], fresh: TvSeason[]): TvSeasonEntry[] {
	const byNumber = new Map(existing.map((season) => [season.season, season]));
	const merged: TvSeasonEntry[] = [];

	for (const season of fresh) {
		const had = byNumber.get(season.season);
		byNumber.delete(season.season);
		merged.push({
			season: season.season,
			name: season.name,
			year: season.year,
			episodes: season.episodes,
			// A season that shrank (TMDB dropping an episode) never leaves the
			// note claiming more watched than there are.
			watched: Math.min(had?.watched ?? 0, season.episodes),
			watchDate: had?.watchDate ?? null,
			extra: had?.extra ?? {},
		});
	}

	return [...merged, ...byNumber.values()].sort((a, b) => a.season - b.season);
}

export function episodesOf(seasons: TvSeasonEntry[]): number {
	return seasons.reduce((total, season) => total + season.episodes, 0);
}

export function watchedOf(seasons: TvSeasonEntry[]): number {
	return seasons.reduce((total, season) => total + season.watched, 0);
}

/** Whether a note's own `status` says nothing more will air. */
export function isFinishedStatus(status: unknown): boolean {
	return typeof status === "string" && FINISHED_STATUSES.includes(status.trim().toLowerCase());
}

function ownedLines(key: TvOwnedKey, show: TvMetadata, links: LinkOptions, previous?: Record<string, unknown>): string[] {
	const names = (list: "creators" | "genres" | "cast", values: string[], link: boolean) =>
		yamlList(list, keepLinks(link ? formatNames(values, links.isResolved) : values, previous?.[list]));
	switch (key) {
		case "title":
			return [`title: ${yamlString(show.title)}`];
		case "original_title":
			return [`original_title: ${yamlString(show.originalTitle)}`];
		case "aliases":
			return yamlList("aliases", buildAliases(show.title, show.originalTitle));
		case "year":
			return [yamlScalar("year", show.year)];
		case "end_year":
			return [yamlScalar("end_year", show.endYear)];
		case "creators":
			// A show's creators are its directors' equivalent, and share that setting.
			return names("creators", show.creators, links.directors);
		case "genres":
			return names("genres", show.genres, links.genres);
		case "cast":
			return names("cast", show.cast.slice(0, links.castCount), links.cast);
		case "networks":
			return yamlList("networks", show.networks);
		case "status":
			return [yamlScalar("status", show.status)];
		case "episodes":
			return [yamlScalar("episodes", show.seasons.reduce((total, season) => total + season.episodes, 0))];
		case "tmdb_tv_id":
			return [`tmdb_tv_id: ${show.tmdbTvId}`];
	}
}

/**
 * Where a key the note doesn't have yet belongs: right after the nearest
 * field before it in `TV_FIELD_ORDER` that the note does have, or failing
 * that right before the nearest field after it. Anything else goes before
 * the `seasons` block, or last.
 */
function insertionIndex(order: string[], key: string): number {
	const canonical = TV_FIELD_ORDER.indexOf(key);
	if (canonical !== -1) {
		for (let before = canonical - 1; before >= 0; before -= 1) {
			const at = order.indexOf(TV_FIELD_ORDER[before]);
			if (at !== -1) return at + 1;
		}
		for (let after = canonical + 1; after < TV_FIELD_ORDER.length; after += 1) {
			const at = order.indexOf(TV_FIELD_ORDER[after]);
			if (at !== -1) return at;
		}
	}

	const seasonsIndex = order.indexOf(SEASONS_KEY);
	return seasonsIndex === -1 ? order.length : seasonsIndex;
}

/** Sets a key's lines, leaving a key the note already has exactly where it is. */
function setKey(doc: Doc, key: string, lines: string[]): void {
	doc.blocks.set(key, lines);
	if (doc.order.includes(key)) return;
	doc.order.splice(insertionIndex(doc.order, key), 0, key);
}

function ownedKeysFor(links: LinkOptions): TvOwnedKey[] {
	const keys = [...TV_OWNED_KEYS];
	if (links.addCast) keys.push("cast");
	return keys;
}

export function buildTvFrontmatter(
	show: TvMetadata,
	posterLink: string | null,
	links: LinkOptions = NO_LINKS,
): string {
	const seasons = mergeSeasons([], show.seasons);
	const lines = [
		"---",
		...ownedLines("title", show, links),
		...ownedLines("original_title", show, links),
		...ownedLines("aliases", show, links),
		...ownedLines("year", show, links),
		...ownedLines("end_year", show, links),
		...ownedLines("creators", show, links),
		...ownedLines("genres", show, links),
	];
	if (links.addCast) lines.push(...ownedLines("cast", show, links));
	lines.push(
		...ownedLines("networks", show, links),
		...ownedLines("status", show, links),
		...ownedLines("episodes", show, links),
		// Written from the start, so the first refresh has nothing to add.
		"episodes_watched: 0",
		posterLine(posterLink),
		...ownedLines("tmdb_tv_id", show, links),
		// Both left empty on purpose: the day you started is yours to write,
		// and the day you finished is filled in when you finish it.
		"watch_start:",
		"watch_date:",
		"watched: false",
		...seasonLines(seasons),
		"---",
	);
	return lines.join("\n");
}

/**
 * The body is left empty on purpose, the same as a film or an anime note:
 * the poster is rendered from the `poster` property beside the note's own
 * properties, and everything below belongs to the user.
 */
export function buildTvNoteContent(
	show: TvMetadata,
	rawPosterLink: string | null,
	links: LinkOptions = NO_LINKS,
): string {
	const link = rawPosterLink === null ? null : rawPosterLink.replace(/^!/, "");
	return `${buildTvFrontmatter(show, link, links)}\n`;
}

/**
 * Rewrites the plugin-owned fields from fresh TMDB data. What the user did —
 * `watched`, `watch_date`, every season's own count and date, their own
 * properties and the body — is preserved exactly, and so is the order of the
 * keys the note already has.
 *
 * A note whose `seasons` block can't be read is returned untouched: rewriting
 * it would throw away progress this can't see (see `readSeasons`).
 */
export function refreshTvFrontmatter(
	content: string,
	show: TvMetadata,
	links: LinkOptions = NO_LINKS,
	newPosterLink: string | null = null,
	previous?: Record<string, unknown>,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	const existing = readSeasons(doc.blocks.get(SEASONS_KEY));
	if (existing === null) return content;
	const seasons = mergeSeasons(existing, show.seasons);

	for (const key of ownedKeysFor(links)) {
		setKey(doc, key, ownedLines(key, show, links, previous));
	}
	setKey(doc, SEASONS_KEY, seasonLines(seasons));
	// `episodes` counts what the note now holds, which is what the seasons say.
	setKey(doc, "episodes", [yamlScalar("episodes", episodesOf(seasons))]);

	if (previous !== undefined) {
		const aliases = mergeAliases(
			buildAliases(show.title, show.originalTitle),
			listValues(previous.aliases),
			[...listValues(previous.title), ...listValues(previous.original_title)],
		);
		doc.blocks.set("aliases", yamlList("aliases", aliases));
	}

	if (newPosterLink !== null && isEmptyValue(doc.blocks.get("poster"))) {
		setKey(doc, "poster", [posterLine(newPosterLink)]);
	}
	if (!doc.order.includes("watch_start")) setKey(doc, "watch_start", ["watch_start:"]);
	if (!doc.order.includes("watched")) setKey(doc, "watched", ["watched: false"]);

	applyTotals(doc, seasons, null);
	return serializeFrontmatterBlocks(doc);
}

/**
 * Writes `episodes_watched` and the show's own tick from the seasons, which
 * are the only record of what was watched. The tick is only set by reaching
 * the end of a show nothing more will air of: a running show whose every
 * aired episode is watched is caught up, not finished. The tick is only
 * ever taken off when `untick` says the user just took a season's tick back
 * — never by a refresh or a count, so a tick set by hand stays.
 */
function applyTotals(doc: Doc, seasons: TvSeasonEntry[], date: string | null, untick = false): void {
	const watched = watchedOf(seasons);
	const episodes = episodesOf(seasons);
	setKey(doc, "episodes_watched", [yamlScalar("episodes_watched", watched)]);

	const finished = isFinishedStatus(valueOf(doc, "status"));
	const complete = finished && episodes > 0 && watched >= episodes;
	const ticked = /^true$/i.test(valueOf(doc, "watched") ?? "");
	if (complete) {
		setKey(doc, "watched", ["watched: true"]);
		if (date !== null && isEmptyValue(doc.blocks.get("watch_date"))) {
			setKey(doc, "watch_date", [`watch_date: ${date}`]);
		}
	} else if (untick && ticked) {
		setKey(doc, "watched", ["watched: false"]);
	}
}

/** A single-line key's value as written, without its key. */
function valueOf(doc: Doc, key: string): string | null {
	const block = doc.blocks.get(key);
	if (block === undefined || block.length !== 1) return null;
	return block[0].slice(block[0].indexOf(":") + 1).trim();
}

/**
 * Runs `change` over the note's seasons and writes them back, with
 * `episodes_watched` and the show's tick brought in step (see `applyTotals`).
 * The note comes back untouched when its seasons can't be read, or when
 * `change` says nothing happened.
 */
function editSeasons(
	content: string,
	date: string | null,
	change: (seasons: TvSeasonEntry[]) => boolean,
	untick = false,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	const seasons = readSeasons(doc.blocks.get(SEASONS_KEY));
	if (seasons === null || !change(seasons)) return content;

	setKey(doc, SEASONS_KEY, seasonLines(seasons));
	applyTotals(doc, seasons, date, untick);
	return serializeFrontmatterBlocks(doc);
}

/**
 * Ticking a season off, or taking that tick back: full means every episode
 * of it and the day it was finished, empty means none and no date. A date
 * already there is kept — the day it was first finished is the user's.
 */
export function setSeasonWatched(content: string, season: number, watched: boolean, date: string | null): string {
	return editSeasons(content, date, (seasons) => {
		const entry = seasons.find((item) => item.season === season);
		if (entry === undefined) return false;

		entry.watched = watched ? entry.episodes : 0;
		if (!watched) entry.watchDate = null;
		else if (entry.watchDate === null) entry.watchDate = date;
		return true;
	}, !watched);
}

/**
 * Whether the note's seasons can be read — and so written. Every edit leaves
 * a note whose seasons can't be read exactly as it is; this is how its caller
 * tells that apart from an edit that simply had nothing to change.
 */
export function seasonsReadable(content: string): boolean {
	const doc = parseFrontmatterBlocks(content);
	return doc !== null && readSeasons(doc.blocks.get(SEASONS_KEY)) !== null;
}

/** One more episode of a season, dating it once its last episode is watched. */
export function watchOneMoreOfSeason(content: string, season: number, date: string | null): string {
	return editSeasons(content, date, (seasons) => {
		const entry = seasons.find((item) => item.season === season);
		if (entry === undefined || entry.watched >= entry.episodes) return false;

		entry.watched += 1;
		if (entry.watched >= entry.episodes && entry.watchDate === null) entry.watchDate = date;
		return true;
	});
}

/** The season a "+1 episode" on the show itself counts into: the earliest one with something left. */
export function nextSeason(seasons: TvSeasonEntry[]): TvSeasonEntry | null {
	return seasons.find((season) => season.watched < season.episodes) ?? null;
}

/**
 * "Mark as watched today" on a TV note: every episode that has aired, and
 * the tick, whether or not the show has ended — someone saying they have
 * watched it is not a guess the plugin has to make.
 */
export function markTvWatched(content: string, date: string | null): string {
	// Seasons it can't read leave the whole note alone, the tick included:
	// a tick the seasons don't agree with is worse than none.
	const before = parseFrontmatterBlocks(content);
	if (before === null || readSeasons(before.blocks.get(SEASONS_KEY)) === null) return content;

	const written = editSeasons(content, date, (seasons) => {
		for (const season of seasons) {
			if (season.watched < season.episodes) {
				season.watched = season.episodes;
				if (season.watchDate === null) season.watchDate = date;
			}
		}
		return true;
	});

	const doc = parseFrontmatterBlocks(written);
	if (doc === null) return written;
	setKey(doc, "watched", ["watched: true"]);
	if (date !== null && isEmptyValue(doc.blocks.get("watch_date"))) {
		setKey(doc, "watch_date", [`watch_date: ${date}`]);
	}
	return serializeFrontmatterBlocks(doc);
}

/** How far through a show the note says it is, read from the seasons themselves. */
export interface TvProgress {
	seasons: TvSeasonEntry[];
	watched: number;
	episodes: number;
	/** The last episode watched, as a season and an episode within it. */
	position: { season: number; episode: number } | null;
	/** Whether anything aired is left to watch. */
	more: boolean;
	done: boolean;
}

export function tvProgressOf(frontmatter: Record<string, unknown> | undefined): TvProgress {
	const raw: unknown = frontmatter?.seasons;
	const seasons = Array.isArray(raw)
		? raw.map(toSeasonEntry).filter((season): season is TvSeasonEntry => season !== null).sort((a, b) => a.season - b.season)
		: [];
	const watched = watchedOf(seasons);

	const started = [...seasons].reverse().find((season) => season.watched > 0);
	return {
		seasons,
		watched,
		episodes: episodesOf(seasons),
		position: started === undefined ? null : { season: started.season, episode: started.watched },
		more: nextSeason(seasons) !== null,
		done: frontmatter?.watched === true,
	};
}
