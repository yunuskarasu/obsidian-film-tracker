import { Notice, type Plugin, type TFile } from "obsidian";
import { parseGoodreadsCsv, type GoodreadsRow } from "../goodreads-import";
import { GoodreadsImportModal } from "../goodreads-import-modal";
import { GoodreadsImporter } from "../goodreads-importer";
import { CsvFileModal } from "../import-file-modal";
import { ImportConfirmModal, ImportProgressModal } from "../import-progress-modal";
import { isWatchedExport, parseLetterboxdCsv, type LetterboxdRow } from "../letterboxd-import";
import { LetterboxdImporter } from "../letterboxd-importer";
import { MalImportModal } from "../mal-import-modal";
import { MalListImporter } from "../mal-importer";
import type { Services } from "../services";
import type { TmdbClient } from "../tmdb";

/** The three imports — Letterboxd, MyAnimeList and Goodreads — of which only one runs at a time. */
export class ImportCommands {
	private readonly letterboxd: LetterboxdImporter;
	private readonly myAnimeList: MalListImporter;
	private readonly goodreads: GoodreadsImporter;

	constructor(private readonly services: Services) {
		const { app, notes } = services;
		this.letterboxd = new LetterboxdImporter(app, notes, services.films);
		this.myAnimeList = new MalListImporter(app, notes, services.anime);
		this.goodreads = new GoodreadsImporter(app, notes, services.books, () => services.settings);
	}

	register(plugin: Plugin): void {
		plugin.addCommand({
			id: "import-letterboxd",
			name: "Import from Letterboxd",
			callback: () => this.startImportFromLetterboxd(),
		});

		plugin.addCommand({
			id: "import-mal",
			name: "Import from MyAnimeList",
			callback: () => this.startImportFromMal(),
		});

		plugin.addCommand({
			id: "import-goodreads",
			name: "Import from Goodreads",
			callback: () => this.startImportFromGoodreads(),
		});
	}

	startImportFromLetterboxd(): void {
		if (this.importRunning()) return;
		const client = this.services.tmdb();
		if (client === null) return;
		new CsvFileModal(this.services.app, (file) => void this.beginLetterboxdImport(client, file)).open();
	}

	/** Only one import runs at a time, of either kind; a second is turned away. */
	private importRunning(): boolean {
		if (!this.letterboxd.running && !this.myAnimeList.running && !this.goodreads.running) return false;
		new Notice("An import is already running.");
		return true;
	}

	/** "Import from MyAnimeList": a note for everything on a public MAL list (see `MalListImporter`). */
	startImportFromMal(): void {
		if (this.importRunning()) return;
		const client = this.services.mal();
		if (client === null) return;
		const { app } = this.services;
		new MalImportModal(app, (userName, selection) => {
			// Asked again: another import may have started while this dialog was open.
			if (this.importRunning()) return;
			const progress = new ImportProgressModal(app, "Importing from MyAnimeList…");
			progress.open();
			void this.myAnimeList.run(client, userName, selection, progress);
		}).open();
	}

	/** "Import from Goodreads": a note for every book in a Goodreads library export (see `GoodreadsImporter`). */
	startImportFromGoodreads(): void {
		if (this.importRunning()) return;
		new CsvFileModal(this.services.app, (file) => void this.beginGoodreadsImport(file), {
			placeholder: "Pick the Goodreads export you added to your vault…",
			empty: 'No .csv files found. On Goodreads, open My Books, then "Import and export", export your library, and drag goodreads_library_export.csv into your vault first.',
		}).open();
	}

	private async beginGoodreadsImport(file: TFile): Promise<void> {
		const { app } = this.services;
		let rows: GoodreadsRow[];
		try {
			rows = parseGoodreadsCsv(await app.vault.read(file));
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not read that file.");
			return;
		}
		if (rows.length === 0) {
			new Notice("No books found in that file.");
			return;
		}

		new GoodreadsImportModal(app, rows, (groups) => {
			// Asked again: another import may have started while this dialog was open.
			if (this.importRunning()) return;
			const progress = new ImportProgressModal(app, "Importing from Goodreads…");
			progress.open();
			void this.goodreads.run(this.services.openLibrary(), rows, groups, progress);
		}).open();
	}

	private async beginLetterboxdImport(client: TmdbClient, file: TFile): Promise<void> {
		const { app } = this.services;
		let rows: LetterboxdRow[];
		try {
			const content = await app.vault.read(file);
			rows = parseLetterboxdCsv(content);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not read that file.";
			new Notice(message);
			return;
		}

		if (rows.length === 0) {
			new Notice("No films found in that file.");
			return;
		}

		new ImportConfirmModal(app, rows.length, isWatchedExport(file.basename), (markAsWatched) => {
			// Asked again: another import may have started while this dialog was open.
			if (this.importRunning()) return;
			const progress = new ImportProgressModal(app, "Importing from Letterboxd…");
			progress.open();
			void this.letterboxd.run(client, rows, markAsWatched, progress);
		}).open();
	}
}
