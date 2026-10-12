import { describe, expect, it } from "vitest";
import { countByKind, diaryEntriesOf, monthsOf, pagesOf, yearsOf, type DiaryEntry } from "../src/diary";

/*
 * The diary's entries: the days each kind of note says something was
 * finished, read from the properties the plugin writes.
 */

describe("the days a note says something was finished", () => {
	it("reads a film's watch date, an album's listen date, a game's completion and a book's finish", () => {
		expect(diaryEntriesOf("Films/Inception (2010).md", "Inception (2010)", { kind: "film", tmdbId: 27205 }, { title: "Inception", watch_date: "2026-03-14", poster: "[[Inception (2010).jpg]]" })).toEqual([
			{ path: "Films/Inception (2010).md", kind: "film", title: "Inception", date: "2026-03-14", detail: null, poster: "[[Inception (2010).jpg]]" },
		]);
		const one = (kind: Parameters<typeof diaryEntriesOf>[2], frontmatter: Record<string, unknown>) => diaryEntriesOf("x.md", "x", kind, frontmatter).map((entry) => [entry.kind, entry.date]);
		expect(one({ kind: "album", mbAlbumId: "a" }, { listen_date: "2026-01-02" })).toEqual([["album", "2026-01-02"]]);
		expect(one({ kind: "game", igdbId: 1 }, { completed: "2026-10-01" })).toEqual([["game", "2026-10-01"]]);
		expect(one({ kind: "book", openLibraryId: "OL1W" }, { finished: "2024-03-02T10:00" })).toEqual([["book", "2024-03-02"]]);
	});

	it("writes nothing for a note with no day, or a day that isn't one", () => {
		expect(diaryEntriesOf("x.md", "x", { kind: "film", tmdbId: 1 }, { watch_date: "" })).toEqual([]);
		expect(diaryEntriesOf("x.md", "x", { kind: "book", openLibraryId: "OL1W" }, { finished: "someday" })).toEqual([]);
		expect(diaryEntriesOf("x.md", "x", { kind: "director", tmdbId: 1 }, { watch_date: "2026-01-01" })).toEqual([]);
	});

	it("gives a series a line a season, and the whole series only on a day no season was finished", () => {
		const entries = diaryEntriesOf("TV/Dark.md", "Dark", { kind: "tv", tmdbTvId: 70523, mangaMalId: null }, {
			title: "Dark",
			watch_date: "2026-05-02",
			seasons: [
				{ season: 1, name: "Season 1", watch_date: "2026-04-10" },
				{ season: 2, watch_date: "2026-05-02" },
				{ season: 3 },
			],
		});
		expect(entries.map((entry) => [entry.date, entry.detail])).toEqual([
			["2026-04-10", "Season 1"],
			["2026-05-02", "Season 2"],
		]);
	});

	it("reads an anime and its manga on one note, the manga with its own title and poster", () => {
		const entries = diaryEntriesOf("Anime/AoT.md", "AoT", { kind: "series", animeMalId: 16498, mangaMalId: 23390 }, {
			title: "Shingeki no Kyojin",
			poster: "[[AoT.jpg]]",
			watch_date: "2026-02-01",
			manga: { title: "Shingeki no Kyojin (Manga)", poster: "[[AoT manga.jpg]]", read_date: "2026-06-20" },
		});
		expect(entries.map((entry) => [entry.kind, entry.title, entry.poster, entry.date])).toEqual([
			["anime", "Shingeki no Kyojin", "[[AoT.jpg]]", "2026-02-01"],
			["manga", "Shingeki no Kyojin (Manga)", "[[AoT manga.jpg]]", "2026-06-20"],
		]);
	});
});

describe("a year of the diary", () => {
	const entry = (title: string, date: string, kind: DiaryEntry["kind"] = "film"): DiaryEntry => ({ path: `${title}.md`, kind, title, date, detail: null, poster: null });
	const entries = [entry("B", "2026-03-14"), entry("A", "2026-03-14", "book"), entry("C", "2026-01-02", "game"), entry("D", "2025-12-31")];

	it("groups a year's entries by month, the earliest first, the empty months left out", () => {
		expect(monthsOf(entries, 2026).map((month) => [month.month, month.entries.map((found) => found.title)])).toEqual([
			[0, ["C"]],
			[2, ["A", "B"]],
		]);
	});

	it("counts each kind, lists the years latest first, and cuts a list into pages", () => {
		expect([...countByKind(entries)]).toEqual([
			["film", 2],
			["book", 1],
			["game", 1],
		]);
		expect(yearsOf(entries)).toEqual([2026, 2025]);
		expect(pagesOf([1, 2, 3, 4, 5, 6, 7], 5)).toEqual([
			[1, 2, 3, 4, 5],
			[6, 7],
		]);
	});
});
