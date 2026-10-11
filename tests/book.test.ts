import { describe, expect, it } from "vitest";
import { bookAuthors, dateOfTime, latinTitle, rankBooks, toAuthorMetadata, toBookMetadata, yearOfTime, NO_BOOK_FACTS, NO_PERSON_FACTS } from "../src/book";
import {
	buildAuthorNoteContent,
	buildBookNoteContent,
	markBookFinished,
	NO_BOOK_LINKS,
	readProgressOf,
	refreshAuthorFrontmatter,
	refreshBookFrontmatter,
	startReading,
} from "../src/book-note";
import { classifyNote, matchesRef } from "../src/note-kind";
import { panelPlanFor } from "../src/panels/panel-plan";
import { watchControlsFor } from "../src/panels/poster";
import { findFilmography } from "../src/filmography";
import { parseYaml } from "./obsidian-stub";

const fm = (content: string) => parseYaml(content.slice(4, content.indexOf("\n---", 4))) as Record<string, unknown>;

const BOOK = toBookMetadata(
	{ key: "/works/OL1W", title: "Kafka on the Shore", author_name: ["村上春樹"], first_publish_year: 1900, number_of_pages_median: 480.6, cover_i: 7 },
	{ year: 2002, genres: ["novel"], series: [], titles: ["海辺のカフカ", "Kafka on the Shore"], englishTitle: "Kafka on the Shore", authors: ["Haruki Murakami"] },
);

describe("book and author notes are told apart by Open Library's id", () => {
	it("reads a book's id, a work's, and an author's", () => {
		expect(classifyNote({ title: "X", openlibrary_id: "OL40875W" })).toEqual({ kind: "book", openLibraryId: "OL40875W" });
		expect(classifyNote({ name: "X", openlibrary_id: "OL28104A" })).toEqual({ kind: "author", openLibraryId: "OL28104A" });
		expect(classifyNote({ openlibrary_id: "OL123M" })).toBeNull();
		expect(classifyNote({ openlibrary_id: 40875 })).toBeNull();
	});

	it("leaves a note with a TMDB or MAL id what it has always been", () => {
		expect(classifyNote({ title: "X", directors: [], tmdb_id: 6977, openlibrary_id: "OL40875W" })?.kind).toBe("film");
		expect(classifyNote({ title: "X", mal_id: 1, media_type: "tv", openlibrary_id: "OL40875W" })?.kind).toBe("series");
	});

	it("never takes an author for a book of the same number", () => {
		expect(matchesRef({ kind: "author", openLibraryId: "OL1A" }, { kind: "book", openLibraryId: "OL1A" })).toBe(false);
		expect(matchesRef({ kind: "book", openLibraryId: "OL1W" }, { kind: "book", openLibraryId: "OL1W" })).toBe(true);
	});

	it("gives an author BIBLIOGRAPHY by every name, never a director's FILMOGRAPHY", () => {
		const plan = panelPlanFor({ name: "Haruki Murakami", aliases: ["Haruki Murakami", "村上春樹"], openlibrary_id: "OL382524A" });
		expect(plan).toEqual({ kind: "author", names: new Set(["Haruki Murakami", "村上春樹"]) });
		expect(panelPlanFor({ title: "X", openlibrary_id: "OL1W" })).toEqual({ kind: "book" });
	});
});

describe("what Wikidata adds", () => {
	it("reads a date only as exactly as it is known", () => {
		expect(dateOfTime({ time: "+1933-07-20T00:00:00Z", precision: 11 })).toBe("1933-07-20");
		expect(dateOfTime({ time: "+1906-00-00T00:00:00Z", precision: 9 })).toBe("1906");
		expect(dateOfTime({ time: "+1906-05-00T00:00:00Z", precision: 10 })).toBe("1906-05");
		expect(dateOfTime({ time: "+1900-00-00T00:00:00Z", precision: 7 })).toBeNull();
		expect(yearOfTime({ time: "-0427-00-00T00:00:00Z", precision: 9 })).toBe(-427);
	});

	it("names a book's authors in Latin letters, place by place, only when Wikidata lists as many", () => {
		expect(bookAuthors(["村上春樹"], ["Haruki Murakami"])).toEqual(["Haruki Murakami"]);
		expect(bookAuthors(["Cormac McCarthy"], ["Cormac McCarthy Jr."])).toEqual(["Cormac McCarthy"]);
		expect(bookAuthors(["村上春樹", "X"], ["Haruki Murakami"])).toEqual(["村上春樹", "X"]);
	});

	it("takes Wikidata's year over Open Library's, and rounds the page count", () => {
		expect(BOOK).toMatchObject({ year: 2002, authors: ["Haruki Murakami"], pages: 481, otherTitles: ["海辺のカフカ"] });
		expect(toBookMetadata({ key: "/works/OL2W", title: "Y", first_publish_year: 1990 }, NO_BOOK_FACTS).year).toBe(1990);
	});

	it("keeps an author in Latin letters as they are, with their name in another script beside it", () => {
		const tolstoy = toAuthorMetadata({ name: "Leo Tolstoy", birth_date: "1828" }, "OL1A", { ...NO_PERSON_FACTS, nativeName: "Лев Николаевич Толстой" });
		expect(tolstoy).toMatchObject({ name: "Leo Tolstoy", originalName: "Лев Николаевич Толстой", born: "1828" });
		// No English name to go by: the note keeps the one Open Library has.
		expect(toAuthorMetadata({ name: "村上春樹" }, "OL2A", NO_PERSON_FACTS)).toMatchObject({ name: "村上春樹", originalName: null });
	});

	it("titles a book in Latin letters: its English name, else its English edition's, else its own", () => {
		const doc = { key: "/works/OL9W", title: "Чайка", editions: { docs: [{ title: "The Sea-Gull", language: ["eng"] }] } };
		expect(latinTitle(doc, "The Seagull")).toEqual({ title: "The Seagull", originalTitle: "Чайка" });
		expect(latinTitle(doc)).toEqual({ title: "The Sea-Gull", originalTitle: "Чайка" });
		// Only an English edition's title, and only in Latin letters.
		expect(latinTitle({ ...doc, editions: { docs: [{ title: "La mouette", language: ["fre"] }] } })).toEqual({ title: "Чайка", originalTitle: null });
		expect(latinTitle({ key: "/works/OL8W", title: "Kürk Mantolu Madonna" }, "Madonna in a Fur Coat")).toEqual({ title: "Kürk Mantolu Madonna", originalTitle: null });
	});

	it("ranks a search by exact title, then by editions", () => {
		const ranked = rankBooks(
			[
				{ key: "/works/OL1W", title: "Dune Messiah", edition_count: 90 },
				{ key: "/works/OL2W", title: "Dune", edition_count: 3 },
				{ key: "/works/OL3W", title: "Dune", edition_count: 120 },
			],
			"dune",
		);
		expect(ranked.map((doc) => doc.key)).toEqual(["/works/OL3W", "/works/OL2W", "/works/OL1W"]);
	});
});

describe("book notes", () => {
	const content = buildBookNoteContent(BOOK, "[[Kafka on the Shore (2002).jpg]]", NO_BOOK_LINKS);

	it("writes the book, then where the user is with it", () => {
		expect(fm(content)).toEqual({
			title: "Kafka on the Shore",
			aliases: ["Kafka on the Shore", "海辺のカフカ"],
			year: 2002,
			authors: ["Haruki Murakami"],
			genres: ["novel"],
			series: null,
			pages: 481,
			poster: "[[Kafka on the Shore (2002).jpg]]",
			url: "https://openlibrary.org/works/OL1W",
			openlibrary_id: "OL1W",
			read_status: "to read",
			started: null,
			finished: null,
			read_count: 0,
		});
	});

	it("keeps the user's aliases, links and own properties on a refresh", () => {
		const edited = content
			.replace("  - 海辺のカフカ", "  - 海辺のカフカ\n  - Umibe no Kafuka")
			.replace("  - Haruki Murakami", '  - "[[Haruki Murakami]]"')
			.replace("read_count: 0", "read_count: 0\nshelf: favourites");
		const refreshed = refreshBookFrontmatter(edited, { ...BOOK, title: "Kafka on the Shore!" }, NO_BOOK_FACTS, NO_BOOK_LINKS, null, fm(edited));
		expect(fm(refreshed)).toMatchObject({
			title: "Kafka on the Shore!",
			aliases: ["Kafka on the Shore!", "海辺のカフカ", "Umibe no Kafuka"],
			authors: ["[[Haruki Murakami]]"],
			shelf: "favourites",
		});
	});

	it("leaves the year, authors, genres and aliases alone when Wikidata couldn't be reached", () => {
		const refreshed = refreshBookFrontmatter(content, { ...BOOK, year: 1900, authors: ["村上春樹"], genres: [], otherTitles: [] }, null, NO_BOOK_LINKS, null, fm(content));
		expect(fm(refreshed)).toMatchObject({ year: 2002, authors: ["Haruki Murakami"], genres: ["novel"], aliases: ["Kafka on the Shore", "海辺のカフカ"] });
	});

	it("reads where the user is with a book", () => {
		expect(readProgressOf({ read_status: "reading", read_count: 2 })).toEqual({ status: "reading", readCount: 2 });
		expect(readProgressOf({ read_count: "x" })).toEqual({ status: null, readCount: 0 });
		const read = markBookFinished(startReading(content, "2026-10-01"), "2026-10-11", 0);
		expect(fm(read)).toMatchObject({ read_status: "read", started: "2026-10-01", finished: "2026-10-11", read_count: 1 });
	});

	it("puts the progress keys back in their place in a note that has none", () => {
		const bare = "---\ntitle: X\nopenlibrary_id: OL1W\nmine: yes\n---\n";
		expect(startReading(bare, "2026-10-11").split("\n").slice(1, 6)).toEqual([
			"title: X",
			"openlibrary_id: OL1W",
			"read_status: reading",
			"started: 2026-10-11",
			"mine: yes",
		]);
	});

	it("offers Start reading under the cover until the book is being read, and Finished today always", () => {
		expect(watchControlsFor({ title: "X", openlibrary_id: "OL1W", read_status: "to read" })).toMatchObject({
			label: null,
			canStartReading: true,
			canMarkWatched: true,
			markText: "Finished today",
		});
		expect(watchControlsFor({ title: "X", openlibrary_id: "OL1W", read_status: "reading", read_count: 2 })).toMatchObject({
			label: "Reading · Read 2 times",
			canStartReading: false,
		});
	});
});

describe("author notes", () => {
	const author = toAuthorMetadata({ name: "村上春樹", photos: [-1, 5] }, "OL382524A", {
		...NO_PERSON_FACTS,
		born: "1949-01-12",
		englishName: "Haruki Murakami",
	});

	it("writes the author with their photo and whom to thank for it", () => {
		expect(fm(buildAuthorNoteContent(author, { link: "[[Haruki Murakami.jpg]]", credit: "Open Library" }))).toEqual({
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
		expect(author.photoId).toBe(5);
	});

	it("keeps a photo the user chose on a refresh", () => {
		const content = buildAuthorNoteContent(author, null).replace("poster:", 'poster: "[[mine.png]]"');
		const refreshed = refreshAuthorFrontmatter(content, { ...author, died: "2099" }, { link: "[[new.jpg]]", credit: "Open Library" }, fm(content));
		expect(fm(refreshed)).toMatchObject({ poster: "[[mine.png]]", photo_credit: null, died: "2099" });
	});

	it("lists their books in the vault on BIBLIOGRAPHY, by any name they go by", () => {
		const books = [
			{ path: "Books/A.md", title: "Norwegian Wood", year: 1987, watched: true, credits: ["Haruki Murakami"] },
			{ path: "Books/B.md", title: "1Q84", year: 2009, watched: false, credits: ["村上春樹"] },
			{ path: "Books/C.md", title: "The Road", year: 2006, watched: false, credits: ["Cormac McCarthy"] },
		];
		expect(findFilmography(new Set(["Haruki Murakami", "村上春樹"]), books).map((book) => book.title)).toEqual(["Norwegian Wood", "1Q84"]);
	});
});
