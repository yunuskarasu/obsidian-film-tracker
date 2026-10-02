/*
 * IGDB's answers, and what a game note is made of. Pure functions only: the
 * requests themselves are in igdb.ts, so that everything here can be checked
 * against the saved answers in tests/fixtures/igdb.
 */

/** A game as IGDB answers for it, with only the fields the plugin asks for. */
export interface IgdbGame {
	id: number;
	name?: string;
	first_release_date?: number;
	/** What the entry is: a main game, a DLC, a remaster… — see `GAME_TYPES`. */
	game_type?: number;
	platforms?: { name?: string; abbreviation?: string }[];
	genres?: { name?: string }[];
	involved_companies?: { company?: { name?: string }; developer?: boolean; publisher?: boolean }[];
	collections?: { name?: string }[];
	franchises?: { name?: string }[];
	alternative_names?: { name?: string; comment?: string }[];
	cover?: { image_id?: string };
	url?: string;
	/** How many ratings it has on IGDB: how well known it is, which the search is ordered by. */
	total_rating_count?: number;
}

/**
 * IGDB's kinds of entry, by the ids of its `game_types`. Each is a note of
 * its own in the search, a game's DLC, or not offered at all.
 */
export const GAME_TYPES: Record<number, string> = {
	0: "Main game",
	1: "DLC",
	2: "Expansion",
	3: "Bundle",
	4: "Standalone expansion",
	5: "Mod",
	6: "Episode",
	7: "Season",
	8: "Remake",
	9: "Remaster",
	10: "Expanded game",
	11: "Port",
	12: "Fork",
	13: "Pack",
	14: "Update",
};

/**
 * What "Add game" finds: a game that stands on its own. A DLC and an
 * expansion belong to their game (added to its note later); a bundle, an
 * episode, a mod or an update isn't a game to keep a note of.
 */
export const SEARCHED_TYPES = [0, 4, 8, 9, 10, 11];

export interface GameSearchResult {
	id: number;
	title: string;
	year: number | null;
	/** What tells a remake from its original: `null` for a main game. */
	type: string | null;
	platforms: string[];
}

/** A platform as IGDB names it, in full and short: "PlayStation 4", "PS4". */
export interface GamePlatform {
	name: string;
	short: string;
}

export interface GameMetadata {
	title: string;
	/** Its Japanese titles, as IGDB lists them: ペルソナ５ タクティカ. They go in `aliases`. */
	japaneseTitles: string[];
	year: number | null;
	platforms: GamePlatform[];
	developers: string[];
	publishers: string[];
	genres: string[];
	/** The series it is part of: IGDB's collections, else its franchises. */
	series: string[];
	/** The id of its cover on IGDB's image server; never written to the note. */
	coverId: string | null;
	url: string | null;
	igdbId: number;
}

/** The fields a search asks for, and what it leaves out — see `SEARCHED_TYPES`. */
export function searchQuery(query: string, limit = 20): string {
	const text = query.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
	return (
		`search "${text}"; fields name,first_release_date,game_type,total_rating_count,platforms.name,platforms.abbreviation; ` +
		`where game_type = (${SEARCHED_TYPES.join(",")}) & version_parent = null; limit ${limit};`
	);
}

/** The fields a game's note is written from. */
export function gameQuery(id: number): string {
	return (
		"fields name,first_release_date,game_type,url,cover.image_id,platforms.name,platforms.abbreviation,genres.name," +
		"involved_companies.company.name,involved_companies.developer,involved_companies.publisher," +
		"collections.name,franchises.name,alternative_names.name,alternative_names.comment; " +
		`where id = ${id};`
	);
}

/** The year of a Unix time in seconds, as IGDB gives release dates — read in UTC. */
export function yearOfTimestamp(seconds: number | undefined): number | null {
	if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
	const year = new Date(seconds * 1000).getUTCFullYear();
	return year > 0 ? year : null;
}

function names(list: ({ name?: string } | undefined)[] | undefined): string[] {
	const found: string[] = [];
	for (const item of list ?? []) {
		const name = item?.name?.trim() ?? "";
		if (name !== "" && !found.includes(name)) found.push(name);
	}
	return found;
}

export function toGameSearchResult(game: IgdbGame): GameSearchResult {
	const type = game.game_type;
	return {
		id: game.id,
		title: game.name?.trim() ?? "",
		year: yearOfTimestamp(game.first_release_date),
		type: type === undefined || type === 0 ? null : (GAME_TYPES[type] ?? null),
		platforms: (game.platforms ?? [])
			.map((platform) => (platform.abbreviation ?? platform.name ?? "").trim())
			.filter((platform) => platform !== ""),
	};
}

/**
 * A game's Japanese titles: the ones IGDB files as "Japanese title — stylized",
 * "— romanization" and the like, but not "— translated", which is an English
 * translation. IGDB never says which of its titles is a game's original, and
 * its other names — every language's, acronyms, executables — would only be
 * noise in `aliases`.
 */
function japaneseTitlesOf(game: IgdbGame, title: string): string[] {
	const found: string[] = [];
	for (const alternative of game.alternative_names ?? []) {
		const name = alternative.name?.trim() ?? "";
		const comment = alternative.comment ?? "";
		if (name === "" || name === title || found.includes(name)) continue;
		if (/^japanese title/i.test(comment) && !/translat/i.test(comment)) found.push(name);
	}
	return found;
}

/** A title reduced to its letters and digits, for telling whether a search names it exactly. */
function titleKey(text: string): string {
	return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * The search's results in the order they are offered: those titled exactly
 * as searched first, then the best known — by how many ratings each has on
 * IGDB — so that Final Fantasy VII itself comes before its ports and the
 * fan games of the same name. Ties keep IGDB's own order.
 */
export function rankSearch(games: IgdbGame[], query: string): IgdbGame[] {
	const wanted = titleKey(query);
	const exact = (game: IgdbGame) => (titleKey(game.name ?? "") === wanted ? 1 : 0);
	const known = (game: IgdbGame) => game.total_rating_count ?? 0;
	return games
		.map((game, index) => ({ game, index }))
		.sort((a, b) => exact(b.game) - exact(a.game) || known(b.game) - known(a.game) || a.index - b.index)
		.map(({ game }) => game);
}

export function toGameMetadata(game: IgdbGame): GameMetadata {
	const title = game.name?.trim() ?? "";
	const companies = game.involved_companies ?? [];
	const series = names(game.collections);
	return {
		title,
		japaneseTitles: japaneseTitlesOf(game, title),
		year: yearOfTimestamp(game.first_release_date),
		platforms: platformsOf(game),
		developers: names(companies.filter((company) => company.developer === true).map((company) => company.company)),
		publishers: names(companies.filter((company) => company.publisher === true).map((company) => company.company)),
		genres: names(game.genres),
		series: series.length > 0 ? series : names(game.franchises),
		coverId: game.cover?.image_id?.trim() || null,
		url: game.url?.trim() || null,
		igdbId: game.id,
	};
}

function platformsOf(game: IgdbGame): GamePlatform[] {
	const found: GamePlatform[] = [];
	for (const platform of game.platforms ?? []) {
		const name = platform.name?.trim() ?? "";
		if (name === "" || found.some((known) => known.name === name)) continue;
		found.push({ name, short: platform.abbreviation?.trim() || name });
	}
	return found;
}

/** How a game note lists its platforms: see the 🎮 Games settings. */
export interface PlatformOptions {
	/** IGDB's short names, "PS4", rather than "PlayStation 4". */
	short: boolean;
	/** Only these, in this order — matched on either name, any case; `null` for every platform. */
	mine: string[] | null;
	/** How many at most; 0 leaves the property out of the note. */
	count: number;
}

export const ALL_PLATFORMS: PlatformOptions = { short: false, mine: null, count: Number.POSITIVE_INFINITY };

const platformKey = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** "PC, PS5, Switch" as a list of platforms. */
export function parsePlatformList(text: string): string[] {
	return text
		.split(/[,\n]/)
		.map((part) => part.trim())
		.filter((part) => part !== "");
}

/**
 * The platforms a note lists: only the user's own, in their order, when they
 * keep a list; then as many as they want, short or in full. An empty list
 * means the note has no `platforms` at all.
 */
export function platformsShown(platforms: GamePlatform[], options: PlatformOptions): string[] {
	let chosen = platforms;
	if (options.mine !== null) {
		chosen = [];
		for (const wanted of options.mine.map(platformKey)) {
			const match = platforms.find((platform) => platformKey(platform.name) === wanted || platformKey(platform.short) === wanted);
			if (match !== undefined && !chosen.includes(match)) chosen.push(match);
		}
	}
	const limit = Math.max(0, Math.floor(options.count));
	return chosen.slice(0, limit).map((platform) => (options.short ? platform.short : platform.name));
}

/** A cover on IGDB's image server, at twice the size of its own "cover_big": 528×748. */
export function coverUrl(imageId: string): string {
	return `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${imageId}.jpg`;
}

/** Where a game is up to, as the user keeps it. */
export const PLAY_STATUSES = ["backlog", "playing", "completed", "abandoned"] as const;
export type PlayStatus = (typeof PLAY_STATUSES)[number];

/** A game's DLC or expansion, as "Add DLC…" offers it. */
export interface GameDlc {
	id: number;
	title: string;
	year: number | null;
	/** "DLC" or "Expansion". */
	type: string;
}

/** IGDB's kinds of entry that belong to a game and can be added to its note: a DLC, an expansion. */
export const DLC_TYPES = [1, 2];

/** A game's own DLCs and expansions, oldest first. */
export function dlcQuery(gameId: number): string {
	return `fields name,first_release_date,game_type; where parent_game = ${gameId} & game_type = (${DLC_TYPES.join(",")}); sort first_release_date asc; limit 100;`;
}

export function toGameDlc(game: IgdbGame): GameDlc {
	return {
		id: game.id,
		title: game.name?.trim() ?? "",
		year: yearOfTimestamp(game.first_release_date),
		type: GAME_TYPES[game.game_type ?? 1] ?? "DLC",
	};
}
