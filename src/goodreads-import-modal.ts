import { App, Modal, Notice, Setting } from "obsidian";
import type { GoodreadsRow, ShelfGroup } from "./goodreads-import";

/** The shelves the dialog offers, every one picked to begin with. */
const GROUPS: { group: ShelfGroup; label: string }[] = [
	{ group: "read", label: "Read" },
	{ group: "currently-reading", label: "Currently reading" },
	{ group: "to-read", label: "Want to read" },
	{ group: "own", label: "Your own exclusive shelves" },
];

/** Open Library's pace: a request a second, about three to a book. */
const SECONDS_A_BOOK = 3;

/**
 * Shows what the export holds, shelf by shelf, and asks which shelves to
 * import before anything is fetched. Closing the dialog cancels.
 */
export class GoodreadsImportModal extends Modal {
	private readonly rows: GoodreadsRow[];
	private readonly onConfirm: (groups: ShelfGroup[]) => void;
	private readonly groups = new Set<ShelfGroup>(GROUPS.map(({ group }) => group));

	constructor(app: App, rows: GoodreadsRow[], onConfirm: (groups: ShelfGroup[]) => void) {
		super(app);
		this.rows = rows;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Import from Goodreads" });
		const minutes = Math.max(1, Math.round((this.rows.length * SECONDS_A_BOOK) / 60));
		contentEl.createEl("p", {
			text:
				`Found ${this.rows.length} book${this.rows.length === 1 ? "" : "s"} in this file. Each one is looked up on Open Library, ` +
				`which answers one request a second, so this takes about ${minutes} minute${minutes === 1 ? "" : "s"} for all of them. ` +
				"A book goes in the folder of its first shelf of your own, with the edition you shelved. " +
				"Books already in your vault stay where they are and are only filled in where they are empty. " +
				"Your ratings and reviews are not imported.",
		});

		new Setting(contentEl).setName("Which shelves").setHeading();
		for (const { group, label } of GROUPS) {
			const count = this.rows.filter((row) => row.group === group).length;
			if (count === 0) continue;
			new Setting(contentEl).setName(`${label} (${count})`).addToggle((toggle) =>
				toggle.setValue(true).onChange((value) => {
					if (value) this.groups.add(group);
					else this.groups.delete(group);
				}),
			);
		}

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText("Import")
					.setCta()
					.onClick(() => this.start()),
			);
	}

	private start(): void {
		const groups = [...this.groups].filter((group) => this.rows.some((row) => row.group === group));
		if (groups.length === 0) {
			new Notice("Pick at least one shelf to import.");
			return;
		}
		this.close();
		this.onConfirm(groups);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
