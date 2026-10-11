import { beforeEach, describe, expect, it } from "vitest";
import { BookActions, type BookUi } from "../src/book-actions";
import { parseGoodreadsCsv, sameBook, withoutSeries, type GoodreadsRow } from "../src/goodreads-import";
import { GoodreadsImporter } from "../src/goodreads-importer";
import { VaultNotes } from "../src/vault-notes";
import { FakeApp, settings } from "./fake-app";
import { replayOpenLibraryClient } from "./openlibrary-fixtures";
import { Notice } from "./obsidian-stub";

/*
 * Import from Goodreads: its library export read, and each book found on
 * Open Library's real answers — tests/fixtures/openlibrary — then written
 * into the vault, or filled into the note already there.
 */

beforeEach(() => {
	Notice.shown.length = 0;
});

const HEADER =
	"Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages," +
	"Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf," +
	"My Review,Spoiler,Private Notes,Read Count,Owned Copies";

/** A row as Goodreads writes one: its ISBNs as `="…"`, so a spreadsheet keeps their zeros. */
function row(fields: {
	title: string;
	author?: string;
	additional?: string;
	isbn?: string;
	isbn13?: string;
	dateRead?: string;
	shelves?: string;
	exclusive: string;
	readCount?: number;
}): string {
	const isbn = (value: string | undefined) => `"=""${value ?? ""}"""`;
	const quoted = (value: string) => `"${value.replace(/"/g, '""')}"`;
	return [
		"1",
		quoted(fields.title),
		quoted(fields.author ?? ""),
		"",
		quoted(fields.additional ?? ""),
		isbn(fields.isbn),
		isbn(fields.isbn13),
		"5",
		"4.10",
		"",
		"Paperback",
		"",
		"",
		"",
		fields.dateRead ?? "",
		"2023/12/01",
		quoted(fields.shelves ?? ""),
		"",
		fields.exclusive,
		quoted("Loved it."),
		"",
		quoted("A note to myself."),
		String(fields.readCount ?? 0),
		"0",
	].join(",");
}

const NO_COUNTRY = row({
	title: "No Country for Old Men",
	author: "Cormac McCarthy",
	isbn13: "9789758859757",
	dateRead: "2024/03/02",
	shelves: "favorites, american",
	exclusive: "read",
	readCount: 2,
});
const KURK = row({ title: "Kürk Mantolu Madonna", author: "Sabahattin Ali", isbn13: "9789753638029", shelves: "currently-reading", exclusive: "currently-reading" });
const CHERRY_ORCHARD = row({ title: "The Cherry Orchard", author: "Anton Chekhov", shelves: "did-not-finish, plays", exclusive: "did-not-finish" });
const UNKNOWN = row({ title: "A Book That Was Never Written (Nowhere, #2)", author: "Nobody Atall", isbn13: "9799999999990", shelves: "to-read", exclusive: "to-read" });

const csv = (...rows: string[]) => [HEADER, ...rows].join("\r\n") + "\r\n";

describe("reading Goodreads' library export", () => {
	it("reads the title, author, ISBN, shelves, read date and read count — and never the rating, review or notes", () => {
		const [book] = parseGoodreadsCsv(String.fromCharCode(0xfeff) + csv(NO_COUNTRY));
		expect(book).toEqual({
			title: "No Country for Old Men",
			searchTitle: "No Country for Old Men",
			author: "Cormac McCarthy",
			isbn: "9789758859757",
			group: "read",
			status: "read",
			finished: "2024-03-02",
			readCount: 2,
			shelves: ["favorites", "american"],
		} satisfies GoodreadsRow);
		expect(JSON.stringify(book)).not.toMatch(/Loved it|note to myself/);
	});

	it("maps the three shelves to read, reading and to read, and a read book is read at least once", () => {
		const rows = parseGoodreadsCsv(
			csv(
				row({ title: "A", author: "X", exclusive: "read" }),
				row({ title: "B", author: "X", exclusive: "currently-reading", shelves: "currently-reading", readCount: 1 }),
				row({ title: "C", author: "X", exclusive: "to-read", shelves: "to-read" }),
			),
		);
		expect(rows.map((found) => [found.status, found.readCount, found.finished, found.shelves])).toEqual([
			["read", 1, null, []],
			["reading", 1, null, []],
			["to read", 0, null, []],
		]);
	});

	it("drops a book on a shelf for books given up on, even one marked read to be shelved there", () => {
		const rows = parseGoodreadsCsv(
			csv(
				row({ title: "A", author: "X", exclusive: "did-not-finish", shelves: "did-not-finish, plays" }),
				row({ title: "B", author: "X", exclusive: "read", shelves: "dnf", dateRead: "2024/01/05", readCount: 1 }),
				row({ title: "C", author: "X", exclusive: "currently-reading", shelves: "currently-reading, abandoned" }),
				row({ title: "D", author: "X", exclusive: "yarım-kalanlar" }),
			),
		);
		expect(rows.map((found) => [found.group, found.status, found.readCount, found.finished, found.shelves])).toEqual([
			["own", "dropped", 0, null, ["did-not-finish", "plays"]],
			["read", "dropped", 0, null, ["dnf"]],
			// Being read now wins: it was picked up again.
			["currently-reading", "reading", 0, null, ["abandoned"]],
			["own", "dropped", 0, null, ["yarım-kalanlar"]],
		]);
	});

	it("reads a book on another shelf of the user's own as read when Goodreads has it read, else to read", () => {
		const rows = parseGoodreadsCsv(
			csv(row({ title: "A", author: "X", exclusive: "owned", dateRead: "2022/7/9" }), row({ title: "B", author: "X", exclusive: "owned", shelves: "owned, classics" })),
		);
		expect(rows.map((found) => [found.status, found.finished, found.shelves])).toEqual([
			["read", "2022-07-09", ["owned"]],
			["to read", null, ["owned", "classics"]],
		]);
	});

	it("takes the ISBN-13, else the ISBN-10, and only one whose last digit checks out", () => {
		const rows = parseGoodreadsCsv(
			csv(
				row({ title: "A", author: "X", isbn: "080442957X", exclusive: "read" }),
				row({ title: "B", author: "X", isbn13: "9789758859758", exclusive: "read" }),
				row({ title: "C", author: "X", exclusive: "read" }),
			),
		);
		expect(rows.map((found) => found.isbn)).toEqual(["080442957X", null, null]);
	});

	it("searches by the title without its series, and by the first other author when none is named", () => {
		const [book] = parseGoodreadsCsv(csv(row({ title: "Harry Potter and the Sorcerer's Stone (Harry Potter, #1)", additional: "J.K. Rowling, Mary GrandPré", exclusive: "read" })));
		expect(book).toMatchObject({ searchTitle: "Harry Potter and the Sorcerer's Stone", author: "J.K. Rowling" });
		expect(withoutSeries("The Way of Shadows (Night Angel, #1-3)")).toBe("The Way of Shadows");
		expect(withoutSeries("Mansfield Park (Penguin Classics)")).toBe("Mansfield Park (Penguin Classics)");
	});

	it("says what to export when the file is something else", () => {
		expect(() => parseGoodreadsCsv("Name,Year\nAlien,1979\n")).toThrow(/isn't a Goodreads library export/);
	});

	it("only takes an edition found by its ISBN alone when its title is the row's", () => {
		const [book] = parseGoodreadsCsv(csv(KURK));
		expect(sameBook("Kurk Mantolu Madonna", book)).toBe(true);
		expect(sameBook("Kitab Jurumiyyah", book)).toBe(false);
		expect(sameBook(null, book)).toBe(false);
	});
});

describe("Import from Goodreads, on Open Library's saved answers", () => {
	const ui: BookUi = { language: () => "en", pickEdition: async () => null, askIsbn: async () => null, confirm: async () => null };

	function setUp(notes: Record<string, string> = {}) {
		const app = new FakeApp(notes);
		const vault = new VaultNotes(app.app);
		const books = new BookActions(app.app, vault, settings(), ui);
		const importer = new GoodreadsImporter(app.app, vault, books, settings());
		const statuses: string[] = [];
		const progress = { isCancelled: () => false, setStatus: (text: string) => statuses.push(text), close: () => {} };
		return { app, books, importer, progress, statuses, ...replayOpenLibraryClient() };
	}

	it("writes each book into its first shelf's folder, with the edition shelved and where the user is with it", async () => {
		const { app, importer, client, progress, statuses } = setUp();
		const rows = parseGoodreadsCsv(csv(NO_COUNTRY, KURK, CHERRY_ORCHARD, UNKNOWN));
		await importer.run(client, rows, ["read", "currently-reading", "to-read", "own"], progress);

		expect(statuses[0]).toBe("1/4: No Country for Old Men");
		expect(app.note("Books/favorites/No Country for Old Men (2005).md")).toBe(
			[
				"---",
				"title: No Country for Old Men",
				"aliases:",
				"  - No Country for Old Men",
				"  - İhtiyarlara yer yok",
				"year: 2005",
				"authors:",
				"  - Cormac McCarthy",
				"genres:",
				"  - Western novel",
				"  - thriller",
				"  - crime fiction",
				"series:",
				"pages: 220",
				'poster: "[[No Country for Old Men (2005).jpg]]"',
				"url: https://openlibrary.org/works/OL40875W",
				"openlibrary_id: OL40875W",
				"edition:",
				"  openlibrary_id: OL37024172M",
				"  title: İhtiyarlara yer yok",
				"  publisher: Kanat",
				"  published: 2008",
				'  isbn: "9789758859757"',
				"  translators:",
				"    - Roza Hakmen",
				"read_status: read",
				"started:",
				"finished: 2024-03-02",
				"read_count: 2",
				"shelves:",
				"  - favorites",
				"  - american",
				"---",
				"",
			].join("\n"),
		);

		// Its ISBN is filed under a stray copy of the book's record; the note is the book's own, the edition the one shelved.
		expect(app.frontmatter("Books/Kürk Mantolu Madonna (1943).md")).toMatchObject({
			openlibrary_id: "OL24327596W",
			edition: { openlibrary_id: "OL28130921M", isbn: "9789753638029" },
			read_status: "reading",
			read_count: 0,
		});
		expect(app.frontmatter("Books/Kürk Mantolu Madonna (1943).md").shelves).toBeUndefined();

		// No ISBN: the book, with no edition of the user's.
		const orchard = app.frontmatter("Books/did-not-finish/The Cherry Orchard (1904).md");
		expect(orchard).toMatchObject({ openlibrary_id: "OL55417W", read_status: "dropped", shelves: ["did-not-finish", "plays"] });
		expect(orchard.edition).toBeUndefined();

		const report = app.note("Film + Anime-Manga Tracker Import Report.md");
		expect(report).toContain("| A Book That Was Never Written (Nowhere, #2) | Nobody Atall | Open Library has no match for its title and author, or its ISBN 9799999999990. |");
		expect(Notice.shown).toContain("Added 3, updated 0, skipped 0, 1 not matched.");
	});

	it("only imports the shelves picked", async () => {
		const { app, importer, client, progress } = setUp();
		await importer.run(client, parseGoodreadsCsv(csv(NO_COUNTRY, KURK, CHERRY_ORCHARD)), ["own"], progress);
		expect([...app.notes.keys()]).toEqual(["Books/did-not-finish/The Cherry Orchard (1904).md"]);
		expect(Notice.shown).toContain("Added 1, updated 0, skipped 0.");
	});

	it("fills a book already in the vault in where it is empty, and leaves it where it is", async () => {
		const { app, books, importer, client, progress } = setUp();
		await books.addBook(client, { id: "OL40875W", title: "No Country for Old Men", originalTitle: null, authors: [], year: null, editions: 1 });
		const path = "Books/No Country for Old Men (2005).md";
		const before = app.note(path);

		await importer.run(client, parseGoodreadsCsv(csv(NO_COUNTRY)), ["read"], progress);
		expect(app.note(path)).toBe(
			before
				.replace("  - No Country for Old Men\n", "  - No Country for Old Men\n  - İhtiyarlara yer yok\n")
				.replace(
					"openlibrary_id: OL40875W\n",
					[
						"openlibrary_id: OL40875W",
						"edition:",
						"  openlibrary_id: OL37024172M",
						"  title: İhtiyarlara yer yok",
						"  publisher: Kanat",
						"  published: 2008",
						'  isbn: "9789758859757"',
						"  translators:",
						"    - Roza Hakmen",
						"",
					].join("\n"),
				)
				.replace("read_status: to read", "read_status: read")
				.replace("finished:", "finished: 2024-03-02")
				.replace("read_count: 0", "read_count: 2\nshelves:\n  - favorites\n  - american"),
		);
		// The page count and the cover it had stay; no second note, no folder for its shelf.
		expect(app.frontmatter(path)).toMatchObject({ pages: 304, poster: "[[No Country for Old Men (2005).jpg]]" });
		expect([...app.notes.keys()]).toEqual([path]);
		expect(Notice.shown).toContain("Added 0, updated 1, skipped 0.");

		// Imported again, there is nothing left to fill in.
		const filled = app.note(path);
		await importer.run(client, parseGoodreadsCsv(csv(NO_COUNTRY)), ["read"], progress);
		expect(app.note(path)).toBe(filled);
		expect(Notice.shown).toContain("Added 0, updated 0, skipped 1.");
	});

	it("never moves a status the user set on, nor writes over their read date, count, shelves or edition", async () => {
		const own = [
			"---",
			"title: No Country for Old Men",
			"openlibrary_id: OL40875W",
			"edition:",
			"  openlibrary_id: OL1M",
			"read_status: reading",
			"finished: 2020-01-01",
			"read_count: 1",
			"shelves:",
			"  - mine",
			"---",
			"",
		].join("\n");
		const { app, importer, client, progress } = setUp({ "Books/No Country for Old Men.md": own });
		await importer.run(client, parseGoodreadsCsv(csv(NO_COUNTRY)), ["read"], progress);
		expect(app.note("Books/No Country for Old Men.md")).toBe(own);
		expect(Notice.shown).toContain("Added 0, updated 0, skipped 1.");
	});
});
