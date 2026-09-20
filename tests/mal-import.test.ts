import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimeActions } from "../src/anime-actions";
import { buildAnimeNoteContent } from "../src/anime-note";
import type { ImportProgress } from "../src/letterboxd-importer";
import { MalError, type AnimeMetadata, type MalListEntry, type MangaMetadata } from "../src/mal";
import { MalListImporter, type MalListSelection } from "../src/mal-importer";
import { applyMangaBlock } from "../src/manga-note";
import { VaultNotes } from "../src/vault-notes";
import { FakeApp, fakeMal, fakeUi, settings } from "./fake-app";
import { Notice } from "./obsidian-stub";

/*
 * Import from MyAnimeList, against the in-memory vault (see fake-app.ts):
 * which entries become notes, what arrives watched or read, and what a list
 * that can't be read or an import that is cancelled leave behind.
 */

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

const monster: AnimeMetadata = { ...hxh, title: "Monster", malId: 19, year: 2004, endYear: 2005 };

const hxhManga: MangaMetadata = {
	title: "Hunter x Hunter",
	mediaType: "manga",
	status: "currently_publishing",
	year: 1998,
	endYear: null,
	chapters: null,
	volumes: null,
	mangaka: [{ name: "Yoshihiro Togashi", malId: 1893 }],
	malId: 26,
	posterUrl: "https://cdn.example/hxh-manga.jpg",
};

const entry = <T>(work: T, listStatus: string | null): MalListEntry<T> => ({ work, listStatus });

const EVERYTHING: MalListSelection = {
	anime: true,
	manga: true,
	statuses: ["completed", "watching", "reading", "plan_to_watch", "plan_to_read"],
};

const COMPLETED: MalListSelection = { anime: true, manga: true, statuses: ["completed"] };

/** A progress dialog that records what it was told, and can be cancelled after N entries. */
function fakeProgress(cancelAfter = Number.POSITIVE_INFINITY) {
	const shown: string[] = [];
	let cancelled = false;
	const progress: ImportProgress = {
		isCancelled: () => cancelled,
		setStatus: (text) => {
			shown.push(text);
			if (shown.length >= cancelAfter) cancelled = true;
		},
		close: () => {
			cancelled = true;
		},
	};
	return { progress, shown };
}

function importerFor(vault: FakeApp) {
	const notes = new VaultNotes(vault.app);
	const anime = new AnimeActions(vault.app, notes, settings(), fakeUi("link").ui);
	return new MalListImporter(vault.app, notes, anime);
}

beforeEach(() => {
	Notice.shown.length = 0;
	// The pause between new notes is a `window` timer, as Obsidian wants.
	vi.stubGlobal("window", { setTimeout });
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("importing a MyAnimeList list", () => {
	it("writes a note for each entry, watched or read where the list says completed", async () => {
		const vault = new FakeApp();
		const client = fakeMal({
			animeList: [entry(hxh, "completed"), entry(monster, "watching")],
			mangaList: [entry(hxhManga, "completed")],
		});
		await importerFor(vault).run(client, "malfan", EVERYTHING, fakeProgress().progress);

		expect(vault.frontmatter("Anime/Hunter x Hunter (2011).md")).toMatchObject({ mal_id: 11061, watched: true });
		expect(vault.frontmatter("Anime/Monster (2004).md")).toMatchObject({ mal_id: 19, watched: false });
		expect(vault.frontmatter("Anime/Hunter x Hunter.md").manga).toMatchObject({ mal_id: 26, read: true });
		expect(Notice.shown).toContain("Added 3, updated 0, skipped 0.");
	});

	it("takes only the shelves that were picked", async () => {
		const vault = new FakeApp();
		const client = fakeMal({
			animeList: [entry(hxh, "completed"), entry(monster, "plan_to_watch")],
			mangaList: [entry(hxhManga, "dropped")],
		});
		await importerFor(vault).run(client, "malfan", COMPLETED, fakeProgress().progress);

		expect([...vault.notes.keys()]).toEqual(["Anime/Hunter x Hunter (2011).md"]);
	});

	it("leaves a note it already has alone, but ticks it when the list says completed", async () => {
		const vault = new FakeApp({
			"Anime/Hunter x Hunter (2011).md": buildAnimeNoteContent(hxh, null),
			"Anime/Monster.md": buildAnimeNoteContent(monster, null).replace("watched: false", "watched: true"),
		});
		const client = fakeMal({ animeList: [entry(hxh, "completed"), entry(monster, "completed")] });
		await importerFor(vault).run(client, "malfan", COMPLETED, fakeProgress().progress);

		expect(vault.notes.size).toBe(2);
		expect(vault.frontmatter("Anime/Hunter x Hunter (2011).md").watched).toBe(true);
		expect(Notice.shown).toContain("Added 0, updated 1, skipped 1.");
		expect(client.calls).not.toContain(`download ${hxh.posterUrl}`);
	});

	it("marks a manga read on every note that carries it", async () => {
		const both = applyMangaBlock(buildAnimeNoteContent(hxh, null), hxhManga, null, () => false);
		const vault = new FakeApp({
			"Anime/Hunter x Hunter (2011).md": both,
			"Anime/Hunter x Hunter (1999).md": applyMangaBlock("---\n---\n", hxhManga, null, () => false),
		});
		await importerFor(vault).run(
			fakeMal({ mangaList: [entry(hxhManga, "completed")] }),
			"malfan",
			COMPLETED,
			fakeProgress().progress,
		);

		expect(vault.frontmatter("Anime/Hunter x Hunter (2011).md").manga).toMatchObject({ read: true });
		expect(vault.frontmatter("Anime/Hunter x Hunter (1999).md").manga).toMatchObject({ read: true });
	});

	it("fetches an entry MAL sent back without its fields", async () => {
		const thin: AnimeMetadata = { ...hxh, mediaType: null, episodes: null, genres: [], studios: [] };
		const vault = new FakeApp();
		const client = fakeMal({ anime: [hxh], animeList: [entry(thin, "completed")] });
		await importerFor(vault).run(client, "malfan", COMPLETED, fakeProgress().progress);

		expect(client.calls).toContain("getAnime 11061");
		expect(vault.frontmatter("Anime/Hunter x Hunter (2011).md").media_type).toBe("tv");
	});

	it("works through a list one page at a time", async () => {
		const vault = new FakeApp();
		const client = fakeMal({
			animeList: [entry(hxh, "completed"), entry(monster, "completed")],
			pageSize: 1,
		});
		await importerFor(vault).run(client, "malfan", COMPLETED, fakeProgress().progress);

		expect(client.calls.filter((call) => call.startsWith("animeList"))).toEqual([
			"animeList malfan 0",
			"animeList malfan 1",
		]);
		expect(vault.notes.size).toBe(2);
	});

	it("stops where it was cancelled", async () => {
		const vault = new FakeApp();
		const client = fakeMal({ animeList: [entry(hxh, "completed"), entry(monster, "completed")] });
		const { progress, shown } = fakeProgress(1);
		await importerFor(vault).run(client, "malfan", COMPLETED, progress);

		expect(shown).toEqual(["Anime 1: Hunter x Hunter (2011)"]);
		expect([...vault.notes.keys()]).toEqual(["Anime/Hunter x Hunter (2011).md"]);
		expect(Notice.shown).toContain("Added 1, updated 0, skipped 0 (cancelled).");
	});

	it("says so, and writes nothing, when the list can't be read", async () => {
		const vault = new FakeApp();
		const client = fakeMal({ listError: new MalError("malfan's list on MyAnimeList isn't public.") });
		await importerFor(vault).run(client, "malfan", COMPLETED, fakeProgress().progress);

		expect(vault.notes.size).toBe(0);
		expect(Notice.shown).toContain("malfan's list on MyAnimeList isn't public.");
	});

	it("reports an entry whose name a note of the user's own already has", async () => {
		const vault = new FakeApp({ "Anime/Monster (2004).md": "My own notes about Monster.\n" });
		await importerFor(vault).run(
			fakeMal({ animeList: [entry(monster, "completed")] }),
			"malfan",
			COMPLETED,
			fakeProgress().progress,
		);

		const report = vault.note("Film + Anime-Manga Tracker Import Report.md");
		expect(report).toContain("Left out: 1");
		expect(report).toContain('A note of your own is already called "Monster".');
		expect(Notice.shown).toContain("Added 0, updated 0, skipped 0, 1 left out.");
	});

	it("turns a second import away while one is running", async () => {
		const vault = new FakeApp();
		const client = fakeMal({ animeList: [entry(hxh, "completed")] });
		const importer = importerFor(vault);

		const first = importer.run(client, "malfan", COMPLETED, fakeProgress().progress);
		expect(importer.running).toBe(true);
		await expect(importer.run(client, "malfan", COMPLETED, fakeProgress().progress)).rejects.toThrow(
			"already running",
		);
		await first;
		expect(importer.running).toBe(false);
	});
});
