import { beforeEach, describe, expect, it } from "vitest";
import { AnimeActions } from "../src/anime-actions";
import type { MangaMetadata } from "../src/mal";
import type { TvMetadata } from "../src/tmdb-tv";
import { TvActions } from "../src/tv-actions";
import { VaultNotes } from "../src/vault-notes";
import { FakeApp, fakeMal, fakeTmdb, fakeUi, settings } from "./fake-app";
import { Notice } from "./obsidian-stub";

/*
 * A TV series note can hold a manga the same way a Series note does: the
 * manga side belongs to the work, not to the catalogue its episodes came
 * from. Everything the manga side does — Read, chapters, the mangaka, a
 * refresh from MyAnimeList — has to reach these notes too.
 */

const attackOnTitan: TvMetadata = {
	title: "Attack on Titan",
	originalTitle: "進撃の巨人",
	year: 2013,
	endYear: 2022,
	creators: [],
	genres: ["Animation"],
	cast: [],
	networks: ["Tokyo MX"],
	status: "Ended",
	finished: true,
	seasons: [
		{ season: 1, name: null, year: 2013, episodes: 25 },
		{ season: 2, name: null, year: 2017, episodes: 12 },
	],
	tmdbTvId: 1429,
	posterPath: "/aot.jpg",
};

const aotManga: MangaMetadata = {
	title: "Shingeki no Kyojin",
	mediaType: "manga",
	status: "finished",
	year: 2009,
	endYear: 2021,
	chapters: 141,
	volumes: 34,
	mangaka: [{ name: "Hajime Isayama", malId: 8054 }],
	malId: 23390,
	posterUrl: "https://cdn.example/aot-manga.jpg",
};

const showResult = {
	id: attackOnTitan.tmdbTvId,
	title: attackOnTitan.title,
	originalTitle: attackOnTitan.originalTitle,
	year: attackOnTitan.year,
	looksLikeAnime: true,
};

const mangaResult = {
	id: aotManga.malId,
	title: aotManga.title,
	mediaType: aotManga.mediaType,
	year: aotManga.year,
};

/** A vault with the show added, and Add manga about to run on that note. */
async function withShow(link: "link" | "separate" | null = "link") {
	const app = new FakeApp();
	const vault = new VaultNotes(app.app);
	const tv = new TvActions(app.app, vault, settings(), { alsoTracked: async () => "add" });
	await tv.addTv(fakeTmdb({ shows: [attackOnTitan] }), showResult);

	const file = app.file("TV/Attack on Titan (2013).md");
	app.show(file.path);
	const { ui, asked } = fakeUi(link);
	const anime = new AnimeActions(app.app, vault, settings(), ui);
	const mal = fakeMal({ manga: [aotManga] });
	Notice.shown.length = 0;
	return { app, anime, tv, mal, file, asked };
}

beforeEach(() => {
	Notice.shown.length = 0;
});

describe("Add manga on a TV series note", () => {
	it("asks, then writes the manga into the note beside its seasons", async () => {
		const { app, anime, mal, file, asked } = await withShow("link");
		await anime.addManga(mal, mangaResult);

		expect(asked).toEqual([
			{ workTitle: "Shingeki no Kyojin", side: "manga", noteName: "Attack on Titan (2013)", alsoIn: [] },
		]);
		const note = app.note(file.path);
		expect(note).toContain("manga:");
		expect(note).toContain("  mal_id: 23390");
		// The seasons stay where they are, and the manga block goes after them.
		expect(note.indexOf("seasons:")).toBeLessThan(note.indexOf("manga:"));
		expect(note).toContain("  - { season: 1, year: 2013, episodes: 25, watched: 0 }");
		expect(Notice.shown).toEqual(["Linked Shingeki no Kyojin to Attack on Titan (2013)"]);
	});

	it("writes a note of its own when that is the answer", async () => {
		const { app, anime, mal, file } = await withShow("separate");
		await anime.addManga(mal, mangaResult);

		expect(app.notes.has("Anime/Shingeki no Kyojin.md")).toBe(true);
		expect(app.note(file.path)).not.toContain("manga:");
	});

	it("writes nothing when the question is dismissed", async () => {
		const { app, anime, mal, file } = await withShow(null);
		await anime.addManga(mal, mangaResult);

		expect(app.note(file.path)).not.toContain("manga:");
		expect([...app.notes.keys()]).toEqual(["TV/Attack on Titan (2013).md"]);
	});
});

describe("the manga side of a TV series note", () => {
	async function linked() {
		const set = await withShow("link");
		await set.anime.addManga(set.mal, mangaResult);
		Notice.shown.length = 0;
		return set;
	}

	it("reads chapters and marks the manga read", async () => {
		const { app, anime, file } = await linked();
		await anime.readOneMoreChapter(file);
		expect(app.note(file.path)).toContain("  chapters_read: 1");

		await anime.markReadToday(file);
		const note = app.note(file.path);
		expect(note).toContain("  read: true");
		expect(note).toMatch(/ {2}read_date: \d{4}-\d{2}-\d{2}/);
		expect(note).toContain("  chapters_read: 141");
	});

	it("keeps Read in step with a note of the manga's own", async () => {
		// The manga first, on a note of its own, and then the show it is on.
		const { app, anime, mal, file, asked } = await withShow("link");
		app.visible = null;
		await anime.addManga(mal, mangaResult);
		const other = "Anime/Shingeki no Kyojin.md";
		expect(app.notes.has(other)).toBe(true);

		app.show(file.path);
		await anime.addManga(mal, mangaResult);
		expect(asked[0].alsoIn).toEqual(["Shingeki no Kyojin"]);
		expect(app.note(file.path)).toContain("  mal_id: 23390");

		// Read once, read everywhere it sits.
		await anime.syncMangaRead(file, true);
		expect(app.note(file.path)).toContain("  read: true");
		expect(app.note(other)).toContain("  read: true");
	});

	it("refreshes the manga from MyAnimeList without touching the seasons", async () => {
		const { app, anime, mal, file } = await linked();
		await anime.readOneMoreChapter(file);
		const before = app.note(file.path);

		await anime.refresh(mal, file);
		const after = app.note(file.path);
		expect(after).toContain("  chapters: 141");
		expect(after).toContain("  chapters_read: 1");
		expect(after).toContain("  - { season: 1, year: 2013, episodes: 25, watched: 0 }");
		expect(before.indexOf("seasons:")).toBe(after.indexOf("seasons:"));
		expect(Notice.shown).toContain("Refreshed Shingeki no Kyojin");
	});

	it("still counts episodes from TMDB, and the show's own refresh leaves the manga alone", async () => {
		const { app, tv, file } = await linked();
		await tv.watchOneMoreEpisode(file);
		expect(app.note(file.path)).toContain("episodes_watched: 1");

		await tv.refresh(fakeTmdb({ shows: [attackOnTitan] }), file, attackOnTitan.tmdbTvId);
		const note = app.note(file.path);
		expect(note).toContain("  mal_id: 23390");
		expect(note).toContain("episodes_watched: 1");
		expect(note).toContain("episodes: 37");
	});

	it("removes the manga and leaves the series behind", async () => {
		const { app, anime, file } = await linked();
		await anime.removeManga(file);

		const note = app.note(file.path);
		expect(note).not.toContain("manga:");
		expect(note).toContain("tmdb_tv_id: 1429");
		expect(note).toContain("seasons:");
	});
});
