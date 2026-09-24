import { App, Notice, SuggestModal } from "obsidian";
import {
	MalError,
	formatMediaType,
	type AnimeSearchResult,
	type MalClient,
	type MangaSearchResult,
} from "./mal";
import {
	TmdbError,
	type FilmSearchResult,
	type PersonSearchResult,
	type TmdbClient,
} from "./tmdb";
import type { TvSearchResult } from "./tmdb-tv";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** What one kind of search needs besides the shared behaviour of `ApiSearchModal`. */
interface SearchSource<T> {
	placeholder: string;
	emptyText: string;
	search: (query: string) => Promise<T[]>;
	render: (item: T, el: HTMLElement) => void;
	/** Named in the message for a failure that isn't the API's own error. */
	service: "TMDB" | "MyAnimeList";
}

/**
 * The search box behind every Add command. It waits for the user to stop
 * typing, drops answers to a query that is no longer the latest one, and
 * shows an API error once rather than on every keystroke.
 */
class ApiSearchModal<T> extends SuggestModal<T> {
	private readonly source: SearchSource<T>;
	private readonly onPick: (item: T) => void;
	private latestQuery = "";
	private lastErrorShown = "";

	constructor(app: App, source: SearchSource<T>, onPick: (item: T) => void) {
		super(app);
		this.source = source;
		this.onPick = onPick;
		this.setPlaceholder(source.placeholder);
		this.emptyStateText = source.emptyText;
	}

	async getSuggestions(query: string): Promise<T[]> {
		const trimmed = query.trim();
		this.latestQuery = trimmed;
		if (trimmed.length < MIN_QUERY_LENGTH) return [];

		await delay(DEBOUNCE_MS);
		if (this.latestQuery !== trimmed) return [];

		try {
			const results = await this.source.search(trimmed);
			this.lastErrorShown = "";
			return this.latestQuery === trimmed ? results : [];
		} catch (error) {
			this.reportOnce(error);
			return [];
		}
	}

	renderSuggestion(item: T, el: HTMLElement): void {
		this.source.render(item, el);
	}

	onChooseSuggestion(item: T): void {
		this.onPick(item);
	}

	private reportOnce(error: unknown): void {
		const known = error instanceof TmdbError || error instanceof MalError;
		const message = known ? error.message : `${this.source.service} search failed.`;
		if (!known) console.error("Film + Anime-Manga Tracker: search failed", error);
		if (message === this.lastErrorShown) return;
		this.lastErrorShown = message;
		new Notice(message);
	}
}

/**
 * A result row: the title, what tells it apart on the right (year, type,
 * department), and optionally a second line under it.
 */
function renderRow(el: HTMLElement, title: string, details: (string | null)[], secondLine?: string): void {
	const primary = el.createDiv({ cls: "film-tracker-suggestion-title" });
	primary.createSpan({ text: title });
	const shown = details.filter((detail): detail is string => detail !== null && detail !== "");
	if (shown.length > 0) {
		primary.createSpan({ cls: "film-tracker-suggestion-year", text: shown.join(" · ") });
	}
	if (secondLine !== undefined) {
		el.createDiv({ cls: "film-tracker-suggestion-original", text: secondLine });
	}
}

function yearText(year: number | null): string | null {
	return year === null ? null : String(year);
}

/**
 * Where a result comes from, said outright at the start of its line. The two
 * catalogues hold different things — a MyAnimeList entry is one season with
 * its manga, a TMDB show is every season with its cast — so a result that
 * exists in both is a real choice, and hiding which is which would only make
 * it harder.
 */
function source(name: "TMDB" | "MAL", ...rest: (string | null)[]): (string | null)[] {
	return [name, ...rest];
}

export function openFilmSearch(app: App, client: TmdbClient, onPick: (film: FilmSearchResult) => void): void {
	new ApiSearchModal(
		app,
		{
			placeholder: "Search for a film…",
			emptyText: "No films found.",
			search: (query) => client.search(query),
			render: (film, el) =>
				renderRow(
					el,
					film.title,
					source("TMDB", "Film", yearText(film.year)),
					film.originalTitle !== film.title ? film.originalTitle : undefined,
				),
			service: "TMDB",
		},
		onPick,
	).open();
}

/**
 * TMDB lists anime among its TV shows as well, where a show is every season
 * at once with its cast and crew; MyAnimeList has each season as an entry of
 * its own, with the manga beside it. A result that exists both ways says so,
 * so the choice is between what the two give rather than between two names.
 */
export function openTvSearch(app: App, client: TmdbClient, onPick: (show: TvSearchResult) => void): void {
	new ApiSearchModal(
		app,
		{
			placeholder: "Search for a TV series…",
			emptyText: "No TV series found.",
			search: (query) => client.searchTv(query),
			render: (show, el) =>
				renderRow(
					el,
					show.title,
					source(
						"TMDB",
						"TV series",
						yearText(show.year),
						show.looksLikeAnime ? "anime — Add anime has it season by season, with its manga" : "seasons, cast and crew",
					),
					show.originalTitle !== show.title ? show.originalTitle : undefined,
				),
			service: "TMDB",
		},
		onPick,
	).open();
}

export function openDirectorSearch(
	app: App,
	client: TmdbClient,
	onPick: (person: PersonSearchResult) => void,
): void {
	new ApiSearchModal(
		app,
		{
			placeholder: "Search for a director…",
			emptyText: "No people found.",
			search: (query) => client.searchPerson(query),
			render: (person, el) => renderRow(el, person.name, source("TMDB", person.department)),
			service: "TMDB",
		},
		onPick,
	).open();
}

/** The type sits next to the year: a TV series and its film often share both title and year. */
export function openAnimeSearch(
	app: App,
	client: MalClient,
	onPick: (anime: AnimeSearchResult) => void,
): void {
	new ApiSearchModal(
		app,
		{
			placeholder: "Search for an anime…",
			emptyText: "No anime found.",
			search: (query) => client.search(query),
			render: (anime, el) =>
				renderRow(
					el,
					anime.title,
					source("MAL", "Anime", formatMediaType(anime.mediaType), yearText(anime.year), "episode by episode"),
				),
			service: "MyAnimeList",
		},
		onPick,
	).open();
}

/**
 * MyAnimeList's manga catalog also holds light novels, novels and one-shots,
 * often under exactly the same title as the manga — the type and year are
 * what tell them apart here.
 */
export function openMangaSearch(
	app: App,
	client: MalClient,
	onPick: (manga: MangaSearchResult) => void,
): void {
	new ApiSearchModal(
		app,
		{
			placeholder: "Search for a manga…",
			emptyText: "No manga found.",
			search: (query) => client.searchManga(query),
			render: (manga, el) =>
				renderRow(el, manga.title, source("MAL", formatMediaType(manga.mediaType), yearText(manga.year))),
			service: "MyAnimeList",
		},
		onPick,
	).open();
}
