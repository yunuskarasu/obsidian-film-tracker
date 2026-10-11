import { Notice, type App } from "obsidian";
import type { BookActions, BookSource } from "./book-actions";
import type { BookEdition } from "./book-edition";
import { fillImportedBook, type ImportedReading } from "./book-note";
import { sameBook, type GoodreadsRow, type ShelfGroup } from "./goodreads-import";
import { writeImportReport, type ImportFailure } from "./import-report";
import type { ImportProgress } from "./letterboxd-importer";
import { joinPath, sanitizeFileName } from "./note";
import type { OpenLibraryClient } from "./openlibrary";
import type { FilmTrackerSettings } from "./settings";
import type { VaultNotes } from "./vault-notes";

/** What the import needs from Open Library: tests hand in saved answers instead. */
export type GoodreadsSource = BookSource & Pick<OpenLibraryClient, "findBook">;

type Outcome = "added" | "updated" | "skipped";

/** Something that stops the whole import rather than just one book. */
class ImportStopped extends Error {}

/**
 * Import from Goodreads: a note for every book on the shelves the user
 * picked, in the folder of its first shelf of their own, with their edition
 * and where they are with it. Open Library has no Goodreads ids, so each
 * book is looked up by its title and author — Open Library's first answer
 * is the book itself far more often than a stray copy of its record — and
 * its ISBN, on Open Library, is the user's edition. A book with no match by
 * title is found by its ISBN alone, as long as the edition's title is the
 * row's. Open Library's pace — a request a second — sets the import's: no
 * pause of its own is needed.
 */
export class GoodreadsImporter {
	private readonly app: App;
	private readonly notes: VaultNotes;
	private readonly books: BookActions;
	private readonly settings: () => FilmTrackerSettings;
	private active = false;

	constructor(app: App, notes: VaultNotes, books: BookActions, settings: () => FilmTrackerSettings) {
		this.app = app;
		this.notes = notes;
		this.books = books;
		this.settings = settings;
	}

	/** Whether an import is under way. Only one runs at a time, as with the other imports. */
	get running(): boolean {
		return this.active;
	}

	async run(client: GoodreadsSource, rows: GoodreadsRow[], groups: ShelfGroup[], progress: ImportProgress): Promise<void> {
		if (this.active) throw new Error("A Goodreads import is already running.");
		this.active = true;
		try {
			await this.importRows(
				client,
				rows.filter((row) => groups.includes(row.group)),
				progress,
			);
		} finally {
			this.active = false;
		}
	}

	private async importRows(client: GoodreadsSource, rows: GoodreadsRow[], progress: ImportProgress): Promise<void> {
		const tally = { added: 0, updated: 0, skipped: 0 };
		const failures: ImportFailure[] = [];
		let stopped: string | null = null;

		for (const [index, row] of rows.entries()) {
			if (progress.isCancelled()) break;
			progress.setStatus(`${index + 1}/${rows.length}: ${row.title}`);
			try {
				tally[await this.importRow(client, row)] += 1;
			} catch (error) {
				if (error instanceof ImportStopped) {
					stopped = error.message;
					break;
				}
				failures.push({ name: row.title, detail: row.author, reason: error instanceof Error ? error.message : "Unexpected error." });
			}
		}

		const cancelled = progress.isCancelled();
		progress.close();
		await writeImportReport(this.app, this.notes, {
			intro: "Imported from Goodreads.",
			counts: [
				["Added", tally.added],
				["Updated (filled in)", tally.updated],
				["Skipped (already in your vault)", tally.skipped],
				["Not matched", failures.length],
			],
			detailColumn: "Author",
			failures,
		});

		if (stopped !== null) {
			new Notice(stopped);
			return;
		}
		const left = failures.length === 0 ? "" : `, ${failures.length} not matched`;
		new Notice(`Added ${tally.added}, updated ${tally.updated}, skipped ${tally.skipped}${left}${cancelled ? " (cancelled)" : ""}.`);
	}

	/**
	 * One row. A book already in the vault is never recreated or moved: it
	 * is only filled in where it is empty (see `fillImportedBook`).
	 */
	async importRow(client: GoodreadsSource, row: GoodreadsRow): Promise<Outcome> {
		const [found] = await client.findBook(row.searchTitle, row.author);
		const byIsbn = row.isbn === null ? null : await client.editionByIsbn(row.isbn);
		const workId = found?.id ?? (byIsbn !== null && sameBook(byIsbn.title, row) ? byIsbn.workId : null);
		if (workId === null) {
			throw new Error(row.isbn === null ? "Open Library has no match for its title and author." : `Open Library has no match for its title and author, or its ISBN ${row.isbn}.`);
		}
		// The ISBN's edition is the user's when it is this book's: filed under it, or titled as the row is — under a stray copy of its record.
		const edition: BookEdition | null =
			byIsbn !== null && row.isbn !== null && (byIsbn.workId === workId || sameBook(byIsbn.title, row)) ? { ...byIsbn, isbn: row.isbn } : null;
		const reading: ImportedReading = { status: row.status, finished: row.finished, readCount: row.readCount, shelves: row.shelves };

		const existing = this.notes.findNote({ kind: "book", openLibraryId: workId });
		if (existing !== null) {
			const previous = this.notes.frontmatterOf(existing) ?? {};
			let changed = false;
			await this.app.vault.process(existing, (content) => {
				const filled = fillImportedBook(content, edition, reading, previous);
				changed = filled !== content;
				return filled;
			});
			return changed ? "updated" : "skipped";
		}

		const { book } = await client.getBook(workId);
		const root = this.settings().bookFolder;
		const [shelf] = row.shelves;
		const folder = shelf === undefined ? root : joinPath(root, sanitizeFileName(shelf));
		const result = await this.books.createImportedBook(client, book, edition, reading, folder);
		if (result === "no-folder") {
			if (folder === root) throw new ImportStopped("The book folder setting names a file, not a folder.");
			throw new Error(`"${folder}" is a file, not a folder.`);
		}
		if (result === "conflict") throw new Error(`A note of your own is already called "${book.title}".`);
		return "added";
	}
}
