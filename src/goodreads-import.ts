import { titleKey, type ReadStatus } from "./book";
import { normalizeIsbn } from "./book-edition";
import { parseCsv } from "./letterboxd-import";

/*
 * Goodreads' library export, goodreads_library_export.csv: one row a book,
 * with the shelves it is on. Pure functions only, like letterboxd-import.ts:
 * the import itself is in goodreads-importer.ts.
 */

/** The three shelves every Goodreads library has. A book is on exactly one of them, or on one of the user's own exclusive shelves. */
const STANDARD_SHELVES = ["read", "currently-reading", "to-read"];

/** A shelf of the user's own for the books they gave up on: "dnf", "did-not-finish", "abandoned", "yarım-kalan"… */
const GAVE_UP = /\bdnf\b|did-?not-?finish|not-?finished|unfinished|abandon|gave-?up|dropped|yar[ıi]m|b[ıi]rak/i;

/** Which of the exclusive shelves a row is on, as the import dialog groups them: the user's own count as one. */
export type ShelfGroup = "read" | "currently-reading" | "to-read" | "own";

export interface GoodreadsRow {
	/** As Goodreads lists it: "Harry Potter and the Sorcerer's Stone (Harry Potter, #1)". */
	title: string;
	/** What Open Library is asked for: the title without its series. */
	searchTitle: string;
	author: string;
	/** The ISBN of the edition on the user's shelf, if Goodreads has one and it checks out. */
	isbn: string | null;
	group: ShelfGroup;
	status: ReadStatus;
	/** The day Goodreads says it was read, as a note writes dates. */
	finished: string | null;
	readCount: number;
	/**
	 * The user's own shelves, every one: their exclusive shelf first, then the
	 * others in Goodreads' order. The first is the folder the note goes in.
	 */
	shelves: string[];
}

/** `="9780439023481"`, as Goodreads writes an ISBN so a spreadsheet keeps its zeros: the ISBN, if it is one. */
function isbnOf(value: string): string | null {
	const text = value.trim().replace(/^="?/, "").replace(/"$/, "");
	return text === "" ? null : normalizeIsbn(text);
}

/** "2024/03/02" — or "2024-3-2" — as a note writes a date: "2024-03-02". */
function dateOf(value: string): string | null {
	const match = value.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
	if (match === null) return null;
	return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

/** "Harry Potter and the Sorcerer's Stone (Harry Potter, #1)": the title without the series Goodreads adds to it. */
export function withoutSeries(title: string): string {
	const bare = title.replace(/\s*\([^()]*#\s*[\d.]+(?:\s*-\s*[\d.]+)?\)\s*$/, "").trim();
	return bare === "" ? title.trim() : bare;
}

/**
 * Where a book stands, from the shelves it is on. A shelf of the user's own
 * for books given up on makes it dropped — unless it is being read now —
 * even beside "read", which is how many mark a book they stopped. A book on
 * another shelf of their own is read if Goodreads has it read, else to read.
 */
function standing(exclusive: string, shelves: string[], dateRead: string | null, count: number): Pick<GoodreadsRow, "status" | "finished" | "readCount"> {
	if (exclusive === "currently-reading") return { status: "reading", finished: null, readCount: count };
	if (shelves.some((shelf) => GAVE_UP.test(shelf))) {
		// Marked read to be shelved as given up: that time doesn't count as read.
		return { status: "dropped", finished: null, readCount: exclusive === "read" ? Math.max(count - 1, 0) : count };
	}
	const read = exclusive === "read" || (exclusive !== "to-read" && (dateRead !== null || count > 0));
	if (read) return { status: "read", finished: dateRead, readCount: Math.max(count, 1) };
	return { status: "to read", finished: null, readCount: count };
}

/**
 * Reads Goodreads' library export. `Title` and `Exclusive Shelf` are
 * required; the author and the ISBN find the book, and the shelves, `Date
 * Read` and `Read Count` say where the user is with it. The rating, the
 * review and the private notes are never read: they are the user's own
 * words, not the plugin's to copy.
 */
export function parseGoodreadsCsv(content: string): GoodreadsRow[] {
	const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
	const rows = parseCsv(withoutBom);
	if (rows.length === 0) return [];

	const header = rows[0].map((name) => name.trim());
	const column = (name: string) => header.indexOf(name);
	const at = (row: string[], index: number) => (index === -1 ? "" : (row[index] ?? "").trim());
	const title = column("Title");
	const exclusive = column("Exclusive Shelf");
	if (title === -1 || exclusive === -1) {
		throw new Error('This isn\'t a Goodreads library export. On Goodreads, open My Books, then "Import and export", and export your library.');
	}
	const author = column("Author");
	const additional = column("Additional Authors");
	const isbn13 = column("ISBN13");
	const isbn10 = column("ISBN");
	const shelvesColumn = column("Bookshelves");
	const dateRead = column("Date Read");
	const readCount = column("Read Count");

	return rows
		.slice(1)
		.filter((row) => at(row, title) !== "")
		.map((row) => {
			const own = at(row, exclusive).toLowerCase() || "to-read";
			const listed = at(row, shelvesColumn)
				.split(",")
				.map((shelf) => shelf.trim())
				.filter((shelf) => shelf !== "");
			const shelves = [...new Set([own, ...listed].filter((shelf) => !STANDARD_SHELVES.includes(shelf.toLowerCase())))];
			const count = Number.parseInt(at(row, readCount), 10);
			const name = at(row, title);
			return {
				title: name,
				searchTitle: withoutSeries(name),
				author: at(row, author) || at(row, additional).split(",")[0].trim(),
				isbn: isbnOf(at(row, isbn13)) ?? isbnOf(at(row, isbn10)),
				group: (STANDARD_SHELVES.includes(own) ? own : "own") as ShelfGroup,
				shelves,
				...standing(own, shelves, dateOf(at(row, dateRead)), Number.isFinite(count) && count > 0 ? count : 0),
			};
		});
}

/**
 * Whether an edition found by its ISBN alone is the book on the row: its
 * title holds the row's, or the other way round. Open Library answers some
 * ISBNs it doesn't have with an unrelated book — see `editionByIsbn`.
 */
export function sameBook(editionTitle: string | null, row: GoodreadsRow): boolean {
	if (editionTitle === null) return false;
	const edition = titleKey(editionTitle);
	const wanted = titleKey(row.searchTitle);
	if (edition === "" || wanted === "") return false;
	return edition.includes(wanted) || wanted.includes(edition);
}
