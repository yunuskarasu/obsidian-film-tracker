import { describe, expect, it } from "vitest";
import {
	buildAnimeFileName,
	buildAnimeNoteContent,
	refreshAnimeFrontmatter,
} from "../src/anime-note";
import type { AnimeMetadata } from "../src/mal";

const aot: AnimeMetadata = {
	title: "Shingeki no Kyojin",
	englishTitle: "Attack on Titan",
	japaneseTitle: "進撃の巨人",
	mediaType: "tv",
	episodes: 25,
	genres: ["Action", "Drama"],
	studios: ["Wit Studio"],
	status: "finished_airing",
	year: 2013,
	endYear: 2013,
	malId: 16498,
	posterUrl: "https://example.com/poster.jpg",
};

describe("buildAnimeFileName", () => {
	it("appends the year the same way a film file name does", () => {
		expect(buildAnimeFileName("Shingeki no Kyojin", 2013)).toBe("Shingeki no Kyojin (2013)");
	});

	it("drops the year when it is null", () => {
		expect(buildAnimeFileName("Shingeki no Kyojin", null)).toBe("Shingeki no Kyojin");
	});

	it("writes the year once when MAL's title already ends in it", () => {
		expect(buildAnimeFileName("Hunter x Hunter (2011)", 2011)).toBe("Hunter x Hunter (2011)");
	});
});

describe("buildAnimeNoteContent", () => {
	it("writes title, alternative titles, media type, episodes, genres, studios, status, year, poster, mal_id and watched", () => {
		const content = buildAnimeNoteContent(aot, "[[Attachments/Attack on Titan.jpg]]");
		expect(content).toBe(
			[
				"---",
				"title: Shingeki no Kyojin",
				"english_title: Attack on Titan",
				"japanese_title: 進撃の巨人",
				"media_type: tv",
				"episodes: 25",
				"genres:",
				"  - Action",
				"  - Drama",
				"studios:",
				"  - Wit Studio",
				"status: finished_airing",
				"year: 2013",
				"end_year: 2013",
				'poster: "[[Attachments/Attack on Titan.jpg]]"',
				"mal_id: 16498",
				"watch_start:",
				"watch_date:",
				"watched: false",
				"---",
				"",
			].join("\n"),
		);
	});

	it("leaves the poster line empty when there is no poster", () => {
		expect(buildAnimeNoteContent(aot, null)).toContain("\nposter:\n");
	});

	it("leaves optional fields empty when MAL has none", () => {
		const content = buildAnimeNoteContent(
			{ ...aot, englishTitle: null, japaneseTitle: null, mediaType: null, episodes: null, status: null, year: null },
			null,
		);
		expect(content).toContain("\nenglish_title:\n");
		expect(content).toContain("\njapanese_title:\n");
		expect(content).toContain("\nmedia_type:\n");
		expect(content).toContain("\nepisodes:\n");
		expect(content).toContain("\nstatus:\n");
		expect(content).toContain("\nyear:\n");
	});

	it("leaves genres and studios empty when MAL has none", () => {
		const content = buildAnimeNoteContent({ ...aot, genres: [], studios: [] }, null);
		expect(content).toContain("\ngenres:\n");
		expect(content).toContain("\nstudios:\n");
	});

	it("initializes watched to false and leaves the body empty", () => {
		const content = buildAnimeNoteContent(aot, null);
		expect(content).toContain("\nwatched: false\n");
		expect(content.endsWith("---\n")).toBe(true);
	});
});

describe("refreshAnimeFrontmatter", () => {
	const existingNote = [
		"---",
		"title: Shingeki no Kyojin",
		"english_title: Attack on Titan",
		"japanese_title: 進撃の巨人",
		"media_type: tv",
		"episodes: 25",
		"genres:",
		"  - Action",
		"  - Drama",
		"studios:",
		"  - Wit Studio",
		"status: finished_airing",
		"year: 2013",
		"end_year: 2013",
		'poster: "[[Attachments/Attack on Titan.jpg]]"',
		"mal_id: 16498",
		"watched: true",
		"---",
		"",
		"My own thoughts about this anime.",
		"",
	].join("\n");

	it("keeps a genre or studio the user linked", () => {
		const linked = existingNote.replace("  - Wit Studio", '  - "[[Wit Studio]]"');
		const updated = refreshAnimeFrontmatter(linked, aot, null, { genres: ["Action", "Drama"], studios: ["[[Wit Studio]]"] });
		expect(updated).toContain('studios:\n  - "[[Wit Studio]]"\n');
		expect(updated).toContain("genres:\n  - Action\n  - Drama\n");
	});

	it("rewrites only the plugin-owned fields, leaving watched and the body untouched", () => {
		const updated = refreshAnimeFrontmatter(existingNote, { ...aot, episodes: 87, status: "currently_airing" });
		expect(updated).toContain("episodes: 87");
		expect(updated).toContain("status: currently_airing");
		expect(updated).toContain("watched: true");
		expect(updated).toContain("My own thoughts about this anime.");
	});

	it("gives a note from before 3.0 nothing new: same data in, the same note out", () => {
		// Refreshed with exactly what the note already says, a 2.x note comes
		// back byte for byte — no `watch_start` or `watch_date` added to it.
		expect(refreshAnimeFrontmatter(existingNote, aot)).toBe(existingNote);
		expect(refreshAnimeFrontmatter(existingNote.replace(/\n/g, "\r\n"), aot)).toBe(existingNote.replace(/\n/g, "\r\n"));
		// Even one whose `watched` line the user deleted gets only that back.
		const noWatched = existingNote.replace("watched: true\n", "");
		expect(refreshAnimeFrontmatter(noWatched, aot)).toBe(existingNote.replace("watched: true", "watched: false"));
	});

	it("never touches a manga block already merged onto this Series note", () => {
		const merged = existingNote.replace(
			"mal_id: 16498",
			[
				"mal_id: 16498",
				"manga:",
				"  mal_id: 26",
				"  title: Hunter x Hunter",
				"  read: true",
			].join("\n"),
		);
		const updated = refreshAnimeFrontmatter(merged, { ...aot, episodes: 148 });
		expect(updated).toContain("episodes: 148");
		expect(updated).toContain("manga:");
		expect(updated).toContain("  mal_id: 26");
		expect(updated).toContain("  read: true");
	});

	it("never overwrites an existing poster", () => {
		const updated = refreshAnimeFrontmatter(existingNote, aot, "[[new-poster.jpg]]");
		expect(updated).toContain('poster: "[[Attachments/Attack on Titan.jpg]]"');
	});

	it("fills in a poster only when the poster field is empty", () => {
		const noPoster = existingNote.replace(
			'poster: "[[Attachments/Attack on Titan.jpg]]"',
			"poster:",
		);
		const updated = refreshAnimeFrontmatter(noPoster, aot, "[[new-poster.jpg]]");
		expect(updated).toContain('poster: "[[new-poster.jpg]]"');
	});

	it("preserves a property the user added and the key order", () => {
		const withExtra = existingNote.replace("mal_id: 16498", "mal_id: 16498\nrating: 9");
		const updated = refreshAnimeFrontmatter(withExtra, aot);
		expect(updated).toContain("rating: 9");
	});

	// A note written before a field existed — end_year, added in 2.3.0 — gets
	// it where a new note would have it, not tacked on at the end.
	it("puts a field the note doesn't have yet in its canonical place", () => {
		const older = existingNote.replace("end_year: 2013\n", "");
		const updated = refreshAnimeFrontmatter(older, aot);
		expect(updated).toContain("\nyear: 2013\nend_year: 2013\nposter:");
	});

	it("puts it there on a note carrying a manga block too", () => {
		const older = existingNote
			.replace("end_year: 2013\n", "")
			.replace("watched: true", "watched: true\nmanga:\n  mal_id: 26\n  read: true");
		const updated = refreshAnimeFrontmatter(older, aot);
		expect(updated).toContain("\nyear: 2013\nend_year: 2013\nposter:");
		expect(updated).toContain("\nwatched: true\nmanga:\n");
	});

	it("returns the content unchanged when there is no frontmatter", () => {
		expect(refreshAnimeFrontmatter("No frontmatter here.", aot)).toBe("No frontmatter here.");
	});

	describe("merging onto a manga-only Series note", () => {
		const mangaOnly = [
			"---",
			"manga:",
			"  mal_id: 26",
			"  title: Hunter x Hunter",
			"  read: true",
			"---",
			"",
			"My manga notes.",
			"",
		].join("\n");

		it("seeds watched to false and keeps the manga block last, in canonical anime field order", () => {
			const merged = refreshAnimeFrontmatter(mangaOnly, aot, "[[Attachments/Attack on Titan.jpg]]");
			expect(merged).toBe(
				[
					"---",
					"title: Shingeki no Kyojin",
					"english_title: Attack on Titan",
					"japanese_title: 進撃の巨人",
					"media_type: tv",
					"episodes: 25",
					"genres:",
					"  - Action",
					"  - Drama",
					"studios:",
					"  - Wit Studio",
					"status: finished_airing",
					"year: 2013",
					"end_year: 2013",
					'poster: "[[Attachments/Attack on Titan.jpg]]"',
					"mal_id: 16498",
					"watch_start:",
					"watch_date:",
					"watched: false",
					"manga:",
					"  mal_id: 26",
					"  title: Hunter x Hunter",
					"  read: true",
					"---",
					"",
					"My manga notes.",
					"",
				].join("\n"),
			);
		});

		it("never overwrites watched if it already exists", () => {
			const alreadyWatched = mangaOnly.replace("manga:", "watched: true\nmanga:");
			const merged = refreshAnimeFrontmatter(alreadyWatched, aot);
			expect(merged).toContain("watched: true");
			expect(merged.match(/^watched:/gm)?.length).toBe(1);
		});

		it("never touches the manga block's own data", () => {
			const merged = refreshAnimeFrontmatter(mangaOnly, aot);
			expect(merged).toContain("  mal_id: 26");
			expect(merged).toContain("  title: Hunter x Hunter");
			expect(merged).toContain("  read: true");
		});
	});
});
