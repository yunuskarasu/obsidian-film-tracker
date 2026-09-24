import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimeActions } from "../src/anime-actions";
import {
	buildAnimeNoteContent,
	markAnimeWatched,
	refreshAnimeFrontmatter,
	setAnimeProgress,
} from "../src/anime-note";
import { FilmActions } from "../src/film-actions";
import type { AnimeMetadata, MangaMetadata } from "../src/mal";
import { applyMangaBlock, setMangaProgress, setMangaRead } from "../src/manga-note";
import { buildNoteContent, today, type FilmMetadata } from "../src/note";
import { VaultNotes } from "../src/vault-notes";
import { FakeApp, fakeUi, settings } from "./fake-app";
import { Notice } from "./obsidian-stub";

/*
 * Watching and reading: the two "today" commands, the one-more-episode and
 * one-more-chapter commands, and the note fields behind them —
 * `episodes_watched`, `watch_date`, `chapters_read` and `read_date`.
 */

const TODAY = "2026-09-20";

const hxh: AnimeMetadata = {
	title: "Hunter x Hunter (2011)",
	englishTitle: "Hunter x Hunter",
	japaneseTitle: null,
	mediaType: "tv",
	episodes: 148,
	genres: ["Action"],
	studios: ["Madhouse"],
	status: "finished_airing",
	year: 2011,
	endYear: 2014,
	malId: 11061,
	posterUrl: "https://cdn.example/hxh.jpg",
};

const berserk: MangaMetadata = {
	title: "Berserk",
	mediaType: "manga",
	status: "currently_publishing",
	year: 1989,
	endYear: null,
	chapters: 3,
	volumes: 1,
	mangaka: [{ name: "Kentarou Miura", malId: 1868 }],
	malId: 2,
	posterUrl: "https://cdn.example/berserk.jpg",
};

const stalker: FilmMetadata = {
	title: "Stalker",
	originalTitle: "Сталкер",
	year: 1979,
	directors: [],
	genres: [],
	cast: [],
	composers: [],
	runtime: 162,
	tmdbId: 1398,
	posterPath: null,
};

function animeActions(vault: FakeApp) {
	return new AnimeActions(vault.app, new VaultNotes(vault.app), settings(), fakeUi("link").ui);
}

function filmActions(vault: FakeApp) {
	return new FilmActions(vault.app, new VaultNotes(vault.app), settings());
}

/** A Series note carrying Berserk's manga side, with nothing read yet. */
function mangaNote(): string {
	return applyMangaBlock("---\n---\n", berserk, null, () => false);
}

beforeEach(() => {
	Notice.shown.length = 0;
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(`${TODAY}T21:30:00`));
});

afterEach(() => {
	vi.useRealTimers();
});

describe("today", () => {
	it("is the device's own day, not UTC's", () => {
		expect(today(new Date("2026-01-05T23:10:00"))).toBe("2026-01-05");
	});
});

describe("the anime fields", () => {
	it("ticks watched, dates it and completes the episode count", () => {
		const updated = markAnimeWatched(buildAnimeNoteContent(hxh, null), TODAY, 148);

		expect(updated).toContain("\nepisodes: 148\nepisodes_watched: 148\n");
		expect(updated).toContain(`\nwatch_date: ${TODAY}\nwatched: true\n`);
	});

	it("keeps the day it was first watched on", () => {
		const once = markAnimeWatched(buildAnimeNoteContent(hxh, null), "2020-02-02", 148);
		const again = markAnimeWatched(once, TODAY, 148);

		expect(again).toContain("watch_date: 2020-02-02");
		expect(again).not.toContain(TODAY);
	});

	it("counts an episode without touching watched until the last one", () => {
		const first = setAnimeProgress(buildAnimeNoteContent(hxh, null), 1, 148, TODAY);
		expect(first).toContain("episodes_watched: 1");
		expect(first).toContain("watched: false");

		const last = setAnimeProgress(first, 148, 148, TODAY);
		expect(last).toContain("watched: true");
		expect(last).toContain(`watch_date: ${TODAY}`);
	});

	it("keeps the count and the date a refresh from MAL would not know", () => {
		const watched = markAnimeWatched(buildAnimeNoteContent(hxh, null), TODAY, 148);
		const refreshed = refreshAnimeFrontmatter(watched, { ...hxh, episodes: 148 });

		expect(refreshed).toContain("episodes_watched: 148");
		expect(refreshed).toContain(`watch_date: ${TODAY}`);
	});
});

describe("the manga fields", () => {
	it("dates the reading and fills the chapter count in", () => {
		const updated = setMangaRead(mangaNote(), true, { date: TODAY, chapters: 3 });

		expect(updated).toContain("  chapters: 3\n  chapters_read: 3\n");
		expect(updated).toContain(`  read: true\n  read_date: ${TODAY}\n`);
	});

	it("takes the date away when the manga is unticked", () => {
		const read = setMangaRead(mangaNote(), true, { date: TODAY, chapters: 3 });
		const undone = setMangaRead(read, false);

		expect(undone).toContain("read: false");
		expect(undone).not.toContain("read_date");
		// How far the reader got is theirs, and stays.
		expect(undone).toContain("chapters_read: 3");
	});

	it("counts a chapter, and the last one finishes the manga", () => {
		const second = setMangaProgress(mangaNote(), 2, 3, TODAY);
		expect(second).toContain("chapters_read: 2");
		expect(second).toContain("read: false");

		const third = setMangaProgress(second, 3, 3, TODAY);
		expect(third).toContain("read: true");
		expect(third).toContain(`read_date: ${TODAY}`);
	});

	it("carries the reading over a refresh from MAL", () => {
		const read = setMangaProgress(mangaNote(), 2, 3, TODAY);
		const refreshed = applyMangaBlock(read, { ...berserk, chapters: 4 }, null, () => false);

		expect(refreshed).toContain("  chapters: 4\n  chapters_read: 2\n");
	});
});

describe("marking a note watched or read today", () => {
	it("dates a film and ticks it", async () => {
		const vault = new FakeApp({ "Films/Stalker (1979).md": buildNoteContent(stalker, null) });
		await filmActions(vault).markWatchedToday(vault.file("Films/Stalker (1979).md"));

		expect(vault.frontmatter("Films/Stalker (1979).md")).toMatchObject({
			watched: true,
			watch_date: TODAY,
		});
		expect(Notice.shown).toContain("Marked Stalker (1979) as watched today.");
	});

	it("says so rather than redating a film already watched", async () => {
		const vault = new FakeApp({ "Films/Stalker (1979).md": buildNoteContent(stalker, null) });
		const films = filmActions(vault);
		await films.markWatchedToday(vault.file("Films/Stalker (1979).md"));
		vi.setSystemTime(new Date("2026-10-01T10:00:00"));
		await films.markWatchedToday(vault.file("Films/Stalker (1979).md"));

		expect(vault.frontmatter("Films/Stalker (1979).md").watch_date).toBe(TODAY);
		expect(Notice.shown).toContain("Stalker (1979) was already watched.");
	});

	it("ticks an anime and completes its episodes", async () => {
		const vault = new FakeApp({ "Anime/Hunter x Hunter (2011).md": buildAnimeNoteContent(hxh, null) });
		await animeActions(vault).markWatchedToday(vault.file("Anime/Hunter x Hunter (2011).md"));

		expect(vault.frontmatter("Anime/Hunter x Hunter (2011).md")).toMatchObject({
			watched: true,
			watch_date: TODAY,
			episodes_watched: 148,
		});
	});

	it("marks the manga read on every note carrying it", async () => {
		const vault = new FakeApp({
			"Anime/Berserk (1997).md": applyMangaBlock(buildAnimeNoteContent(hxh, null), berserk, null, () => false),
			"Anime/Berserk.md": mangaNote(),
		});
		await animeActions(vault).markReadToday(vault.file("Anime/Berserk.md"));

		for (const path of ["Anime/Berserk (1997).md", "Anime/Berserk.md"]) {
			expect(vault.frontmatter(path).manga).toMatchObject({ read: true, read_date: TODAY, chapters_read: 3 });
		}
	});
});

describe("one more episode or chapter", () => {
	it("counts up, and finishes the anime on the last episode", async () => {
		const vault = new FakeApp({
			"Anime/Short.md": buildAnimeNoteContent({ ...hxh, episodes: 2 }, null),
		});
		const anime = animeActions(vault);
		const file = () => vault.file("Anime/Short.md");

		await anime.watchOneMoreEpisode(file());
		expect(vault.frontmatter("Anime/Short.md")).toMatchObject({ episodes_watched: 1, watched: false });
		expect(Notice.shown).toContain("Episode 1 of 2 watched.");

		await anime.watchOneMoreEpisode(file());
		expect(vault.frontmatter("Anime/Short.md")).toMatchObject({
			episodes_watched: 2,
			watched: true,
			watch_date: TODAY,
		});

		await anime.watchOneMoreEpisode(file());
		expect(Notice.shown).toContain("Short is already fully watched.");
	});

	it("counts an episode of an anime whose length MAL doesn't know", async () => {
		const vault = new FakeApp({ "Anime/Airing.md": buildAnimeNoteContent({ ...hxh, episodes: null }, null) });
		await animeActions(vault).watchOneMoreEpisode(vault.file("Anime/Airing.md"));

		expect(vault.frontmatter("Anime/Airing.md").episodes_watched).toBe(1);
		expect(Notice.shown).toContain("Episode 1 watched.");
	});

	/**
	 * One anime can sit on a note per manga it adapts — one for each part of a
	 * long series — and watching an episode of it is watching that episode,
	 * whichever of those notes is on screen.
	 */
	it("writes an episode to every note carrying the anime", async () => {
		const vault = new FakeApp({
			"Anime/Part 1.md": applyMangaBlock(buildAnimeNoteContent({ ...hxh, episodes: 2 }, null), berserk, null, () => false),
			"Anime/Part 2.md": buildAnimeNoteContent({ ...hxh, episodes: 2 }, null),
		});
		const anime = animeActions(vault);

		await anime.watchOneMoreEpisode(vault.file("Anime/Part 1.md"));
		for (const path of ["Anime/Part 1.md", "Anime/Part 2.md"]) {
			expect(vault.frontmatter(path)).toMatchObject({ episodes_watched: 1, watched: false });
		}

		// Finishing it finishes it everywhere, with the same date.
		await anime.watchOneMoreEpisode(vault.file("Anime/Part 2.md"));
		for (const path of ["Anime/Part 1.md", "Anime/Part 2.md"]) {
			expect(vault.frontmatter(path)).toMatchObject({ episodes_watched: 2, watched: true, watch_date: TODAY });
		}
		// The manga on the first note is untouched by any of it.
		expect(vault.frontmatter("Anime/Part 1.md").manga).toMatchObject({ read: false });
	});

	it("marks every note carrying the anime watched today", async () => {
		const vault = new FakeApp({
			"Anime/Part 1.md": buildAnimeNoteContent(hxh, null),
			"Anime/Part 2.md": buildAnimeNoteContent(hxh, null),
		});
		await animeActions(vault).markWatchedToday(vault.file("Anime/Part 1.md"));

		for (const path of ["Anime/Part 1.md", "Anime/Part 2.md"]) {
			expect(vault.frontmatter(path)).toMatchObject({ watched: true, watch_date: TODAY });
		}
	});

	it("writes a chapter to every note carrying the manga", async () => {
		const vault = new FakeApp({
			"Anime/Berserk (1997).md": applyMangaBlock(buildAnimeNoteContent(hxh, null), berserk, null, () => false),
			"Anime/Berserk.md": mangaNote(),
		});
		await animeActions(vault).readOneMoreChapter(vault.file("Anime/Berserk.md"));

		for (const path of ["Anime/Berserk (1997).md", "Anime/Berserk.md"]) {
			expect(vault.frontmatter(path).manga).toMatchObject({ chapters_read: 1, read: false });
		}
		expect(Notice.shown).toContain("Chapter 1 of 3 read.");
	});
});
