import { Notice, type App, type TFile } from "obsidian";
import type { NoteResult } from "./anime-actions";
import type { AuthorSearchResult, BookMetadata, BookSearchResult } from "./book";
import { languageName, marcLanguageOf, normalizeIsbn, rankEditions, type BookEdition } from "./book-edition";
import {
	buildAuthorNoteContent,
	buildBookNoteContent,
	buildImportedBookNote,
	editionOfNote,
	markBookFinished,
	readProgressOf,
	refreshAuthorFrontmatter,
	refreshBookFrontmatter,
	setBookEdition,
	startReading,
	type AuthorPhoto,
	type BookLinks,
	type ImportedReading,
} from "./book-note";
import type { ConfirmAnswer, ConfirmRequest } from "./confirm-modal";
import type { Picture } from "./musicbrainz";
import { buildFileName, sanitizeFileName, today } from "./note";
import type { OpenLibraryClient } from "./openlibrary";
import type { FilmTrackerSettings } from "./settings";
import { noteName, reportFailures, type VaultNotes } from "./vault-notes";

/** What the book commands need from Open Library: tests hand in saved answers instead. */
export type BookSource = Pick<OpenLibraryClient, "getBook" | "getAuthor" | "bookCover" | "authorPhoto" | "editions" | "editionByIsbn">;

/** What "Choose edition" picks: an edition from the list, or the one with an ISBN — typed already, or still to be asked for. */
export type EditionChoice = { kind: "edition"; edition: BookEdition } | { kind: "isbn"; isbn: string | null };

/** What a book command needs to ask the user. */
export interface BookUi {
	/** The language Obsidian is in, as it names it: "tr", "en". */
	language(): string;
	/** "Choose edition" — see `EditionPickerModal`; `null` when closed without a pick. */
	pickEdition(bookTitle: string, editions: BookEdition[]): Promise<EditionChoice | null>;
	/** An ISBN, typed in — see `IsbnModal`; `null` when cancelled. */
	askIsbn(): Promise<string | null>;
	/** Asks before something is deleted, or used anyway — see `ConfirmModal`. */
	confirm(request: ConfirmRequest): Promise<ConfirmAnswer>;
}

/** An edition as a notice or a question names it: "Kanat, 2008". */
export function describeEdition(edition: BookEdition): string {
	const parts = [edition.publisher, edition.year === null ? null : String(edition.year), ...edition.languages.slice(0, 1).map(languageName)];
	return parts.filter((part): part is string => part !== null).join(", ") || edition.id;
}

/**
 * Everything the plugin does with books and their authors. Each command
 * writes the one note it was asked for and nothing else: adding a book never
 * creates its author's note.
 */
export class BookActions {
	private readonly app: App;
	private readonly notes: VaultNotes;
	private readonly settings: () => FilmTrackerSettings;
	private readonly ui: BookUi;

	constructor(app: App, notes: VaultNotes, settings: () => FilmTrackerSettings, ui: BookUi) {
		this.app = app;
		this.notes = notes;
		this.settings = settings;
		this.ui = ui;
	}

	private links(sourcePath: string): BookLinks {
		const settings = this.settings();
		return { authors: settings.linkAuthors, genres: settings.linkBookGenres, isResolved: this.notes.isResolved(sourcePath) };
	}

	async addBook(client: BookSource, result: BookSearchResult): Promise<void> {
		await reportFailures("add the book", async () => {
			const existing = this.notes.findNote({ kind: "book", openLibraryId: result.id });
			if (existing) {
				new Notice(`Already in your vault: ${existing.basename}`);
				await this.notes.openNote(existing);
				return;
			}

			const { book } = await client.getBook(result.id);
			const target = await this.notes.newNotePath(this.settings().bookFolder, [buildFileName(book.title, book.year)]);
			if (target === null) return;
			if ("conflict" in target) {
				await this.notes.openConflict(target.conflict);
				return;
			}
			const notePath = target.path;

			const picture = book.coverId === null ? null : await client.bookCover(book.coverId);
			const cover = await this.saveImage(picture, noteName(notePath), notePath, this.settings().bookCoverFolder, "the cover");
			const coverLink = cover === null ? null : this.notes.imageLink(cover, notePath);
			const note = await this.app.vault.create(notePath, buildBookNoteContent(book, coverLink, this.links(notePath)));
			await this.notes.openNote(note);
			new Notice(cover === null ? `Added ${book.title}. No cover was found.` : `Added ${book.title}`);
		});
	}

	/**
	 * A book from an import, in `folder`: the note "Add book" writes, with the
	 * user's edition and where they are with it (see `buildImportedBookNote`),
	 * and the edition's cover where it has one, else the book's. Never opened.
	 */
	async createImportedBook(
		client: BookSource,
		book: BookMetadata,
		edition: BookEdition | null,
		reading: ImportedReading,
		folder: string,
	): Promise<NoteResult> {
		const target = await this.notes.newNotePath(folder, [buildFileName(book.title, book.year)]);
		if (target === null) return "no-folder";
		if ("conflict" in target) return "conflict";
		const notePath = target.path;

		const coverId = edition?.coverId ?? book.coverId;
		const picture = coverId === null ? null : await client.bookCover(coverId);
		const cover = await this.saveImage(picture, noteName(notePath), notePath, this.settings().bookCoverFolder, "the cover");
		const coverLink = cover === null ? null : this.notes.imageLink(cover, notePath);
		await this.app.vault.create(notePath, buildImportedBookNote(book, coverLink, this.links(notePath), edition, reading));
		return "created";
	}

	async addAuthor(client: BookSource, result: AuthorSearchResult): Promise<void> {
		await reportFailures("add the author", async () => {
			const existing = this.notes.findNote({ kind: "author", openLibraryId: result.id });
			if (existing) {
				new Notice(`Already in your vault: ${existing.basename}`);
				await this.notes.openNote(existing);
				return;
			}

			const author = await client.getAuthor(result.id);
			const target = await this.notes.newNotePath(this.settings().authorFolder, [sanitizeFileName(author.name)]);
			if (target === null) return;
			if ("conflict" in target) {
				await this.notes.openConflict(target.conflict);
				return;
			}
			const notePath = target.path;

			const picture = await client.authorPhoto(author);
			const photo = await this.photoOf(picture, noteName(notePath), notePath);
			const note = await this.app.vault.create(notePath, buildAuthorNoteContent(author, photo));
			await this.notes.openNote(note);
			new Notice(photo === null ? `Added ${author.name}. No photo was found.` : `Added ${author.name}`);
		});
	}

	/** "Refresh book metadata from Open Library", on a book or an author: the same note written from fresh data, nothing of the user's touched. */
	async refresh(client: BookSource, file: TFile): Promise<void> {
		const note = this.notes.kindOf(file);
		if (note?.kind === "book") await this.refreshBook(client, file, note.openLibraryId);
		else if (note?.kind === "author") await this.refreshAuthor(client, file, note.openLibraryId);
	}

	private async refreshBook(client: BookSource, file: TFile, id: string): Promise<void> {
		await reportFailures("refresh the book", async () => {
			const { book, facts } = await client.getBook(id);
			const previous = this.notes.frontmatterOf(file) ?? {};
			let coverLink: string | null = null;
			// A cover is only looked for when the note has none, or its file is gone: the one there stays.
			if ((isBlank(previous.poster) || this.notes.posterMissing(file)) && book.coverId !== null) {
				const cover = await this.saveImage(await client.bookCover(book.coverId), file.basename, file.path, this.settings().bookCoverFolder, "the cover");
				coverLink = cover === null ? null : this.notes.imageLink(cover, file.path);
			}
			// Asked again after the download: a cover the user set meanwhile stays.
			const missing = this.notes.posterMissing(file);
			const written = await this.notes.rewriteFrontmatter(file, (content) =>
				refreshBookFrontmatter(content, book, facts, this.links(file.path), coverLink, previous, missing),
			);
			if (!written) return;
			new Notice(facts === null ? `Refreshed ${book.title}. Wikidata couldn't be reached, so its year, authors and genres were left as they were.` : `Refreshed ${book.title}`);
		});
	}

	private async refreshAuthor(client: BookSource, file: TFile, id: string): Promise<void> {
		await reportFailures("refresh the author", async () => {
			const author = await client.getAuthor(id);
			const previous = this.notes.frontmatterOf(file) ?? {};
			let photo: AuthorPhoto | null = null;
			if (isBlank(previous.poster) || this.notes.posterMissing(file)) {
				photo = await this.photoOf(await client.authorPhoto(author), file.basename, file.path);
			}
			const missing = this.notes.posterMissing(file);
			if (!(await this.notes.rewriteFrontmatter(file, (content) => refreshAuthorFrontmatter(content, author, photo, previous, missing)))) return;
			new Notice(`Refreshed ${author.name}`);
		});
	}

	/** "Start reading": the book is being read now — again, if it was finished before. */
	async startReading(file: TFile): Promise<void> {
		const date = today();
		if (!(await this.notes.rewriteFrontmatter(file, (content) => startReading(content, date)))) return;
		new Notice(`Reading ${file.basename}.`);
	}

	/** "Mark book as finished today": read, dated the first time, and counted once more. */
	async markFinishedToday(file: TFile): Promise<void> {
		const { readCount } = readProgressOf(this.notes.frontmatterOf(file));
		const date = today();
		if (!(await this.notes.rewriteFrontmatter(file, (content) => markBookFinished(content, date, readCount)))) return;
		const times = readCount + 1;
		new Notice(`Finished ${file.basename} today — ${times === 1 ? "the first time" : `${times} times so far`}.`);
	}

	/**
	 * "Choose edition": the book's editions on Open Library, those in the
	 * user's language first, or the one with an ISBN they type. The one picked
	 * becomes the note's own — see `setBookEdition`. Its cover is saved
	 * beside the old one, never over it, and the old one is only deleted when
	 * the user says so, and only offered when nothing else uses it.
	 */
	async chooseEdition(client: BookSource, file: TFile): Promise<void> {
		const note = this.notes.kindOf(file);
		if (note?.kind !== "book") return;

		await reportFailures("choose the edition", async () => {
			new Notice(`Loading the editions of ${file.basename}…`);
			const editions = rankEditions(await client.editions(note.openLibraryId), marcLanguageOf(this.ui.language()));
			const choice = await this.ui.pickEdition(file.basename, editions);
			if (choice === null) return;
			const edition = choice.kind === "edition" ? choice.edition : await this.editionByIsbn(client, choice.isbn, note.openLibraryId);
			if (edition === null) return;
			await this.useEdition(client, file, edition);
		});
	}

	/** The edition with the ISBN the user types, once they agree to one Open Library files under another record. */
	private async editionByIsbn(client: BookSource, typed: string | null, workId: string): Promise<BookEdition | null> {
		const text = typed ?? (await this.ui.askIsbn());
		if (text === null) return null;
		const isbn = normalizeIsbn(text);
		if (isbn === null) {
			new Notice("That isn't an ISBN, or a digit of it is mistyped. An ISBN has 13 digits, or 10 in older books.");
			return null;
		}
		const edition = await client.editionByIsbn(isbn);
		if (edition === null) {
			new Notice(`Open Library has no edition with ISBN ${isbn}.`);
			return null;
		}
		if (edition.workId !== workId) {
			const answer = await this.ui.confirm({
				title: "Use this edition?",
				message: `On Open Library, ISBN ${isbn} (${describeEdition(edition)}) is filed under another record than this book's: most often a second copy of the same book's record. Use it for this note anyway?`,
				confirmLabel: "Use it",
				destructive: false,
			});
			if (answer === null) return null;
		}
		// An edition can have more than one ISBN: the one typed is the user's.
		return { ...edition, isbn };
	}

	private async useEdition(client: BookSource, file: TFile, edition: BookEdition): Promise<void> {
		const previous = this.notes.frontmatterOf(file) ?? {};
		const before = editionOfNote(previous);
		const again = before?.id === edition.id;
		// The translators are the user's once written: for this very edition, theirs stay.
		const own = again ? (before?.translators ?? []) : [];
		const translators = own.length > 0 ? own : edition.translators;

		const oldCover = this.notes.unusedTopLevelPoster(file);
		let cover: TFile | null = null;
		if (edition.coverId !== null && !(again && !this.notes.posterMissing(file))) {
			cover = await this.saveImage(await client.bookCover(edition.coverId), file.basename, file.path, this.settings().bookCoverFolder, "the cover");
		}
		const coverLink = cover === null ? null : this.notes.imageLink(cover, file.path);
		if (!(await this.notes.rewriteFrontmatter(file, (content) => setBookEdition(content, edition, translators, coverLink, previous)))) return;
		const noCover = edition.coverId === null && !again ? " Open Library has no cover for it, so the one there stays." : "";
		new Notice(`${file.basename} is now your ${describeEdition(edition)} edition.${noCover}`);

		if (cover === null || oldCover === null || oldCover.path === cover.path) return;
		const answer = await this.ui.confirm({
			title: "Delete the old cover?",
			message: `No note uses ${oldCover.name} now that ${file.basename} has its edition's cover. It's deleted the way Obsidian's "Deleted files" setting says.`,
			confirmLabel: "Delete",
			cancelLabel: "Keep",
		});
		if (answer !== null) await this.notes.deleteFile(oldCover);
	}

	/** The Open Library id of an author's note, for BIBLIOGRAPHY's "Add book…". */
	authorIdOf(file: TFile): string | null {
		const note = this.notes.kindOf(file);
		return note?.kind === "author" ? note.openLibraryId : null;
	}

	private async photoOf(picture: Picture | null, baseName: string, notePath: string): Promise<AuthorPhoto | null> {
		const file = await this.saveImage(picture, baseName, notePath, this.settings().authorPhotoFolder, "the photo");
		return file === null ? null : { link: this.notes.imageLink(file, notePath), credit: picture?.credit ?? null };
	}

	private async saveImage(picture: Picture | null, baseName: string, notePath: string, folder: string, what: string): Promise<TFile | null> {
		if (picture === null) return null;
		return this.notes.saveImage(async () => picture.data, `${baseName}.${picture.extension ?? "jpg"}`, notePath, folder, what);
	}
}

function isBlank(value: unknown): boolean {
	return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}
