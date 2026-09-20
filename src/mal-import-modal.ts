import { App, Modal, Notice, Setting } from "obsidian";
import { LIST_STATUSES, type MalListSelection } from "./mal-importer";

/**
 * Asks whose list to import and how much of it, before anything is fetched.
 * Closing the dialog cancels.
 */
export class MalImportModal extends Modal {
	private readonly onConfirm: (userName: string, selection: MalListSelection) => void;
	private userName = "";
	private anime = true;
	private manga = true;
	private readonly statuses = new Set(
		LIST_STATUSES.filter((status) => status.on).flatMap((status) => status.values),
	);

	constructor(app: App, onConfirm: (userName: string, selection: MalListSelection) => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Import from MyAnimeList" });
		contentEl.createEl("p", {
			text:
				"Everything picked below gets a note, and what you have completed arrives watched or read. " +
				"Anything already in your vault is left where it is. The list has to be public — that's a " +
				"MyAnimeList setting, not something the plugin can change.",
		});

		new Setting(contentEl)
			.setName("MyAnimeList username")
			.setDesc("Whose list to read. Your own list is the usual answer.")
			.addText((text) =>
				text.setPlaceholder("Username").onChange((value) => {
					this.userName = value.trim();
				}),
			);

		new Setting(contentEl)
			.setName("Anime list")
			.addToggle((toggle) =>
				toggle.setValue(this.anime).onChange((value) => {
					this.anime = value;
				}),
			);

		new Setting(contentEl)
			.setName("Manga list")
			.addToggle((toggle) =>
				toggle.setValue(this.manga).onChange((value) => {
					this.manga = value;
				}),
			);

		new Setting(contentEl).setName("Which shelves").setHeading();
		for (const status of LIST_STATUSES) {
			new Setting(contentEl).setName(status.label).addToggle((toggle) =>
				toggle.setValue(status.on).onChange((value) => {
					for (const name of status.values) {
						if (value) this.statuses.add(name);
						else this.statuses.delete(name);
					}
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
		if (this.userName === "") {
			new Notice("Type the MyAnimeList username whose list to import.");
			return;
		}
		if (!this.anime && !this.manga) {
			new Notice("Pick the anime list, the manga list, or both.");
			return;
		}
		if (this.statuses.size === 0) {
			new Notice("Pick at least one shelf to import.");
			return;
		}

		const selection: MalListSelection = {
			anime: this.anime,
			manga: this.manga,
			statuses: [...this.statuses],
		};
		this.close();
		this.onConfirm(this.userName, selection);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
