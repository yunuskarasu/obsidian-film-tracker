import { Notice, type App } from "obsidian";
import type { FilmActions } from "./film-actions";
import { writeImportReport, type ImportFailure } from "./import-report";
import { pickBestMatch, type LetterboxdRow } from "./letterboxd-import";
import { markWatched, setWatchDate } from "./note";
import type { FilmSearchResult, TmdbClient } from "./tmdb";
import type { VaultNotes } from "./vault-notes";

/** Kept well under TMDB's rate limit while an import works through a long list. */
const IMPORT_DELAY_MS = 250;

/** What the import shows while it runs — `ImportProgressModal` in the app. */
export interface ImportProgress {
	isCancelled(): boolean;
	setStatus(text: string): void;
	close(): void;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Import from Letterboxd: one film note per row of an export, the report for the rows TMDB couldn't match. */
export class LetterboxdImporter {
	private readonly app: App;
	private readonly notes: VaultNotes;
	private readonly films: FilmActions;
	private active = false;

	constructor(app: App, notes: VaultNotes, films: FilmActions) {
		this.app = app;
		this.notes = notes;
		this.films = films;
	}

	/**
	 * Whether an import is under way. Only one runs at a time: a second would
	 * race the first to create the same notes, and TMDB would get twice the
	 * requests the delay between rows allows for.
	 */
	get running(): boolean {
		return this.active;
	}

	async run(
		client: TmdbClient,
		rows: LetterboxdRow[],
		markAsWatched: boolean,
		progress: ImportProgress,
	): Promise<void> {
		if (this.active) throw new Error("A Letterboxd import is already running.");
		this.active = true;
		try {
			await this.importRows(client, rows, markAsWatched, progress);
		} finally {
			this.active = false;
		}
	}

	private async importRows(
		client: TmdbClient,
		rows: LetterboxdRow[],
		markAsWatched: boolean,
		progress: ImportProgress,
	): Promise<void> {
		let imported = 0;
		let skipped = 0;
		const failures: ImportFailure[] = [];

		for (let i = 0; i < rows.length; i++) {
			if (progress.isCancelled()) break;
			const row = rows[i];
			progress.setStatus(`${i + 1}/${rows.length}: ${row.name}`);

			try {
				const outcome = await this.importRow(client, row, markAsWatched);
				if (outcome === "imported") imported += 1;
				else skipped += 1;
			} catch (error) {
				const reason = error instanceof Error ? error.message : "Unexpected error.";
				failures.push({ name: row.name, detail: row.year === null ? "" : String(row.year), reason });
			}

			if (i < rows.length - 1) await delay(IMPORT_DELAY_MS);
		}

		const cancelled = progress.isCancelled();
		progress.close();
		await writeImportReport(this.app, this.notes, {
			intro: "Imported from Letterboxd.",
			counts: [
				["Imported", imported],
				["Skipped (already in vault)", skipped],
				["Not matched", failures.length],
			],
			detailColumn: "Year",
			failures,
		});

		new Notice(
			`Imported ${imported}, skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}, ` +
				`${failures.length} not matched${cancelled ? " (cancelled)" : ""}.`,
		);
	}

	/**
	 * A film already in the vault is never recreated, but it still gets what
	 * the export knows about it: the diary's watch date where `watch_date` is
	 * empty, and — when the user chose "Mark as watched" — a ticked `watched`.
	 */
	async importRow(
		client: TmdbClient,
		row: LetterboxdRow,
		markAsWatched: boolean,
	): Promise<"imported" | "skipped"> {
		const match = await this.findMatch(client, row);
		if (match === null) {
			const withinYear = row.year === null ? "" : ` within a year of ${row.year}`;
			throw new Error(`No TMDB match found for "${row.name}"${withinYear}.`);
		}

		const existing = this.notes.findNote({ kind: "film", tmdbId: match.id });
		if (existing) {
			const watchedDate = row.watchedDate;
			if (watchedDate !== null || markAsWatched) {
				await this.app.vault.process(existing, (content) => {
					const dated = watchedDate === null ? content : setWatchDate(content, watchedDate);
					return markAsWatched ? markWatched(dated) : dated;
				});
			}
			return "skipped";
		}

		const film = await client.getFilm(match.id);
		const result = await this.films.createFilmNote(client, film, {
			watchDate: row.watchedDate,
			watched: markAsWatched,
			open: false,
		});
		if (result === "no-folder") {
			throw new Error("The Film folder setting names a file, not a folder.");
		}
		if (result === "conflict") {
			// A same-named note of the plugin's own would have been stepped
			// past (see `chooseNotePath`): this one is the user's, without an id.
			throw new Error(`A note already exists for "${film.title}" but has no tmdb_id.`);
		}
		return "imported";
	}

	/**
	 * The TMDB film a Letterboxd row names. Searching with the row's year
	 * first keeps a common title from being lost among its namesakes; when
	 * that finds nothing close enough — TMDB can file a film under the
	 * neighbouring year — the title is searched on its own, under the same
	 * year check (see `pickBestMatch`).
	 */
	private async findMatch(client: TmdbClient, row: LetterboxdRow): Promise<FilmSearchResult | null> {
		if (row.year !== null) {
			const match = pickBestMatch(await client.search(row.name, row.year), row.year);
			if (match !== null) return match;
		}
		return pickBestMatch(await client.search(row.name), row.year);
	}

}
