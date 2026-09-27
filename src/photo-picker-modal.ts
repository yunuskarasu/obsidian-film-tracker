import { App, FuzzySuggestModal, Modal, Setting, TFile } from "obsidian";
import type { PhotoCandidate } from "./musicbrainz";

/**
 * What "Change photo" came back with: one of the photos on offer, or the
 * wish to take one from the vault or from a web address instead.
 */
export type PhotoChoice =
	| { kind: "candidate"; candidate: PhotoCandidate }
	| { kind: "vault" }
	| { kind: "url" };

/**
 * "Change photo": every photo on offer for an artist, side by side, each
 * with whom it would credit, and under them the two other ways to a photo.
 * Picking closes the window; closing it any other way picks nothing, and the
 * note stays as it is.
 */
export class PhotoPickerModal extends Modal {
	private readonly artistName: string;
	private readonly candidates: PhotoCandidate[];
	private readonly onDone: (choice: PhotoChoice | null) => void;
	private choice: PhotoChoice | null = null;

	constructor(
		app: App,
		artistName: string,
		candidates: PhotoCandidate[],
		onDone: (choice: PhotoChoice | null) => void,
	) {
		super(app);
		this.artistName = artistName;
		this.candidates = candidates;
		this.onDone = onDone;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: `Choose a photo of ${this.artistName}` });

		if (this.candidates.length === 0) {
			contentEl.createEl("p", { cls: "film-tracker-empty", text: "Deezer and Wikimedia Commons have no photo of them." });
		}
		const grid = contentEl.createDiv({ cls: "film-tracker-photo-grid" });
		for (const candidate of this.candidates) {
			const button = grid.createEl("button", { cls: "film-tracker-photo-choice" });
			button.createEl("img", { attr: { src: candidate.url, alt: `${this.artistName}, from ${candidate.source}` } });
			button.createDiv({ cls: "film-tracker-photo-source", text: candidate.source });
			if (candidate.credit !== candidate.source) {
				button.createDiv({ cls: "film-tracker-photo-credit", text: candidate.credit });
			}
			button.addEventListener("click", () => this.finish({ kind: "candidate", candidate }));
		}

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Choose from your vault…").onClick(() => this.finish({ kind: "vault" })))
			.addButton((button) => button.setButtonText("From a web address…").onClick(() => this.finish({ kind: "url" })));
	}

	onClose(): void {
		this.contentEl.empty();
		this.onDone(this.choice);
	}

	private finish(choice: PhotoChoice): void {
		this.choice = choice;
		this.close();
	}
}

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp"];

/** Every picture in the vault, filtered as you type — a photo the user already has. */
export class VaultImageModal extends FuzzySuggestModal<TFile> {
	private readonly onDone: (image: TFile | null) => void;
	private chosen: TFile | null = null;

	constructor(app: App, onDone: (image: TFile | null) => void) {
		super(app);
		this.onDone = onDone;
		this.setPlaceholder("Pick a picture from your vault…");
		this.emptyStateText = "No pictures match.";
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles().filter((file) => IMAGE_EXTENSIONS.includes(file.extension.toLowerCase()));
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.chosen = file;
	}

	onClose(): void {
		super.onClose();
		// Obsidian closes the window before it reports the pick: wait for that.
		window.setTimeout(() => this.onDone(this.chosen), 0);
	}
}

/** Asks for the address of a picture on the web. */
export class ImageUrlModal extends Modal {
	private readonly onDone: (url: string | null) => void;
	private url = "";
	private submitted = false;

	constructor(app: App, onDone: (url: string | null) => void) {
		super(app);
		this.onDone = onDone;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Photo from a web address" });
		contentEl.createEl("p", { text: "Paste the address of the picture itself — one that ends in .jpg or .png, say — not of the page it is on." });

		new Setting(contentEl).setName("Address").addText((text) => {
			text.setPlaceholder("Paste the address here").onChange((value) => (this.url = value));
			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter") this.submit();
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});
		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Use this picture").setCta().onClick(() => this.submit()))
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
		this.onDone(this.submitted && this.url.trim() !== "" ? this.url.trim() : null);
	}

	private submit(): void {
		this.submitted = true;
		this.close();
	}
}
