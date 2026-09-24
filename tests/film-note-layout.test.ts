import { describe, expect, it } from "vitest";
import {
	mangaSummary,
	posterLinkpathOf,
	progressLabel,
	seasonAndEpisode,
	seasonSummary,
	watchControlsFor,
} from "../src/film-note-layout";
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

describe("a TV note's own bar", () => {
	const note = (seasons: unknown[], watched = false) => ({
		title: "Breaking Bad",
		tmdb_tv_id: 1396,
		watched,
		seasons,
	});

	it("says where the note is, in seasons and episodes", () => {
		const controls = watchControlsFor(
			note([
				{ season: 1, episodes: 7, watched: 7 },
				{ season: 2, episodes: 13, watched: 5 },
			]),
		);
		expect(controls).toEqual({
			label: "S2E5 · 12 / 20 episodes",
			percent: "60%",
			canWatchEpisode: true,
			canMarkWatched: true,
		});
	});

	it("offers nothing more to watch once every aired episode is in", () => {
		const controls = watchControlsFor(note([{ season: 1, episodes: 7, watched: 7 }], true));
		expect(controls).toMatchObject({ label: "S1E7 · 7 / 7 episodes", canWatchEpisode: false, canMarkWatched: false });
	});

	it("shows no bar on a note nothing has been watched of yet", () => {
		expect(watchControlsFor(note([{ season: 1, episodes: 7, watched: 0 }]))).toMatchObject({
			label: null,
			canWatchEpisode: true,
		});
	});

	it("writes a season as a viewer counts it", () => {
		expect(seasonAndEpisode({ season: 3, episode: 6 })).toBe("S3E6");
		expect(seasonAndEpisode(null)).toBeNull();
	});
});

describe("seasonSummary", () => {
	const season = { season: 4, name: null, year: 2024, episodes: 6, watched: 0, watchDate: null, extra: {} };

	it("reads the season, its year and its length", () => {
		expect(seasonSummary(season)).toBe("Season 4 · 2024 · 6 episodes");
	});

	it("adds a name that says more than the number, and leaves out what TMDB has not got", () => {
		expect(seasonSummary({ ...season, name: "Night Country" })).toBe("Season 4 · Night Country · 2024 · 6 episodes");
		expect(seasonSummary({ ...season, year: null, episodes: 1 })).toBe("Season 4 · 1 episode");
	});
});

/** Regression: a TV note showed no poster at all, since the rule read `tmdb_id`/`mal_id` directly. */
describe("posterLinkpathOf", () => {
	it("finds the poster of every note the plugin owns", () => {
		const poster = '[[Poster.jpg]]';
		expect(posterLinkpathOf({ title: "A film", directors: [], tmdb_id: 1398, poster })).toBe("Poster.jpg");
		expect(posterLinkpathOf({ name: "A director", tmdb_id: 8452, poster })).toBe("Poster.jpg");
		expect(posterLinkpathOf({ title: "An anime", media_type: "tv", episodes: 12, studios: [], mal_id: 1, poster })).toBe(
			"Poster.jpg",
		);
		expect(posterLinkpathOf({ title: "A show", tmdb_tv_id: 1396, seasons: [], poster })).toBe("Poster.jpg");
	});

	it("leaves every other note alone, and a note with no poster of its own", () => {
		expect(posterLinkpathOf({ title: "Meeting notes", poster: "[[Poster.jpg]]" })).toBeNull();
		expect(posterLinkpathOf({ title: "A show", tmdb_tv_id: 1396, poster: "" })).toBeNull();
		expect(posterLinkpathOf(undefined)).toBeNull();
	});
});
