/** TMDB's genre id for Animation, the same on every show. */
const ANIMATION_GENRE = 16;

/** The statuses after which nothing more will air: every listed episode is out, and a show can be finished. */
const FINISHED_STATUSES = ["Ended", "Canceled"];

export interface TmdbTvSearchItem {
	id: number;
	name?: string;
	original_name?: string;
	original_language?: string;
	origin_country?: string[];
	first_air_date?: string;
	genre_ids?: number[];
}

export interface TmdbEpisodeRef {
	season_number?: number;
	episode_number?: number;
	air_date?: string | null;
}

export interface TmdbTvSeasonSummary {
	season_number?: number;
	name?: string;
	episode_count?: number;
	air_date?: string | null;
}

export interface TmdbTvDetails {
	id: number;
	name?: string;
	original_name?: string;
	original_language?: string;
	origin_country?: string[];
	first_air_date?: string | null;
	last_air_date?: string | null;
	status?: string;
	poster_path?: string | null;
	genres?: { id?: number; name?: string }[];
	created_by?: { name?: string }[];
	networks?: { name?: string }[];
	last_episode_to_air?: TmdbEpisodeRef | null;
	seasons?: TmdbTvSeasonSummary[];
	aggregate_credits?: { cast?: { name?: string; order?: number }[] };
}

/** One season in full — only asked for when the show's own summary can't tell how much of it has aired. */
export interface TmdbTvSeasonDetails {
	season_number?: number;
	episodes?: TmdbEpisodeRef[];
}

export interface TvSearchResult {
	id: number;
	title: string;
	originalTitle: string;
	year: number | null;
	/** Japanese animation: MyAnimeList, through Add anime, is where the plugin tracks that. */
	looksLikeAnime: boolean;
}

/** A season as the note keeps it: only seasons with at least one episode out. */
export interface TvSeason {
	season: number;
	/** TMDB's own name when it is more than "Season N" ("Night Country"), else `null`. */
	name: string | null;
	year: number | null;
	/** How many of its episodes have aired — never the ones only announced. */
	episodes: number;
}

export interface TvMetadata {
	title: string;
	originalTitle: string;
	year: number | null;
	/** Only once the show has ended or been canceled; a show still running has none. */
	endYear: number | null;
	creators: string[];
	genres: string[];
	cast: string[];
	networks: string[];
	status: string | null;
	/** Ended or canceled: the only time reaching the last episode may finish the note off. */
	finished: boolean;
	/** Regular seasons only, oldest first. Specials (season 0) are left out. */
	seasons: TvSeason[];
	tmdbTvId: number;
	posterPath: string | null;
}

function yearOf(date: string | null | undefined): number | null {
	if (!date) return null;
	const year = Number(date.slice(0, 4));
	return Number.isInteger(year) && year > 0 ? year : null;
}

function cleanNames(values: ({ name?: string } | undefined)[] | undefined): string[] {
	return (values ?? []).map((value) => value?.name?.trim() ?? "").filter((name) => name !== "");
}

function isAnime(genreIds: number[], originCountry: string[] | undefined, language: string | undefined): boolean {
	return genreIds.includes(ANIMATION_GENRE) && ((originCountry ?? []).includes("JP") || language === "ja");
}

export function toTvSearchResult(item: TmdbTvSearchItem): TvSearchResult {
	const title = item.name?.trim() || item.original_name?.trim() || "";
	return {
		id: item.id,
		title,
		originalTitle: item.original_name?.trim() || title,
		year: yearOf(item.first_air_date),
		looksLikeAnime: isAnime(item.genre_ids ?? [], item.origin_country, item.original_language),
	};
}

export function isFinished(details: Pick<TmdbTvDetails, "status">): boolean {
	return FINISHED_STATUSES.includes(details.status ?? "");
}

/** Regular seasons, in order; season 0 holds the specials, which the note leaves out. */
function regularSeasons(details: TmdbTvDetails): (TmdbTvSeasonSummary & { season_number: number })[] {
	return (details.seasons ?? [])
		.filter((season): season is TmdbTvSeasonSummary & { season_number: number } =>
			typeof season.season_number === "number" && season.season_number > 0,
		)
		.sort((a, b) => a.season_number - b.season_number);
}

/**
 * The season whose episodes have to be counted one by one: the latest one
 * already under way, on a show still running whose last aired episode was a
 * special, or isn't given. `null` when the summary alone is enough.
 */
export function seasonToCount(details: TmdbTvDetails, today: string): number | null {
	if (isFinished(details)) return null;
	const last = details.last_episode_to_air;
	if (typeof last?.season_number === "number" && last.season_number > 0) return null;

	const started = regularSeasons(details).filter((season) => !!season.air_date && season.air_date <= today);
	return started.length === 0 ? null : started[started.length - 1].season_number;
}

/**
 * How many episodes of each regular season have aired. A season's
 * `episode_count` also counts episodes only announced — The Simpsons listed
 * 803 with 801 out — so it is only taken whole for a season that is over:
 * every season of a show that has ended, and every season before the one the
 * last aired episode belongs to. That season counts up to that episode;
 * later ones have none out yet. `counted` is `seasonToCount`'s season in full,
 * when the summary couldn't say.
 */
export function airedBySeason(
	details: TmdbTvDetails,
	today: string,
	counted: TmdbTvSeasonDetails | null = null,
): Map<number, number> {
	const seasons = regularSeasons(details);
	const aired = new Map<number, number>();
	const whole = (season: TmdbTvSeasonSummary) => Math.max(0, season.episode_count ?? 0);

	if (isFinished(details)) {
		for (const season of seasons) aired.set(season.season_number, whole(season));
		return aired;
	}

	const last = details.last_episode_to_air;
	let current: number;
	let outInCurrent: number;
	if (typeof last?.season_number === "number" && last.season_number > 0) {
		current = last.season_number;
		outInCurrent = Math.max(0, last.episode_number ?? 0);
	} else if (typeof counted?.season_number === "number") {
		current = counted.season_number;
		outInCurrent = (counted.episodes ?? []).filter((episode) => !!episode.air_date && episode.air_date <= today).length;
	} else {
		for (const season of seasons) aired.set(season.season_number, 0);
		return aired;
	}

	for (const season of seasons) {
		const number = season.season_number;
		aired.set(number, number < current ? whole(season) : number === current ? outInCurrent : 0);
	}
	return aired;
}

/** TMDB's season name, unless it only says "Season N". */
function seasonName(season: TmdbTvSeasonSummary & { season_number: number }): string | null {
	const name = season.name?.trim() ?? "";
	return name === "" || name === `Season ${season.season_number}` ? null : name;
}

/** Cast in TMDB's own billing order across every season; members with no order sort last. */
function castOf(details: TmdbTvDetails): string[] {
	const cast = [...(details.aggregate_credits?.cast ?? [])];
	cast.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
	return cleanNames(cast);
}

export function toTvMetadata(
	details: TmdbTvDetails,
	today: string,
	counted: TmdbTvSeasonDetails | null = null,
): TvMetadata {
	const title = details.name?.trim() || details.original_name?.trim() || "";
	const finished = isFinished(details);
	const aired = airedBySeason(details, today, counted);
	return {
		title,
		originalTitle: details.original_name?.trim() || title,
		year: yearOf(details.first_air_date),
		endYear: finished ? yearOf(details.last_air_date) : null,
		creators: cleanNames(details.created_by),
		genres: cleanNames(details.genres),
		cast: castOf(details),
		networks: cleanNames(details.networks),
		status: details.status?.trim() || null,
		finished,
		seasons: regularSeasons(details)
			.map((season) => ({
				season: season.season_number,
				name: seasonName(season),
				year: yearOf(season.air_date),
				episodes: aired.get(season.season_number) ?? 0,
			}))
			.filter((season) => season.episodes > 0),
		tmdbTvId: details.id,
		posterPath: details.poster_path ?? null,
	};
}

/** Whether TMDB's genres mark the show as Japanese animation (see `TvSearchResult.looksLikeAnime`). */
export function detailsLookLikeAnime(details: TmdbTvDetails): boolean {
	const genreIds = (details.genres ?? []).map((genre) => genre.id).filter((id): id is number => typeof id === "number");
	return isAnime(genreIds, details.origin_country, details.original_language);
}
