import { closestRecord, lyricsOf, type LrcRecord, type Lyrics } from "./lyrics";
import { OBSIDIAN_WEB, type WebAccess, type WebResponse } from "./musicbrainz";

const API_BASE = "https://lrclib.net/api";
const HOMEPAGE = "https://github.com/yunuskarasu/obsidian-film-tracker";

/** How long to wait before asking a busy LRCLIB again: longer each time. */
const BUSY_PAUSES_MS = [1500, 3000];

/** How many of an artist's names are tried: the note's, then the one in their own script. */
const NAMES_MAX = 3;

/** LRCLIB said it was busy, every time it was asked. */
export class LrclibBusy extends Error {}

/** LRCLIB could not be reached at all. */
export class LrclibOffline extends Error {}

/** What is known of a song to find its lyrics by. */
export interface LyricsQuery {
	title: string;
	/** Every name its artists go by, the note's own first: "Hikaru Utada", "宇多田ヒカル". */
	artists: string[];
	album: string | null;
	/** Seconds, from the note's `length`. */
	seconds: number | null;
}

/**
 * LRCLIB, the open lyrics database: no key, no account. Lyrics are looked up
 * by the song's exact title, artist, album and length first — LRCLIB allows a
 * couple of seconds either way — and only then searched for, keeping a record
 * only when its length is within a few seconds of the song's (see
 * `closestRecord`). Only the song's own details are ever sent.
 */
export class LrclibClient {
	private readonly userAgent: string;
	private readonly web: WebAccess;

	constructor(version: string, web: WebAccess = OBSIDIAN_WEB) {
		this.userAgent = `FilmTracker/${version} ( ${HOMEPAGE} )`;
		this.web = web;
	}

	/** The song's lyrics, `null` when LRCLIB has none that are surely this song. */
	async find(query: LyricsQuery): Promise<Lyrics | null> {
		const names = [...new Set(query.artists.map((name) => name.trim()).filter((name) => name !== ""))].slice(0, NAMES_MAX);
		for (const artist of names) {
			const exact = await this.get<LrcRecord>(
				"get",
				params({ artist_name: artist, track_name: query.title, album_name: query.album, duration: query.seconds }),
			);
			const found = lyricsOf(exact);
			if (found !== null) return found;

			const records = await this.get<LrcRecord[]>("search", params({ track_name: query.title, artist_name: artist }));
			const close = lyricsOf(closestRecord(Array.isArray(records) ? records : [], query.title, query.seconds));
			if (close !== null) return close;
		}
		return null;
	}

	/** One answer, `null` for "no such song"; asked again when LRCLIB is busy or drops the connection. */
	private async get<T>(endpoint: string, query: string): Promise<T | null> {
		const url = `${API_BASE}/${endpoint}?${query}`;
		for (let attempt = 0; attempt <= BUSY_PAUSES_MS.length; attempt++) {
			let response: WebResponse | null = null;
			try {
				response = await this.web.get(url, { "User-Agent": this.userAgent, Accept: "application/json" });
			} catch (error) {
				if (attempt === BUSY_PAUSES_MS.length) {
					console.error("Film + Anime-Manga Tracker: LRCLIB request failed", error);
					throw new LrclibOffline("Could not reach LRCLIB.");
				}
			}
			if (response !== null) {
				if (response.status === 200) return response.json as T;
				if (response.status === 404) return null;
				if (response.status !== 503 && response.status !== 429) {
					throw new LrclibBusy(`LRCLIB request failed (HTTP ${response.status}).`);
				}
			}
			const pause = BUSY_PAUSES_MS[attempt];
			if (pause !== undefined) await this.web.sleep(pause);
		}
		throw new LrclibBusy("LRCLIB is busy right now.");
	}
}

/** A query string of the values that are there: an album or a length LRCLIB isn't given is left out, not sent empty. */
function params(values: Record<string, string | number | null>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) {
		if (value !== null && value !== "") search.set(key, String(value));
	}
	return search.toString();
}
