import { OBSIDIAN_WEB, type WebAccess } from "./musicbrainz";
import { NO_BOOK_FACTS, NO_PERSON_FACTS, dateOfTime, yearOfTime, type BookFacts, type PersonFacts, type WikidataTime } from "./book";
import type { SoundtrackWork } from "./soundtrack";

const API = "https://www.wikidata.org/w/api.php";
const HOMEPAGE = "https://github.com/yunuskarasu/obsidian-film-tracker";

/**
 * Where Wikidata keeps a work's id in each catalogue the plugin uses: TMDB's
 * films and TV series are numbered apart, the same way the notes keep them.
 */
const ID_PROPERTY: Record<SoundtrackWork["kind"], string> = {
	film: "P4947",
	tv: "P4983",
	anime: "P4086",
	// IGDB's slug, "hollow-knight", rather than its number.
	game: "P5794",
};
/** A work's "soundtrack release" — the album item. */
const SOUNDTRACK_RELEASE = "P406";
/** An album's "music created for" — the same link, kept on the album's side instead. */
const MUSIC_CREATED_FOR = "P9899";
/** An album's MusicBrainz release group: the id its note is known by. */
const MUSICBRAINZ_ALBUM = "P436";

/** How many items one lookup follows at most: a work has a handful of soundtracks, never dozens. */
const MAX_ITEMS = 10;

/** A book's or an author's Open Library id: "OL40875W", "OL28104A". */
const OPEN_LIBRARY_ID = "P648";
const PUBLICATION_DATE = "P577";
const GENRE = "P136";
const PART_OF_THE_SERIES = "P179";
const TITLE = "P1476";
const AUTHOR = "P50";
const DATE_OF_BIRTH = "P569";
const DATE_OF_DEATH = "P570";
const NATIVE_NAME = "P1559";
const IMAGE = "P18";

type Claim = { mainsnak?: { datavalue?: { value?: unknown } } };
type Entity = { claims?: Record<string, Claim[]>; labels?: Record<string, { value?: string }> };

/**
 * Wikidata, asked which albums are a work's soundtrack and which works an
 * album is the soundtrack of. It holds both links for a fair share of films
 * and anime — not for all — and what it holds is right: it is where "Find
 * soundtrack…" starts. Only a work's or an album's id is ever sent. A
 * failure is no answer, never an error: the MusicBrainz search still runs.
 */
export class WikidataClient {
	private readonly userAgent: string;
	private readonly web: WebAccess;

	constructor(version: string, web: WebAccess = OBSIDIAN_WEB) {
		this.userAgent = `FilmTracker/${version} ( ${HOMEPAGE} )`;
		this.web = web;
	}

	/**
	 * The MusicBrainz ids of a work's soundtracks. Wikidata may keep the link
	 * on either side — Spirited Away names its album, Inception's album names
	 * the film — so both are read.
	 */
	async soundtrackAlbumIds(work: SoundtrackWork): Promise<string[]> {
		const id = workId(work);
		if (id === null) return [];
		const works = await this.search(`haswbstatement:${ID_PROPERTY[work.kind]}=${id}`);
		if (works.length === 0) return [];

		const albums = values(await this.entities(works), SOUNDTRACK_RELEASE);
		for (const item of works) {
			for (const album of await this.search(`haswbstatement:${MUSIC_CREATED_FOR}=${item}`)) {
				if (!albums.includes(album)) albums.push(album);
			}
		}
		return values(await this.entities(albums.slice(0, MAX_ITEMS)), MUSICBRAINZ_ALBUM);
	}

	/** The works an album is the soundtrack of, read the other way round. */
	async worksOfAlbum(albumId: string): Promise<SoundtrackWork[]> {
		const albums = await this.search(`haswbstatement:${MUSICBRAINZ_ALBUM}=${albumId}`);
		if (albums.length === 0) return [];

		const items = values(await this.entities(albums), MUSIC_CREATED_FOR);
		for (const album of albums) {
			for (const work of await this.search(`haswbstatement:${SOUNDTRACK_RELEASE}=${album}`)) {
				if (!items.includes(work)) items.push(work);
			}
		}

		const entities = await this.entities(items.slice(0, MAX_ITEMS));
		const works: SoundtrackWork[] = [];
		for (const id of values(entities, ID_PROPERTY.film).map(Number).filter(Number.isInteger)) works.push({ kind: "film", tmdbId: id });
		for (const id of values(entities, ID_PROPERTY.tv).map(Number).filter(Number.isInteger)) works.push({ kind: "tv", tmdbTvId: id });
		for (const id of values(entities, ID_PROPERTY.anime).map(Number).filter(Number.isInteger)) works.push({ kind: "anime", malId: id });
		for (const slug of values(entities, ID_PROPERTY.game)) works.push({ kind: "game", igdbId: null, slug });
		return works;
	}

	/**
	 * What Wikidata knows of a book that Open Library doesn't, or has wrong:
	 * the year it first came out, its genres and series, its other titles and
	 * its authors' English names. Three requests — the item, its own claims,
	 * and the names of the genres, series and authors they point at. `null`
	 * when Wikidata couldn't be reached, so that a refresh keeps what the note
	 * has; a book Wikidata doesn't have is `NO_BOOK_FACTS`.
	 */
	async bookFacts(openLibraryId: string): Promise<BookFacts | null> {
		const items = await this.searchOrNull(`haswbstatement:${OPEN_LIBRARY_ID}=${openLibraryId}`);
		if (items === null) return null;
		if (items.length === 0) return NO_BOOK_FACTS;
		const [item] = await this.entitiesWithLabels(items.slice(0, 1));
		if (item === undefined) return null;

		const genres = values([item], GENRE);
		const series = values([item], PART_OF_THE_SERIES);
		const authors = values([item], AUTHOR);
		const labels = await this.labels([...genres, ...series, ...authors]);
		if (labels === null) return null;
		const named = (ids: string[]) => ids.map((id) => labels.get(id) ?? "").filter((label) => label !== "");

		const years = times(item, PUBLICATION_DATE).map(yearOfTime).filter((year): year is number => year !== null);
		const titles = [...ownTitles(item), englishLabel(item)].filter((title): title is string => title !== null && title !== "");
		return {
			year: years.length === 0 ? null : Math.min(...years),
			genres: named(genres),
			series: named(series),
			titles: [...new Set(titles)],
			englishTitle: englishLabel(item),
			authors: named(authors),
		};
	}

	/**
	 * An author's dates, names and photo, from their item — the one Open
	 * Library links, or else the one that links Open Library's id. `null` when
	 * Wikidata couldn't be reached; someone it doesn't have is
	 * `NO_PERSON_FACTS`.
	 */
	async personFacts(wikidataId: string | null, openLibraryId: string): Promise<PersonFacts | null> {
		let id = wikidataId;
		if (id === null || !/^Q\d+$/.test(id)) {
			const items = await this.searchOrNull(`haswbstatement:${OPEN_LIBRARY_ID}=${openLibraryId}`);
			if (items === null) return null;
			id = items[0] ?? null;
		}
		if (id === null) return NO_PERSON_FACTS;
		const [person] = await this.entitiesWithLabels([id]);
		if (person === undefined) return null;
		const date = (property: string) => times(person, property).map(dateOfTime).find((value) => value !== null) ?? null;
		return {
			born: date(DATE_OF_BIRTH),
			died: date(DATE_OF_DEATH),
			englishName: englishLabel(person),
			nativeName: monolingual(person, NATIVE_NAME)[0]?.text ?? null,
			photo: values([person], IMAGE)[0] ?? null,
		};
	}

	/** A search's items, or `null` when Wikidata couldn't be reached — told apart from finding nothing. */
	private async searchOrNull(query: string): Promise<string[] | null> {
		const answer = await this.fetch(
			`${API}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${MAX_ITEMS}&format=json`,
		);
		if (answer === null) return null;
		const hits = (answer as { query?: { search?: { title?: unknown }[] } }).query?.search ?? [];
		return hits.map((hit) => hit.title).filter((title): title is string => typeof title === "string" && /^Q\d+$/.test(title));
	}

	/** Items with their claims and English names, in the order asked for. */
	private async entitiesWithLabels(ids: string[]): Promise<Entity[]> {
		if (ids.length === 0) return [];
		const answer = await this.fetch(`${API}?action=wbgetentities&ids=${ids.join("|")}&props=claims|labels&languages=en|mul&format=json`);
		const entities = (answer as { entities?: Record<string, Entity> } | null)?.entities ?? {};
		return ids.map((id) => entities[id]).filter((entity): entity is Entity => entity !== undefined && entity.claims !== undefined);
	}

	/** Items' English names, by id — one request for up to fifty. `null` when Wikidata couldn't be reached. */
	private async labels(ids: string[]): Promise<Map<string, string> | null> {
		const unique = [...new Set(ids)].slice(0, 50);
		if (unique.length === 0) return new Map();
		const answer = await this.fetch(`${API}?action=wbgetentities&ids=${unique.join("|")}&props=labels&languages=en|mul&format=json`);
		if (answer === null) return null;
		const entities = (answer as { entities?: Record<string, Entity> }).entities ?? {};
		const found = new Map<string, string>();
		for (const id of unique) {
			const label = englishLabel(entities[id]);
			if (label !== null) found.set(id, label);
		}
		return found;
	}

	/** The items a search finds: "Q13417189". */
	private async search(query: string): Promise<string[]> {
		const answer = await this.fetch(
			`${API}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${MAX_ITEMS}&format=json`,
		);
		const hits = (answer as { query?: { search?: { title?: unknown }[] } } | null)?.query?.search ?? [];
		return hits.map((hit) => hit.title).filter((title): title is string => typeof title === "string" && /^Q\d+$/.test(title));
	}

	/** Several items' claims at once — one request. */
	private async entities(ids: string[]): Promise<Entity[]> {
		if (ids.length === 0) return [];
		const answer = await this.fetch(`${API}?action=wbgetentities&ids=${ids.join("|")}&props=claims&format=json`);
		return Object.values((answer as { entities?: Record<string, Entity> } | null)?.entities ?? {});
	}

	private async fetch(url: string): Promise<unknown> {
		try {
			const response = await this.web.get(url, { "User-Agent": this.userAgent });
			return response.status === 200 ? response.json : null;
		} catch (error) {
			console.error("Film + Anime-Manga Tracker: Wikidata request failed", url, error);
			return null;
		}
	}
}

/** The id Wikidata knows a work by; `null` for a game whose note has no IGDB address to take its slug from. */
function workId(work: SoundtrackWork): number | string | null {
	if (work.kind === "film") return work.tmdbId;
	if (work.kind === "tv") return work.tmdbTvId;
	if (work.kind === "anime") return work.malId;
	return work.slug;
}

/**
 * An item's name in English, if it has one — or the name Wikidata now keeps
 * for every language at once ("mul"), which more and more items have
 * instead: the Harry Potter series has no English name of its own.
 */
function englishLabel(entity: Entity | undefined): string | null {
	for (const language of ["en", "mul"]) {
		const label = entity?.labels?.[language]?.value?.trim();
		if (label !== undefined && label !== "") return label;
	}
	return null;
}

/** The times one property holds: a publication date, a date of birth. */
function times(entity: Entity, property: string): WikidataTime[] {
	const found: WikidataTime[] = [];
	for (const claim of entity.claims?.[property] ?? []) {
		const value = claim.mainsnak?.datavalue?.value as { time?: unknown; precision?: unknown } | undefined;
		if (typeof value?.time === "string") found.push({ time: value.time, precision: typeof value.precision === "number" ? value.precision : 11 });
	}
	return found;
}

/** The texts a monolingual property holds — a title, a name in its own language — each with its language. */
function monolingual(entity: Entity, property: string): { text: string; language: string }[] {
	const found: { text: string; language: string }[] = [];
	for (const claim of entity.claims?.[property] ?? []) {
		const value = claim.mainsnak?.datavalue?.value as { text?: unknown; language?: unknown } | undefined;
		const text = typeof value?.text === "string" ? value.text.trim() : "";
		if (text !== "" && !found.some((known) => known.text === text)) found.push({ text, language: typeof value?.language === "string" ? value.language : "" });
	}
	return found;
}

/**
 * A book's own titles: the first one Wikidata gives — the title in the
 * language it was written in — and any in English beside it ("Harry Potter
 * and the Sorcerer's Stone"). Some books list a title in every language they
 * were translated into; those would only be noise in `aliases`.
 */
function ownTitles(entity: Entity): string[] {
	const titles = monolingual(entity, TITLE);
	return titles.filter((title, index) => index === 0 || title.language === "en" || title.language.startsWith("en-")).map((title) => title.text);
}

/**
 * One property's values across several items, each once: an item's id
 * ("Q18552823") or a text value ("4513c7b9-…", "157336").
 */
function values(entities: Entity[], property: string): string[] {
	const found: string[] = [];
	for (const entity of entities) {
		for (const claim of entity.claims?.[property] ?? []) {
			const value = claim.mainsnak?.datavalue?.value;
			const text = typeof value === "string" ? value : (value as { id?: unknown } | undefined)?.id;
			if (typeof text === "string" && text !== "" && !found.includes(text)) found.push(text);
		}
	}
	return found;
}
