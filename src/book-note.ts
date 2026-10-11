import { NO_BOOK_FACTS, type AuthorMetadata, type BookFacts, type BookMetadata, type ReadStatus } from "./book";
import type { BookEdition } from "./book-edition";
import {
	formatNames,
	isEmptyValue,
	keepLinks,
	listValues,
	mergeAliases,
	parseFrontmatterBlocks,
	posterLine,
	serializeFrontmatterBlocks,
	setOrderedKey,
	yamlList,
	yamlScalar,
	yamlString,
} from "./note";

/*
 * Book and author notes. What Open Library and Wikidata know — the title,
 * authors, year, genres, series, pages; an author's names and dates — is
 * rewritten by a refresh; where the user is with a book — `read_status`,
 * `started`, `finished`, `read_count` — is theirs, and only ever changed by
 * their own commands, and so are the `shelves` a Goodreads import brings. So is the `edition` block, the edition the user owns:
 * only "Choose edition" writes it, and once it is there `pages` is that
 * edition's.
 */

const BOOK_FIELD_ORDER = [
	"title",
	"original_title",
	"aliases",
	"year",
	"authors",
	"genres",
	"series",
	"pages",
	"poster",
	"url",
	"openlibrary_id",
	"edition",
	"read_status",
	"started",
	"finished",
	"read_count",
	"shelves",
];

const AUTHOR_FIELD_ORDER = ["name", "original_name", "aliases", "born", "died", "poster", "photo_credit", "url", "openlibrary_id"];

/** Which of a book's names are written as links, and how to tell whether a note exists. */
export interface BookLinks {
	authors: boolean;
	genres: boolean;
	isResolved: (name: string) => boolean;
}

export const NO_BOOK_LINKS: BookLinks = { authors: false, genres: false, isResolved: () => false };

/** The names a book's note is also found by: its title, its own in another script, then its other titles. */
function aliasesOf(book: BookMetadata): string[] {
	return [...new Set([book.title, ...(book.originalTitle === null ? [] : [book.originalTitle]), ...book.otherTitles])];
}

/**
 * The lines a book's metadata writes. With `facts` at `null` — Wikidata
 * couldn't be reached — the ones it decides are left out, so a refresh keeps
 * what the note has rather than writing Open Library's year, or an author's
 * name in another script, over it. So is the title of a book titled in
 * another script, whose English name is Wikidata's to give. `original_title`
 * is only ever written for such a book.
 */
function bookLines(book: BookMetadata, links: BookLinks, facts: BookFacts | null, previous?: Record<string, unknown>): [string, string[]][] {
	const linked = (key: "authors" | "genres", values: string[], link: boolean) =>
		yamlList(key, keepLinks(link ? formatNames(values, links.isResolved) : values, previous?.[key]));
	const fromWikidata: [string, string[]][] =
		facts === null
			? []
			: [
					["year", [yamlScalar("year", book.year)]],
					["authors", linked("authors", book.authors, links.authors)],
					["genres", linked("genres", book.genres, links.genres)],
					["series", yamlList("series", keepLinks(book.series, previous?.series))],
				];
	const titles: [string, string[]][] =
		facts === null && book.originalTitle !== null
			? []
			: [
					["title", [`title: ${yamlString(book.title)}`]],
					...(book.originalTitle === null ? [] : ([["original_title", [`original_title: ${yamlString(book.originalTitle)}`]]] as [string, string[]][])),
				];
	return [
		...titles,
		...fromWikidata,
		["pages", [yamlScalar("pages", book.pages)]],
		["url", [yamlScalar("url", book.url)]],
		["openlibrary_id", [`openlibrary_id: ${book.openLibraryId}`]],
	];
}

export function buildBookNoteContent(book: BookMetadata, coverLink: string | null, links: BookLinks): string {
	// Every line: a new note is written whole, from whatever was found.
	const owned = new Map(bookLines(book, links, NO_BOOK_FACTS));
	const lines = ["---"];
	for (const key of BOOK_FIELD_ORDER) {
		if (key === "aliases") lines.push(...yamlList("aliases", aliasesOf(book)));
		else if (key === "poster") lines.push(posterLine(coverLink === null ? null : coverLink.replace(/^!/, "")));
		else if (key === "read_status") lines.push("read_status: to read");
		else if (key === "started") lines.push("started:");
		else if (key === "finished") lines.push("finished:");
		else if (key === "read_count") lines.push("read_count: 0");
		else lines.push(...(owned.get(key) ?? []));
	}
	lines.push("---", "");
	return lines.join("\n");
}

/**
 * Rewrites what Open Library and Wikidata know about the book. The aliases
 * the user added are kept, a name already written as a link stays one, and
 * the cover is only filled in when the note has none — or `posterMissing`,
 * one whose file is gone. Everything of the user's stays as it is.
 */
export function refreshBookFrontmatter(
	content: string,
	book: BookMetadata,
	facts: BookFacts | null,
	links: BookLinks,
	coverLink: string | null,
	previous: Record<string, unknown> = {},
	posterMissing = false,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	// Once the user has chosen their edition, the page count is that edition's.
	const ownEdition = !isEmptyValue(doc.blocks.get("edition"));
	for (const [key, lines] of bookLines(book, links, facts, previous)) {
		if (key === "pages" && ownEdition) continue;
		setOrderedKey(doc, BOOK_FIELD_ORDER, key, lines);
	}
	if (facts !== null) {
		// The old title gives way to the new one; every other alias — the user's own too — stays.
		const aliases = mergeAliases(aliasesOf(book), listValues(previous.aliases), [...listValues(previous.title), ...listValues(previous.original_title)]);
		setOrderedKey(doc, BOOK_FIELD_ORDER, "aliases", yamlList("aliases", aliases));
	}
	if (coverLink !== null && (posterMissing || isEmptyValue(doc.blocks.get("poster")))) {
		setOrderedKey(doc, BOOK_FIELD_ORDER, "poster", [posterLine(coverLink.replace(/^!/, ""))]);
	}
	return serializeFrontmatterBlocks(doc);
}

/** The edition a book's note says the user owns, as far as choosing another goes. */
export interface NoteEdition {
	id: string | null;
	title: string | null;
	translators: string[];
}

export function editionOfNote(frontmatter: Record<string, unknown> | undefined): NoteEdition | null {
	const edition: unknown = frontmatter?.edition;
	if (edition === null || typeof edition !== "object" || Array.isArray(edition)) return null;
	const fields = edition as Record<string, unknown>;
	const id = typeof fields.openlibrary_id === "string" && /^OL\d+M$/.test(fields.openlibrary_id.trim()) ? fields.openlibrary_id.trim() : null;
	const [title] = listValues(fields.title);
	return { id, title: title ?? null, translators: listValues(fields.translators) };
}

/** Two titles that differ only in case or spacing are one. */
function sameTitle(a: string, b: string): boolean {
	const key = (text: string) => text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
	return key(a) === key(b);
}

/**
 * The `edition` block: the edition's Open Library id, its title where it
 * isn't the book's own — a translation's, say — its publisher, the year it
 * was published, its ISBN and its translators. Every key is written, empty
 * where nothing is known, for the user to fill in.
 */
function editionBlock(edition: BookEdition, translators: string[], ownTitle: boolean): string[] {
	const indent = "  ";
	return [
		"edition:",
		yamlScalar("openlibrary_id", edition.id, indent),
		...(edition.title !== null && !ownTitle ? [yamlScalar("title", edition.title, indent)] : []),
		yamlScalar("publisher", edition.publisher, indent),
		yamlScalar("published", edition.year, indent),
		yamlScalar("isbn", edition.isbn, indent),
		...yamlList("translators", translators, indent),
	];
}

/**
 * "Choose edition": the edition becomes the note's own. Its block replaces
 * the one before, `pages` becomes its page count where it has one, and its
 * cover the poster where one was saved. A translation's title joins the
 * aliases, so the note is found by it, in place of the last edition's.
 * Everything else stays as it is. With `keepPages`, a page count already
 * there stays too: an import fills a note in, it never overwrites it.
 */
export function setBookEdition(
	content: string,
	edition: BookEdition,
	translators: string[],
	coverLink: string | null,
	previous: Record<string, unknown> = {},
	options: { keepPages?: boolean } = {},
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;
	// The book's own titles: an edition under one of them adds no title of its own.
	const ownTitles = [...listValues(previous.title), ...listValues(previous.original_title)];
	const isOwn = (title: string) => ownTitles.some((own) => sameTitle(own, title));
	const ownTitle = edition.title === null || isOwn(edition.title);

	setOrderedKey(doc, BOOK_FIELD_ORDER, "edition", editionBlock(edition, translators, ownTitle));
	const keepPages = options.keepPages === true && !isEmptyValue(doc.blocks.get("pages"));
	if (edition.pages !== null && !keepPages) setOrderedKey(doc, BOOK_FIELD_ORDER, "pages", [yamlScalar("pages", edition.pages)]);
	if (coverLink !== null) setOrderedKey(doc, BOOK_FIELD_ORDER, "poster", [posterLine(coverLink.replace(/^!/, ""))]);

	const aliases = listValues(previous.aliases);
	const previousTitle = editionOfNote(previous)?.title ?? null;
	const kept = aliases.filter((alias) => alias !== previousTitle || isOwn(alias));
	const added = edition.title !== null && !ownTitle && !kept.some((alias) => sameTitle(alias, edition.title ?? "")) ? [edition.title] : [];
	if (added.length > 0 || kept.length !== aliases.length) {
		setOrderedKey(doc, BOOK_FIELD_ORDER, "aliases", yamlList("aliases", [...kept, ...added]));
	}
	return serializeFrontmatterBlocks(doc);
}

/** The names an author's note is found by: the one it goes by, then the one in their own script. */
function authorAliases(author: AuthorMetadata): string[] {
	return [...new Set([author.name, ...(author.originalName === null ? [] : [author.originalName])])];
}

function authorLines(author: AuthorMetadata): [string, string[]][] {
	return [
		["name", [`name: ${yamlString(author.name)}`]],
		["original_name", [yamlScalar("original_name", author.originalName)]],
		["born", [yamlScalar("born", author.born)]],
		["died", [yamlScalar("died", author.died)]],
		["url", [yamlScalar("url", author.url)]],
		["openlibrary_id", [`openlibrary_id: ${author.openLibraryId}`]],
	];
}

/** A photo as an author's note keeps it: the link, and whom to credit for it. */
export interface AuthorPhoto {
	link: string;
	credit: string | null;
}

export function buildAuthorNoteContent(author: AuthorMetadata, photo: AuthorPhoto | null): string {
	const owned = new Map(authorLines(author));
	const lines = ["---"];
	for (const key of AUTHOR_FIELD_ORDER) {
		if (key === "aliases") lines.push(...yamlList("aliases", authorAliases(author)));
		else if (key === "poster") lines.push(posterLine(photo === null ? null : photo.link.replace(/^!/, "")));
		else if (key === "photo_credit") lines.push(yamlScalar("photo_credit", photo?.credit ?? null));
		else lines.push(...(owned.get(key) ?? []));
	}
	lines.push("---", "");
	return lines.join("\n");
}

/** Rewrites what is known about the author; a photo is only filled in where the note has none, or its file is gone. */
export function refreshAuthorFrontmatter(
	content: string,
	author: AuthorMetadata,
	photo: AuthorPhoto | null,
	previous: Record<string, unknown> = {},
	posterMissing = false,
): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;

	for (const [key, lines] of authorLines(author)) setOrderedKey(doc, AUTHOR_FIELD_ORDER, key, lines);
	const aliases = mergeAliases(authorAliases(author), listValues(previous.aliases), [
		...listValues(previous.name),
		...listValues(previous.original_name),
	]);
	setOrderedKey(doc, AUTHOR_FIELD_ORDER, "aliases", yamlList("aliases", aliases));
	if (photo !== null && (posterMissing || isEmptyValue(doc.blocks.get("poster")))) {
		setOrderedKey(doc, AUTHOR_FIELD_ORDER, "poster", [posterLine(photo.link.replace(/^!/, ""))]);
		setOrderedKey(doc, AUTHOR_FIELD_ORDER, "photo_credit", [yamlScalar("photo_credit", photo.credit)]);
	}
	return serializeFrontmatterBlocks(doc);
}

export interface ReadProgress {
	status: string | null;
	readCount: number;
}

export function readProgressOf(frontmatter: Record<string, unknown> | undefined): ReadProgress {
	const status: unknown = frontmatter?.read_status;
	const count: unknown = frontmatter?.read_count;
	return {
		status: typeof status === "string" && status.trim() !== "" ? status.trim() : null,
		readCount: typeof count === "number" && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
	};
}

/** "Start reading": being read now — again, if it was finished before. The day it was first started stays. */
export function startReading(content: string, date: string): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;
	setOrderedKey(doc, BOOK_FIELD_ORDER, "read_status", [`read_status: ${"reading" satisfies ReadStatus}`]);
	if (isEmptyValue(doc.blocks.get("started"))) setOrderedKey(doc, BOOK_FIELD_ORDER, "started", [`started: ${date}`]);
	return serializeFrontmatterBlocks(doc);
}

/**
 * "Mark book as finished today": read, dated the first time — the day it was
 * first finished stays — and counted once more, since a book is read again.
 */
export function markBookFinished(content: string, date: string, count: number): string {
	const doc = parseFrontmatterBlocks(content);
	if (doc === null) return content;
	setOrderedKey(doc, BOOK_FIELD_ORDER, "read_status", [`read_status: ${"read" satisfies ReadStatus}`]);
	if (isEmptyValue(doc.blocks.get("finished"))) setOrderedKey(doc, BOOK_FIELD_ORDER, "finished", [`finished: ${date}`]);
	setOrderedKey(doc, BOOK_FIELD_ORDER, "read_count", [`read_count: ${count + 1}`]);
	return serializeFrontmatterBlocks(doc);
}

/** Where the user is with a book, as an import finds it: Goodreads' shelves, read date and read count. */
export interface ImportedReading {
	status: ReadStatus;
	finished: string | null;
	readCount: number;
	shelves: string[];
}

/**
 * A new book note, as an import writes it: the note "Add book" writes, with
 * the user's edition — the ISBN they shelved — and where they are with it.
 */
export function buildImportedBookNote(
	book: BookMetadata,
	coverLink: string | null,
	links: BookLinks,
	edition: BookEdition | null,
	reading: ImportedReading,
): string {
	const content = buildBookNoteContent(book, coverLink, links);
	const own = { title: book.title, original_title: book.originalTitle ?? undefined, aliases: aliasesOf(book) };
	const withEdition = edition === null ? content : setBookEdition(content, edition, edition.translators, null, own);
	const doc = parseFrontmatterBlocks(withEdition);
	if (doc === null) return withEdition;
	setOrderedKey(doc, BOOK_FIELD_ORDER, "read_status", [`read_status: ${reading.status}`]);
	if (reading.finished !== null) setOrderedKey(doc, BOOK_FIELD_ORDER, "finished", [`finished: ${reading.finished}`]);
	setOrderedKey(doc, BOOK_FIELD_ORDER, "read_count", [`read_count: ${reading.readCount}`]);
	if (reading.shelves.length > 0) setOrderedKey(doc, BOOK_FIELD_ORDER, "shelves", yamlList("shelves", reading.shelves));
	return serializeFrontmatterBlocks(doc);
}

/**
 * A book already in the vault, filled in from an import: only what the note
 * leaves empty. Its status only moves on from "to read" — a book the user
 * marked reading, read or dropped stays so — the read date and the shelves
 * are only written where there are none, the read count only where it is
 * 0, and the edition only where none was chosen, the page count kept. The
 * poster, and where the note sits, are never touched.
 */
export function fillImportedBook(
	content: string,
	edition: BookEdition | null,
	reading: ImportedReading,
	previous: Record<string, unknown> = {},
): string {
	const hasEdition = editionOfNote(previous) !== null;
	const withEdition = edition === null || hasEdition ? content : setBookEdition(content, edition, edition.translators, null, previous, { keepPages: true });
	const doc = parseFrontmatterBlocks(withEdition);
	if (doc === null) return content;

	const { status, readCount } = readProgressOf(previous);
	if (status === null || (status === "to read" && reading.status !== "to read")) {
		setOrderedKey(doc, BOOK_FIELD_ORDER, "read_status", [`read_status: ${reading.status}`]);
	}
	if (reading.finished !== null && isEmptyValue(doc.blocks.get("finished"))) {
		setOrderedKey(doc, BOOK_FIELD_ORDER, "finished", [`finished: ${reading.finished}`]);
	}
	if (readCount === 0 && reading.readCount > 0) setOrderedKey(doc, BOOK_FIELD_ORDER, "read_count", [`read_count: ${reading.readCount}`]);
	if (reading.shelves.length > 0 && isEmptyValue(doc.blocks.get("shelves"))) {
		setOrderedKey(doc, BOOK_FIELD_ORDER, "shelves", yamlList("shelves", reading.shelves));
	}
	return serializeFrontmatterBlocks(doc);
}
