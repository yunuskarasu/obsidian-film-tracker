import { App, Modal, Setting } from "obsidian";

/** Shows the row count and asks for confirmation before any network call is made. */
export class ImportConfirmModal extends Modal {
	private readonly count: number;
	private readonly onConfirm: () => void;

	constructor(app: App, count: number, onConfirm: () => void) {
		super(app);
		this.count = count;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Import from Letterboxd" });
		contentEl.createEl("p", {
			text:
				`Found ${this.count} film${this.count === 1 ? "" : "s"} in this file. ` +
				"Film Tracker will search TMDB for each one and create a note for anything " +
				"not already in your vault. This can take a while for large exports.",
		});

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText("Import")
					.setCta()
					.onClick(() => {
						this.close();
						this.onConfirm();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Reports progress while the import runs and lets the user stop it early. */
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
		this.contentEl.empty();
	}
}
