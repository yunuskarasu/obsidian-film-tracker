import { requestUrl } from "obsidian";
import {
	artistNoteName,
	deezerAlbumIdsOf,
	formatLength,
	matchKey,
	needsAliases,
	photoCredit,
	pickDeezerEdition,
	pickEdition,
	rankAlbums,
	songTracksOf,
	sortByDate,
	toAlbumMetadata,
	toAlbumSearchResult,
	toArtistMetadata,
	toArtistSearchResult,
	type AlbumMetadata,
	type AlbumSearchResult,
	type AlbumSong,
	type ArtistMetadata,
	type ArtistSearchResult,
	type MbArtist,
	type MbArtistCredit,
	type MbRecording,
	type MbRelease,
	type MbReleaseGroup,
	type SongMetadata,
} from "./music";

import { soundtrackQuery, type ScoredAlbum } from "./soundtrack";

const API_BASE = "https://musicbrainz.org/ws/2";
const HOMEPAGE = "https://github.com/yunuskarasu/obsidian-film-tracker";

/**
 * MusicBrainz asks for one request a second from each client, and for a name
 * it can reach the author by in every request. The pause is kept across every
 * client the plugin makes, since each command makes its own.
 */
const GAP_MS = 1100;
let nextRequestAt = 0;
/** Requests take their turns one after another, never two at once. */
let queue: Promise<void> = Promise.resolve();

/** An artist's albums are read a hundred at a time; the busiest have several hundred. */
const BROWSE_PAGE = 100;
const BROWSE_MAX = 500;

export class MusicBrainzError extends Error {}

/** An id MusicBrainz no longer has: merged into another, or deleted. */
export class MusicBrainzNotFound extends MusicBrainzError {}

/**
 * A search dropped while it waited its turn, because the user has typed on
 * since: it was never sent, and there is nothing to report.
 */
export class SearchSuperseded extends Error {}

/** How long to wait before asking a busy MusicBrainz again: longer each time. */
const BUSY_PAUSES_MS = [2000, 4000];

/** One answer from a web service, the way `requestUrl` gives it. */
export interface WebResponse {
	status: number;
	json: unknown;
	arrayBuffer: ArrayBuffer;
	/** The `Content-Type` header, lowercased: "image/png". */
	contentType?: string | null;
}

/** What the client needs from the outside world: tests hand it saved answers instead. */
export interface WebAccess {
	get(url: string, headers: Record<string, string>): Promise<WebResponse>;
	sleep(ms: number): Promise<void>;
}

export const OBSIDIAN_WEB: WebAccess = {
	get: async (url, headers) => {
		const response = await requestUrl({ url, headers, throw: false });
		const type = Object.entries(response.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1];
		return {
			status: response.status,
			contentType: type === undefined ? null : type.toLowerCase(),
			// Read only when asked for: a picture's bytes are not JSON.
			get json(): unknown {
				try {
					return response.json as unknown;
				} catch {
					return null;
				}
			},
			arrayBuffer: response.arrayBuffer,
		};
	},
	sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
};

/** A photo on offer for an artist, before it is downloaded: where it is, and whom to credit. */
export interface PhotoCandidate {
	source: "Deezer" | "Wikimedia Commons";
	url: string;
	/** What `photo_credit` will say. */
	credit: string;
}

/** A picture ready to be saved, and who to thank for it. */
export interface Picture {
	data: ArrayBuffer;
	/** `photo_credit` for an artist's photo; `null` for an album cover. */
	credit: string | null;
	/** What the file is saved as: "jpg" unless the picture says otherwise. */
	extension?: string;
}

/** The file types a picture from a web address may be saved as. */
const IMAGE_TYPES: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
};

/** How many photos Wikimedia Commons may offer "Change photo" at most. */
const COMMONS_MAX = 8;

interface DeezerAlbum {
	title?: string;
	artist?: { name?: string };
	cover_xl?: string;
	nb_tracks?: number;
	record_type?: string;
}

interface DeezerArtist {
	name?: string;
	picture_xl?: string;
}

export class MusicBrainzClient {
	private readonly userAgent: string;
	private readonly web: WebAccess;
	/** Aliases already read in this command: an album's artists often repeat. */
	private readonly artistNames = new Map<string, string>();

	constructor(version: string, web: WebAccess = OBSIDIAN_WEB) {
		this.userAgent = `FilmTracker/${version} ( ${HOMEPAGE} )`;
		this.web = web;
	}

	/**
	 * `stillWanted` is asked once the request's turn comes: a search the user
	 * has typed past by then is dropped rather than sent (see `SearchSuperseded`),
	 * so typing never queues up requests nobody will read.
	 */
	async searchArtists(query: string, stillWanted?: () => boolean): Promise<ArtistSearchResult[]> {
		const body = await this.mb<{ artists?: MbArtist[] }>(`artist?query=${encodeURIComponent(query)}&limit=15`, stillWanted);
		return (body.artists ?? []).map(toArtistSearchResult).filter((artist) => artist.name !== "");
	}

	async getArtist(id: string): Promise<ArtistMetadata> {
		return toArtistMetadata(await this.mb<MbArtist>(`artist/${id}?inc=aliases+url-rels+genres`));
	}

	async searchAlbums(query: string, stillWanted?: () => boolean): Promise<AlbumSearchResult[]> {
		const body = await this.mb<{ "release-groups"?: MbReleaseGroup[] }>(
			`release-group?query=${encodeURIComponent(query)}&limit=25`,
			stillWanted,
		);
		return rankAlbums(body["release-groups"] ?? []).map(toAlbumSearchResult).filter((album) => album.title !== "");
	}

	/**
	 * Soundtracks filed under one title (see `soundtrackQuery`), in
	 * MusicBrainz's own order, each with its score.
	 */
	async searchSoundtracks(title: string): Promise<ScoredAlbum[]> {
		const body = await this.mb<{ "release-groups"?: MbReleaseGroup[] }>(
			`release-group?query=${encodeURIComponent(soundtrackQuery(title))}&limit=25`,
		);
		return (body["release-groups"] ?? [])
			.map((group) => ({ album: toAlbumSearchResult(group), score: group.score ?? 0 }))
			.filter((result) => result.album.title !== "");
	}

	/** Albums by their ids, one request each; an id MusicBrainz no longer has is skipped. */
	async albumsById(ids: string[]): Promise<AlbumSearchResult[]> {
		const albums: AlbumSearchResult[] = [];
		for (const id of ids) {
			try {
				albums.push(toAlbumSearchResult(await this.mb<MbReleaseGroup>(`release-group/${id}?inc=artist-credits`)));
			} catch (error) {
				if (!(error instanceof MusicBrainzNotFound)) throw error;
			}
		}
		return albums.filter((album) => album.title !== "");
	}

	/**
	 * Every album an artist has, oldest first — what "Browse an artist's
	 * albums" lists. Bootlegs and promos are left out, the way MusicBrainz's
	 * own site leaves them out by default.
	 */
	async artistAlbums(artistId: string): Promise<AlbumSearchResult[]> {
		const groups: MbReleaseGroup[] = [];
		for (let offset = 0; offset < BROWSE_MAX; offset += BROWSE_PAGE) {
			const page = await this.mb<{ "release-groups"?: MbReleaseGroup[]; "release-group-count"?: number }>(
				`release-group?artist=${artistId}&release-group-status=website-default&limit=${BROWSE_PAGE}&offset=${offset}`,
			);
			groups.push(...(page["release-groups"] ?? []));
			if (offset + BROWSE_PAGE >= (page["release-group-count"] ?? 0)) break;
		}
		return sortByDate(groups).map(toAlbumSearchResult).filter((album) => album.title !== "");
	}

	/**
	 * An album with its track list: the album itself, its releases — with
	 * their links to Deezer, where the cover comes from — and the one release
	 * the tracks are read from (see `pickEdition`). Three requests, and one
	 * more for each artist credited in a script other than Latin letters,
	 * whose note name has to come from their aliases.
	 */
	async getAlbum(id: string): Promise<AlbumMetadata> {
		const group = await this.mb<MbReleaseGroup>(`release-group/${id}?inc=artist-credits+genres+url-rels`);
		const releases = await this.mb<{ releases?: MbRelease[] }>(`release?release-group=${id}&inc=media+url-rels&limit=100`);
		const edition = pickEdition(releases.releases ?? [], group["first-release-date"]);
		const release = edition === null ? null : await this.mb<MbRelease>(`release/${edition.id}?inc=recordings`);
		const artists = await this.creditNames(group["artist-credit"]);
		return toAlbumMetadata(group, release, artists, deezerAlbumIdsOf(releases.releases ?? []));
	}

	/**
	 * Every song on an album, read from the same release its note's tracks
	 * came from (see `pickEdition`), so that a track line and its song agree
	 * on disc and number — each with its own artists, who on a soundtrack or a
	 * compilation are not always the album's. Three requests, and one more
	 * for each artist credited in a script other than Latin letters.
	 */
	async albumSongs(albumId: string): Promise<AlbumSong[]> {
		const group = await this.mb<MbReleaseGroup>(`release-group/${albumId}?inc=artist-credits+genres+url-rels`);
		const releases = await this.mb<{ releases?: MbRelease[] }>(`release?release-group=${albumId}&inc=media+url-rels&limit=100`);
		const edition = pickEdition(releases.releases ?? [], group["first-release-date"]);
		if (edition === null) return [];
		const release = await this.mb<MbRelease>(`release/${edition.id}?inc=recordings+artist-credits`);

		const songs: AlbumSong[] = [];
		for (const { credits, ...track } of songTracksOf(release)) {
			songs.push({ ...track, artists: await this.creditNames(credits) });
		}
		return songs;
	}

	/** A song by itself — what refreshing its note reads. */
	async getSong(recordingId: string): Promise<SongMetadata> {
		const recording = await this.mb<MbRecording>(`recording/${recordingId}?inc=artist-credits`);
		return {
			title: recording.title?.trim() ?? "",
			artists: await this.creditNames(recording["artist-credit"]),
			length: formatLength(recording.length),
			mbRecordingId: recording.id,
		};
	}

	/** The artists a credit names, each the way their own note is named, once each. */
	private async creditNames(credits: MbArtistCredit[] | undefined): Promise<string[]> {
		const names: string[] = [];
		for (const credit of credits ?? []) {
			if (credit.artist === undefined) continue;
			const name = await this.noteNameOf(credit.artist);
			if (name !== "" && !names.includes(name)) names.push(name);
		}
		return names;
	}

	private async noteNameOf(artist: MbArtist): Promise<string> {
		if (!needsAliases(artist)) return artistNoteName(artist);
		const known = this.artistNames.get(artist.id);
		if (known !== undefined) return known;
		const full = await this.mb<MbArtist>(`artist/${artist.id}?inc=aliases`);
		const name = artistNoteName(full);
		this.artistNames.set(artist.id, name);
		return name;
	}

	/**
	 * The album's front cover, from the first source that has one: the
	 * album's own page on Deezer — through the links MusicBrainz keeps, the
	 * edition with the album's own number of tracks (see `pickDeezerEdition`)
	 * — then the Cover Art Archive, then Deezer's search, but only for an album
	 * whose title and artist match exactly. No cover is better than the wrong
	 * one.
	 */
	async albumCover(album: AlbumMetadata): Promise<Picture | null> {
		const deezer = await this.deezerCover(album);
		if (deezer !== null) return deezer;

		const archive = await this.fetch(`https://coverartarchive.org/release-group/${album.mbAlbumId}/front-500`);
		if (archive !== null && archive.status === 200 && archive.arrayBuffer.byteLength > 0) {
			return { data: archive.arrayBuffer, credit: null };
		}

		const artist = album.artists[0];
		if (artist === undefined) return null;
		const query = encodeURIComponent(`artist:"${artist}" album:"${album.title}"`);
		const search = await this.fetch(`https://api.deezer.com/search/album?q=${query}&limit=5`);
		const hits = (search?.json as { data?: DeezerAlbum[] } | null)?.data ?? [];
		const hit = hits.find(
			(item) => matchKey(item.title ?? "") === matchKey(album.title) && matchKey(item.artist?.name ?? "") === matchKey(artist),
		);
		return hit?.cover_xl && !isStandIn(hit.cover_xl) ? this.picture(hit.cover_xl, null) : null;
	}

	/** The cover of the album's own page on Deezer, when MusicBrainz links one. */
	private async deezerCover(album: AlbumMetadata): Promise<Picture | null> {
		const editions = [];
		for (const id of album.deezerAlbumIds) {
			const page = (await this.fetch(`https://api.deezer.com/album/${id}`))?.json as DeezerAlbum | null | undefined;
			if (!page?.cover_xl || isStandIn(page.cover_xl)) continue;
			editions.push({ tracks: page.nb_tracks ?? 0, recordType: page.record_type ?? null, coverUrl: page.cover_xl });
		}
		const edition = pickDeezerEdition(editions, album.tracks.length);
		return edition === null ? null : this.picture(edition.coverUrl, null);
	}

	/**
	 * The artist's photo, from the first source that has one: their own page
	 * on Deezer — a press photo, found through the link MusicBrainz keeps, so
	 * it is the right artist for certain — then Wikimedia Commons, through the
	 * artist's Wikidata item, then Deezer again for an artist of exactly that
	 * name. Each source is only asked once the one before it had nothing.
	 */
	async artistPhoto(artist: ArtistMetadata): Promise<Picture | null> {
		const sources = [
			() => this.deezerById(artist.deezerId).then((found) => (found === null ? [] : [found])),
			() => this.commonsCandidates(artist.wikidataId, 1),
			() => (artist.deezerId === null ? this.deezerByName(artist.name).then((found) => (found === null ? [] : [found])) : Promise.resolve([])),
		];
		for (const source of sources) {
			for (const candidate of await source()) {
				const picture = await this.download(candidate);
				if (picture !== null) return picture;
			}
		}
		return null;
	}

	/**
	 * Every photo on offer for an artist, for "Change photo" to show side by
	 * side: Deezer's, then Wikimedia Commons' — the photos the artist's
	 * Wikidata item names, and then the rest of their Commons category.
	 */
	async photoCandidates(artist: ArtistMetadata): Promise<PhotoCandidate[]> {
		const deezer = artist.deezerId !== null ? await this.deezerById(artist.deezerId) : await this.deezerByName(artist.name);
		const commons = await this.commonsCandidates(artist.wikidataId, COMMONS_MAX, true);
		return [...(deezer === null ? [] : [deezer]), ...commons];
	}

	/**
	 * A picture from an address the user pasted. It has to be a picture — an
	 * address that leads to a web page gives `null` — and it is credited to
	 * the site it came from.
	 */
	async downloadUrl(url: string): Promise<Picture | null> {
		let address: URL;
		try {
			address = new URL(url.trim());
		} catch {
			return null;
		}
		if (address.protocol !== "https:" && address.protocol !== "http:") return null;

		const response = await this.fetch(address.href);
		if (response === null || response.status !== 200 || response.arrayBuffer.byteLength === 0) return null;
		const type = (response.contentType ?? "").split(";")[0].trim();
		const extension = IMAGE_TYPES[type];
		if (extension === undefined) return null;
		return { data: response.arrayBuffer, credit: address.hostname.replace(/^www\./, ""), extension };
	}

	/** A photo picked from `photoCandidates`, downloaded. */
	async download(candidate: PhotoCandidate): Promise<Picture | null> {
		return this.picture(candidate.url, candidate.credit);
	}

	private async deezerById(id: string | null): Promise<PhotoCandidate | null> {
		if (id === null) return null;
		const answer = await this.fetch(`https://api.deezer.com/artist/${id}`);
		return deezerCandidate((answer?.json as DeezerArtist | null) ?? null);
	}

	private async deezerByName(name: string): Promise<PhotoCandidate | null> {
		const search = await this.fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`);
		const hits = (search?.json as { data?: DeezerArtist[] } | null)?.data ?? [];
		return deezerCandidate(hits.find((item) => matchKey(item.name ?? "") === matchKey(name)) ?? null);
	}

	/**
	 * Photos from Wikimedia Commons: the ones the artist's Wikidata item
	 * names as theirs first, then — for "Change photo", with `whole` — the
	 * rest of the artist's own Commons category, as many as `max` in all.
	 */
	private async commonsCandidates(wikidataId: string | null, max: number, whole = false): Promise<PhotoCandidate[]> {
		if (wikidataId === null) return [];
		const files = await this.wikidataValues(wikidataId, "P18");
		if (whole) {
			const [category] = await this.wikidataValues(wikidataId, "P373");
			if (category !== undefined) {
				for (const file of await this.categoryFiles(category)) {
					if (!files.includes(file)) files.push(file);
				}
			}
		}
		return this.commonsImages(files.slice(0, max));
	}

	/** The text values of one Wikidata property: P18 names an item's photo, P373 its Commons category. */
	private async wikidataValues(wikidataId: string, property: string): Promise<string[]> {
		const claims = await this.fetch(
			`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${wikidataId}&property=${property}&format=json`,
		);
		type Claim = { mainsnak?: { datavalue?: { value?: unknown } } };
		const list = (claims?.json as { claims?: Record<string, Claim[]> } | null)?.claims?.[property] ?? [];
		return list
			.map((claim) => claim.mainsnak?.datavalue?.value)
			.filter((value): value is string => typeof value === "string" && value !== "");
	}

	/** The photos filed straight in a Commons category: JPEGs — PNGs there are mostly logos and drawings. */
	private async categoryFiles(category: string): Promise<string[]> {
		const members = await this.fetch(
			"https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers" +
				`&cmtitle=${encodeURIComponent(`Category:${category}`)}&cmtype=file&cmlimit=30&format=json`,
		);
		const list = (members?.json as { query?: { categorymembers?: { title?: string }[] } } | null)?.query?.categorymembers ?? [];
		return list
			.map((member) => member.title ?? "")
			.filter((title) => /\.jpe?g$/i.test(title))
			.map((title) => title.replace(/^File:/, ""));
	}

	/** Several Commons files at once — one request — each with its thumbnail and whom to credit. */
	private async commonsImages(files: string[]): Promise<PhotoCandidate[]> {
		if (files.length === 0) return [];
		const titles = files.map((file) => `File:${file}`).join("|");
		const info = await this.fetch(
			`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}` +
				"&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=500&format=json",
		);
		type ImageInfo = { thumburl?: string; extmetadata?: Record<string, { value?: string }> };
		type Page = { title?: string; imageinfo?: ImageInfo[] };
		const pages = Object.values((info?.json as { query?: { pages?: Record<string, Page> } } | null)?.query?.pages ?? {});
		// Commons answers in an order of its own: put them back in the order asked for.
		const byTitle = new Map(pages.map((page) => [(page.title ?? "").replace(/^File:/, "").replace(/_/g, " "), page]));
		const candidates: PhotoCandidate[] = [];
		for (const file of files) {
			const image = byTitle.get(file.replace(/_/g, " "))?.imageinfo?.[0];
			if (!image?.thumburl) continue;
			candidates.push({
				source: "Wikimedia Commons",
				url: image.thumburl,
				credit: photoCredit(image.extmetadata?.Artist?.value, image.extmetadata?.LicenseShortName?.value),
			});
		}
		return candidates;
	}

	private async picture(url: string, credit: string | null): Promise<Picture | null> {
		const response = await this.fetch(url);
		if (response === null || response.status !== 200 || response.arrayBuffer.byteLength === 0) return null;
		const type = (response.contentType ?? "").split(";")[0].trim();
		return { data: response.arrayBuffer, credit, extension: IMAGE_TYPES[type] ?? "jpg" };
	}

	/** A request to anything but MusicBrainz itself: a failure is no picture, never an error. */
	private async fetch(url: string): Promise<WebResponse | null> {
		try {
			return await this.web.get(url, { "User-Agent": this.userAgent });
		} catch (error) {
			console.error("Film + Anime-Manga Tracker: request failed", url, error);
			return null;
		}
	}

	/**
	 * One MusicBrainz request, in its turn. A busy answer (503) is tried again
	 * after a pause, twice, each pause longer than the last.
	 */
	private async mb<T>(path: string, stillWanted?: () => boolean): Promise<T> {
		const url = `${API_BASE}/${path}${path.includes("?") ? "&" : "?"}fmt=json`;
		for (let attempt = 0; attempt <= BUSY_PAUSES_MS.length; attempt++) {
			await this.waitForTurn(stillWanted);
			let response: WebResponse;
			try {
				response = await this.web.get(url, { "User-Agent": this.userAgent, Accept: "application/json" });
			} catch (error) {
				// MusicBrainz now and then drops a connection outright; a moment
				// later the same request goes through. Only a request that keeps
				// failing means there is no connection.
				const pause = BUSY_PAUSES_MS[attempt];
				if (pause !== undefined) {
					await this.web.sleep(pause);
					continue;
				}
				console.error("Film + Anime-Manga Tracker: MusicBrainz request failed", error);
				throw new MusicBrainzError("Could not reach MusicBrainz. Check your internet connection.");
			}
			if (response.status === 200) return response.json as T;
			if (response.status === 404) throw new MusicBrainzNotFound("MusicBrainz has no such entry any more.");
			if (response.status !== 503) throw new MusicBrainzError(`MusicBrainz request failed (HTTP ${response.status}).`);
			const pause = BUSY_PAUSES_MS[attempt];
			if (pause !== undefined) await this.web.sleep(pause);
		}
		throw new MusicBrainzError("MusicBrainz is busy right now. Try again in a moment.");
	}

	/**
	 * Waits for this request's turn: in line behind every request asked for
	 * before it, and a second after the last one sent. A search the user has
	 * typed past by then gives its turn up unused — the next in line goes
	 * straight away rather than a second later — and throws `SearchSuperseded`.
	 */
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

/**
 * Deezer's stand-in for a missing picture, a blank grey square: its path has
 * either no id at all ("/artist//") or the id of nothing — the MD5 of an
 * empty string. Radiohead's page on Deezer has the second.
 */
const EMPTY_MD5 = "d41d8cd98f00b204e9800998ecf8427e";

function isStandIn(url: string): boolean {
	return /\/(artist|cover)\/\//.test(url) || url.includes(`/${EMPTY_MD5}/`);
}

/** Deezer's photo of an artist, unless it is the stand-in for one without. */
function deezerCandidate(artist: DeezerArtist | null): PhotoCandidate | null {
	const url = artist?.picture_xl;
	if (!url || isStandIn(url)) return null;
	return { source: "Deezer", url, credit: "Deezer" };
}
