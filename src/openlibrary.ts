import {
	AUTHOR_FIELDS,
	NO_BOOK_FACTS,
	WORK_LANGUAGE,
	NO_PERSON_FACTS,
	WORK_FIELDS,
	authorPhotoUrl,
	bookCoverUrl,
	rankAuthors,
	rankBooks,
	toAuthorMetadata,
	toAuthorSearchResult,
	toBookMetadata,
	toBookSearchResult,
	type AuthorMetadata,
	type AuthorSearchResult,
	type BookFacts,
	type BookMetadata,
	type BookSearchResult,
	type OlAuthor,
	type OlAuthorDoc,
	type OlWorkDoc,
} from "./book";
import { commonsImages } from "./commons";
import { isLatin } from "./music";
import { OBSIDIAN_WEB, SearchSuperseded, type Picture, type WebAccess, type WebResponse } from "./musicbrainz";
import { WikidataClient } from "./wikidata";

const API_BASE = "https://openlibrary.org";
const HOMEPAGE = "https://github.com/yunuskarasu/obsidian-film-tracker";

/**
 * Open Library takes one request a second from a client it can't tell
 * apart, and asks every client to say who it is. The pause is kept across
 * every client the plugin makes, since each command makes its own. Its
 * image server is not counted: covers by their id are never limited.
 */
const GAP_MS = 1000;
let nextRequestAt = 0;
/** Requests take their turns one after another, never two at once. */
let queue: Promise<void> = Promise.resolve();

/** How long to wait before asking a busy Open Library again: longer each time. */
const BUSY_PAUSES_MS = [2000, 4000];

/** How many of an author's books "Add book…" offers, the best known first. */
const AUTHOR_WORKS_MAX = 100;

export class OpenLibraryError extends Error {}

/** For tests: the next request goes out at once. */
export function resetOpenLibraryQueue(): void {
	nextRequestAt = 0;
	queue = Promise.resolve();
}

/**
 * Open Library, the Internet Archive's catalogue of books, with Wikidata
 * beside it for what Open Library has wrong or not at all. Neither needs a
 * key: every request names the plugin and where to find it instead.
 */
export class OpenLibraryClient {
	private readonly userAgent: string;
	private readonly web: WebAccess;
	private readonly wikidata: WikidataClient;

	constructor(version: string, web: WebAccess = OBSIDIAN_WEB) {
		this.userAgent = `FilmTracker/${version} ( ${HOMEPAGE} )`;
		this.web = web;
		this.wikidata = new WikidataClient(version, web);
	}

	/** `stillWanted` works as it does for MusicBrainz: a search typed past is dropped before it is sent. */
	async searchBooks(query: string, stillWanted?: () => boolean): Promise<BookSearchResult[]> {
		const body = await this.ol<{ docs?: OlWorkDoc[] }>(
			`/search.json?q=${encodeURIComponent(query)}&fields=${WORK_FIELDS}&lang=${WORK_LANGUAGE}&limit=20`,
			stillWanted,
		);
		return rankBooks(body.docs ?? [], query)
			.map(toBookSearchResult)
			.filter((book) => book.id !== "" && book.title !== "");
	}

	async searchAuthors(query: string, stillWanted?: () => boolean): Promise<AuthorSearchResult[]> {
		const body = await this.ol<{ docs?: OlAuthorDoc[] }>(
			`/search/authors.json?q=${encodeURIComponent(query)}&fields=${AUTHOR_FIELDS}&limit=20`,
			stillWanted,
		);
		return rankAuthors(body.docs ?? [])
			.map(toAuthorSearchResult)
			.filter((author) => author.id !== "" && author.name !== "");
	}

	/** An author's books, the ones with the most editions first: what BIBLIOGRAPHY's "Add book…" offers. */
	async authorWorks(authorId: string): Promise<BookSearchResult[]> {
		const body = await this.ol<{ docs?: OlWorkDoc[] }>(
			`/search.json?author_key=${authorId}&sort=editions&fields=${WORK_FIELDS}&lang=${WORK_LANGUAGE}&limit=${AUTHOR_WORKS_MAX}`,
		);
		return (body.docs ?? []).map(toBookSearchResult).filter((book) => book.id !== "" && book.title !== "");
	}

	/**
	 * A book by its id: one request to Open Library — its search, which has
	 * the authors' names and the page count the work's own record lacks — and
	 * Wikidata's facts beside it (see `WikidataClient.bookFacts`). `facts` is
	 * `null` when Wikidata couldn't be reached.
	 *
	 * An author Open Library names in another script — 村上春樹 — whom
	 * Wikidata didn't name for this book is looked up on their own, so the
	 * book lists them the way their note is named: Haruki Murakami.
	 */
	async getBook(id: string): Promise<{ book: BookMetadata; facts: BookFacts | null }> {
		const body = await this.ol<{ docs?: OlWorkDoc[] }>(`/search.json?q=${encodeURIComponent(`key:/works/${id}`)}&fields=${WORK_FIELDS}&lang=${WORK_LANGUAGE}`);
		const doc = (body.docs ?? []).find((found) => found.key === `/works/${id}`);
		if (doc === undefined) throw new OpenLibraryError("Open Library has no such book any more.");
		const facts = await this.wikidata.bookFacts(id);
		const book = toBookMetadata(doc, facts ?? NO_BOOK_FACTS);
		if (facts !== null) book.authors = await this.authorsInLatin(book.authors, doc);
		return { book, facts };
	}

	/** The authors still named in another script, each looked up on their own; one that can't be is left as it is. */
	private async authorsInLatin(authors: string[], doc: OlWorkDoc): Promise<string[]> {
		const named: string[] = [];
		for (const [index, name] of authors.entries()) {
			const key = doc.author_name?.[index]?.trim() === name ? doc.author_key?.[index] : undefined;
			if (isLatin(name) || key === undefined) {
				named.push(name);
				continue;
			}
			try {
				named.push((await this.getAuthor(key)).name);
			} catch (error) {
				if (!(error instanceof OpenLibraryError)) throw error;
				named.push(name);
			}
		}
		return named;
	}

	/** An author by their id: their own record, and Wikidata's facts beside it. */
	async getAuthor(id: string): Promise<AuthorMetadata> {
		const author = await this.ol<OlAuthor>(`/authors/${id}.json`);
		const wikidataId = author.remote_ids?.wikidata?.trim() || null;
		const facts = await this.wikidata.personFacts(wikidataId, id);
		const metadata = toAuthorMetadata(author, id, facts ?? NO_PERSON_FACTS);
		if (metadata.name === "") throw new OpenLibraryError("Open Library has no name for this author.");
		return metadata;
	}

	/** A book's cover, from Open Library's image server. */
	async bookCover(coverId: number): Promise<Picture | null> {
		return this.picture(bookCoverUrl(coverId), null);
	}

	/**
	 * An author's photo: their own on Open Library, else the one their
	 * Wikidata item names on Wikimedia Commons — credited, as an artist's is.
	 */
	async authorPhoto(author: AuthorMetadata): Promise<Picture | null> {
		if (author.photoId !== null) {
			const own = await this.picture(authorPhotoUrl(author.photoId), "Open Library");
			if (own !== null) return own;
		}
		if (author.commonsPhoto === null) return null;
		const [candidate] = await commonsImages((url) => this.fetch(url), [author.commonsPhoto]);
		return candidate === undefined ? null : this.picture(candidate.url, candidate.credit);
	}

	private async picture(url: string, credit: string | null): Promise<Picture | null> {
		const response = await this.fetch(url);
		if (response === null || response.status !== 200 || response.arrayBuffer.byteLength === 0) return null;
		const type = (response.contentType ?? "").split(";")[0].trim();
		return { data: response.arrayBuffer, credit, extension: type === "image/png" ? "png" : "jpg" };
	}

	/** A request to anything but Open Library's catalogue: a failure is no picture, never an error. */
	private async fetch(url: string): Promise<WebResponse | null> {
		try {
			return await this.web.get(url, { "User-Agent": this.userAgent });
		} catch (error) {
			console.error("Film + Anime-Manga Tracker: request failed", url, error);
			return null;
		}
	}

	/**
	 * One request to Open Library, in its turn. A busy answer (429 or 503) is
	 * tried again after a pause, twice, each pause longer than the last.
	 */
	private async ol<T>(path: string, stillWanted?: () => boolean): Promise<T> {
		const url = `${API_BASE}${path}`;
		for (let attempt = 0; attempt <= BUSY_PAUSES_MS.length; attempt++) {
			await this.waitForTurn(stillWanted);
			let response: WebResponse;
			try {
				response = await this.web.get(url, { "User-Agent": this.userAgent, Accept: "application/json" });
			} catch (error) {
				console.error("Film + Anime-Manga Tracker: Open Library request failed", error);
				throw new OpenLibraryError("Could not reach Open Library. Check your internet connection.");
			}
			if (response.status === 200) return (response.json ?? {}) as T;
			if (response.status === 404) throw new OpenLibraryError("Open Library has no such entry any more.");
			if (response.status !== 429 && response.status !== 503) {
				throw new OpenLibraryError(`Open Library request failed (HTTP ${response.status}).`);
			}
			const pause = BUSY_PAUSES_MS[attempt];
			if (pause !== undefined) await this.web.sleep(pause);
		}
		throw new OpenLibraryError("Open Library is busy right now. Try again in a moment.");
	}

	/** Waits for this request's turn — see `MusicBrainzClient.waitForTurn`, which this follows. */
	private async waitForTurn(stillWanted?: () => boolean): Promise<void> {
		const turn = queue.then(async () => {
			const wait = nextRequestAt - Date.now();
			if (wait > 0) await this.web.sleep(wait);
			if (stillWanted !== undefined && !stillWanted()) throw new SearchSuperseded();
			nextRequestAt = Date.now() + GAP_MS;
		});
		queue = turn.catch(() => undefined);
		await turn;
	}
}
