import { App, Modal, Setting } from "obsidian";

/**
 * Shows the row count and asks for confirmation before any network call is
 * made. Also where the user confirms whether the films were watched: the
 * starting value comes from the file name (see `isWatchedExport`), since a
 * watchlist export looks exactly like watched.csv.
 */
export class ImportConfirmModal extends Modal {
	private readonly count: number;
	private markAsWatched: boolean;
	private readonly onConfirm: (markAsWatched: boolean) => void;

	constructor(
		app: App,
		count: number,
		markAsWatched: boolean,
		onConfirm: (markAsWatched: boolean) => void,
	) {
		super(app);
		this.count = count;
		this.markAsWatched = markAsWatched;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Import from Letterboxd" });
		contentEl.createEl("p", {
			text:
				`Found ${this.count} film${this.count === 1 ? "" : "s"} in this file. ` +
				"Film + Anime-Manga Tracker will search TMDB for each one and create a note for anything " +
				"not already in your vault. This can take a while for large exports.",
		});

		new Setting(contentEl)
			.setName("Mark these films as watched")
			.setDesc(
				"Ticks watched on every film in this file, including notes already in your vault. " +
					"Leave it off for a watchlist.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.markAsWatched).onChange((value) => {
					this.markAsWatched = value;
				}),
			);

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText("Import")
					.setCta()
					.onClick(() => {
						this.close();
						this.onConfirm(this.markAsWatched);
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Reports progress while the import runs and lets the user stop it early:
 * with Cancel, or by closing the dialog, which can't be brought back.
 */
export class ImportProgressModal extends Modal {
	private statusEl: HTMLElement | null = null;
	private cancelled = false;

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Importing from Letterboxd…" });
		this.statusEl = contentEl.createEl("p", { text: "Starting…" });

		new Setting(contentEl).addButton((button) =>
			button.setButtonText("Cancel").onClick(() => {
				this.cancelled = true;
				button.setDisabled(true).setButtonText("Cancelling…");
			}),
		);
	}

	isCancelled(): boolean {
		return this.cancelled;
	}

	setStatus(text: string): void {
		this.statusEl?.setText(text);
	}

	onClose(): void {
		// Esc, the close button or a click outside stops the import as Cancel
		// does. The import closes the dialog itself once it is done, after it
		// has read `isCancelled` for the last time.
		this.cancelled = true;
		this.contentEl.empty();
	}
}
