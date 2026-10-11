import { App, FuzzySuggestModal, TFile } from "obsidian";

/** What the picker says for one service's export. */
export interface CsvFileTexts {
	placeholder: string;
	empty: string;
}

const LETTERBOXD: CsvFileTexts = {
	placeholder: "Pick the Letterboxd CSV file you added to your vault…",
	empty: "No .csv files found. Export your data from Letterboxd, unzip it, and drag diary.csv or watched.csv into your vault first.",
};

/** Lets the user pick the CSV export they dragged into their vault: Letterboxd's, unless `texts` says whose. */
export class CsvFileModal extends FuzzySuggestModal<TFile> {
	private readonly onPick: (file: TFile) => void;

	constructor(app: App, onPick: (file: TFile) => void, texts: CsvFileTexts = LETTERBOXD) {
		super(app);
		this.onPick = onPick;
		this.setPlaceholder(texts.placeholder);
		this.emptyStateText = texts.empty;
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
