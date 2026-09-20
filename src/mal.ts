import { requestUrl } from "obsidian";

const API_BASE = "https://api.myanimelist.net/v2";
/**
 * MAL's `fields` parameter replaces the default field set rather than adding
 * to it, so `main_picture` must be listed explicitly — omitting it silently
 * drops the poster from every response, `id` and `title` are the only fields
 * always returned regardless of this list.
 */
export const DETAIL_FIELDS =
	"main_picture,alternative_titles,media_type,num_episodes,genres,studios,status,start_date,end_date";

/**
 * The `authors{node{id,first_name,last_name}}` nested-field syntax is
 * required — bare `authors` only returns each person's id, and the flatter
 * `authors{first_name,last_name}` silently drops the field. `node{id,...}`
 * additionally surfaces the author's own MAL person id (MAL's default
 * `authors` selector omits it otherwise) — the only way to find a mangaka's
 * id at all, since MAL's API has no standalone person-search endpoint.
 * `start_date` and `end_date` are requested the same way the anime side
 * asks for its own years.
 * Confirmed against real API responses before writing this.
 */
export const MANGA_DETAIL_FIELDS =
	"main_picture,media_type,num_volumes,num_chapters,authors{node{id,first_name,last_name}},status,start_date,end_date";

/**
 * MAL's official API has no person-search endpoint (confirmed: `GET
 * /people?q=...` returns 404) — a mangaka's id can only come from a manga's
 * own `authors` list (see `MANGA_DETAIL_FIELDS`). `/people/{id}` itself does
 * work once an id is known; `alternate_names` and `about` were requested
 * during testing and came back empty, so only the fields confirmed to
 * actually return data are asked for here.
 */
export const PERSON_DETAIL_FIELDS = "first_name,last_name,birthday,main_picture";

/**
 * What a search hit carries besides `id` and `title` (the only fields MAL
 * returns unasked): the type and the year are what tell same-titled entries
 * apart in the picker — a TV series from its film, a light novel from the
 * manga adapting it.
 */
export const ANIME_SEARCH_FIELDS = "start_season,media_type";
export const MANGA_SEARCH_FIELDS = "start_date,media_type";

export interface AnimeMetadata {
	title: string;
	englishTitle: string | null;
	japaneseTitle: string | null;
	mediaType: string | null;
	episodes: number | null;
	genres: string[];
	studios: string[];
	status: string | null;
	year: number | null;
	/** The year it finished, when MAL has one — a work still running has none. */
	endYear: number | null;
	malId: number;
	posterUrl: string | null;
}

export interface AnimeSearchResult {
	id: number;
	title: string;
	year: number | null;
	mediaType: string | null;
}

export interface MalPicture {
	medium?: string;
	large?: string;
}

export interface MalAlternativeTitles {
	en?: string;
	ja?: string;
}

export interface MalStudio {
	name?: string;
}

export interface MalGenre {
	name?: string;
}

export interface MalSearchNode {
	id: number;
	title?: string;
	main_picture?: MalPicture;
	start_season?: { year?: number };
	media_type?: string;
}

export interface MalAnimeDetails {
	id: number;
	title?: string;
	main_picture?: MalPicture;
	alternative_titles?: MalAlternativeTitles;
	media_type?: string;
	num_episodes?: number;
	genres?: MalGenre[];
	studios?: MalStudio[];
	status?: string;
	start_date?: string;
	end_date?: string;
}

/** A manga's author as mapped from MAL's `authors` list — `malId` is `null` only if MAL's response is missing the id, which real testing never showed. */
export interface MangaAuthor {
	name: string;
	malId: number | null;
}

export interface MangaMetadata {
	title: string;
	mediaType: string | null;
	chapters: number | null;
	volumes: number | null;
	status: string | null;
	year: number | null;
	endYear: number | null;
	mangaka: MangaAuthor[];
	malId: number;
	posterUrl: string | null;
}

export interface MangaSearchResult {
	id: number;
	title: string;
	year: number | null;
	mediaType: string | null;
}

export interface MalAuthorPerson {
	id?: number;
	first_name?: string;
	last_name?: string;
}

export interface MalAuthor {
	node?: MalAuthorPerson;
	role?: string;
}

export interface MalMangaSearchNode {
	id: number;
	title?: string;
	start_date?: string;
	media_type?: string;
}

export interface MalMangaDetails {
	id: number;
	title?: string;
	main_picture?: MalPicture;
	media_type?: string;
	num_volumes?: number;
	num_chapters?: number;
	authors?: MalAuthor[];
	status?: string;
	start_date?: string;
	end_date?: string;
}

export interface MalPersonDetails {
	id: number;
	first_name?: string;
	last_name?: string;
	birthday?: string;
	main_picture?: MalPicture;
}

export interface MangakaMetadata {
	name: string;
	birthday: string | null;
	malId: number;
	photoUrl: string | null;
}

/**
 * How much of a list one request asks for. MAL allows more, but a smaller
 * page comes back quickly, which is what lets a cancelled import stop soon
 * after it is asked to.
 */
const LIST_PAGE_SIZE = 100;

/** One entry of someone's list: the work itself, and what their list says about it. */
export interface MalListEntry<T> {
	work: T;
	/** MAL's own value — "completed", "watching", "plan_to_watch" … — or `null` when the entry has none. */
	listStatus: string | null;
	/** Episodes watched or chapters read, as the list has them; `null` when it says nothing. */
	progress: number | null;
	/** The day the list says it was finished ("2019-04-07"), or `null` — MAL only has one where the user filled it in. */
	finishDate: string | null;
}

export interface MalListPage<T> {
	entries: MalListEntry<T>[];
	/** Where the next page starts, or `null` at the end of the list. */
	nextOffset: number | null;
}

interface MalListStatus {
	status?: string;
	num_episodes_watched?: number;
	num_chapters_read?: number;
	finish_date?: string;
}

interface MalListResponse<N> {
	data?: { node: N; list_status?: MalListStatus }[];
	paging?: { next?: string };
}

/** Episodes watched or chapters read — whichever of the two this list is about. */
function listProgress(status: MalListStatus | undefined): number | null {
	const value = status?.num_episodes_watched ?? status?.num_chapters_read;
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function toListPage<N, T>(body: MalListResponse<N>, offset: number, map: (node: N) => T): MalListPage<T> {
	const entries = (body.data ?? []).map((entry) => ({
		work: map(entry.node),
		listStatus: entry.list_status?.status?.trim() || null,
		progress: listProgress(entry.list_status),
		finishDate: entry.list_status?.finish_date?.trim() || null,
	}));
	// A `next` link with nothing on the page would ask for the same offset for ever.
	const more = body.paging?.next !== undefined && entries.length > 0;
	return { entries, nextOffset: more ? offset + entries.length : null };
}

export class MalError extends Error {}

function cleanNames(values: ({ name?: string } | undefined)[]): string[] {
	return values.map((value) => value?.name?.trim() ?? "").filter((name) => name !== "");
}

export function parseYearFromDate(date: string | undefined): number | null {
	if (!date) return null;
	const year = Number(date.slice(0, 4));
	return Number.isInteger(year) && year > 0 ? year : null;
}

function bestPicture(picture: MalPicture | undefined): string | null {
	return picture?.large?.trim() || picture?.medium?.trim() || null;
}

export function toAnimeSearchResult(node: MalSearchNode): AnimeSearchResult {
	return {
		id: node.id,
		title: node.title?.trim() ?? "",
		year: node.start_season?.year ?? null,
		mediaType: node.media_type?.trim() || null,
	};
}

/** MAL's media types whose label isn't just the value with a capital letter. */
const MEDIA_TYPE_LABELS: Record<string, string> = {
	tv: "TV",
	ova: "OVA",
	ona: "ONA",
	tv_special: "TV special",
	cm: "CM",
	pv: "PV",
	one_shot: "One-shot",
	oel: "OEL",
};

/**
 * A MAL media type as the search pickers show it: "light_novel" becomes
 * "Light novel", "tv" becomes "TV". A type not in the table loses its
 * underscores and gains a capital letter, so one MAL adds later still reads
 * fine.
 */
export function formatMediaType(value: string | null): string | null {
	const key = value?.trim().toLowerCase() ?? "";
	if (key === "") return null;
	return MEDIA_TYPE_LABELS[key] ?? humanize(key);
}

/**
 * A MAL status as the MANGA panel shows it: "currently_publishing" becomes
 * "Currently publishing", "on_hiatus" becomes "On hiatus".
 */
export function formatStatus(value: string | null): string | null {
	const key = value?.trim().toLowerCase() ?? "";
	return key === "" ? null : humanize(key);
}

/** One of MAL's snake_case values as text: underscores become spaces, the first letter a capital. */
function humanize(key: string): string {
	const words = key.replace(/_/g, " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function joinPersonName(person: { first_name?: string; last_name?: string } | undefined): string {
	return [person?.first_name?.trim(), person?.last_name?.trim()]
		.filter((part): part is string => !!part && part !== "")
		.join(" ");
}

function toMangaAuthor(author: MalAuthor): MangaAuthor {
	return { name: joinPersonName(author.node), malId: author.node?.id ?? null };
}

export function toMangaSearchResult(node: MalMangaSearchNode): MangaSearchResult {
	return {
		id: node.id,
		title: node.title?.trim() ?? "",
		year: parseYearFromDate(node.start_date),
		mediaType: node.media_type?.trim() || null,
	};
}

export function toMangaMetadata(details: MalMangaDetails): MangaMetadata {
	return {
		title: details.title?.trim() ?? "",
		mediaType: details.media_type?.trim() || null,
		chapters:
			details.num_chapters !== undefined && details.num_chapters > 0
				? details.num_chapters
				: null,
		volumes:
			details.num_volumes !== undefined && details.num_volumes > 0
				? details.num_volumes
				: null,
		status: details.status?.trim() || null,
		year: parseYearFromDate(details.start_date),
		endYear: parseYearFromDate(details.end_date),
		mangaka: (details.authors ?? []).map(toMangaAuthor).filter((author) => author.name !== ""),
		malId: details.id,
		posterUrl: bestPicture(details.main_picture),
	};
}

export function toMangakaMetadata(details: MalPersonDetails): MangakaMetadata {
	return {
		name: joinPersonName(details),
		birthday: details.birthday?.trim() || null,
		malId: details.id,
		photoUrl: bestPicture(details.main_picture),
	};
}

export function toAnimeMetadata(details: MalAnimeDetails): AnimeMetadata {
	const title = details.title?.trim() ?? "";
	return {
		title,
		englishTitle: details.alternative_titles?.en?.trim() || null,
		japaneseTitle: details.alternative_titles?.ja?.trim() || null,
		mediaType: details.media_type?.trim() || null,
		episodes:
			details.num_episodes !== undefined && details.num_episodes > 0
				? details.num_episodes
				: null,
		genres: cleanNames(details.genres ?? []),
		studios: cleanNames(details.studios ?? []),
		status: details.status?.trim() || null,
		year: parseYearFromDate(details.start_date),
		endYear: parseYearFromDate(details.end_date),
		malId: details.id,
		posterUrl: bestPicture(details.main_picture),
	};
}

export class MalClient {
	constructor(private readonly clientId: string) {}

	async search(query: string): Promise<AnimeSearchResult[]> {
		const params = new URLSearchParams({
			q: query,
			limit: "10",
			fields: ANIME_SEARCH_FIELDS,
		});
		const body = await this.getJson<{ data?: { node: MalSearchNode }[] }>(
			`${API_BASE}/anime?${params.toString()}`,
		);
		return (body.data ?? []).map((entry) => toAnimeSearchResult(entry.node));
	}

	async getAnime(id: number): Promise<AnimeMetadata> {
		const params = new URLSearchParams({ fields: DETAIL_FIELDS });
		const details = await this.getJson<MalAnimeDetails>(
			`${API_BASE}/anime/${id}?${params.toString()}`,
		);
		return toAnimeMetadata(details);
	}

	async searchManga(query: string): Promise<MangaSearchResult[]> {
		const params = new URLSearchParams({ q: query, limit: "10", fields: MANGA_SEARCH_FIELDS });
		const body = await this.getJson<{ data?: { node: MalMangaSearchNode }[] }>(
			`${API_BASE}/manga?${params.toString()}`,
		);
		return (body.data ?? []).map((entry) => toMangaSearchResult(entry.node));
	}

	async getManga(id: number): Promise<MangaMetadata> {
		const params = new URLSearchParams({ fields: MANGA_DETAIL_FIELDS });
		const details = await this.getJson<MalMangaDetails>(
			`${API_BASE}/manga/${id}?${params.toString()}`,
		);
		return toMangaMetadata(details);
	}

	async getPerson(id: number): Promise<MangakaMetadata> {
		const params = new URLSearchParams({ fields: PERSON_DETAIL_FIELDS });
		const details = await this.getJson<MalPersonDetails>(
			`${API_BASE}/people/${id}?${params.toString()}`,
		);
		return toMangakaMetadata(details);
	}

	/**
	 * A page of someone's public anime list. The works' own fields are asked
	 * for alongside `list_status`, so a list costs one request per hundred
	 * entries rather than one per entry — where MAL answers without them, the
	 * import fills the entry in with `getAnime`.
	 */
	async animeListPage(userName: string, offset: number): Promise<MalListPage<AnimeMetadata>> {
		const body = await this.listJson<MalAnimeDetails>(userName, "animelist", DETAIL_FIELDS, offset);
		return toListPage(body, offset, toAnimeMetadata);
	}

	/** A page of someone's public manga list — see `animeListPage`. */
	async mangaListPage(userName: string, offset: number): Promise<MalListPage<MangaMetadata>> {
		const body = await this.listJson<MalMangaDetails>(userName, "mangalist", MANGA_DETAIL_FIELDS, offset);
		return toListPage(body, offset, toMangaMetadata);
	}

	private async listJson<N>(
		userName: string,
		path: "animelist" | "mangalist",
		fields: string,
		offset: number,
	): Promise<MalListResponse<N>> {
		const params = new URLSearchParams({
			fields: `list_status,${fields}`,
			limit: String(LIST_PAGE_SIZE),
			offset: String(offset),
			// Without this, MAL leaves everything it marks as adult out of the list.
			nsfw: "true",
		});
		return this.getJson<MalListResponse<N>>(
			`${API_BASE}/users/${encodeURIComponent(userName)}/${path}?${params.toString()}`,
			{
				403: `${userName}'s list on MyAnimeList isn't public.`,
				404: `MyAnimeList has no user called "${userName}".`,
			},
		);
	}

	async downloadImage(url: string): Promise<ArrayBuffer> {
		const response = await this.request(url);
		if (response.status !== 200) {
			throw new MalError(`Image download failed (HTTP ${response.status}).`);
		}
		return response.arrayBuffer;
	}

	private async request(url: string) {
		try {
			return await requestUrl({
				url,
				throw: false,
				headers: { "X-MAL-CLIENT-ID": this.clientId },
			});
		} catch (error) {
			console.error("Film + Anime-Manga Tracker: MAL request failed", error);
			throw new MalError("Could not reach MyAnimeList. Check your internet connection.");
		}
	}

	private async getJson<T>(url: string, errors: Record<number, string> = {}): Promise<T> {
		const response = await this.request(url);
		const known = errors[response.status];
		if (known !== undefined) throw new MalError(known);
		if (response.status === 401) throw new MalError("Invalid MyAnimeList client ID.");
		if (response.status === 429) {
			throw new MalError("MyAnimeList rate limit reached. Try again in a moment.");
		}
		if (response.status !== 200) {
			throw new MalError(`MyAnimeList request failed (HTTP ${response.status}).`);
		}
		return response.json as T;
	}
}
