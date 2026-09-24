import { App, Modal, Setting } from "obsidian";

export type AlreadyTrackedChoice = "open" | "add";

/** Which catalogue the notes already in the vault came from. */
export type TrackedSide = "anime" | "tv";

const SIDES = {
	anime: { noun: "an anime", source: "MyAnimeList", other: "TMDB", open: "Open the anime note" },
	tv: { noun: "a TV series", source: "TMDB", other: "MyAnimeList", open: "Open the TV series note" },
};

/**
 * Asks before a work the vault already tracks on one side is added on the
 * other: an anime note for a show TMDB also lists, or the other way round.
 * The two catalogues share no id, so this can only go by the titles (see
 * `anime-match.ts`) and is never certain — which is why it asks rather than
 * refusing. Closing the dialog cancels: `onChoose` gets `null`.
 */
export class AlreadyTrackedModal extends Modal {
	private readonly title: string;
	private readonly noteNames: string[];
	private readonly side: TrackedSide;
	private readonly onChoose: (choice: AlreadyTrackedChoice | null) => void;
	private choice: AlreadyTrackedChoice | null = null;

	constructor(
		app: App,
		title: string,
		noteNames: string[],
		side: TrackedSide,
		onChoose: (choice: AlreadyTrackedChoice | null) => void,
	) {
		super(app);
		this.title = title;
		this.noteNames = noteNames;
		this.side = side;
		this.onChoose = onChoose;
	}

	onOpen(): void {
		const { contentEl } = this;
		const side = SIDES[this.side];
		contentEl.createEl("h2", { text: `Already in your vault as ${side.noun}` });
		contentEl.createEl("p", {
			text: `${this.noteNames.join(", ")} already tracks ${this.title}, with episodes from ${side.source}.`,
		});
		contentEl.createEl("p", {
			text: `Adding it from ${side.other} as well gives it a second note, with a count of its own. That is fine if you want both.`,
		});

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Add anyway").onClick(() => this.choose("add")))
			.addButton((button) =>
				button
					.setButtonText(side.open)
					.setCta()
					.onClick(() => this.choose("open")),
			);
	}

	private choose(choice: AlreadyTrackedChoice): void {
		this.choice = choice;
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		this.onChoose(this.choice);
	}
}
