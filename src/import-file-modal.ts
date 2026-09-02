import { App, FuzzySuggestModal, TFile } from "obsidian";

/** Lets the user pick the Letterboxd CSV they dragged into their vault. */
export class CsvFileModal extends FuzzySuggestModal<TFile> {
	private readonly onPick: (file: TFile) => void;

	constructor(app: App, onPick: (file: TFile) => void) {
		super(app);
		this.onPick = onPick;
		this.setPlaceholder("Pick the Letterboxd CSV file you added to your vault…");
		this.emptyStateText =
			"No .csv files found. Export your data from Letterboxd, unzip it, and drag diary.csv or watched.csv into your vault first.";
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles().filter((file) => file.extension === "csv");
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}
