import { App, Notice, SuggestModal } from "obsidian";
import { TmdbError, type FilmSearchResult, type TmdbClient } from "./tmdb";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class FilmSearchModal extends SuggestModal<FilmSearchResult> {
	private readonly client: TmdbClient;
	private readonly onPick: (film: FilmSearchResult) => void;
	private latestQuery = "";
	private lastErrorShown = "";

	constructor(app: App, client: TmdbClient, onPick: (film: FilmSearchResult) => void) {
		super(app);
		this.client = client;
		this.onPick = onPick;
		this.setPlaceholder("Search for a film…");
		this.emptyStateText = "No films found.";
	}

	async getSuggestions(query: string): Promise<FilmSearchResult[]> {
		const trimmed = query.trim();
		this.latestQuery = trimmed;
		if (trimmed.length < MIN_QUERY_LENGTH) return [];

		await delay(DEBOUNCE_MS);
		if (this.latestQuery !== trimmed) return [];

		try {
			const results = await this.client.search(trimmed);
			this.lastErrorShown = "";
			return this.latestQuery === trimmed ? results : [];
		} catch (error) {
			this.reportOnce(error);
			return [];
		}
	}

	renderSuggestion(film: FilmSearchResult, el: HTMLElement): void {
		const primary = el.createDiv({ cls: "film-tracker-suggestion-title" });
		primary.createSpan({ text: film.title });
		if (film.year !== null) {
			primary.createSpan({
				cls: "film-tracker-suggestion-year",
				text: String(film.year),
			});
		}
		if (film.originalTitle !== film.title) {
			el.createDiv({
				cls: "film-tracker-suggestion-original",
				text: film.originalTitle,
			});
		}
	}

	onChooseSuggestion(film: FilmSearchResult): void {
		this.onPick(film);
	}

	private reportOnce(error: unknown): void {
		const message = error instanceof TmdbError ? error.message : "TMDB search failed.";
		if (!(error instanceof TmdbError)) {
			console.error("Film Tracker: search failed", error);
		}
		if (message === this.lastErrorShown) return;
		this.lastErrorShown = message;
		new Notice(message);
	}
}
