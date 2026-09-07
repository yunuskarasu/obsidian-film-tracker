import { requestUrl } from "obsidian";
import { buildAliases, type FilmMetadata } from "./note";

const API_BASE = "https://api.themoviedb.org/3";
const POSTER_BASE = "https://image.tmdb.org/t/p/w500";

/**
 * TMDB returns the English title in `title` and the original-language title in
 * `original_title`. When a film has no English translation, `title` falls back
 * to the original title server-side, which is exactly the behaviour we want.
 */
const LANGUAGE = "en-US";

export interface FilmSearchResult {
	id: number;
	title: string;
	originalTitle: string;
	year: number | null;
}

export interface TmdbSearchItem {
	id: number;
	title?: string;
	original_title?: string;
	release_date?: string;
}

export interface TmdbCastMember {
	name?: string;
	order?: number;
}

export interface TmdbMovieDetails {
	id: number;
	title?: string;
	original_title?: string;
	release_date?: string;
	runtime?: number | null;
	poster_path?: string | null;
	genres?: { name?: string }[];
	credits?: { cast?: TmdbCastMember[]; crew?: { job?: string; name?: string }[] };
}

export interface TmdbPersonSearchItem {
	id: number;
	name?: string;
	known_for_department?: string;
}

export interface TmdbPersonDetails {
	id: number;
	name?: string;
	birthday?: string | null;
	deathday?: string | null;
	place_of_birth?: string | null;
	profile_path?: string | null;
	also_known_as?: string[];
}

export interface PersonSearchResult {
	id: number;
	name: string;
	department: string | null;
}

export interface DirectorMetadata {
	name: string;
	originalName: string | null;
	aliases: string[];
	birthday: string | null;
	deathday: string | null;
	placeOfBirth: string | null;
	tmdbId: number;
	photoPath: string | null;
}

export class TmdbError extends Error {}

export function parseYear(releaseDate: string | undefined): number | null {
	if (!releaseDate) return null;
	const year = Number(releaseDate.slice(0, 4));
	return Number.isInteger(year) && year > 0 ? year : null;
}

function cleanNames(values: ({ name?: string } | undefined)[]): string[] {
	return values
		.map((value) => value?.name?.trim() ?? "")
		.filter((name) => name !== "");
}

export function toSearchResult(item: TmdbSearchItem): FilmSearchResult {
	const title = item.title?.trim() || item.original_title?.trim() || "";
	return {
		id: item.id,
		title,
		originalTitle: item.original_title?.trim() || title,
		year: parseYear(item.release_date),
	};
}

export function toPersonSearchResult(item: TmdbPersonSearchItem): PersonSearchResult {
	return {
		id: item.id,
		name: item.name?.trim() ?? "",
		department: item.known_for_department?.trim() || null,
	};
}

/**
 * TMDB's `also_known_as` has no language tags, so there is no direct way to
 * know which alternate spelling is the director's own-language name. The
 * best available signal is `place_of_birth`: guessing its writing system
 * from a short list of country/region keywords, then picking the first
 * `also_known_as` entry actually written in that script. This only works
 * for scripts distinct from Latin — a French, Polish or German name looks
 * just as "Latin" as the English one, with nothing in the data to tell them
 * apart, so those are deliberately left undetected (see `toDirectorMetadata`).
 */
const SCRIPT_COUNTRIES: { script: RegExp; countries: string[] }[] = [
	{
		script: /[Ѐ-ӿ]/,
		countries: [
			"russia",
			"ussr",
			"soviet union",
			"ukraine",
			"belarus",
			"kazakhstan",
			"uzbekistan",
			"kyrgyzstan",
			"tajikistan",
			"turkmenistan",
			"bulgaria",
			"mongolia",
		],
	},
	// Checked ahead of the CJK Han range below: kana characters are unique to
	// Japanese, so this is what tells a Japanese name apart from a Chinese one.
	{ script: /[぀-ヿ]/, countries: ["japan"] },
	{ script: /[一-鿿]/, countries: ["china", "taiwan", "hong kong", "macau", "macao"] },
	{ script: /[가-힯]/, countries: ["korea"] },
	{
		script: /[؀-ۿ]/,
		countries: [
			"egypt",
			"saudi arabia",
			"united arab emirates",
			"iraq",
			"syria",
			"jordan",
			"lebanon",
			"morocco",
			"algeria",
			"tunisia",
			"libya",
			"kuwait",
			"qatar",
			"bahrain",
			"oman",
			"yemen",
			"palestine",
			"iran",
			"pakistan",
		],
	},
	{ script: /[֐-׿]/, countries: ["israel"] },
	{ script: /[Ͱ-Ͽ]/, countries: ["greece", "cyprus"] },
	{ script: /[฀-๿]/, countries: ["thailand"] },
];

export function detectOriginalName(
	name: string,
	alsoKnownAs: string[] | undefined,
	placeOfBirth: string | null,
): string | null {
	if (placeOfBirth === null || alsoKnownAs === undefined) return null;

	const location = placeOfBirth.toLowerCase();
	const match = SCRIPT_COUNTRIES.find((entry) =>
		entry.countries.some((country) => location.includes(country)),
	);
	if (match === undefined) return null;

	const candidate = alsoKnownAs
		.map((value) => value.trim())
		.find((value) => value !== "" && value !== name && match.script.test(value));
	return candidate ?? null;
}

export function toDirectorMetadata(details: TmdbPersonDetails): DirectorMetadata {
	const name = details.name?.trim() ?? "";
	const placeOfBirth = details.place_of_birth?.trim() || null;
	const originalName = detectOriginalName(name, details.also_known_as, placeOfBirth);
	return {
		name,
		originalName,
		aliases: buildAliases(name, originalName),
		birthday: details.birthday?.trim() || null,
		deathday: details.deathday?.trim() || null,
		placeOfBirth,
		tmdbId: details.id,
		photoPath: details.profile_path ?? null,
	};
}

/** TMDB's own billing order, ascending; members with no order sort last. */
function sortByBilling(cast: TmdbCastMember[]): TmdbCastMember[] {
	return [...cast].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
}

export function toFilmMetadata(details: TmdbMovieDetails): FilmMetadata {
	const title = details.title?.trim() || details.original_title?.trim() || "";
	const crew = details.credits?.crew ?? [];
	const cast = details.credits?.cast ?? [];
	return {
		title,
		originalTitle: details.original_title?.trim() || title,
		year: parseYear(details.release_date),
		directors: cleanNames(crew.filter((member) => member.job === "Director")),
		genres: cleanNames(details.genres ?? []),
		cast: cleanNames(sortByBilling(cast)),
		composers: cleanNames(crew.filter((member) => member.job === "Original Music Composer")),
		runtime: details.runtime && details.runtime > 0 ? details.runtime : null,
		tmdbId: details.id,
		posterPath: details.poster_path ?? null,
	};
}

export class TmdbClient {
	constructor(private readonly apiKey: string) {}

	async search(query: string): Promise<FilmSearchResult[]> {
		const params = new URLSearchParams({
			api_key: this.apiKey,
			query,
			language: LANGUAGE,
			include_adult: "false",
			page: "1",
		});
		const body = await this.getJson<{ results?: TmdbSearchItem[] }>(
			`${API_BASE}/search/movie?${params.toString()}`,
		);
		return (body.results ?? []).map(toSearchResult);
	}

	async getFilm(id: number): Promise<FilmMetadata> {
		const params = new URLSearchParams({
			api_key: this.apiKey,
			language: LANGUAGE,
			append_to_response: "credits",
		});
		const details = await this.getJson<TmdbMovieDetails>(
			`${API_BASE}/movie/${id}?${params.toString()}`,
		);
		return toFilmMetadata(details);
	}

	async searchPerson(query: string): Promise<PersonSearchResult[]> {
		const params = new URLSearchParams({
			api_key: this.apiKey,
			query,
			language: LANGUAGE,
			include_adult: "false",
			page: "1",
		});
		const body = await this.getJson<{ results?: TmdbPersonSearchItem[] }>(
			`${API_BASE}/search/person?${params.toString()}`,
		);
		return (body.results ?? []).map(toPersonSearchResult);
	}

	async getPerson(id: number): Promise<DirectorMetadata> {
		const params = new URLSearchParams({ api_key: this.apiKey, language: LANGUAGE });
		const details = await this.getJson<TmdbPersonDetails>(
			`${API_BASE}/person/${id}?${params.toString()}`,
		);
		return toDirectorMetadata(details);
	}

	async downloadImage(imagePath: string): Promise<ArrayBuffer> {
		const response = await this.request(`${POSTER_BASE}${imagePath}`);
		if (response.status !== 200) {
			throw new TmdbError(`Image download failed (HTTP ${response.status}).`);
		}
		return response.arrayBuffer;
	}

	private async request(url: string) {
		try {
			return await requestUrl({ url, throw: false });
		} catch (error) {
			console.error("Film, Anime & Manga Tracker: TMDB request failed", error);
			throw new TmdbError("Could not reach TMDB. Check your internet connection.");
		}
	}

	private async getJson<T>(url: string): Promise<T> {
		const response = await this.request(url);
		if (response.status === 401) throw new TmdbError("Invalid TMDB API key.");
		if (response.status === 429) {
			throw new TmdbError("TMDB rate limit reached. Try again in a moment.");
		}
		if (response.status !== 200) {
			throw new TmdbError(`TMDB request failed (HTTP ${response.status}).`);
		}
		return response.json as T;
	}
}
