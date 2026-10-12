import type { Plugin, TFile } from "obsidian";
import { isBook } from "../note-kind";
import { openAuthorSearch, openAuthorWorks, openBookSearch } from "../search-modal";
import type { Services } from "../services";

/** Books, their editions and their authors, from Open Library. */
export class BookCommands {
	constructor(private readonly services: Services) {}

	register(plugin: Plugin): void {
		const { services } = this;

		plugin.addCommand({
			id: "add-book",
			name: "Add book",
			callback: () => this.startAddBook(),
		});

		plugin.addCommand({
			id: "add-author",
			name: "Add author",
			callback: () => this.startAddAuthor(),
		});

		plugin.addCommand({
			id: "refresh-book-metadata",
			name: "Refresh book metadata from Open Library",
			checkCallback: (checking) => {
				const note = services.activeNote();
				if (note === null || (note.kind.kind !== "book" && note.kind.kind !== "author")) return false;
				if (!checking) void services.books.refresh(services.openLibrary(), note.file);
				return true;
			},
		});

		plugin.addCommand({
			id: "start-reading",
			name: "Start reading",
			checkCallback: (checking) => {
				const note = services.activeNote();
				if (note === null || !isBook(note.kind)) return false;
				if (!checking) void services.books.startReading(note.file);
				return true;
			},
		});

		plugin.addCommand({
			id: "finished-reading-today",
			name: "Mark book as finished today",
			checkCallback: (checking) => {
				const note = services.activeNote();
				if (note === null || !isBook(note.kind)) return false;
				if (!checking) void services.books.markFinishedToday(note.file);
				return true;
			},
		});

		plugin.addCommand({
			id: "choose-edition",
			name: "Choose edition",
			checkCallback: (checking) => {
				const note = services.activeNote();
				if (note === null || !isBook(note.kind)) return false;
				if (!checking) void services.books.chooseEdition(services.openLibrary(), note.file);
				return true;
			},
		});
	}

	startAddBook(): void {
		const client = this.services.openLibrary();
		openBookSearch(this.services.app, client, (result) => void this.services.books.addBook(client, result));
	}

	startAddAuthor(): void {
		const client = this.services.openLibrary();
		openAuthorSearch(this.services.app, client, (result) => void this.services.books.addAuthor(client, result));
	}

	/** BIBLIOGRAPHY's "Add book…": the books of the author whose note it is. */
	startAddBookOf(file: TFile): void {
		const { app, notes, books } = this.services;
		const id = books.authorIdOf(file);
		if (id === null) return;
		const client = this.services.openLibrary();
		const name: unknown = notes.frontmatterOf(file)?.name;
		const author = { id, name: typeof name === "string" && name.trim() !== "" ? name.trim() : file.basename };
		void openAuthorWorks(app, client, author, (book) => void books.addBook(client, book));
	}
}
