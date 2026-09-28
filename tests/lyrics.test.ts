import { describe, expect, it } from "vitest";
import {
	appendLyrics,
	closestRecord,
	hasLyricsSection,
	lyricsOf,
	secondsOf,
	stripTimestamps,
	type LrcRecord,
} from "../src/lyrics";
import { lrclibFixture } from "./lrclib-fixtures";

/*
 * What a song's lyrics are made of, and the "## Lyrics" section a note gets
 * when they are copied into it — never over what the user wrote.
 */

describe("secondsOf", () => {
	it("reads a song's length the way its note writes it", () => {
		expect(secondsOf("3:06")).toBe(186);
		expect(secondsOf("1:02:03")).toBe(3723);
	});

	it("reads nothing into anything else", () => {
		expect(secondsOf(null)).toBeNull();
		expect(secondsOf("")).toBeNull();
		expect(secondsOf("0:00")).toBeNull();
		expect(secondsOf("three minutes")).toBeNull();
		expect(secondsOf(186)).toBeNull();
	});
});

describe("stripTimestamps", () => {
	it("keeps the words of timed lyrics and drops their times and tags", () => {
		expect(stripTimestamps("[ar: Radiohead]\n[00:10.00] First line\n[00:15.50]Second line\n[00:20.00]\n[01:02.345] Third")).toBe(
			"First line\nSecond line\n\nThird",
		);
	});
});

describe("lyricsOf", () => {
	const base: LrcRecord = { id: 1, trackName: "Airbag" };

	it("takes the plain lyrics", () => {
		expect(lyricsOf({ ...base, plainLyrics: "One\r\nTwo\n", syncedLyrics: "[00:01.00] Other" })).toEqual({ kind: "text", text: "One\nTwo" });
	});

	it("falls back on the timed lyrics, without their times", () => {
		expect(lyricsOf({ ...base, plainLyrics: "", syncedLyrics: "[00:01.00] One\n[00:02.00] Two" })).toEqual({ kind: "text", text: "One\nTwo" });
	});

	it("says an instrumental has none", () => {
		expect(lyricsOf(lrclibFixture<LrcRecord>("get-cornfield-chase"))).toEqual({ kind: "instrumental" });
	});

	it("finds nothing in a record without words", () => {
		expect(lyricsOf({ ...base, plainLyrics: null, syncedLyrics: null })).toBeNull();
		expect(lyricsOf(null)).toBeNull();
	});
});

describe("closestRecord", () => {
	const results = lrclibFixture<LrcRecord[]>("search-airbag-too-long");

	it("takes the record whose length is closest to the song's", () => {
		expect(closestRecord(results, "Airbag", 284)?.duration).toBe(284);
	});

	it("never takes a recording of the same title but another length — a live one", () => {
		expect(closestRecord(results, "Airbag", 400)).toBeNull();
		expect(closestRecord([{ id: 1, trackName: "Airbag", duration: 290, plainLyrics: "x" }], "Airbag", 284)).toBeNull();
	});

	it("never takes another song, whatever its length", () => {
		expect(closestRecord([{ id: 1, trackName: "Airbag (Live)", duration: 284, plainLyrics: "x" }], "Airbag", 284)).toBeNull();
	});

	it("with no length to go by, takes the first record of the very same title", () => {
		expect(closestRecord(results, "airbag", null)?.id).toBe(results[0].id);
	});
});

describe("hasLyricsSection", () => {
	it("finds a Lyrics heading in the body, at any level", () => {
		expect(hasLyricsSection("---\ntitle: Airbag\n---\n\n## Lyrics\n\nWords\n")).toBe(true);
		expect(hasLyricsSection("---\ntitle: Airbag\n---\n### lyrics\n")).toBe(true);
	});

	it("never takes a property, or a heading that only starts with the word, for one", () => {
		expect(hasLyricsSection("---\ntitle: Airbag\nlyrics: none\n---\n")).toBe(false);
		expect(hasLyricsSection("---\ntitle: Airbag\n---\n## Lyrics I like\n")).toBe(false);
		expect(hasLyricsSection("---\ntitle: Airbag\n---\nLyrics\n")).toBe(false);
	});
});

describe("appendLyrics", () => {
	it("adds the lyrics at the end, under their own heading", () => {
		expect(appendLyrics("---\ntitle: Airbag\n---\n", "One\nTwo")).toBe("---\ntitle: Airbag\n---\n\n## Lyrics\n\nOne\nTwo\n");
	});

	it("keeps what the user wrote above them", () => {
		expect(appendLyrics("---\ntitle: Airbag\n---\n\nMy notes.\n\n\n", "One")).toBe("---\ntitle: Airbag\n---\n\nMy notes.\n\n## Lyrics\n\nOne\n");
	});

	it("writes a note's own line endings", () => {
		expect(appendLyrics("---\r\ntitle: Airbag\r\n---\r\n", "One\nTwo")).toBe("---\r\ntitle: Airbag\r\n---\r\n\r\n## Lyrics\r\n\r\nOne\r\nTwo\r\n");
	});

	it("leaves a note that already has its lyrics as it is", () => {
		const own = "---\ntitle: Airbag\n---\n\n## Lyrics\n\nMy own version.\n";
		expect(appendLyrics(own, "One")).toBe(own);
	});
});
