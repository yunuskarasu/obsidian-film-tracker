import { App, Notice, SuggestModal } from "obsidian";
import { MalError, type AnimeSearchResult, type MalClient } from "./mal";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class AnimeSearchModal extends SuggestModal<AnimeSearchResult> {
	private readonly client: MalClient;
	private readonly onPick: (anime: AnimeSearchResult) => void;
	private latestQuery = "";
	private lastErrorShown = "";

	constructor(app: App, client: MalClient, onPick: (anime: AnimeSearchResult) => void) {
		super(app);
		this.client = client;
		this.onPick = onPick;
		this.setPlaceholder("Search for an anime…");
		this.emptyStateText = "No anime found.";
	}

	async getSuggestions(query: string): Promise<AnimeSearchResult[]> {
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

	renderSuggestion(anime: AnimeSearchResult, el: HTMLElement): void {
		const primary = el.createDiv({ cls: "film-tracker-suggestion-title" });
		primary.createSpan({ text: anime.title });
		if (anime.year !== null) {
			primary.createSpan({
				cls: "film-tracker-suggestion-year",
				text: String(anime.year),
			});
		}
	}

	onChooseSuggestion(anime: AnimeSearchResult): void {
		this.onPick(anime);
	}

	private reportOnce(error: unknown): void {
		const message = error instanceof MalError ? error.message : "MyAnimeList search failed.";
		if (!(error instanceof MalError)) {
			console.error("Film, Anime & Manga Tracker: anime search failed", error);
		}
		if (message === this.lastErrorShown) return;
		this.lastErrorShown = message;
		new Notice(message);
	}
}
