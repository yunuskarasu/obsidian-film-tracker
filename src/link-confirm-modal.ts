import { App, Modal, Setting } from "obsidian";

export type LinkChoice = "link" | "separate";

/**
 * Asks before Add anime or Add manga links a work into the note open in the
 * editor. That note is the only link target the plugin ever considers, and
 * linking rewrites it, so the user confirms — or keeps the work as a note of
 * its own. Closing the dialog cancels: `onChoose` gets `null`.
 */
export class LinkConfirmModal extends Modal {
	private readonly workTitle: string;
	private readonly side: "anime" | "manga";
	private readonly noteName: string;
	private readonly alsoIn: string[];
	private readonly onChoose: (choice: LinkChoice | null) => void;
	private choice: LinkChoice | null = null;

	constructor(
		app: App,
		workTitle: string,
		side: "anime" | "manga",
		noteName: string,
		alsoIn: string[],
		onChoose: (choice: LinkChoice | null) => void,
	) {
		super(app);
		this.workTitle = workTitle;
		this.side = side;
		this.noteName = noteName;
		this.alsoIn = alsoIn;
		this.onChoose = onChoose;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Link to this note?" });
		contentEl.createEl("p", {
			text: `Add ${this.workTitle} to ${this.noteName} as its ${this.side} side, or keep it as a separate note.`,
		});
		if (this.alsoIn.length > 0) {
			contentEl.createEl("p", {
				cls: "film-tracker-link-also-in",
				text: `Already in ${this.alsoIn.join(", ")}. That's fine: the same ${this.side} can be on one note per adaptation.`,
			});
		}

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Separate note").onClick(() => this.choose("separate")))
			.addButton((button) =>
				button
					.setButtonText("Link to this note")
					.setCta()
					.onClick(() => this.choose("link")),
			);
	}

	private choose(choice: LinkChoice): void {
		this.choice = choice;
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		this.onChoose(this.choice);
	}
}
