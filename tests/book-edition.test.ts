import { describe, expect, it } from "vitest";
import { editionYear, marcLanguageOf, normalizeIsbn, rankEditions, toBookEdition, translatorsOf, type OlEdition } from "../src/book-edition";
import { replayOpenLibraryClient } from "./openlibrary-fixtures";

/*
 * A book's editions: what an edition's record says, read the way "Choose
 * edition" lists it, on Open Library's real answers where there are some.
 */

describe("an ISBN as typed", () => {
	it("is read with hyphens, spaces or an ISBN label around it", () => {
		expect(normalizeIsbn("978-975-8859-75-7")).toBe("9789758859757");
		expect(normalizeIsbn(" ISBN 978 975 8859 75 7 ")).toBe("9789758859757");
		expect(normalizeIsbn("ISBN-10: 975-885-975-7")).toBe("9758859757");
		expect(normalizeIsbn("0-8044-2957-x")).toBe("080442957X");
	});

	it("is refused with a digit mistyped, or too few digits", () => {
		expect(normalizeIsbn("9789758859758")).toBeNull();
		expect(normalizeIsbn("9758859758")).toBeNull();
		expect(normalizeIsbn("97897588597")).toBeNull();
		expect(normalizeIsbn("Kürk Mantolu Madonna")).toBeNull();
	});
});

describe("an edition's year", () => {
	it("is found however the date is written", () => {
		expect(editionYear("2022-06-13")).toBe(2022);
		expect(editionYear("Apr 13, 2019")).toBe(2019);
		expect(editionYear("1971-11")).toBe(1971);
		expect(editionYear("c1962.")).toBe(1962);
		expect(editionYear(undefined)).toBeNull();
		expect(editionYear("n.d.")).toBeNull();
	});
});

describe("an edition's translators", () => {
	const by = (statement: string): OlEdition => ({ by_statement: statement });

	it("are read from a contributor whose role says so", () => {
		expect(translatorsOf({ contributors: [{ role: "Translator", name: "Constance Black Garnett" }, { role: "Illustrator", name: "Someone" }] })).toEqual([
			"Constance Black Garnett",
		]);
	});

	it("are read from the title page in English, as Open Library keeps it", () => {
		expect(translatorsOf(by("by Anton Chekhov ; translated by Curt Columbus"))).toEqual(["Curt Columbus"]);
		expect(translatorsOf(by("[by] Anton Chekhov ; translated by Tyrone Guthrie and Leonid Kipnis"))).toEqual(["Tyrone Guthrie", "Leonid Kipnis"]);
		expect(translatorsOf(by("Anton Chekhov ; translated from the Russian by  Richard Nelson, Richard Pevear and Larissa Volokhonsky"))).toEqual([
			"Richard Nelson",
			"Richard Pevear",
			"Larissa Volokhonsky",
		]);
		expect(translatorsOf(by("Anton Chekhov ; translated, with an introduction and notes, by Sharon Marie Carnicke"))).toEqual(["Sharon Marie Carnicke"]);
		expect(translatorsOf(by("Anton Chekhov ; translated from the Russian by Michael Frayn with commentary and notes by Nick Worrall"))).toEqual([
			"Michael Frayn",
		]);
		expect(translatorsOf(by("Translated by Avrahm Yarmolinsky. Critical material selected and introduced by Henry Popkin."))).toEqual([
			"Avrahm Yarmolinsky",
		]);
		expect(translatorsOf(by("by Anton Tchekhoff, English translation by Jenny Covan."))).toEqual(["Jenny Covan"]);
	});

	it("are read in Turkish, French and German too", () => {
		expect(translatorsOf(by("Cormac McCarthy ; çeviren, Roza Hakmen"))).toEqual(["Roza Hakmen"]);
		expect(translatorsOf(by("Sabahattin Ali ; Çev.: Maureen Freely ve Alexander Dawe"))).toEqual(["Maureen Freely", "Alexander Dawe"]);
		expect(translatorsOf(by("Anton Tchekhov ; pièce en quatre actes ; traduite du russe par André Markowicz et Françoise Morvan"))).toEqual([
			"André Markowicz",
			"Françoise Morvan",
		]);
		expect(translatorsOf(by("Haruki Murakami ; aus dem Japanischen von Ursula Gräfe"))).toEqual(["Ursula Gräfe"]);
	});

	it("are nobody where the title page is less certain", () => {
		// An adaptation, an editor's notes on translation, a book's own author: none is a translator for certain.
		expect(translatorsOf(by("by Anton Chekhov ; English version by Sir John Gielgud; introduction by Michel Saint-Denis."))).toEqual([]);
		expect(
			translatorsOf(by("by A. P. Chekhov. Edited, with introduction, biographical, literary and translations notes and a glossary, by Nicholas N. Sergievsky ...")),
		).toEqual([]);
		expect(translatorsOf(by("Cormac McCarthy"))).toEqual([]);
		expect(translatorsOf({})).toEqual([]);
	});
});

describe("the editions of a book, on Open Library's answers", () => {
	it("reads Kanat's Turkish No Country for Old Men whole, translator and all, by its ISBN", async () => {
		const { client } = replayOpenLibraryClient();
		expect(await client.editionByIsbn("9789758859757")).toEqual({
			id: "OL37024172M",
			workId: "OL40875W",
			title: "İhtiyarlara yer yok",
			publisher: "Kanat",
			year: 2008,
			pages: 220,
			isbn: "9789758859757",
			languages: ["tur"],
			format: null,
			coverId: 12603449,
			translators: ["Roza Hakmen"],
		});
	});

	it("says which record an ISBN is filed under, even a second copy of the book's", async () => {
		const { client } = replayOpenLibraryClient();
		expect(await client.editionByIsbn("9789753638029")).toMatchObject({ id: "OL28130921M", workId: "OL20784452W", format: "Paperback" });
	});

	it("has no edition for an ISBN no book has", async () => {
		const { client } = replayOpenLibraryClient();
		expect(await client.editionByIsbn("9799999999990")).toBeNull();
	});

	it("lists every edition, in one request", async () => {
		const { client, web } = replayOpenLibraryClient();
		expect(await client.editions("OL55417W")).toHaveLength(152);
		expect(web.requests).toEqual(["https://openlibrary.org/works/OL55417W/editions.json?limit=1000"]);
	});

	it("offers the editions in the user's language first, the newest first", async () => {
		const { client } = replayOpenLibraryClient();
		const editions = await client.editions("OL40875W");
		const [turkish, next] = rankEditions(editions, marcLanguageOf("tr"));
		expect(turkish).toMatchObject({ id: "OL37024172M", title: "İhtiyarlara yer yok", translators: ["Roza Hakmen"] });
		expect(next.languages).not.toContain("tur");

		const english = rankEditions(editions, marcLanguageOf("en"));
		const inEnglish = english.filter((edition) => edition.languages.includes("eng"));
		expect(english.slice(0, inEnglish.length)).toEqual(inEnglish);
		const years = inEnglish.map((edition) => edition.year ?? 0);
		expect(years).toEqual([...years].sort((a, b) => b - a));
	});

	it("takes a cover Open Library took away as none", () => {
		expect(toBookEdition({ key: "/books/OL1M", covers: [-1] }).coverId).toBeNull();
		expect(toBookEdition({ key: "/books/OL1M", covers: [-1, 42] }).coverId).toBe(42);
	});
});

describe("Obsidian's language, as Open Library names it", () => {
	it("is matched whatever its region, and English when unknown", () => {
		expect(marcLanguageOf("tr")).toBe("tur");
		expect(marcLanguageOf("pt-BR")).toBe("por");
		expect(marcLanguageOf("zh-TW")).toBe("chi");
		expect(marcLanguageOf("xx")).toBe("eng");
	});
});
