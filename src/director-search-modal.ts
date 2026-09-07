import { App, Notice, SuggestModal } from "obsidian";
import { TmdbError, type PersonSearchResult, type TmdbClient } from "./tmdb";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class DirectorSearchModal extends SuggestModal<PersonSearchResult> {
	private readonly client: TmdbClient;
	private readonly onPick: (person: PersonSearchResult) => void;
	private latestQuery = "";
	private lastErrorShown = "";

	constructor(app: App, client: TmdbClient, onPick: (person: PersonSearchResult) => void) {
		super(app);
		this.client = client;
		this.onPick = onPick;
		this.setPlaceholder("Search for a director…");
		this.emptyStateText = "No people found.";
	}

	async getSuggestions(query: string): Promise<PersonSearchResult[]> {
		const trimmed = query.trim();
		this.latestQuery = trimmed;
		if (trimmed.length < MIN_QUERY_LENGTH) return [];

		await delay(DEBOUNCE_MS);
		if (this.latestQuery !== trimmed) return [];

		try {
			const results = await this.client.searchPerson(trimmed);
			this.lastErrorShown = "";
			return this.latestQuery === trimmed ? results : [];
		} catch (error) {
			this.reportOnce(error);
			return [];
		}
	}

	renderSuggestion(person: PersonSearchResult, el: HTMLElement): void {
		const primary = el.createDiv({ cls: "film-tracker-suggestion-title" });
		primary.createSpan({ text: person.name });
		if (person.department !== null) {
			primary.createSpan({
				cls: "film-tracker-suggestion-year",
				text: person.department,
			});
		}
	}

	onChooseSuggestion(person: PersonSearchResult): void {
		this.onPick(person);
	}

	private reportOnce(error: unknown): void {
		const message = error instanceof TmdbError ? error.message : "TMDB search failed.";
		if (!(error instanceof TmdbError)) {
			console.error("Film + Anime-Manga Tracker: search failed", error);
		}
		if (message === this.lastErrorShown) return;
		this.lastErrorShown = message;
		new Notice(message);
	}
}
