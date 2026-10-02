import { parseYaml } from "obsidian";
import { ALL_PLATFORMS, platformsShown, type GameDlc, type GameMetadata, type PlatformOptions, type PlayStatus } from "./game";
import { flowEntry } from "./yaml-flow";
import {
	formatNames,
	isEmptyValue,
	keepLinks,
	listValues,
	mergeAliases,
	parseFrontmatterBlocks,
	posterLine,
	serializeFrontmatterBlocks,
	setOrderedKey,
	yamlList,
	yamlScalar,
	yamlString,
} from "./note";

/*
 * Game notes. What IGDB knows — the title, platforms, companies, genres,
 * series — is rewritten by a refresh; where the user is with the game —
 * `play_status`, `played_on`, `completed`, `completed_count`, `hours` — is
 * theirs, and only ever changed by their own commands.
 */

/** Where a game note keeps the DLCs added to it, one line each. */
export const DLCS_KEY = "dlcs";

const GAME_FIELD_ORDER = [
	"title",
	"aliases",
	"year",
	"platforms",
	"developers",
	"publishers",
	"genres",
	"series",
	"poster",
	"url",
	"igdb_id",
	"play_status",
	"played_on",
	"completed",
	"completed_count",
	"hours",
	DLCS_KEY,
];

/** Which of a game's names are written as links, and how to tell whether a note exists. */
export interface GameLinks {
	/** Developers and publishers, with **Link developers** on. */
	companies: boolean;
	isResolved: (name: string) => boolean;
	/** Which platforms are listed, and how. */
	platforms: PlatformOptions;
}

export const NO_GAME_LINKS: GameLinks = { companies: false, isResolved: () => false, platforms: ALL_PLATFORMS };

/** The names a game's note is also found by: its title, then its Japanese titles. */
function aliasesOf(game: GameMetadata): string[] {
	return [...new Set([game.title, ...game.japaneseTitles])];
}

function gameLines(game: GameMetadata, links: GameLinks, previous?: Record<string, unknown>): [string, string[]][] {
	const companies = (key: "developers" | "publishers", values: string[]) =>
		yamlList(key, keepLinks(links.companies ? formatNames(values, links.isResolved) : values, previous?.[key]));
	const list = (key: "platforms" | "genres" | "series", values: string[]) => yamlList(key, keepLinks(values, previous?.[key]));
	const platforms = platformsShown(game.platforms, links.platforms);
	// With "Platforms to list" at 0 there is no such property at all.
	const platformLines: [string, string[]][] = links.platforms.count > 0 ? [["platforms", list("platforms", platforms)]] : [];
	return [
		["title", [`title: ${yamlString(game.title)}`]],
		["year", [yamlScalar("year", game.year)]],
		...platformLines,
		["developers", companies("developers", game.developers)],
		["publishers", companies("publishers", game.publishers)],
		["genres", list("genres", game.genres)],
		["series", list("series", game.series)],
		["url", [yamlScalar("url", game.url)]],
		["igdb_id", [`igdb_id: ${game.igdbId}`]],
	];
}

export function buildGameNoteContent(game: GameMetadata, coverLink: string | null, links: GameLinks): string {
	const owned = new Map(gameLines(game, links));
	const lines = ["---"];
	for (const key of GAME_FIELD_ORDER) {
		if (key === "aliases") lines.push(...yamlList("aliases", aliasesOf(game)));
		else if (key === "poster") lines.push(posterLine(coverLink === null ? null : coverLink.replace(/^!/, "")));
		else if (key === "play_status") lines.push("play_status: backlog");
		else if (key === "played_on") lines.push("played_on:");
		else if (key === "completed") lines.push("completed:");
		else if (key === "completed_count") lines.push("completed_count: 0");
		else if (key === "hours") lines.push("hours:");
		else lines.push(...(owned.get(key) ?? []));
	}
	lines.push("---", "");
	return lines.join("\n");
}

/**
 * Rewrites what IGDB knows about the game. The aliases the user added are
 * kept, a name already written as a link stays one, and the cover is only
 * filled in when the note has none — or `posterMissing`, one whose file is
 * gone. Everything of the user's stays as it is.
 */
export function refreshGameFrontmatter(
	content: string,
	game: GameMetadata,
	links: GameLinks,
	coverLink: string | null,
	previous: Record<string, unknown> = {},
	posterMissing = false,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	for (const [key, lines] of gameLines(game, links, previous)) setOrderedKey(doc, GAME_FIELD_ORDER, key, lines);
	if (links.platforms.count <= 0 && doc.blocks.has("platforms")) {
		doc.blocks.delete("platforms");
		doc.order = doc.order.filter((key) => key !== "platforms");
	}
	// The old title gives way to the new one; every other alias — the user's own too — stays.
	const aliases = mergeAliases(aliasesOf(game), listValues(previous.aliases), listValues(previous.title));
	setOrderedKey(doc, GAME_FIELD_ORDER, "aliases", yamlList("aliases", aliases));
	if (coverLink !== null && (posterMissing || isEmptyValue(doc.blocks.get("poster")))) {
		setOrderedKey(doc, GAME_FIELD_ORDER, "poster", [posterLine(coverLink.replace(/^!/, ""))]);
	}
	return serializeFrontmatterBlocks(doc);
}

export interface PlayProgress {
	status: string | null;
	completedCount: number;
	completed: string | null;
}

export function playProgressOf(frontmatter: Record<string, unknown> | undefined): PlayProgress {
	const status: unknown = frontmatter?.play_status;
	const count: unknown = frontmatter?.completed_count;
	const completed: unknown = frontmatter?.completed;
	return {
		status: typeof status === "string" && status.trim() !== "" ? status.trim() : null,
		completedCount: typeof count === "number" && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
		completed: typeof completed === "string" && completed.trim() !== "" ? completed.trim() : null,
	};
}

/** "Start playing" — and "Completed today" — set where the game is up to. */
export function setPlayStatus(content: string, status: PlayStatus): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;
	setOrderedKey(doc, GAME_FIELD_ORDER, "play_status", [`play_status: ${status}`]);
	return serializeFrontmatterBlocks(doc);
}

/**
 * "Completed today": finished, dated the first time — the day it was first
 * finished stays — and counted once more, since a game is played again.
 */
export function markGameCompleted(content: string, date: string, count: number): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;
	setOrderedKey(doc, GAME_FIELD_ORDER, "play_status", ["play_status: completed"]);
	if (isEmptyValue(doc.blocks.get("completed"))) setOrderedKey(doc, GAME_FIELD_ORDER, "completed", [`completed: ${date}`]);
	setOrderedKey(doc, GAME_FIELD_ORDER, "completed_count", [`completed_count: ${count + 1}`]);
	return serializeFrontmatterBlocks(doc);
}

// ——— DLC ———

/** A DLC as the note keeps it: what IGDB said of it, whether it's done, and any key the user added to its line. */
export interface GameDlcEntry {
	title: string;
	year: number | null;
	igdbId: number;
	done: boolean;
	/** The day it was ticked off. */
	completed: string | null;
	extra: Record<string, unknown>;
}

const KNOWN_DLC_KEYS = ["title", "year", "igdb_id", "done", "completed"];

function dateText(value: unknown): string | null {
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function toDlcEntry(value: unknown): GameDlcEntry | null {
	if (typeof value !== "object" || value === null) return null;
	const raw = value as Record<string, unknown>;
	if (typeof raw.igdb_id !== "number") return null;
	const extra: Record<string, unknown> = {};
	for (const [key, own] of Object.entries(raw)) {
		if (!KNOWN_DLC_KEYS.includes(key)) extra[key] = own;
	}
	return {
		title: typeof raw.title === "string" ? raw.title : typeof raw.title === "number" ? String(raw.title) : "",
		year: typeof raw.year === "number" ? raw.year : null,
		igdbId: raw.igdb_id,
		done: raw.done === true,
		completed: dateText(raw.completed),
		extra,
	};
}

/**
 * The DLCs a note's `dlcs` holds, from the frontmatter as Obsidian parsed it.
 * `null` means the list is there but can't be read — then nothing is
 * written over it, the rule an album's tracks follow.
 */
export function gameDlcsOf(frontmatter: Record<string, unknown> | undefined): GameDlcEntry[] | null {
	const list: unknown = frontmatter?.[DLCS_KEY];
	if (list === null || list === undefined) return [];
	if (!Array.isArray(list)) return null;
	const entries: GameDlcEntry[] = [];
	for (const item of list) {
		const entry = toDlcEntry(item);
		if (entry === null) return null;
		entries.push(entry);
	}
	return entries;
}

function dlcLine(dlc: GameDlcEntry): string {
	return flowEntry([
		["title", dlc.title],
		["year", dlc.year],
		["igdb_id", dlc.igdbId],
		["done", dlc.done],
		["completed", dlc.completed],
		...Object.entries(dlc.extra),
	]);
}

/** Rewrites a note's DLC list with `change`; `null` when the list can't be read and the note is left alone. */
function rewriteDlcs(content: string, change: (dlcs: GameDlcEntry[]) => GameDlcEntry[]): string | null {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return null;
	const block = doc.blocks.get(DLCS_KEY);
	let parsed: unknown = undefined;
	if (block !== undefined) {
		try {
			parsed = parseYaml(block.join("\n")) as unknown;
		} catch {
			return null;
		}
	}
	const existing = gameDlcsOf(parsed as Record<string, unknown> | undefined);
	if (existing === null) return null;
	const next = change(existing);
	setOrderedKey(doc, GAME_FIELD_ORDER, DLCS_KEY, [`${DLCS_KEY}:`, ...next.map(dlcLine)]);
	return serializeFrontmatterBlocks(doc);
}

/** "Add DLC…": the DLC joins the note's list, after the ones there — once. */
export function addGameDlc(content: string, dlc: GameDlc): string | null {
	return rewriteDlcs(content, (dlcs) =>
		dlcs.some((known) => known.igdbId === dlc.id)
			? dlcs
			: [...dlcs, { title: dlc.title, year: dlc.year, igdbId: dlc.id, done: false, completed: null, extra: {} }],
	);
}

/** The DLC panel's checkbox: done, dated the day it was ticked — or not done, and undated. */
export function setGameDlcDone(content: string, igdbId: number, done: boolean, date: string): string | null {
	return rewriteDlcs(content, (dlcs) =>
		dlcs.map((dlc) =>
			dlc.igdbId !== igdbId ? dlc : { ...dlc, done, completed: done ? (dlc.completed ?? date) : null },
		),
	);
}
