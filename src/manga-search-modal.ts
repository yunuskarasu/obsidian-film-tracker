import { App, Notice, SuggestModal } from "obsidian";
import { MalError, type MalClient, type MangaSearchResult } from "./mal";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class MangaSearchModal extends SuggestModal<MangaSearchResult> {
	private readonly client: MalClient;
	private readonly onPick: (manga: MangaSearchResult) => void;
	private latestQuery = "";
	private lastErrorShown = "";

	constructor(app: App, client: MalClient, onPick: (manga: MangaSearchResult) => void) {
		super(app);
		this.client = client;
		this.onPick = onPick;
		this.setPlaceholder("Search for a manga…");
		this.emptyStateText = "No manga found.";
	}

	async getSuggestions(query: string): Promise<MangaSearchResult[]> {
		const trimmed = query.trim();
		this.latestQuery = trimmed;
		if (trimmed.length < MIN_QUERY_LENGTH) return [];

		await delay(DEBOUNCE_MS);
		if (this.latestQuery !== trimmed) return [];

		try {
			const results = await this.client.searchManga(trimmed);
			this.lastErrorShown = "";
			return this.latestQuery === trimmed ? results : [];
		} catch (error) {
			this.reportOnce(error);
			return [];
		}
	}

	renderSuggestion(manga: MangaSearchResult, el: HTMLElement): void {
		el.createDiv({ cls: "film-tracker-suggestion-title" }).createSpan({ text: manga.title });
	}

	onChooseSuggestion(manga: MangaSearchResult): void {
		this.onPick(manga);
	}

	private reportOnce(error: unknown): void {
		const message = error instanceof MalError ? error.message : "MyAnimeList search failed.";
		if (!(error instanceof MalError)) {
			console.error("Film, Anime & Manga Tracker: manga search failed", error);
		}
		if (message === this.lastErrorShown) return;
		this.lastErrorShown = message;
		new Notice(message);
	}
}
