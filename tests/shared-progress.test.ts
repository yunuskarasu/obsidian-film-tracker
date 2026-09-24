import { beforeEach, describe, expect, it } from "vitest";
import { AnimeActions } from "../src/anime-actions";
import { buildAnimeNoteContent } from "../src/anime-note";
import type { AnimeMetadata } from "../src/mal";
import { VaultNotes } from "../src/vault-notes";
import { FakeApp, fakeUi, settings } from "./fake-app";
import { Notice } from "./obsidian-stub";

/*
 * One anime can sit on a note per manga it adapts, and watching it is
 * shared between them. Before 3.0 those notes were counted apart, so one of
 * them may be further along than the note on screen: sharing a count must
 * never take that note back.
 */

const jojo: AnimeMetadata = {
	title: "JoJo no Kimyou na Bouken (TV)",
	englishTitle: null,
	japaneseTitle: null,
	mediaType: "tv",
	status: "finished_airing",
	episodes: 26,
	genres: [],
	studios: [],
	year: 2012,
	endYear: 2013,
	malId: 14719,
	posterUrl: null,
};

const PART_1 = "Anime/Part 1.md";
const PART_2 = "Anime/Part 2.md";

function note(watched: number): string {
	return buildAnimeNoteContent(jojo, null).replace("watched: false", `episodes_watched: ${watched}\nwatched: false`);
}

function setUp(part1: number, part2: number) {
	const app = new FakeApp({ [PART_1]: note(part1), [PART_2]: note(part2) });
	const obsidian = app.app;
	const anime = new AnimeActions(obsidian, new VaultNotes(obsidian), settings(), fakeUi(null, null).ui);
	return { app, obsidian, anime };
}

beforeEach(() => {
	Notice.shown.length = 0;
});

describe("watching an anime shared between notes", () => {
	it("never takes back a note that was further along", async () => {
		const { app, anime } = setUp(10, 3);
		await anime.watchOneMoreEpisode(app.file(PART_2));

		expect(app.note(PART_2)).toContain("episodes_watched: 4");
		expect(app.note(PART_1)).toContain("episodes_watched: 10");
		expect(Notice.shown).toEqual(["Episode 4 of 26 watched."]);
	});

	it("brings a note that was behind up to the one on screen", async () => {
		const { app, anime } = setUp(2, 3);
		await anime.watchOneMoreEpisode(app.file(PART_2));

		expect(app.note(PART_1)).toContain("episodes_watched: 4");
		expect(app.note(PART_2)).toContain("episodes_watched: 4");
	});

	it("says nothing was watched when the note on screen could not be written", async () => {
		const { app, obsidian, anime } = setUp(3, 3);
		// The note changed under the plugin between reading it and writing it:
		// what is on disk now has no properties the plugin can read.
		obsidian.vault.process = async (_file, rewrite) => rewrite("plain text\n");

		await anime.watchOneMoreEpisode(app.file(PART_2));
		await anime.markWatchedToday(app.file(PART_2));

		expect(Notice.shown).toEqual([
			"Could not read the properties of Part 1, so it was left unchanged.",
			"Could not read the properties of Part 2, so it was left unchanged.",
			"Could not read the properties of Part 1, so it was left unchanged.",
			"Could not read the properties of Part 2, so it was left unchanged.",
		]);
	});
});
