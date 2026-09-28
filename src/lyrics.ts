import { matchKey } from "./music";

/*
 * A song's lyrics as LRCLIB (lrclib.net) keeps them, and the `## Lyrics`
 * section a song note gets when they are copied into it. Pure functions
 * only: the requests are in lrclib.ts, the saved answers in lyrics-cache.ts.
 */

/** One of LRCLIB's records: a song's lyrics as someone submitted them. */
export interface LrcRecord {
	id: number;
	trackName?: string;
	artistName?: string;
	albumName?: string | null;
	/** Seconds. */
	duration?: number | null;
	instrumental?: boolean;
	plainLyrics?: string | null;
	syncedLyrics?: string | null;
}

/** What a song has: its words, or none because it is instrumental. */
export type Lyrics = { kind: "text"; text: string } | { kind: "instrumental" };

/** How far LRCLIB's length for a song may be from MusicBrainz's and still be the same recording. */
export const DURATION_TOLERANCE_S = 3;

/** "3:06" as 186 seconds, "1:02:03" as 3723; `null` for anything else. */
export function secondsOf(length: unknown): number | null {
	if (typeof length !== "string") return null;
	const parts = length.trim().split(":");
	if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
	const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
	return seconds > 0 ? seconds : null;
}

/**
 * Timed lyrics as plain text: "[01:23.45] words" becomes "words", and the
 * tag lines some files start with ("[ar: Radiohead]") are dropped.
 */
export function stripTimestamps(synced: string): string {
	return synced
		.split(/\r?\n/)
		.filter((line) => !/^\s*\[[a-z]+:[^\]]*\]\s*$/i.test(line))
		.map((line) => line.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]\s?/g, "").trimEnd())
		.join("\n")
		.trim();
}

/** What a record gives a song: its words — plain, or else the timed ones without their times — or that it has none. */
export function lyricsOf(record: LrcRecord | null | undefined): Lyrics | null {
	if (record === null || record === undefined) return null;
	if (record.instrumental === true) return { kind: "instrumental" };
	const plain = record.plainLyrics?.trim() ?? "";
	if (plain !== "") return { kind: "text", text: plain.replace(/\r\n/g, "\n") };
	const synced = stripTimestamps(record.syncedLyrics ?? "");
	return synced === "" ? null : { kind: "text", text: synced };
}

/**
 * Of a search's records, the one that is this song: its title, and a length
 * within a few seconds of the song's — a live recording five minutes long is
 * the same title, not the same song. Closest length first. With no length to
 * go by, only a record of the very same title is taken.
 */
export function closestRecord(records: LrcRecord[], title: string, seconds: number | null): LrcRecord | null {
	const key = matchKey(title);
	const usable = records.filter((record) => lyricsOf(record) !== null && matchKey(record.trackName ?? "") === key);
	if (seconds === null) return usable[0] ?? null;

	const distance = (record: LrcRecord) => Math.abs((record.duration ?? Infinity) - seconds);
	const near = usable.filter((record) => distance(record) <= DURATION_TOLERANCE_S);
	return near.sort((a, b) => distance(a) - distance(b))[0] ?? null;
}

const LYRICS_HEADING = /^#{1,6}[ \t]+lyrics[ \t]*#*[ \t]*$/im;

/** The body of a note: everything after its frontmatter. */
function bodyOf(content: string): string {
	const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
	return match === null ? content : content.slice(match[0].length);
}

/** Whether the note already has a "Lyrics" heading in its body — its own lyrics, which the panel then leaves to it. */
export function hasLyricsSection(content: string): boolean {
	return LYRICS_HEADING.test(bodyOf(content));
}

/**
 * The note with the lyrics added at the end, under "## Lyrics". A note that
 * already has such a section is handed back as it is: what is there is the
 * user's.
 */
export function appendLyrics(content: string, text: string): string {
	if (hasLyricsSection(content)) return content;
	const eol = content.includes("\r\n") ? "\r\n" : "\n";
	const trimmed = content.replace(/\s+$/, "");
	const lyrics = text.trim().split(/\r?\n/).join(eol);
	return `${trimmed}${eol}${eol}## Lyrics${eol}${eol}${lyrics}${eol}`;
}
