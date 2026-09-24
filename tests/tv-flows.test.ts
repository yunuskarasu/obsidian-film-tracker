import { beforeEach, describe, expect, it } from "vitest";
import { AnimeActions } from "../src/anime-actions";
import { FilmActions } from "../src/film-actions";
import { buildDirectorNoteContent } from "../src/director-note";
import { buildAnimeNoteContent } from "../src/anime-note";
import type { AnimeMetadata } from "../src/mal";
import type { TmdbTvDetails, TvMetadata } from "../src/tmdb-tv";
import { TvActions } from "../src/tv-actions";
import type { AlreadyTrackedChoice } from "../src/already-tracked-modal";
import { VaultNotes } from "../src/vault-notes";
import { FakeApp, fakeMal, fakeTmdb, fakeUi, settings } from "./fake-app";
import { Notice } from "./obsidian-stub";

/*
 * Add TV series, Refresh and the watching commands end to end, against the
 * in-memory vault (see fake-app.ts): what lands in the note, which note is
 * opened, and what the user is told.
 */

const breakingBad: TvMetadata = {
	title: "Breaking Bad",
	originalTitle: "Breaking Bad",
	year: 2008,
	endYear: 2013,
	creators: ["Vince Gilligan"],
	genres: ["Drama"],
	cast: [],
	networks: ["AMC"],
	status: "Ended",
	finished: true,
	seasons: [
		{ season: 1, name: null, year: 2008, episodes: 7 },
		{ season: 2, name: null, year: 2009, episodes: 13 },
	],
	tmdbTvId: 1396,
	posterPath: "/bb.jpg",
};

const attackOnTitan: TvMetadata = {
	...breakingBad,
	title: "Attack on Titan",
	originalTitle: "進撃の巨人",
	year: 2013,
	endYear: 2022,
	creators: [],
	networks: ["Tokyo MX"],
	seasons: [{ season: 1, name: null, year: 2013, episodes: 25 }],
	tmdbTvId: 1429,
	posterPath: "/aot.jpg",
};

/** The genres TMDB gives a show, which is where the anime check looks. */
const animeDetails = (show: TvMetadata): TmdbTvDetails => ({
	id: show.tmdbTvId,
	genres: [{ id: 16, name: "Animation" }],
	origin_country: ["JP"],
});

const aotAnime: AnimeMetadata = {
	title: "Shingeki no Kyojin",
	englishTitle: "Attack on Titan",
	japaneseTitle: "進撃の巨人",
	mediaType: "tv",
	status: "finished_airing",
	episodes: 25,
	genres: [],
	studios: ["Wit Studio"],
	year: 2013,
	endYear: 2013,
	malId: 16498,
	posterUrl: "https://cdn.example/aot.jpg",
};

function setUp(
	notes: Record<string, string> = {},
	choice: AlreadyTrackedChoice | null = "add",
): {
	app: FakeApp;
	tv: TvActions;
	asked: { showTitle: string; noteNames: string[] }[];
	client: ReturnType<typeof fakeTmdb>;
} {
	const app = new FakeApp(notes);
	const vault = new VaultNotes(app.app);
	const asked: { showTitle: string; noteNames: string[] }[] = [];
	const client = fakeTmdb({
		shows: [breakingBad, attackOnTitan],
		showDetails: (show) => (show.tmdbTvId === attackOnTitan.tmdbTvId ? animeDetails(show) : { id: show.tmdbTvId }),
	});
	const tv = new TvActions(app.app, vault, settings(), {
		alsoTracked: async (showTitle, noteNames) => {
			asked.push({ showTitle, noteNames });
			return choice;
		},
	});
	return { app, tv, asked, client };
}

const result = (show: TvMetadata) => ({
	id: show.tmdbTvId,
	title: show.title,
	originalTitle: show.originalTitle,
	year: show.year,
	looksLikeAnime: false,
});

beforeEach(() => {
	Notice.shown.length = 0;
});

describe("Add TV series", () => {
	it("writes the note, its poster and its seasons", async () => {
		const { app, tv, client } = setUp();
		await tv.addTv(client, result(breakingBad));

		const note = app.note("TV/Breaking Bad (2008).md");
		expect(note).toContain("tmdb_tv_id: 1396");
		expect(note).toContain("episodes: 20");
		expect(note).toContain("  - { season: 1, year: 2008, episodes: 7, watched: 0 }");
		expect(app.images.has("Breaking Bad (2008).jpg")).toBe(true);
		expect(app.opened).toEqual(["TV/Breaking Bad (2008).md"]);
		expect(Notice.shown).toEqual(["Added Breaking Bad"]);
	});

	it("opens the note it already has rather than writing a second one", async () => {
		const { app, tv, client } = setUp();
		await tv.addTv(client, result(breakingBad));
		Notice.shown.length = 0;
		await tv.addTv(client, result(breakingBad));

		expect([...app.notes.keys()].filter((path) => path.startsWith("TV/"))).toHaveLength(1);
		expect(Notice.shown).toEqual(["Already in your vault: Breaking Bad (2008)"]);
	});

	it("never takes a film note for the show with the same id", async () => {
		// TMDB numbers films and shows apart: 1396 is both.
		const film = ["---", "title: A film", "directors:", "tmdb_id: 1396", "watched: false", "---", ""].join("\n");
		const { app, tv, client } = setUp({ "Films/A film.md": film });
		await tv.addTv(client, result(breakingBad));

		expect(app.notes.has("TV/Breaking Bad (2008).md")).toBe(true);
		expect(app.note("Films/A film.md")).toBe(film);
	});
});

describe("a show the vault already tracks as an anime", () => {
	const animeNote = () => ({ "Anime/Shingeki no Kyojin (2013).md": buildAnimeNoteContent(aotAnime, null) });

	it("asks, and opens the anime note when that is the answer", async () => {
		const { app, tv, asked, client } = setUp(animeNote(), "open");
		await tv.addTv(client, result(attackOnTitan));

		expect(asked).toEqual([{ showTitle: "Attack on Titan", noteNames: ["Shingeki no Kyojin (2013)"] }]);
		expect(app.notes.has("TV/Attack on Titan (2013).md")).toBe(false);
		expect(app.opened).toEqual(["Anime/Shingeki no Kyojin (2013).md"]);
	});

	it("adds it anyway when that is the answer, and writes nothing when the question is dismissed", async () => {
		const { app, tv, client } = setUp(animeNote(), "add");
		await tv.addTv(client, result(attackOnTitan));
		expect(app.notes.has("TV/Attack on Titan (2013).md")).toBe(true);

		const dismissed = setUp(animeNote(), null);
		await dismissed.tv.addTv(dismissed.client, result(attackOnTitan));
		expect(dismissed.app.notes.has("TV/Attack on Titan (2013).md")).toBe(false);
	});

	it("never asks about a show that isn't anime, whatever the vault holds", async () => {
		const { tv, asked, client } = setUp(animeNote());
		await tv.addTv(client, result(breakingBad));
		expect(asked).toEqual([]);
	});
});

describe("watching a TV note", () => {
	async function added(): Promise<{ app: FakeApp; tv: TvActions; file: ReturnType<FakeApp["file"]> }> {
		const { app, tv, client } = setUp();
		await tv.addTv(client, result(breakingBad));
		Notice.shown.length = 0;
		return { app, tv, file: app.file("TV/Breaking Bad (2008).md") };
	}

	it("counts an episode into the earliest season with something left", async () => {
		const { app, tv, file } = await added();
		await tv.watchOneMoreEpisode(file);
		await tv.watchOneMoreEpisode(file);

		expect(app.note(file.path)).toContain("  - { season: 1, year: 2008, episodes: 7, watched: 2 }");
		expect(app.note(file.path)).toContain("episodes_watched: 2");
		expect(Notice.shown).toEqual([
			"Season 1: episode 1 of 7 watched.",
			"Season 1: episode 2 of 7 watched.",
		]);
	});

	it("moves on to the next season once one is done", async () => {
		const { app, tv, file } = await added();
		await tv.setSeasonWatched(file, 1, true);
		await tv.watchOneMoreEpisode(file);

		expect(app.note(file.path)).toContain("season: 2, year: 2009, episodes: 13, watched: 1");
		expect(app.note(file.path)).toContain("episodes_watched: 8");
	});

	it("ticks the show off once every season of a finished show is watched", async () => {
		const { app, tv, file } = await added();
		await tv.setSeasonWatched(file, 1, true);
		await tv.setSeasonWatched(file, 2, true);

		expect(app.note(file.path)).toContain("watched: true");
		expect(app.note(file.path)).toContain("episodes_watched: 20");
	});

	it("says so rather than counting past the last episode there is", async () => {
		const { tv, file } = await added();
		await tv.setSeasonWatched(file, 1, true);
		await tv.setSeasonWatched(file, 2, true);
		Notice.shown.length = 0;

		await tv.watchOneMoreEpisode(file);
		expect(Notice.shown).toEqual(["Breaking Bad (2008) is watched up to its latest episode."]);
	});

	it("marks the whole show watched today", async () => {
		const { app, tv, file } = await added();
		await tv.markWatchedToday(file);

		const note = app.note(file.path);
		expect(note).toContain("episodes_watched: 20");
		expect(note).toMatch(/watch_date: \d{4}-\d{2}-\d{2}/);
		expect(Notice.shown).toEqual(["Marked Breaking Bad (2008) as watched today."]);
	});

	/** The note with a season line the plugin can't read added by hand. */
	async function withBadLine() {
		const setup = await added();
		const bad = setup.app.note(setup.file.path).replace("  - { season: 1, year: 2008, episodes: 7, watched: 0 }", "  - { season: 1, year: 2008, episodes: 7, watched: 0 }\n  - { season: special }");
		setup.app.notes.set(setup.file.path, bad);
		return { ...setup, bad };
	}

	it("writes nothing, and says so, when a season line can't be read", async () => {
		const { app, tv, file, bad } = await withBadLine();
		await tv.watchOneMoreOfSeason(file, 1);
		await tv.watchOneMoreEpisode(file);
		await tv.setSeasonWatched(file, 1, true);

		expect(app.note(file.path)).toBe(bad);
		const unreadable = "Could not read the seasons of Breaking Bad (2008), so it was left unchanged.";
		expect(Notice.shown).toEqual([unreadable, unreadable, unreadable]);
	});

	it("leaves the whole note alone on Mark as watched today when a season line can't be read", async () => {
		const { app, tv, file, bad } = await withBadLine();
		await tv.markWatchedToday(file);

		expect(app.note(file.path)).toBe(bad);
		expect(Notice.shown).toEqual(["Could not read the seasons of Breaking Bad (2008), so it was left unchanged."]);
	});

	it("never takes away a tick the user set by hand", async () => {
		const { app, tv, file } = await added();
		app.notes.set(file.path, app.note(file.path).replace("watched: false", "watched: true"));

		await tv.watchOneMoreEpisode(file);
		expect(app.note(file.path)).toMatch(/\nwatched: true\n/);
		await tv.refresh(fakeTmdb({ shows: [breakingBad] }), file, 1396);
		expect(app.note(file.path)).toMatch(/\nwatched: true\n/);
	});

	it("takes the show's tick off when a season's tick is taken back", async () => {
		const { app, tv, file } = await added();
		await tv.setSeasonWatched(file, 1, true);
		await tv.setSeasonWatched(file, 2, true);
		await tv.setSeasonWatched(file, 2, false);

		expect(app.note(file.path)).toMatch(/\nwatched: false\n/);
		expect(app.note(file.path)).toContain("episodes_watched: 7");
	});
});

describe("Refresh on a TV note", () => {
	it("brings a new season in and leaves what was watched alone", async () => {
		const { app, tv, client } = setUp();
		await tv.addTv(client, result(breakingBad));
		const file = app.file("TV/Breaking Bad (2008).md");
		await tv.setSeasonWatched(file, 1, true);
		Notice.shown.length = 0;

		const grown = fakeTmdb({
			shows: [{ ...breakingBad, seasons: [...breakingBad.seasons, { season: 3, name: null, year: 2010, episodes: 13 }] }],
		});
		await tv.refresh(grown, file, 1396);

		const note = app.note(file.path);
		expect(note).toContain("episodes: 33");
		expect(note).toContain("episodes_watched: 7");
		expect(note).toContain("  - { season: 3, year: 2010, episodes: 13, watched: 0 }");
		expect(Notice.shown).toEqual(["Refreshed Breaking Bad"]);
	});

	it("says it refreshed a note that was already up to date", async () => {
		const { app, tv, client } = setUp();
		await tv.addTv(client, result(breakingBad));
		const file = app.file("TV/Breaking Bad (2008).md");
		const before = app.note(file.path);
		Notice.shown.length = 0;

		await tv.refresh(client, file, 1396);
		expect(app.note(file.path)).toBe(before);
		expect(Notice.shown).toEqual(["Refreshed Breaking Bad"]);
	});

	it("leaves a note whose seasons cannot be read exactly as it is, and says so", async () => {
		const { app, tv, client } = setUp();
		await tv.addTv(client, result(breakingBad));
		const file = app.file("TV/Breaking Bad (2008).md");
		const broken = app.note(file.path).replace("  - { season: 1, year: 2008, episodes: 7, watched: 0 }", "  - { season: 1,");
		app.notes.set(file.path, broken);
		Notice.shown.length = 0;

		await tv.refresh(client, file, 1396);
		expect(app.note(file.path)).toBe(broken);
		expect(Notice.shown).toEqual([
			"Could not read the seasons of Breaking Bad (2008), so it was left unchanged.",
		]);
	});
});

describe("Add anime, the other way round", () => {
	/** A vault with the show already on a TV note, and Add anime about to run. */
	async function withTvNote(tracked: AlreadyTrackedChoice | null) {
		const { app, tv, client } = setUp();
		await tv.addTv(client, result(attackOnTitan));
		Notice.shown.length = 0;

		const { ui, alsoTracked } = fakeUi(null, { option: false }, tracked);
		const anime = new AnimeActions(app.app, new VaultNotes(app.app), settings(), ui);
		const add = () =>
			anime.addAnime(fakeMal({ anime: [aotAnime] }), {
				id: aotAnime.malId,
				title: aotAnime.title,
				mediaType: aotAnime.mediaType,
				year: aotAnime.year,
			});
		return { app, add, alsoTracked };
	}

	it("asks, and opens the TV note when that is the answer", async () => {
		const { app, add, alsoTracked } = await withTvNote("open");
		await add();

		expect(alsoTracked).toEqual([
			{ title: "Shingeki no Kyojin", noteNames: ["Attack on Titan (2013)"], side: "tv" },
		]);
		expect(app.notes.has("Anime/Shingeki no Kyojin (2013).md")).toBe(false);
		expect(app.opened).toContain("TV/Attack on Titan (2013).md");
	});

	it("adds the anime note anyway when that is the answer, and writes nothing when dismissed", async () => {
		const added = await withTvNote("add");
		await added.add();
		expect(added.app.notes.has("Anime/Shingeki no Kyojin (2013).md")).toBe(true);

		const dismissed = await withTvNote(null);
		await dismissed.add();
		expect(dismissed.app.notes.has("Anime/Shingeki no Kyojin (2013).md")).toBe(false);
	});

	it("never asks when the vault holds no TV note of that work", async () => {
		const app = new FakeApp();
		const { ui, alsoTracked } = fakeUi(null);
		const anime = new AnimeActions(app.app, new VaultNotes(app.app), settings(), ui);
		await anime.addAnime(fakeMal({ anime: [aotAnime] }), {
			id: aotAnime.malId,
			title: aotAnime.title,
			mediaType: aotAnime.mediaType,
			year: aotAnime.year,
		});

		expect(alsoTracked).toEqual([]);
		expect(app.notes.has("Anime/Shingeki no Kyojin (2013).md")).toBe(true);
	});
});

describe("Relink on a TV note", () => {
	const gilligan = {
		name: "Vince Gilligan",
		originalName: null,
		aliases: ["Vince Gilligan"],
		alsoKnownAs: [],
		birthday: "1967-02-10",
		deathday: null,
		placeOfBirth: "Richmond, Virginia, USA",
		tmdbId: 66633,
		photoPath: null,
	};

	it("turns a show's creators into links once the person's note exists", async () => {
		const { app, tv, client } = setUp();
		await tv.addTv(client, result(breakingBad));
		const file = app.file("TV/Breaking Bad (2008).md");
		expect(app.note(file.path)).toContain("  - Vince Gilligan");

		app.notes.set("Directors/Vince Gilligan.md", buildDirectorNoteContent(gilligan, null));
		Notice.shown.length = 0;

		const films = new FilmActions(app.app, new VaultNotes(app.app), settings());
		await films.relinkAll();

		expect(app.note(file.path)).toContain("  - \"[[Vince Gilligan]]\"");
		expect(Notice.shown).toEqual(["Relinked 1 note."]);
	});

	it("follows the series' own Link creators setting, not the film one", async () => {
		const { app, tv, client } = setUp();
		await tv.addTv(client, result(breakingBad));
		app.notes.set("Directors/Vince Gilligan.md", buildDirectorNoteContent(gilligan, null));

		// A film setting turned off says nothing about a series.
		const off = new FilmActions(app.app, new VaultNotes(app.app), settings({ linkCreators: false, linkDirectors: true }));
		await off.relinkAll();
		expect(app.note("TV/Breaking Bad (2008).md")).toContain("  - Vince Gilligan");

		const on = new FilmActions(app.app, new VaultNotes(app.app), settings({ linkCreators: true, linkDirectors: false }));
		await on.relinkAll();
		expect(app.note("TV/Breaking Bad (2008).md")).toContain('  - "[[Vince Gilligan]]"');
	});
});
