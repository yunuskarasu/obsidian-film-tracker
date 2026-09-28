import type { Lyrics } from "./lyrics";

/*
 * Lyrics once fetched, kept in a file of the plugin's own —
 * `.obsidian/plugins/film-tracker/lyrics.json`, apart from data.json and its
 * keys — so a song's lyrics show again without a connection. Keyed by the
 * song's MusicBrainz recording, so renaming or moving a note loses nothing.
 */

/** What is kept for a song: its lyrics, or that the user said the ones found were wrong. */
export type CachedLyrics = Lyrics | { kind: "wrong" };

/** The few file operations the cache needs: Obsidian's vault adapter, or a map in the tests. */
export interface CacheFile {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
}

const VERSION = 1;

function isCached(value: unknown): value is CachedLyrics {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Record<string, unknown>;
	if (entry.kind === "text") return typeof entry.text === "string";
	return entry.kind === "instrumental" || entry.kind === "wrong";
}

export class LyricsCache {
	private readonly file: CacheFile;
	private readonly path: string;
	private entries: Map<string, CachedLyrics> | null = null;
	private loading: Promise<Map<string, CachedLyrics>> | null = null;
	/** Writes one after another, never two at once over each other. */
	private writing: Promise<void> = Promise.resolve();

	constructor(file: CacheFile, path: string) {
		this.file = file;
		this.path = path;
	}

	async get(recordingId: string): Promise<CachedLyrics | null> {
		return (await this.load()).get(recordingId) ?? null;
	}

	async set(recordingId: string, lyrics: CachedLyrics): Promise<void> {
		(await this.load()).set(recordingId, lyrics);
		await this.save();
	}

	async delete(recordingId: string): Promise<void> {
		if ((await this.load()).delete(recordingId)) await this.save();
	}

	/**
	 * Read once, on first use. A file that can't be read — cut short, edited
	 * by hand — counts as empty rather than stopping the panel; entries in it
	 * that don't make sense are skipped one by one.
	 */
	private load(): Promise<Map<string, CachedLyrics>> {
		if (this.entries !== null) return Promise.resolve(this.entries);
		this.loading ??= (async () => {
			const entries = new Map<string, CachedLyrics>();
			try {
				if (await this.file.exists(this.path)) {
					const parsed = JSON.parse(await this.file.read(this.path)) as { songs?: Record<string, unknown> };
					for (const [id, entry] of Object.entries(parsed.songs ?? {})) {
						if (isCached(entry)) entries.set(id, entry);
					}
				}
			} catch (error) {
				console.error("Film + Anime-Manga Tracker: could not read the saved lyrics", error);
			}
			this.entries = entries;
			return entries;
		})();
		return this.loading;
	}

	private save(): Promise<void> {
		const entries = this.entries;
		if (entries === null) return Promise.resolve();
		this.writing = this.writing
			.then(() => this.file.write(this.path, JSON.stringify({ version: VERSION, songs: Object.fromEntries(entries) })))
			.catch((error: unknown) => console.error("Film + Anime-Manga Tracker: could not save the lyrics", error));
		return this.writing;
	}
}
