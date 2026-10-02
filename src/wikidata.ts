import { OBSIDIAN_WEB, type WebAccess } from "./musicbrainz";
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

type Claim = { mainsnak?: { datavalue?: { value?: unknown } } };
type Entity = { claims?: Record<string, Claim[]> };

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
