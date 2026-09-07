import { App, SuggestModal } from "obsidian";
import type { MangaAuthor } from "./mal";

/**
 * Lets the user pick which of a manga's several credited authors to add as a
 * mangaka. Unlike `AnimeSearchModal`/`MangaSearchModal`/`DirectorSearchModal`,
 * this never calls MAL — the candidates are already fully known from the
 * same `getManga` call that found there was more than one, since MAL's API
 * has no person-search endpoint to query live. `getSuggestions` is a plain
 * synchronous filter over that small, fixed list.
 */
export class MangakaPickerModal extends SuggestModal<MangaAuthor> {
	private readonly candidates: readonly MangaAuthor[];
	private readonly onPick: (author: MangaAuthor) => void;

	constructor(app: App, candidates: readonly MangaAuthor[], onPick: (author: MangaAuthor) => void) {
		super(app);
		this.candidates = candidates;
		this.onPick = onPick;
		this.setPlaceholder("Pick a mangaka…");
	}

	getSuggestions(query: string): MangaAuthor[] {
		const trimmed = query.trim().toLowerCase();
		if (trimmed === "") return [...this.candidates];
		return this.candidates.filter((author) => author.name.toLowerCase().includes(trimmed));
	}

	renderSuggestion(author: MangaAuthor, el: HTMLElement): void {
		el.createDiv({ cls: "film-tracker-suggestion-title" }).createSpan({ text: author.name });
	}

	onChooseSuggestion(author: MangaAuthor): void {
		this.onPick(author);
	}
}
