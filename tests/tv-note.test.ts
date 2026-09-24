import { describe, expect, it } from "vitest";
import type { TvMetadata, TvSeason } from "../src/tmdb-tv";
import {
	buildTvNoteContent,
	markTvWatched,
	mergeSeasons,
	readSeasons,
	refreshTvFrontmatter,
	setSeasonWatched,
	tvProgressOf,
	watchOneMoreOfSeason,
} from "../src/tv-note";

/*
 * A TV note keeps its seasons in the note itself, one line each, and they
 * are the only record of what was watched: `episodes`, `episodes_watched`
 * and the show's own tick are all written from them.
 */

function season(number: number, episodes: number, name: string | null = null): TvSeason {
	return { season: number, name, year: 2007 + number, episodes };
}

function show(overrides: Partial<TvMetadata> = {}): TvMetadata {
	return {
		title: "Breaking Bad",
		originalTitle: "Breaking Bad",
		year: 2008,
		endYear: 2013,
		creators: ["Vince Gilligan"],
		genres: ["Drama", "Crime"],
		cast: [],
		networks: ["AMC"],
		status: "Ended",
		finished: true,
		seasons: [season(1, 7), season(2, 13)],
		tmdbTvId: 1396,
		posterPath: "/bb.jpg",
		...overrides,
	};
}

const running = () =>
	show({ status: "Returning Series", finished: false, endYear: null, seasons: [season(1, 9), season(2, 10)] });

/** The note's seasons as the plugin reads them back out of the file. */
function seasonsOf(content: string): ReturnType<typeof readSeasons> {
	const lines = content.split("\n");
	const start = lines.indexOf("seasons:");
	const end = lines.findIndex((line, index) => index > 0 && line === "---");
	return readSeasons(lines.slice(start, end));
}

function valueOf(content: string, key: string): string {
	const line = content.split("\n").find((item) => item.startsWith(`${key}:`)) ?? "";
	return line.slice(line.indexOf(":") + 1).trim();
}

describe("buildTvNoteContent", () => {
	it("writes the show, then its seasons, one line each", () => {
		const content = buildTvNoteContent(show(), "[[Breaking Bad (2008).jpg]]");
		expect(content).toBe(
			[
				"---",
				"title: Breaking Bad",
				"original_title: Breaking Bad",
				"aliases:",
				"  - Breaking Bad",
				"year: 2008",
				"end_year: 2013",
				"creators:",
				"  - Vince Gilligan",
				"genres:",
				"  - Drama",
				"  - Crime",
				"networks:",
				"  - AMC",
				"status: Ended",
				"episodes: 20",
				"episodes_watched: 0",
				'poster: "[[Breaking Bad (2008).jpg]]"',
				"tmdb_tv_id: 1396",
				"watch_start:",
				"watch_date:",
				"watched: false",
				"seasons:",
				"  - { season: 1, year: 2008, episodes: 7, watched: 0 }",
				"  - { season: 2, year: 2009, episodes: 13, watched: 0 }",
				"---",
				"",
			].join("\n"),
		);
	});

	it("keeps a season name that says more than its number", () => {
		const content = buildTvNoteContent(show({ seasons: [season(4, 6, "Night Country")] }), null);
		expect(content).toContain("  - { season: 4, name: Night Country, year: 2011, episodes: 6, watched: 0 }");
	});

	it("quotes a season name a comma or a brace would otherwise cut short", () => {
		const content = buildTvNoteContent(show({ seasons: [season(1, 3, "Books, Part {One}")] }), null);
		expect(seasonsOf(content)?.[0].name).toBe("Books, Part {One}");
		expect(content).toContain('name: "Books, Part {One}", year');
	});

	it("writes a quoted value back exactly, however often the season is written", () => {
		let content = buildTvNoteContent(show(), null).replace(
			"  - { season: 1, year: 2008, episodes: 7, watched: 0 }",
			'  - { season: 1, year: 2008, episodes: 7, watched: 0, note: "a, b" }',
		);
		for (let i = 0; i < 3; i++) content = watchOneMoreOfSeason(content, 1, "2026-09-24");

		expect(content).toContain('watched: 3, note: "a, b" }');
	});
});

describe("mergeSeasons", () => {
	const existing = [
		{ season: 1, name: null, year: 2008, episodes: 7, watched: 7, watchDate: "2026-09-01", extra: {} },
		{ season: 2, name: null, year: 2009, episodes: 13, watched: 5, watchDate: null, extra: { rating: 9 } },
	];

	it("takes the lengths from TMDB and leaves what was watched alone", () => {
		const merged = mergeSeasons(existing, [season(1, 7), season(2, 13), season(3, 13)]);
		expect(merged.map((item) => [item.season, item.episodes, item.watched])).toEqual([
			[1, 7, 7],
			[2, 13, 5],
			[3, 13, 0],
		]);
		expect(merged[0].watchDate).toBe("2026-09-01");
		expect(merged[1].extra).toEqual({ rating: 9 });
	});

	it("never leaves more watched than a season that shrank now has", () => {
		expect(mergeSeasons(existing, [season(1, 7), season(2, 4)])[1].watched).toBe(4);
	});

	it("keeps a season TMDB no longer lists, with its progress", () => {
		const merged = mergeSeasons(existing, [season(1, 7)]);
		expect(merged.map((item) => item.season)).toEqual([1, 2]);
		expect(merged[1].watched).toBe(5);
	});
});

describe("refreshTvFrontmatter", () => {
	const note = () =>
		buildTvNoteContent(show(), "[[Breaking Bad (2008).jpg]]")
			.replace("watched: false", "watched: false\nmy_rating: 10")
			.replace(
				"  - { season: 2, year: 2009, episodes: 13, watched: 0 }",
				"  - { season: 2, year: 2009, episodes: 13, watched: 5, my_note: rewatch }",
			);

	it("brings new seasons in and counts the episodes again", () => {
		const refreshed = refreshTvFrontmatter(note(), show({ seasons: [season(1, 7), season(2, 13), season(3, 13)] }));
		expect(valueOf(refreshed, "episodes")).toBe("33");
		expect(valueOf(refreshed, "episodes_watched")).toBe("5");
		expect(seasonsOf(refreshed)?.map((item) => item.season)).toEqual([1, 2, 3]);
	});

	it("keeps what the user wrote, in the note and on a season's own line", () => {
		const refreshed = refreshTvFrontmatter(note(), show());
		expect(refreshed).toContain("my_rating: 10");
		expect(seasonsOf(refreshed)?.[1].extra).toEqual({ my_note: "rewatch" });
		expect(seasonsOf(refreshed)?.[1].watched).toBe(5);
	});

	it("leaves a note alone when its seasons cannot be read", () => {
		const broken = note().replace("  - { season: 1, year: 2008, episodes: 7, watched: 0 }", "  - { season: 1, year: ");
		expect(refreshTvFrontmatter(broken, show())).toBe(broken);
	});
});

describe("watching", () => {
	const ended = () => buildTvNoteContent(show(), null);
	const ongoing = () => buildTvNoteContent(running(), null);

	it("counts one more episode, and dates the season its last one finishes", () => {
		let content = watchOneMoreOfSeason(ended(), 1, "2026-09-22");
		expect(valueOf(content, "episodes_watched")).toBe("1");
		expect(seasonsOf(content)?.[0].watchDate).toBeNull();

		for (let episode = 2; episode <= 7; episode += 1) content = watchOneMoreOfSeason(content, 1, "2026-09-22");
		expect(seasonsOf(content)?.[0]).toMatchObject({ watched: 7, watchDate: "2026-09-22" });
		expect(valueOf(content, "watched")).toBe("false");
	});

	it("ticks the show off once a show that has ended is fully watched", () => {
		const content = markTvWatched(setSeasonWatched(ended(), 1, true, "2026-09-01"), "2026-09-22");
		expect(valueOf(content, "watched")).toBe("true");
		expect(valueOf(content, "watch_date")).toBe("2026-09-22");
		expect(valueOf(content, "episodes_watched")).toBe("20");
		// The day season 1 was finished is its own, and stays.
		expect(seasonsOf(content)?.[0].watchDate).toBe("2026-09-01");
	});

	it("never ticks a show that is still running off by itself", () => {
		let content = ongoing();
		for (const number of [1, 2]) content = setSeasonWatched(content, number, true, "2026-09-22");
		expect(valueOf(content, "episodes_watched")).toBe("19");
		expect(valueOf(content, "watched")).toBe("false");

		// Said by hand, it is taken at its word.
		expect(valueOf(markTvWatched(content, "2026-09-22"), "watched")).toBe("true");
	});

	it("takes the tick back when a season is unticked again", () => {
		const watched = markTvWatched(ended(), "2026-09-22");
		const content = setSeasonWatched(watched, 2, false, null);
		expect(valueOf(content, "watched")).toBe("false");
		expect(valueOf(content, "episodes_watched")).toBe("7");
		expect(seasonsOf(content)?.[1]).toMatchObject({ watched: 0, watchDate: null });
	});

	it("never writes the day you started, whatever is watched", () => {
		// `watch_start` is the one date the plugin only ever makes room for.
		let content = markTvWatched(ended(), "2026-09-22");
		content = setSeasonWatched(content, 1, true, "2026-09-22");
		content = refreshTvFrontmatter(content, show());
		expect(valueOf(content, "watch_start")).toBe("");
		expect(valueOf(content, "watch_date")).toBe("2026-09-22");
	});

	it("does nothing to a season the note does not have, or one already complete", () => {
		const content = setSeasonWatched(ended(), 1, true, "2026-09-22");
		expect(setSeasonWatched(content, 9, true, "2026-09-22")).toBe(content);
		expect(watchOneMoreOfSeason(content, 1, "2026-09-22")).toBe(content);
	});
});

describe("tvProgressOf", () => {
	it("reads the seasons the way Obsidian hands them over", () => {
		const progress = tvProgressOf({
			watched: false,
			seasons: [
				{ season: 1, episodes: 7, watched: 7, watch_date: "2026-09-01" },
				{ season: 2, episodes: 13, watched: 5 },
				{ season: 3, episodes: 13, watched: 0 },
			],
		});
		expect(progress).toMatchObject({
			watched: 12,
			episodes: 33,
			position: { season: 2, episode: 5 },
			more: true,
			done: false,
		});
	});

	it("points at the last season watched, even when an earlier one was skipped", () => {
		// True Detective and other anthologies: season 3 alone is a real answer.
		const progress = tvProgressOf({
			seasons: [
				{ season: 1, episodes: 8, watched: 0 },
				{ season: 3, episodes: 8, watched: 8 },
			],
		});
		expect(progress.position).toEqual({ season: 3, episode: 8 });
		expect(progress.watched).toBe(8);
	});

	it("has nothing to show for a note with no seasons", () => {
		expect(tvProgressOf({})).toMatchObject({ watched: 0, episodes: 0, position: null, more: false });
		expect(tvProgressOf(undefined).seasons).toEqual([]);
	});
});
