import { isLatin } from "./music";

/*
 * Open Library's answers, Wikidata's additions to them, and what a book or an
 * author note is made of. Pure functions only: the requests themselves are in
 * openlibrary.ts, so that everything here can be checked against the saved
 * answers in tests/fixtures/openlibrary.
 */

/** A work as Open Library's search answers for it, with only the fields asked for. */
export interface OlWorkDoc {
	/** "/works/OL40875W". */
	key: string;
	title?: string;
	author_name?: string[];
	author_key?: string[];
	first_publish_year?: number;
	cover_i?: number;
	number_of_pages_median?: number;
	edition_count?: number;
	/** The edition that best matches the language asked for (see `WORK_LANGUAGE`): "The Cherry Orchard" for Вишневый сад. */
	editions?: { docs?: { title?: string; language?: string[] }[] };
}

/** The fields every work search asks for. */
export const WORK_FIELDS =
	"key,title,author_name,author_key,first_publish_year,cover_i,number_of_pages_median,edition_count,editions,editions.title,editions.language";

/**
 * The language every work search asks Open Library to match an edition in.
 * A work's own record is titled in its first language — Вишневый сад,
 * Дядя Ваня — and the edition says what it is called in English.
 */
export const WORK_LANGUAGE = "en";

/** An author as Open Library's author search answers for them. */
export interface OlAuthorDoc {
	/** "OL28104A". */
	key: string;
	name?: string;
	birth_date?: string;
	death_date?: string;
	top_work?: string;
	work_count?: number;
}

/** The fields an author search asks for. */
export const AUTHOR_FIELDS = "key,name,birth_date,death_date,top_work,work_count";

/** An author's own record on Open Library: /authors/OL28104A.json. */
export interface OlAuthor {
	key?: string;
	name?: string;
	personal_name?: string;
	birth_date?: string;
	death_date?: string;
	/** Ids on Open Library's image server; -1 stands for a photo since removed. */
	photos?: number[];
	remote_ids?: { wikidata?: string };
}

export interface BookSearchResult {
	/** Open Library's id of the work: "OL40875W". */
	id: string;
	/** Its title in Latin letters: its own, or its English one for a book titled in another script. */
	title: string;
	/** Its own title, when `title` is its English one: Вишневый сад. */
	originalTitle: string | null;
	authors: string[];
	/** The year Open Library has. Its own, and not always right: the note takes Wikidata's where it has one. */
	year: number | null;
	/** How many editions Open Library holds — what tells the book itself from a stray copy of its record. */
	editions: number;
}

export interface AuthorSearchResult {
	/** "OL28104A". */
	id: string;
	name: string;
	/** "1933–2023", or "1906–1948", as Open Library writes their dates. */
	years: string | null;
	topWork: string | null;
	works: number;
}

/**
 * What Wikidata adds to a book: the year it was first published — Open
 * Library's own is now and then the year of some stray edition, 1900 for a
 * 2005 novel — its genres and series, and its other titles.
 */
export interface BookFacts {
	year: number | null;
	genres: string[];
	series: string[];
	/** Its title in its own language, and in English: ノルウェイの森, Madonna in a Fur Coat. */
	titles: string[];
	/** Its name in English: what a book titled in another script goes by. */
	englishTitle: string | null;
	/** Its authors' names in English, in Wikidata's order. */
	authors: string[];
}

/** What Wikidata adds to an author: their dates, their names, and a photo on Wikimedia Commons. */
export interface PersonFacts {
	born: string | null;
	died: string | null;
	/** Their name in English: Haruki Murakami for 村上春樹. */
	englishName: string | null;
	/** Their name in their own language and script: Лев Толстой. */
	nativeName: string | null;
	/** A file on Wikimedia Commons. */
	photo: string | null;
}

export const NO_BOOK_FACTS: BookFacts = { year: null, genres: [], series: [], titles: [], englishTitle: null, authors: [] };
export const NO_PERSON_FACTS: PersonFacts = { born: null, died: null, englishName: null, nativeName: null, photo: null };

export interface BookMetadata {
	/** Its title in Latin letters — see `latinTitle`. */
	title: string;
	/** Its own title in another script, when `title` is its English one. */
	originalTitle: string | null;
	/** Its other titles, for `aliases`. */
	otherTitles: string[];
	year: number | null;
	authors: string[];
	genres: string[];
	series: string[];
	/** The median page count of its editions on Open Library. */
	pages: number | null;
	/** The id of its cover on Open Library's image server; never written to the note. */
	coverId: number | null;
	url: string;
	openLibraryId: string;
}

export interface AuthorMetadata {
	name: string;
	/** Their name in another script, when the note goes by their name in Latin letters. */
	originalName: string | null;
	born: string | null;
	died: string | null;
	/** Their photo on Open Library's image server, if it has one. */
	photoId: number | null;
	/** Their Wikidata item. */
	wikidataId: string | null;
	/** The photo their Wikidata item names on Wikimedia Commons: the one taken when Open Library has none. */
	commonsPhoto: string | null;
	url: string;
	openLibraryId: string;
}

/** "/works/OL40875W" or "OL40875W": the id alone, or `null` for anything that isn't one. */
export function workIdOf(key: string | undefined): string | null {
	const match = (key ?? "").match(/(OL\d+W)$/);
	return match === null ? null : match[1];
}

/** "/authors/OL28104A" or "OL28104A": the id alone. */
export function authorIdOf(key: string | undefined): string | null {
	const match = (key ?? "").match(/(OL\d+A)$/);
	return match === null ? null : match[1];
}

/** A title reduced to its letters and digits, for telling whether a search names it exactly. */
export function titleKey(text: string): string {
	return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * The search's results in the order they are offered: those titled exactly
 * as searched first — in their own language or in English, so that "The
 * Cherry Orchard" finds Вишневый сад itself ahead of the plays named after
 * it — then by how many editions each has. Open Library keeps stray copies
 * of a book's record — Kürk Mantolu Madonna has two — and the one with every
 * edition under it is the book itself. Ties keep Open Library's own order.
 */
export function rankBooks(docs: OlWorkDoc[], query: string): OlWorkDoc[] {
	const wanted = titleKey(query);
	const exact = (doc: OlWorkDoc) => ([doc.title ?? "", englishEditionTitle(doc) ?? ""].some((title) => titleKey(title) === wanted) ? 1 : 0);
	const editions = (doc: OlWorkDoc) => doc.edition_count ?? 0;
	return docs
		.map((doc, index) => ({ doc, index }))
		.sort((a, b) => exact(b.doc) - exact(a.doc) || editions(b.doc) - editions(a.doc) || a.index - b.index)
		.map(({ doc }) => doc);
}

/**
 * Authors with the most works first. Open Library keeps stray records of
 * authors too — a "Haruki Murakami" with four works beside 村上春樹 with five
 * hundred — and the one the books are filed under is the one to pick.
 */
export function rankAuthors(docs: OlAuthorDoc[]): OlAuthorDoc[] {
	return docs
		.map((doc, index) => ({ doc, index }))
		.sort((a, b) => (b.doc.work_count ?? 0) - (a.doc.work_count ?? 0) || a.index - b.index)
		.map(({ doc }) => doc);
}

function names(list: string[] | undefined): string[] {
	const found: string[] = [];
	for (const item of list ?? []) {
		const name = item.trim();
		if (name !== "" && !found.includes(name)) found.push(name);
	}
	return found;
}

/** The title of the English edition Open Library matched, if it found one in English and it is in Latin letters. */
function englishEditionTitle(doc: OlWorkDoc): string | null {
	const edition = doc.editions?.docs?.[0];
	const title = edition?.title?.trim() ?? "";
	return title !== "" && (edition?.language ?? []).includes("eng") && isLatin(title) ? title : null;
}

/**
 * A book's title in Latin letters, and its own when that is in another
 * script: Вишневый сад goes by The Cherry Orchard — Wikidata's English name
 * for it, else the English edition's title — the way an author goes by
 * their name in Latin letters. A title already in Latin letters, in any
 * language, stays as it is; one with no English name found stays too.
 */
export function latinTitle(doc: OlWorkDoc, englishTitle: string | null = null): { title: string; originalTitle: string | null } {
	const own = doc.title?.trim() ?? "";
	if (isLatin(own)) return { title: own, originalTitle: null };
	const english = [englishTitle, englishEditionTitle(doc)].find((title): title is string => title !== null && title !== "" && isLatin(title));
	return english === undefined ? { title: own, originalTitle: null } : { title: english, originalTitle: own };
}

export function toBookSearchResult(doc: OlWorkDoc): BookSearchResult {
	return {
		id: workIdOf(doc.key) ?? "",
		...latinTitle(doc),
		authors: names(doc.author_name),
		year: typeof doc.first_publish_year === "number" ? doc.first_publish_year : null,
		editions: doc.edition_count ?? 0,
	};
}

/** "1933–2023", "1906–1948", "1949–": what tells two authors of one name apart. */
function lifeYears(born: string | undefined, died: string | undefined): string | null {
	const year = (text: string | undefined) => text?.match(/\d{3,4}/)?.[0] ?? null;
	const from = year(born);
	const to = year(died);
	if (from === null && to === null) return null;
	return `${from ?? "?"}–${to ?? ""}`;
}

export function toAuthorSearchResult(doc: OlAuthorDoc): AuthorSearchResult {
	return {
		id: authorIdOf(doc.key) ?? "",
		name: doc.name?.trim() ?? "",
		years: lifeYears(doc.birth_date, doc.death_date),
		topWork: doc.top_work?.trim() || null,
		works: doc.work_count ?? 0,
	};
}

/**
 * A book's authors as its note lists them. Open Library writes some in their
 * own script — 村上春樹 — and the author's note goes by the English name
 * Wikidata has (see `toAuthorMetadata`), so that the two link up; a name
 * already in Latin letters stays as Open Library has it. The names are only
 * swapped when Wikidata lists as many authors, so each takes its own place.
 */
export function bookAuthors(openLibrary: string[], wikidata: string[]): string[] {
	if (openLibrary.length !== wikidata.length) return openLibrary;
	return openLibrary.map((name, index) => (isLatin(name) || !isLatin(wikidata[index]) ? name : wikidata[index]));
}

export function toBookMetadata(doc: OlWorkDoc, facts: BookFacts): BookMetadata {
	const id = workIdOf(doc.key) ?? "";
	const { title, originalTitle } = latinTitle(doc, facts.englishTitle);
	const pages = doc.number_of_pages_median;
	return {
		title,
		originalTitle,
		otherTitles: facts.titles.filter((other) => other !== title && other !== originalTitle),
		year: facts.year ?? (typeof doc.first_publish_year === "number" ? doc.first_publish_year : null),
		authors: bookAuthors(names(doc.author_name), facts.authors),
		genres: facts.genres,
		series: facts.series,
		pages: typeof pages === "number" && pages > 0 ? Math.round(pages) : null,
		coverId: typeof doc.cover_i === "number" && doc.cover_i > 0 ? doc.cover_i : null,
		url: `https://openlibrary.org/works/${id}`,
		openLibraryId: id,
	};
}

/**
 * An author as their note has them. The note goes by their name in Latin
 * letters — Wikidata's English one where Open Library writes it in another
 * script — and keeps the other in `original_name`, the way an artist's note
 * does. Their dates are Wikidata's, written as dates, where it has them.
 */
export function toAuthorMetadata(author: OlAuthor, id: string, facts: PersonFacts): AuthorMetadata {
	const own = author.name?.trim() || author.personal_name?.trim() || "";
	const english = facts.englishName !== null && isLatin(facts.englishName) ? facts.englishName : null;
	const name = isLatin(own) || english === null ? own : english;
	const other = [own, facts.nativeName].find((candidate) => candidate !== null && candidate !== "" && candidate !== name && !isLatin(candidate));
	const photo = (author.photos ?? []).find((photoId) => typeof photoId === "number" && photoId > 0);
	return {
		name,
		originalName: other ?? null,
		born: facts.born ?? (author.birth_date?.trim() || null),
		died: facts.died ?? (author.death_date?.trim() || null),
		photoId: photo ?? null,
		wikidataId: author.remote_ids?.wikidata?.trim() || null,
		commonsPhoto: facts.photo,
		url: `https://openlibrary.org/authors/${id}`,
		openLibraryId: id,
	};
}

/** A cover on Open Library's image server, large. `default=false` makes a missing one a 404 rather than a blank picture. */
export function bookCoverUrl(coverId: number): string {
	return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false`;
}

export function authorPhotoUrl(photoId: number): string {
	return `https://covers.openlibrary.org/a/id/${photoId}-L.jpg?default=false`;
}

/** A Wikidata time value as the claim holds it: "+2005-07-19T00:00:00Z", with how much of it is known. */
export interface WikidataTime {
	time: string;
	/** 9 for a year, 10 for a month, 11 for a day. */
	precision: number;
}

/** The year of a Wikidata time; a year before the common era is negative. */
export function yearOfTime(value: WikidataTime): number | null {
	const match = value.time.match(/^([+-])(\d+)-/);
	if (match === null) return null;
	const year = Number(match[2]) * (match[1] === "-" ? -1 : 1);
	return Number.isFinite(year) && year !== 0 ? year : null;
}

/** A Wikidata time as a date property holds it, only as exactly as it is known: "1933-07-20", "1906". */
export function dateOfTime(value: WikidataTime): string | null {
	const match = value.time.match(/^([+-])(\d+)-(\d{2})-(\d{2})/);
	if (match === null || value.precision < 9) return null;
	const year = `${match[1] === "-" ? "-" : ""}${match[2].replace(/^0+(?=\d{4})/, "")}`;
	if (value.precision === 9 || match[3] === "00") return year;
	if (value.precision === 10 || match[4] === "00") return `${year}-${match[3]}`;
	return `${year}-${match[3]}-${match[4]}`;
}

/** Where the user is with a book, as they keep it. */
export const READ_STATUSES = ["to read", "reading", "read", "dropped"] as const;
export type ReadStatus = (typeof READ_STATUSES)[number];
