import type { App, TFile } from "obsidian";
import { LrclibOffline, type LyricsQuery } from "./lrclib";
import type { Lyrics } from "./lyrics";
import { secondsOf } from "./lyrics";
import type { CachedLyrics, LyricsCache } from "./lyrics-cache";
import { parseLinkTarget } from "./note";
import { extractNames } from "./panels/panel-plan";

/** What the LYRICS panel shows for a song, and so which buttons it offers. */
export type LyricsState =
	| { status: "loading" }
	| { status: "text"; text: string }
	| { status: "instrumental" }
	| { status: "none" }
	| { status: "wrong" }
	| { status: "busy" }
	| { status: "offline" };

/** Where lyrics are looked up: LRCLIB, or saved answers in the tests. */
export interface LyricsSource {
	find(query: LyricsQuery): Promise<Lyrics | null>;
}

function stateOf(entry: CachedLyrics): LyricsState {
	if (entry.kind === "text") return { status: "text", text: entry.text };
	return { status: entry.kind };
}

/**
 * The lyrics of every song note opened in this session. A song is looked up
 * once: first in the saved lyrics — so they show without a connection — then
 * on LRCLIB, and what LRCLIB finds is saved. "Nothing found" is only
 * remembered until Obsidian closes: LRCLIB may have the song by next time.
 * `changed` is told whenever a song's lyrics arrive, for the panel to redraw.
 */
export class LyricsService {
	private readonly source: () => LyricsSource;
	private readonly cache: LyricsCache;
	private readonly changed: () => void;
	private readonly states = new Map<string, LyricsState>();

	constructor(source: () => LyricsSource, cache: LyricsCache, changed: () => void) {
		this.source = source;
		this.cache = cache;
		this.changed = changed;
	}

	/** What is known of the song now; asking starts the lookup the first time. */
	state(recordingId: string, query: () => LyricsQuery): LyricsState {
		const known = this.states.get(recordingId);
		if (known !== undefined) return known;
		const loading: LyricsState = { status: "loading" };
		this.states.set(recordingId, loading);
		void this.load(recordingId, query, true);
		return loading;
	}

	/** "Fetch again" and "Try again": straight to LRCLIB, past what was saved. */
	async fetchAgain(recordingId: string, query: () => LyricsQuery): Promise<void> {
		this.states.set(recordingId, { status: "loading" });
		this.changed();
		await this.load(recordingId, query, false);
	}

	/** "Wrong lyrics": the song is remembered as having none, until fetched again. */
	async markWrong(recordingId: string): Promise<void> {
		await this.cache.set(recordingId, { kind: "wrong" });
		this.states.set(recordingId, { status: "wrong" });
		this.changed();
	}

	private async load(recordingId: string, query: () => LyricsQuery, useSaved: boolean): Promise<void> {
		let state: LyricsState;
		try {
			const saved = useSaved ? await this.cache.get(recordingId) : null;
			if (saved !== null) {
				state = stateOf(saved);
			} else {
				const found = await this.source().find(query());
				if (found !== null) {
					await this.cache.set(recordingId, found);
					state = stateOf(found);
				} else {
					// Asked again and LRCLIB has nothing now: what was saved goes too.
					if (!useSaved) await this.cache.delete(recordingId);
					state = { status: "none" };
				}
			}
		} catch (error) {
			state = { status: error instanceof LrclibOffline ? "offline" : "busy" };
		}
		this.states.set(recordingId, state);
		this.changed();
	}
}

/**
 * What a song note says about the song, for LRCLIB: its title, album and
 * length, and every name its artists go by — the note's, then, from each
 * artist's own note where there is one, their name in their own script.
 */
export function lyricsQueryOf(app: App, file: TFile): LyricsQuery {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
	const title: unknown = frontmatter.title;
	const credited = extractNames(frontmatter.artists);

	const others: string[] = [];
	for (const name of credited) {
		const note = app.metadataCache.getFirstLinkpathDest(name, file.path);
		const artist = note === null ? undefined : app.metadataCache.getFileCache(note)?.frontmatter;
		if (artist === undefined) continue;
		const original: unknown = artist.original_name;
		if (typeof original === "string" && original.trim() !== "") others.push(original.trim());
		others.push(...extractNames(artist.aliases));
	}

	const albumPath = parseLinkTarget(frontmatter.album);
	const albumNote = albumPath === null ? null : app.metadataCache.getFirstLinkpathDest(albumPath, file.path);
	const albumTitle: unknown = albumNote === null ? undefined : app.metadataCache.getFileCache(albumNote)?.frontmatter?.title;

	return {
		title: typeof title === "string" && title.trim() !== "" ? title.trim() : file.basename,
		artists: [...new Set([...credited, ...others])],
		album: typeof albumTitle === "string" && albumTitle.trim() !== "" ? albumTitle.trim() : null,
		seconds: secondsOf(frontmatter.length),
	};
}
