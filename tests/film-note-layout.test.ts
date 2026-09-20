import { describe, expect, it } from "vitest";
import { mangaSummary, progressLabel, watchControlsFor } from "../src/film-note-layout";
import { parseLinkTarget, parseWikilink } from "../src/note";

describe("mangaSummary", () => {
	it("reads type, year and status as text, then the counts", () => {
		expect(
			mangaSummary({
				mediaType: "manga",
				year: 1998,
				endYear: null,
				status: "currently_publishing",
				volumes: 38,
				chapters: null,
			}),
		).toBe("Manga · 1998 · Currently publishing · 38 volumes");
	});

	it("shows the years a finished work ran, and one year when it ran inside one", () => {
		const manga = { mediaType: "manga", status: "finished", volumes: null, chapters: null };
		expect(mangaSummary({ ...manga, year: 1990, endYear: 1994 })).toBe("Manga · 1990–1994 · Finished");
		expect(mangaSummary({ ...manga, year: 1990, endYear: 1990 })).toBe("Manga · 1990 · Finished");
		expect(mangaSummary({ ...manga, year: null, endYear: 1994 })).toBe("Manga · 1994 · Finished");
	});

	it("uses the singular for a count of one", () => {
		expect(
			mangaSummary({ mediaType: "one_shot", year: 2003, endYear: 2003, status: "finished", volumes: 1, chapters: 1 }),
		).toBe("One-shot · 2003 · Finished · 1 volume · 1 chapter");
	});

	it("leaves out whatever MAL left blank", () => {
		expect(
			mangaSummary({ mediaType: null, year: null, endYear: null, status: null, volumes: null, chapters: null }),
		).toBe("");
		expect(
			mangaSummary({ mediaType: "manhwa", year: null, endYear: null, status: null, volumes: null, chapters: 120 }),
		).toBe("Manhwa · 120 chapters");
	});
});

describe("progressLabel", () => {
	it("counts against the length when MAL knows it", () => {
		expect(progressLabel(48, 148, "episode")).toBe("48 / 148 episodes");
	});

	it("stands on its own while the length is unknown", () => {
		expect(progressLabel(12, null, "chapter")).toBe("12 chapters");
		expect(progressLabel(1, null, "episode")).toBe("1 episode");
	});

	it("shows nothing before anything has been watched or read", () => {
		expect(progressLabel(0, 148, "episode")).toBeNull();
	});
});

describe("watchControlsFor", () => {
	const anime = { mal_id: 11061, media_type: "tv", episodes: 148, studios: ["Madhouse"], watched: false };

	it("offers both buttons on an anime nobody has started", () => {
		expect(watchControlsFor(anime)).toMatchObject({
			label: null,
			canWatchEpisode: true,
			canMarkWatched: true,
		});
	});

	it("shows how far through it is once episodes are counted", () => {
		expect(watchControlsFor({ ...anime, episodes_watched: 48 })).toMatchObject({
			label: "48 / 148 episodes",
			percent: "32%",
			canWatchEpisode: true,
		});
	});

	it("stops offering episodes once the last one is watched", () => {
		expect(watchControlsFor({ ...anime, episodes_watched: 148, watched: true })).toMatchObject({
			canWatchEpisode: false,
			canMarkWatched: false,
		});
	});

	it("gives a film the watched button and no episodes", () => {
		expect(watchControlsFor({ tmdb_id: 1398, watched: false })).toMatchObject({
			label: null,
			canWatchEpisode: false,
			canMarkWatched: true,
		});
	});

	it("leaves a director, a mangaka and a manga-only note alone", () => {
		expect(watchControlsFor({ tmdb_id: 8452, name: "Andrei Tarkovsky" })).toBeNull();
		expect(watchControlsFor({ mal_id: 1893, name: "Yoshihiro Togashi" })).toBeNull();
		expect(watchControlsFor({ manga: { mal_id: 26 } })).toBeNull();
		expect(watchControlsFor(undefined)).toBeNull();
	});
});

describe("parseWikilink", () => {
	it("reads the target of a plain wikilink", () => {
		expect(parseWikilink("[[Stalker (1979).jpg]]")).toBe("Stalker (1979).jpg");
		expect(parseWikilink("[[Afiş/Stalker (1979).jpg]]")).toBe("Afiş/Stalker (1979).jpg");
	});

	it("drops an alias", () => {
		expect(parseWikilink("[[poster.jpg|Stalker]]")).toBe("poster.jpg");
	});

	it("tolerates surrounding whitespace", () => {
		expect(parseWikilink("  [[poster.jpg]]  ")).toBe("poster.jpg");
	});

	it("returns null for anything that is not a wikilink", () => {
		expect(parseWikilink("")).toBeNull();
		expect(parseWikilink(undefined)).toBeNull();
		expect(parseWikilink(null)).toBeNull();
		expect(parseWikilink(1398)).toBeNull();
		expect(parseWikilink("poster.jpg")).toBeNull();
		expect(parseWikilink("https://image.tmdb.org/t/p/w500/x.jpg")).toBeNull();
		expect(parseWikilink("[[unclosed")).toBeNull();
	});
});

describe("parseLinkTarget", () => {
	it("reads a wikilink the same way parseWikilink does", () => {
		expect(parseLinkTarget("[[Stalker (1979).jpg]]")).toBe("Stalker (1979).jpg");
		expect(parseLinkTarget("[[poster.jpg|Stalker]]")).toBe("poster.jpg");
	});

	/** Regression: with "Use [[Wikilinks]]" off, posters were written like this and never shown. */
	it("reads the Markdown link Obsidian wrote with Use [[Wikilinks]] turned off", () => {
		expect(parseLinkTarget("[Amélie (2001).jpg](Attachments/Am%C3%A9lie%20(2001).jpg)")).toBe(
			"Attachments/Amélie (2001).jpg",
		);
		expect(parseLinkTarget("![](Posters/Stalker%20(1979).jpg)")).toBe("Posters/Stalker (1979).jpg");
	});

	it("reads an angle-bracketed Markdown link target", () => {
		expect(parseLinkTarget("[](<Posters/Stalker (1979).jpg>)")).toBe("Posters/Stalker (1979).jpg");
	});

	it("keeps a target whose % starts no escape sequence exactly as written", () => {
		expect(parseLinkTarget("[](Posters/100%.jpg)")).toBe("Posters/100%.jpg");
	});

	it("returns null for anything that is not a link", () => {
		expect(parseLinkTarget("poster.jpg")).toBeNull();
		expect(parseLinkTarget("")).toBeNull();
		expect(parseLinkTarget(undefined)).toBeNull();
		expect(parseLinkTarget(1398)).toBeNull();
		expect(parseLinkTarget("[]()")).toBeNull();
		expect(parseLinkTarget("https://image.tmdb.org/t/p/w500/x.jpg")).toBeNull();
	});
});
