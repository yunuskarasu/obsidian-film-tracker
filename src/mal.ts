import { requestUrl } from "obsidian";

const API_BASE = "https://api.myanimelist.net/v2";
/**
 * MAL's `fields` parameter replaces the default field set rather than adding
 * to it, so `main_picture` must be listed explicitly — omitting it silently
 * drops the poster from every response, `id` and `title` are the only fields
 * always returned regardless of this list.
 */
export const DETAIL_FIELDS =
	"main_picture,alternative_titles,media_type,num_episodes,genres,studios,status,start_date";

/**
 * The `authors{node{id,first_name,last_name}}` nested-field syntax is
 * required — bare `authors` only returns each person's id, and the flatter
 * `authors{first_name,last_name}` silently drops the field. `node{id,...}`
 * additionally surfaces the author's own MAL person id (MAL's default
 * `authors` selector omits it otherwise) — the only way to find a mangaka's
 * id at all, since MAL's API has no standalone person-search endpoint.
 * `start_date` is requested the same way anime's own `year` already is.
 * Confirmed against real API responses before writing this.
 */
export const MANGA_DETAIL_FIELDS =
	"main_picture,media_type,num_volumes,num_chapters,authors{node{id,first_name,last_name}},status,start_date";

/**
 * MAL's official API has no person-search endpoint (confirmed: `GET
 * /people?q=...` returns 404) — a mangaka's id can only come from a manga's
 * own `authors` list (see `MANGA_DETAIL_FIELDS`). `/people/{id}` itself does
 * work once an id is known; `alternate_names` and `about` were requested
 * during testing and came back empty, so only the fields confirmed to
 * actually return data are asked for here.
 */
export const PERSON_DETAIL_FIELDS = "first_name,last_name,birthday,main_picture";

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
	malId: number;
	posterUrl: string | null;
}

export interface AnimeSearchResult {
	id: number;
	title: string;
	year: number | null;
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
	mangaka: MangaAuthor[];
	malId: number;
	posterUrl: string | null;
}

export interface MangaSearchResult {
	id: number;
	title: string;
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

export class MalError extends Error {}

function cleanNames(values: ({ name?: string } | undefined)[]): string[] {
	return values.map((value) => value?.name?.trim() ?? "").filter((name) => name !== "");
}

export function parseYearFromDate(startDate: string | undefined): number | null {
	if (!startDate) return null;
	const year = Number(startDate.slice(0, 4));
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
	};
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
	return { id: node.id, title: node.title?.trim() ?? "" };
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
			fields: "start_season",
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
		const params = new URLSearchParams({ q: query, limit: "10" });
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

	private async getJson<T>(url: string): Promise<T> {
		const response = await this.request(url);
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
