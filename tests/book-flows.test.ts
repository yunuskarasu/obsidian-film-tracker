import { beforeEach, describe, expect, it } from "vitest";
import { BookActions } from "../src/book-actions";
import { VaultNotes } from "../src/vault-notes";
import { FakeApp, settings } from "./fake-app";
import { replayOpenLibraryClient } from "./openlibrary-fixtures";
import { Notice } from "./obsidian-stub";

/*
 * Add book and Add author end to end, on Open Library's and Wikidata's real
 * answers: what is offered, in which order, and the note each pick writes.
 */

beforeEach(() => {
	Notice.shown.length = 0;
});

const catalogue = (requests: string[]) => requests.filter((url) => url.startsWith("https://openlibrary.org/"));

describe("the searches, on Open Library's answers", () => {
	it("offers the book itself first, ahead of the stray copies of its record", async () => {
		const { client } = replayOpenLibraryClient();
		const [first, second] = await client.searchBooks("Kürk Mantolu Madonna");
		expect(first).toMatchObject({ id: "OL24327596W", title: "Kürk Mantolu Madonna", authors: ["Sabahattin Ali"], editions: 24 });
		expect(second.editions).toBeLessThan(first.editions);
	});

	it("puts the novel before the books about it", async () => {
		const { client } = replayOpenLibraryClient();
		const [novel] = await client.searchBooks("No Country for Old Men");
		expect(novel).toMatchObject({ id: "OL40875W", authors: ["Cormac McCarthy"], editions: 45 });
	});

	it("offers a book titled in another script by its English title, its own beside it, ahead of the plays named after it", async () => {
		const { client } = replayOpenLibraryClient();
		const [first] = await client.searchBooks("The Cherry Orchard");
		expect(first).toMatchObject({ id: "OL55417W", title: "The Cherry Orchard", originalTitle: "Вишневый сад", editions: 152 });
	});

	it("lists an author's books titled in another script by their English titles", async () => {
		const { client } = replayOpenLibraryClient();
		const works = await client.authorWorks("OL19677A");
		expect(works.slice(0, 4).map((book) => [book.title, book.originalTitle])).toEqual([
			["Uncle Vanya", "Дядя Ваня"],
			["The Sea-Gull", "Чайка"],
			["The Cherry Orchard", "Вишневый сад"],
			["The Three Sisters", "Три сестры"],
		]);
		// One titled in English already stays as it is.
		expect(works[4]).toMatchObject({ title: "The Lady with the Dog and Other Stories [9 stories]", originalTitle: null });
	});

	it("offers the author with every book under them first, not a stray record of the same name", async () => {
		const { client } = replayOpenLibraryClient();
		const [murakami, stray] = await client.searchAuthors("Haruki Murakami");
		expect(murakami).toMatchObject({ id: "OL382524A", name: "村上春樹", years: "1949–", works: 534 });
		expect(stray).toMatchObject({ name: "Haruki Murakami", works: 4 });
	});

	it("names the plugin in every request, and asks Open Library itself once for a book", async () => {
		const { client, web } = replayOpenLibraryClient();
		await client.getBook("OL40875W");
		expect(new Set(web.userAgents)).toEqual(new Set(["FilmTracker/3.5.0 ( https://github.com/yunuskarasu/obsidian-film-tracker )"]));
		// The rest go to Wikidata.
		expect(catalogue(web.requests)).toHaveLength(1);
	});
});

describe("a book's metadata, from Open Library and Wikidata", () => {
	it("takes the year from Wikidata where Open Library's is a stray edition's", async () => {
		const { client } = replayOpenLibraryClient();
		const { book } = await client.getBook("OL40875W");
		expect(book).toMatchObject({
			title: "No Country for Old Men",
			year: 2005,
			authors: ["Cormac McCarthy"],
			genres: ["Western novel", "thriller", "crime fiction"],
			pages: 304,
			coverId: 9296899,
			url: "https://openlibrary.org/works/OL40875W",
		});
		expect((await client.getBook("OL24327596W")).book.year).toBe(1943);
	});

	it("keeps a book's other titles: its English one, never every translation's", async () => {
		const { client } = replayOpenLibraryClient();
		expect((await client.getBook("OL24327596W")).book.otherTitles).toEqual(["Madonna in a Fur Coat"]);
		const potter = (await client.getBook("OL82563W")).book;
		expect(potter.otherTitles).toEqual(["Harry Potter and the Sorcerer's Stone"]);
		// Wikidata names the series in every language at once ("mul"), not in English.
		expect(potter.series).toEqual(["Harry Potter"]);
	});

	it("names an author Open Library writes in another script the way their note is named", async () => {
		const { client } = replayOpenLibraryClient();
		// Norwegian Wood isn't on Wikidata: its author is looked up on their own.
		const { book, facts } = await client.getBook("OL2625457W");
		expect(book.authors).toEqual(["Haruki Murakami"]);
		expect(book.year).toBe(1987);
		expect(facts).toEqual({ year: null, genres: [], series: [], titles: [], englishTitle: null, authors: [] });
	});

	it("falls back on Open Library alone for a book Wikidata doesn't have", async () => {
		const { client } = replayOpenLibraryClient();
		const { book } = await client.getBook("OL2627082W");
		expect(book).toMatchObject({ title: "Parallel Politics", year: 1990, authors: ["Samuel Kernell"], genres: [] });
	});

	it("says when Wikidata couldn't be reached, rather than that it has nothing", async () => {
		const { client } = replayOpenLibraryClient({ wikidataDown: true });
		const { book, facts } = await client.getBook("OL40875W");
		expect(facts).toBeNull();
		expect(book.year).toBe(1900);
	});

	it("lists an author's books with the most editions first", async () => {
		const { client } = replayOpenLibraryClient();
		const works = await client.authorWorks("OL28104A");
		expect(works.slice(0, 2).map((book) => book.title)).toEqual(["The Road", "All the Pretty Horses"]);
	});
});

describe("an author's metadata", () => {
	it("dates them as Wikidata does, and takes their photo from Open Library", async () => {
		const { client } = replayOpenLibraryClient();
		const author = await client.getAuthor("OL28104A");
		expect(author).toMatchObject({ name: "Cormac McCarthy", originalName: null, born: "1933-07-20", died: "2023-06-13", photoId: 14333158 });
		expect((await client.authorPhoto(author))?.credit).toBe("Open Library");
	});

	it("takes a photo from Wikimedia Commons, credited, when Open Library has none", async () => {
		const { client, web } = replayOpenLibraryClient();
		const author = await client.getAuthor("OL97057A");
		expect(author.photoId).toBeNull();
		const photo = await client.authorPhoto(author);
		expect(photo?.credit).toContain("Public domain");
		expect(web.requests.some((url) => url.startsWith("https://commons.wikimedia.org/"))).toBe(true);
	});

	it("goes by their name in Latin letters, and keeps the one in their own script", async () => {
		const { client } = replayOpenLibraryClient();
		expect(await client.getAuthor("OL382524A")).toMatchObject({ name: "Haruki Murakami", originalName: "村上春樹", born: "1949-01-12", died: null });
	});
});

describe("Add book and Add author, on the saved answers", () => {
	function setUp(notes: Record<string, string> = {}) {
		const app = new FakeApp(notes);
		const books = new BookActions(app.app, new VaultNotes(app.app), settings());
		return { app, books, ...replayOpenLibraryClient() };
	}
	const pickBook = (id: string, title: string) => ({ id, title, originalTitle: null, authors: [], year: null, editions: 1 });
	const pickAuthor = (id: string, name: string) => ({ id, name, years: null, topWork: null, works: 1 });
	const NO_COUNTRY = "Books/No Country for Old Men (2005).md";

	it("writes No Country for Old Men's note, with its cover beside it", async () => {
		const { app, books, client } = setUp();
		await books.addBook(client, pickBook("OL40875W", "No Country for Old Men"));

		expect(app.frontmatter(NO_COUNTRY)).toEqual({
			title: "No Country for Old Men",
			aliases: ["No Country for Old Men"],
			year: 2005,
			authors: ["Cormac McCarthy"],
			genres: ["Western novel", "thriller", "crime fiction"],
			series: null,
			pages: 304,
			poster: "[[No Country for Old Men (2005).jpg]]",
			url: "https://openlibrary.org/works/OL40875W",
			openlibrary_id: "OL40875W",
			read_status: "to read",
			started: null,
			finished: null,
			read_count: 0,
		});
		expect(app.images.has("No Country for Old Men (2005).jpg")).toBe(true);
		expect(app.opened).toEqual([NO_COUNTRY]);
	});

	it("links the author where their note exists, and never writes one for them", async () => {
		const { app, books, client } = setUp({ "Authors/Cormac McCarthy.md": "---\nname: Cormac McCarthy\nopenlibrary_id: OL28104A\n---\n" });
		await books.addBook(client, pickBook("OL40875W", "No Country for Old Men"));
		expect(app.frontmatter(NO_COUNTRY).authors).toEqual(["[[Cormac McCarthy]]"]);
		expect([...app.notes.keys()].sort()).toEqual(["Authors/Cormac McCarthy.md", NO_COUNTRY]);
	});

	it("opens the note already there rather than writing a second one", async () => {
		const { app, books, client } = setUp();
		await books.addBook(client, pickBook("OL40875W", "No Country for Old Men"));
		await books.addBook(client, pickBook("OL40875W", "No Country for Old Men"));
		expect(app.notes.size).toBe(1);
		expect(Notice.shown).toContain("Already in your vault: No Country for Old Men (2005)");
	});

	it("never writes beside a note of the user's own of that name", async () => {
		const own = "---\ntags: [favourite]\n---\nMy own thoughts.\n";
		const { app, books, client } = setUp({ [NO_COUNTRY]: own });
		await books.addBook(client, pickBook("OL40875W", "No Country for Old Men"));
		expect(app.note(NO_COUNTRY)).toBe(own);
		expect(app.notes.size).toBe(1);
		expect(Notice.shown).toContain(`A note already exists at ${NO_COUNTRY}`);
	});

	it("writes a book titled in another script under its English title, with its own kept beside it", async () => {
		const { app, books, client } = setUp();
		await books.addBook(client, pickBook("OL55417W", "The Cherry Orchard"));
		expect(app.frontmatter("Books/The Cherry Orchard (1904).md")).toMatchObject({
			title: "The Cherry Orchard",
			original_title: "Вишневый сад",
			aliases: ["The Cherry Orchard", "Вишневый сад", "Вишнёвый сад"],
			year: 1904,
			authors: ["Anton Chekhov"],
		});
		// A book titled in Latin letters has no original_title at all.
		await books.addBook(client, pickBook("OL24327596W", "Kürk Mantolu Madonna"));
		expect("original_title" in app.frontmatter("Books/Kürk Mantolu Madonna (1943).md")).toBe(false);
	});

	it("keeps such a book's title when Wikidata, whose English name it is, can't be reached on a refresh", async () => {
		const { app, books, client } = setUp();
		await books.addBook(client, pickBook("OL55417W", "The Cherry Orchard"));
		const path = "Books/The Cherry Orchard (1904).md";
		await books.refresh(replayOpenLibraryClient({ wikidataDown: true }).client, app.file(path));
		expect(app.frontmatter(path)).toMatchObject({ title: "The Cherry Orchard", original_title: "Вишневый сад" });
	});

	it("writes Haruki Murakami's note under his name in Latin letters", async () => {
		const { app, books, client } = setUp();
		await books.addAuthor(client, pickAuthor("OL382524A", "村上春樹"));
		expect(app.frontmatter("Authors/Haruki Murakami.md")).toEqual({
			name: "Haruki Murakami",
			original_name: "村上春樹",
			aliases: ["Haruki Murakami", "村上春樹"],
			born: "1949-01-12",
			died: null,
			poster: "[[Haruki Murakami.jpg]]",
			photo_credit: "Open Library",
			url: "https://openlibrary.org/authors/OL382524A",
			openlibrary_id: "OL382524A",
		});
	});

	it("refreshes a book without touching what is the user's", async () => {
		const { app, books, client } = setUp();
		await books.addBook(client, pickBook("OL40875W", "No Country for Old Men"));
		const file = app.file(NO_COUNTRY);
		await books.startReading(file);
		await books.markFinishedToday(file);
		app.notes.set(
			NO_COUNTRY,
			`${app.note(NO_COUNTRY).replace("year: 2005", "year: 1999").replace("read_count: 1", "read_count: 1\nrating: 5")}My review.\n`,
		);

		await books.refresh(client, file);
		const note = app.frontmatter(NO_COUNTRY);
		expect(note).toMatchObject({ year: 2005, read_status: "read", read_count: 1, rating: 5 });
		expect(typeof note.started).toBe("string");
		expect(app.note(NO_COUNTRY).endsWith("My review.\n")).toBe(true);
		expect(Notice.shown[Notice.shown.length - 1]).toBe("Refreshed No Country for Old Men");
	});

	it("keeps a book's year, authors and genres when Wikidata can't be reached on a refresh", async () => {
		const { app, books, client } = setUp();
		await books.addBook(client, pickBook("OL40875W", "No Country for Old Men"));

		const down = replayOpenLibraryClient({ wikidataDown: true }).client;
		await books.refresh(down, app.file(NO_COUNTRY));
		expect(app.frontmatter(NO_COUNTRY)).toMatchObject({
			year: 2005,
			genres: ["Western novel", "thriller", "crime fiction"],
			authors: ["Cormac McCarthy"],
		});
		expect(Notice.shown[Notice.shown.length - 1]).toContain("Wikidata couldn't be reached");
	});

	it("starts and finishes a book: the first days stay, and every reading is counted", async () => {
		const { app, books, client } = setUp();
		await books.addBook(client, pickBook("OL40875W", "No Country for Old Men"));
		const file = app.file(NO_COUNTRY);

		await books.startReading(file);
		expect(app.frontmatter(NO_COUNTRY).read_status).toBe("reading");
		await books.markFinishedToday(file);
		expect(app.frontmatter(NO_COUNTRY)).toMatchObject({ read_status: "read", read_count: 1 });

		app.notes.set(NO_COUNTRY, app.note(NO_COUNTRY).replace(/started: .*/, "started: 2020-01-01").replace(/finished: .*/, "finished: 2020-02-01"));
		await books.startReading(file);
		await books.markFinishedToday(file);
		expect(app.frontmatter(NO_COUNTRY)).toMatchObject({ read_status: "read", read_count: 2, started: "2020-01-01", finished: "2020-02-01" });
		expect(Notice.shown[Notice.shown.length - 1]).toBe("Finished No Country for Old Men (2005) today — 2 times so far.");
	});
});
