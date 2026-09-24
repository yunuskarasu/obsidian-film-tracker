import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimeActions } from "../src/anime-actions";
import { buildAnimeNoteContent } from "../src/anime-note";
import type { ConfirmAnswer } from "../src/confirm-modal";
import { buildDirectorNoteContent } from "../src/director-note";
import { FilmActions } from "../src/film-actions";
import { LetterboxdImporter } from "../src/letterboxd-importer";
import type { LinkChoice } from "../src/link-confirm-modal";
import type { AnimeMetadata, MangaMetadata } from "../src/mal";
import { applyMangaBlock } from "../src/manga-note";
import { buildNoteContent, type FilmMetadata } from "../src/note";
import type { FilmTrackerSettings } from "../src/settings";
import type { DirectorMetadata } from "../src/tmdb";
import { VaultNotes } from "../src/vault-notes";
import { FakeApp, fakeMal, fakeTmdb, fakeUi, settings } from "./fake-app";
import { Notice } from "./obsidian-stub";

/*
 * The plugin's commands end to end, against an in-memory vault (see
 * fake-app.ts): what gets written where, which note is opened, what the user
 * is told. TMDB, MyAnimeList and the dialogs answer from fixtures.
 */

const stalker: FilmMetadata = {
	title: "Stalker",
	originalTitle: "Сталкер",
	year: 1979,
	directors: ["Andrei Tarkovsky"],
	genres: ["Drama"],
	cast: [],
	composers: [],
	runtime: 162,
	tmdbId: 1398,
	posterPath: "/stalker.jpg",
};

const tarkovsky: DirectorMetadata = {
	name: "Andrei Tarkovsky",
	originalName: null,
	aliases: ["Andrei Tarkovsky"],
	alsoKnownAs: [],
	birthday: "1932-04-04",
	deathday: "1986-12-29",
	placeOfBirth: "Zavrazhye, USSR",
	tmdbId: 8452,
	photoPath: "/tarkovsky.jpg",
};

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

const hxh2011: AnimeMetadata = {
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
	posterUrl: "https://cdn.example/hxh-2011.jpg",
};

const hxh1999: AnimeMetadata = {
	...hxh2011,
	title: "Hunter x Hunter",
	episodes: 62,
	studios: ["Nippon Animation"],
	year: 1999,
	malId: 136,
	posterUrl: "https://cdn.example/hxh-1999.jpg",
};

const never = () => false;
const MANGA_POSTER = "Hunter x Hunter (Manga).jpg";

const mangaOnly = applyMangaBlock("---\n---\n", hxhManga, `[[${MANGA_POSTER}]]`, never);
const animeOnly = (anime: AnimeMetadata) => buildAnimeNoteContent(anime, `[[${anime.title}.jpg]]`);
const series = (anime: AnimeMetadata) => applyMangaBlock(animeOnly(anime), hxhManga, `[[${MANGA_POSTER}]]`, never);

function films(vault: FakeApp, overrides: Partial<FilmTrackerSettings> = {}): FilmActions {
	return new FilmActions(vault.app, new VaultNotes(vault.app), settings(overrides));
}

function anime(vault: FakeApp, choice: LinkChoice | null = "link", answer: ConfirmAnswer = { option: false }) {
	const { ui, asked, confirmed } = fakeUi(choice, answer);
	return { actions: new AnimeActions(vault.app, new VaultNotes(vault.app), settings(), ui), asked, confirmed };
}

beforeEach(() => {
	Notice.shown.length = 0;
});

describe("adding and refreshing films and directors", () => {
	it("adds a film with a wikilinked poster, and opens it", async () => {
		const vault = new FakeApp();
		await films(vault).addFilm(fakeTmdb({ films: [stalker] }), { id: 1398, title: "Stalker", originalTitle: "Сталкер", year: 1979 });

		expect(vault.frontmatter("Films/Stalker (1979).md")).toMatchObject({
			tmdb_id: 1398,
			poster: "[[Stalker (1979).jpg]]",
			watched: false,
		});
		expect(vault.images.has("Stalker (1979).jpg")).toBe(true);
		expect(vault.opened).toEqual(["Films/Stalker (1979).md"]);
	});

	it("finds a film already in the vault, whatever folder it was moved to", async () => {
		const vault = new FakeApp({ "Archive/Stalker (1979).md": buildNoteContent(stalker, null) });
		await films(vault).addFilm(fakeTmdb({ films: [stalker] }), { id: 1398, title: "Stalker", originalTitle: "Сталкер", year: 1979 });

		expect([...vault.notes.keys()]).toEqual(["Archive/Stalker (1979).md"]);
		expect(Notice.shown).toContain("Already in your vault: Stalker (1979)");
		expect(vault.opened).toEqual(["Archive/Stalker (1979).md"]);
	});

	it("never takes a director whose TMDB id equals the film's for that film", async () => {
		const vault = new FakeApp({
			"Directors/Someone.md": buildDirectorNoteContent({ ...tarkovsky, name: "Someone", tmdbId: 1398 }, null),
		});
		await films(vault).addFilm(fakeTmdb({ films: [stalker] }), { id: 1398, title: "Stalker", originalTitle: "Сталкер", year: 1979 });

		expect(vault.notes.has("Films/Stalker (1979).md")).toBe(true);
	});

	/** Regression (H1): with the Director folder empty, this refresh used to fetch *film* 8452 and write it into the director note. */
	it("refreshes a director at the vault root as a director", async () => {
		const vault = new FakeApp({ "Andrei Tarkovsky.md": buildDirectorNoteContent(tarkovsky, null) });
		const client = fakeTmdb({
			people: [{ ...tarkovsky, deathday: "1986-12-30" }],
			films: [{ ...stalker, title: "A film that shares the number", tmdbId: 8452 }],
		});
		await films(vault, { directorFolder: "" }).refresh(client, vault.file("Andrei Tarkovsky.md"));

		const frontmatter = vault.frontmatter("Andrei Tarkovsky.md");
		expect(frontmatter.deathday).toBe("1986-12-30");
		expect(frontmatter).not.toHaveProperty("title");
		expect(frontmatter).not.toHaveProperty("directors");
		expect(client.calls).not.toContain("getFilm 8452");
	});

	it("keeps an alias the user added when a film is refreshed", async () => {
		const note = buildNoteContent(stalker, null).replace("  - Сталкер\n", "  - Сталкер\n  - Сталкер (фильм)\n");
		const vault = new FakeApp({ "Films/Stalker (1979).md": note });
		await films(vault).refresh(fakeTmdb({ films: [stalker] }), vault.file("Films/Stalker (1979).md"));

		expect(vault.frontmatter("Films/Stalker (1979).md").aliases).toEqual(["Stalker", "Сталкер", "Сталкер (фильм)"]);
		expect(Notice.shown).toContain("Refreshed Stalker");
	});

	it("gives a different film with the same title and year the next free name", async () => {
		const vault = new FakeApp({ "Films/Stalker (1979).md": buildNoteContent({ ...stalker, tmdbId: 1 }, null) });
		await films(vault).addFilm(fakeTmdb({ films: [stalker] }), { id: 1398, title: "Stalker", originalTitle: "Сталкер", year: 1979 });

		expect(vault.frontmatter("Films/Stalker (1979) 2.md").tmdb_id).toBe(1398);
	});

	it("never writes a film note beside a note of the user's own with its name", async () => {
		const vault = new FakeApp({ "Films/Stalker (1979).md": "My own notes on Stalker.\n" });
		await films(vault).addFilm(fakeTmdb({ films: [stalker] }), { id: 1398, title: "Stalker", originalTitle: "Сталкер", year: 1979 });

		expect([...vault.notes.keys()]).toEqual(["Films/Stalker (1979).md"]);
		expect(Notice.shown).toContain("A note already exists at Films/Stalker (1979).md");
		expect(vault.opened).toEqual(["Films/Stalker (1979).md"]);
	});

	it("says so, instead of reporting success, when a note's frontmatter can't be read", async () => {
		const vault = new FakeApp({ "Plain.md": "No frontmatter here.\n" });
		const readable = await new VaultNotes(vault.app).rewriteFrontmatter(vault.file("Plain.md"), (content) => `${content}!`);

		expect(readable).toBe(false);
		expect(vault.note("Plain.md")).toBe("No frontmatter here.\n");
		expect(Notice.shown).toEqual(["Could not read the properties of Plain, so it was left unchanged."]);
	});
});

describe("linking anime and manga", () => {
	it("links an anime into the manga-only note on screen, once the user confirms", async () => {
		const vault = new FakeApp({ "Anime/Hunter x Hunter.md": mangaOnly }, [MANGA_POSTER]);
		vault.show("Anime/Hunter x Hunter.md");
		const { actions, asked } = anime(vault, "link");
		await actions.addAnime(fakeMal({ anime: [hxh2011] }), { id: 11061, title: "", year: null, mediaType: null });

		expect(asked).toEqual([{ workTitle: "Hunter x Hunter (2011)", side: "anime", noteName: "Hunter x Hunter", alsoIn: [] }]);
		expect(vault.frontmatter("Anime/Hunter x Hunter.md")).toMatchObject({ mal_id: 11061, manga: { mal_id: 26 } });
		expect(Notice.shown).toContain("Linked Hunter x Hunter (2011) to Hunter x Hunter");
	});

	it("gives the anime a note of its own when the user chooses that", async () => {
		const vault = new FakeApp({ "Anime/Hunter x Hunter.md": mangaOnly });
		vault.show("Anime/Hunter x Hunter.md");
		await anime(vault, "separate").actions.addAnime(fakeMal({ anime: [hxh2011] }), { id: 11061, title: "", year: null, mediaType: null });

		expect(vault.note("Anime/Hunter x Hunter.md")).toBe(mangaOnly);
		expect(vault.frontmatter("Anime/Hunter x Hunter (2011).md").mal_id).toBe(11061);
	});

	it("does nothing when the dialog is dismissed", async () => {
		const vault = new FakeApp({ "Anime/Hunter x Hunter.md": mangaOnly });
		vault.show("Anime/Hunter x Hunter.md");
		await anime(vault, null).actions.addAnime(fakeMal({ anime: [hxh2011] }), { id: 11061, title: "", year: null, mediaType: null });

		expect([...vault.notes.keys()]).toEqual(["Anime/Hunter x Hunter.md"]);
		expect(vault.note("Anime/Hunter x Hunter.md")).toBe(mangaOnly);
	});

	/** Regression (M4): the last note used was linked into even while Graph view had the focus. */
	it("never links into a note that isn't on screen", async () => {
		const vault = new FakeApp({ "Anime/Hunter x Hunter.md": mangaOnly });
		vault.show("Anime/Hunter x Hunter.md");
		vault.visible = null;
		const { actions, asked } = anime(vault, "link");
		await actions.addAnime(fakeMal({ anime: [hxh2011] }), { id: 11061, title: "", year: null, mediaType: null });

		expect(asked).toEqual([]);
		expect(vault.note("Anime/Hunter x Hunter.md")).toBe(mangaOnly);
		expect(vault.notes.has("Anime/Hunter x Hunter (2011).md")).toBe(true);
	});

	it("opens the note that already pairs the two, rather than pairing them twice", async () => {
		const vault = new FakeApp({ "Anime/Hunter x Hunter (2011).md": series(hxh2011), "Anime/Hunter x Hunter.md": mangaOnly });
		vault.show("Anime/Hunter x Hunter.md");
		const { actions, asked } = anime(vault, "link");
		await actions.addAnime(fakeMal({ anime: [hxh2011] }), { id: 11061, title: "", year: null, mediaType: null });

		expect(asked).toEqual([]);
		expect(vault.note("Anime/Hunter x Hunter.md")).toBe(mangaOnly);
		expect(Notice.shown).toContain("Already linked in Hunter x Hunter (2011)");
		expect(vault.opened).toEqual(["Anime/Hunter x Hunter (2011).md"]);
	});

	it("links a manga already on another note, in step with it: its poster and its read", async () => {
		const vault = new FakeApp(
			{
				"Anime/Hunter x Hunter (1999).md": series(hxh1999).replace("read: false", "read: true"),
				"Anime/Hunter x Hunter (2011).md": animeOnly(hxh2011),
			},
			[MANGA_POSTER],
		);
		vault.show("Anime/Hunter x Hunter (2011).md");
		const client = fakeMal({ manga: [hxhManga] });
		const { actions, asked } = anime(vault, "link");
		await actions.addManga(client, { id: 26, title: "", year: null, mediaType: null });

		expect(asked[0].alsoIn).toEqual(["Hunter x Hunter (1999)"]);
		expect(vault.frontmatter("Anime/Hunter x Hunter (2011).md").manga).toMatchObject({
			mal_id: 26,
			read: true,
			poster: `[[${MANGA_POSTER}]]`,
		});
		expect(client.calls).not.toContain(`download ${hxhManga.posterUrl}`);
	});

	it("names a manga-only note after its title, adding the year only when another work has the name", async () => {
		const other: MangaMetadata = { ...hxhManga, malId: 999, year: 2004, mediaType: "light_novel" };
		const vault = new FakeApp({ "Anime/Hunter x Hunter.md": mangaOnly });
		await anime(vault).actions.addManga(fakeMal({ manga: [other] }), { id: 999, title: "", year: null, mediaType: null });

		expect(vault.frontmatter("Anime/Hunter x Hunter (2004).md").manga).toMatchObject({ mal_id: 999 });
	});

	/** Regression: MAL's "Hunter x Hunter (2011)" used to become "Hunter x Hunter (2011) (2011)". */
	it("writes the year MyAnimeList already put in a title only once", async () => {
		const vault = new FakeApp();
		await anime(vault).actions.addAnime(fakeMal({ anime: [hxh2011] }), { id: 11061, title: "", year: null, mediaType: null });

		expect(vault.frontmatter("Anime/Hunter x Hunter (2011).md").poster).toBe("[[Hunter x Hunter (2011).jpg]]");
	});
});

describe("Add adaptation", () => {
	it("gives a new anime its own note, carrying the manga and its poster", async () => {
		const vault = new FakeApp({ "Anime/Hunter x Hunter (2011).md": series(hxh2011) }, [MANGA_POSTER]);
		const client = fakeMal({ anime: [hxh1999], manga: [hxhManga] });
		await anime(vault).actions.addAdaptation(client, { id: 136, title: "", year: null, mediaType: null }, vault.file("Anime/Hunter x Hunter (2011).md"), 26);

		expect(vault.frontmatter("Anime/Hunter x Hunter (1999).md")).toMatchObject({
			mal_id: 136,
			manga: { mal_id: 26, poster: `[[${MANGA_POSTER}]]` },
		});
		expect(client.calls).not.toContain(`download ${hxhManga.posterUrl}`);
		expect(Notice.shown).toContain("Added Hunter x Hunter as another adaptation of Hunter x Hunter");
	});

	it("adds the manga to the anime's existing anime-only note instead", async () => {
		const vault = new FakeApp({
			"Anime/Hunter x Hunter (2011).md": series(hxh2011),
			"Anime/Hunter x Hunter (1999).md": animeOnly(hxh1999),
		});
		await anime(vault).actions.addAdaptation(fakeMal({ anime: [hxh1999], manga: [hxhManga] }), { id: 136, title: "", year: null, mediaType: null }, vault.file("Anime/Hunter x Hunter (2011).md"), 26);

		expect(vault.notes.size).toBe(2);
		expect(vault.frontmatter("Anime/Hunter x Hunter (1999).md").manga).toMatchObject({ mal_id: 26 });
	});

	/**
	 * Regression: the pairing used to go to whichever anime-only note already
	 * had that anime, so someone on a manga note — one part of a long series,
	 * say — got the adaptation written somewhere else entirely.
	 */
	it("still links into the note it was added from when the anime is on another note", async () => {
		const vault = new FakeApp({
			"Anime/Hunter x Hunter.md": mangaOnly,
			"Anime/Hunter x Hunter (2011).md": animeOnly(hxh2011),
		});
		await anime(vault).actions.addAdaptation(
			fakeMal({ anime: [hxh2011], manga: [hxhManga] }),
			{ id: 11061, title: "", year: null, mediaType: null },
			vault.file("Anime/Hunter x Hunter.md"),
			26,
		);

		expect(vault.frontmatter("Anime/Hunter x Hunter.md")).toMatchObject({ mal_id: 11061, manga: { mal_id: 26 } });
		// The other note keeps the anime and gains no manga.
		expect(vault.frontmatter("Anime/Hunter x Hunter (2011).md").manga).toBeUndefined();
		expect(vault.notes.size).toBe(2);
	});

	it("links the anime into the manga-only note it was added from", async () => {
		const vault = new FakeApp({ "Anime/Hunter x Hunter.md": mangaOnly });
		await anime(vault).actions.addAdaptation(fakeMal({ anime: [hxh2011], manga: [hxhManga] }), { id: 11061, title: "", year: null, mediaType: null }, vault.file("Anime/Hunter x Hunter.md"), 26);

		expect(vault.notes.size).toBe(1);
		expect(vault.frontmatter("Anime/Hunter x Hunter.md")).toMatchObject({ mal_id: 11061, manga: { mal_id: 26 } });
	});
});

describe("Remove manga and Change manga", () => {
	const HXH_2011 = "Anime/Hunter x Hunter (2011).md";
	const yuyu: MangaMetadata = { ...hxhManga, title: "Yuu Yuu Hakusho", malId: 53, posterUrl: "https://cdn.example/yuyu.jpg" };

	it("asks first, and changes nothing when the user cancels", async () => {
		const vault = new FakeApp({ [HXH_2011]: series(hxh2011) }, [MANGA_POSTER]);
		const before = vault.note(HXH_2011);
		const { actions, confirmed } = anime(vault, "link", null);
		await actions.removeManga(vault.file(HXH_2011));

		expect(confirmed[0]).toMatchObject({ title: "Remove the manga?", confirmLabel: "Remove" });
		expect(confirmed[0].message).toContain("This removes Hunter x Hunter from Hunter x Hunter (2011)");
		expect(vault.note(HXH_2011)).toBe(before);
		expect(vault.images.has(MANGA_POSTER)).toBe(true);
	});

	it("removes only the manga, keeping its poster unless the user ticks the toggle", async () => {
		const vault = new FakeApp({ [HXH_2011]: series(hxh2011) }, [MANGA_POSTER]);
		const { actions, confirmed } = anime(vault, "link", { option: false });
		await actions.removeManga(vault.file(HXH_2011));

		expect(confirmed[0].option?.desc).toContain(`No other note uses ${MANGA_POSTER}.`);
		expect(vault.frontmatter(HXH_2011)).not.toHaveProperty("manga");
		expect(vault.frontmatter(HXH_2011)).toMatchObject({ mal_id: 11061, poster: "[[Hunter x Hunter (2011).jpg]]" });
		expect(vault.images.has(MANGA_POSTER)).toBe(true);
		expect(Notice.shown).toContain("Removed the manga from Hunter x Hunter (2011)");
	});

	it("deletes the poster along with the manga when asked to", async () => {
		const vault = new FakeApp({ [HXH_2011]: series(hxh2011) }, [MANGA_POSTER, "Hunter x Hunter (2011).jpg"]);
		await anime(vault, "link", { option: true }).actions.removeManga(vault.file(HXH_2011));

		expect(vault.images.has(MANGA_POSTER)).toBe(false);
		expect(vault.images.has("Hunter x Hunter (2011).jpg")).toBe(true);
		expect(Notice.shown).toContain("Removed the manga and its poster from Hunter x Hunter (2011)");
	});

	it("never offers a poster another adaptation, another note or the note's own text still uses", async () => {
		const uses = {
			"another adaptation": { "Anime/Hunter x Hunter (1999).md": series(hxh1999) },
			"a link in another note": { "Covers.md": `Best cover: [[${MANGA_POSTER}]]\n` },
			"an embed in the note itself": { [HXH_2011]: `${series(hxh2011)}\n![[${MANGA_POSTER}]]\n` },
		};
		for (const [use, notes] of Object.entries(uses)) {
			const vault = new FakeApp({ [HXH_2011]: series(hxh2011), ...notes }, [MANGA_POSTER]);
			const { actions, confirmed } = anime(vault, "link", { option: true });
			await actions.removeManga(vault.file(HXH_2011));

			expect(confirmed[0].option, use).toBeUndefined();
			expect(vault.images.has(MANGA_POSTER), use).toBe(true);
			expect(vault.frontmatter(HXH_2011), use).not.toHaveProperty("manga");
		}
	});

	it("offers to delete the old manga's poster after Change manga", async () => {
		const vault = new FakeApp({ [HXH_2011]: series(hxh2011) }, [MANGA_POSTER]);
		const { actions, confirmed } = anime(vault, "link", { option: false });
		await actions.changeManga(fakeMal({ manga: [yuyu] }), { id: 53, title: "", year: null, mediaType: null }, vault.file(HXH_2011));

		expect(vault.frontmatter(HXH_2011).manga).toMatchObject({ mal_id: 53, poster: "[[Yuu Yuu Hakusho (Manga).jpg]]" });
		expect(confirmed[0]).toMatchObject({ title: "Delete the old poster?", confirmLabel: "Delete", cancelLabel: "Keep" });
		expect(vault.images.has(MANGA_POSTER)).toBe(false);
	});

	it("keeps the old poster when the user says Keep, and asks nothing when another note still uses it", async () => {
		const kept = new FakeApp({ [HXH_2011]: series(hxh2011) }, [MANGA_POSTER]);
		await anime(kept, "link", null).actions.changeManga(fakeMal({ manga: [yuyu] }), { id: 53, title: "", year: null, mediaType: null }, kept.file(HXH_2011));
		expect(kept.images.has(MANGA_POSTER)).toBe(true);

		const shared = new FakeApp({ [HXH_2011]: series(hxh2011), "Anime/Hunter x Hunter (1999).md": series(hxh1999) }, [MANGA_POSTER]);
		const { actions, confirmed } = anime(shared, "link", { option: false });
		await actions.changeManga(fakeMal({ manga: [yuyu] }), { id: 53, title: "", year: null, mediaType: null }, shared.file(HXH_2011));
		expect(confirmed).toEqual([]);
		expect(shared.images.has(MANGA_POSTER)).toBe(true);
	});
});

describe("Read on a manga carried by several notes", () => {
	it("is set on every note that carries it, and on no other", async () => {
		const yuyu: MangaMetadata = { ...hxhManga, title: "Yuu Yuu Hakusho", malId: 53 };
		const vault = new FakeApp({
			"Anime/Hunter x Hunter (1999).md": series(hxh1999),
			"Anime/Hunter x Hunter (2011).md": series(hxh2011),
			"Anime/Yuu Yuu Hakusho.md": applyMangaBlock("---\n---\n", yuyu, null, never),
		});
		await anime(vault).actions.syncMangaRead(vault.file("Anime/Hunter x Hunter (2011).md"), true);

		expect(vault.frontmatter("Anime/Hunter x Hunter (1999).md").manga).toMatchObject({ read: true });
		expect(vault.frontmatter("Anime/Hunter x Hunter (2011).md").manga).toMatchObject({ read: true });
		expect(vault.frontmatter("Anime/Yuu Yuu Hakusho.md").manga).toMatchObject({ read: false });
	});
});

describe("Letterboxd import rows", () => {
	const importer = (vault: FakeApp) => {
		const notes = new VaultNotes(vault.app);
		return new LetterboxdImporter(vault.app, notes, new FilmActions(vault.app, notes, settings()));
	};
	const searchStalker = () => [{ id: 1398, title: "Stalker", originalTitle: "Сталкер", year: 1979 }];

	it("creates a diary row's film a year off, watched and dated", async () => {
		const vault = new FakeApp();
		const outcome = await importer(vault).importRow(
			fakeTmdb({ films: [stalker], search: searchStalker }),
			{ name: "Stalker", year: 1980, watchedDate: "2024-03-01" },
			true,
		);

		expect(outcome).toBe("imported");
		expect(vault.frontmatter("Films/Stalker (1979).md")).toMatchObject({ watch_date: "2024-03-01", watched: true });
	});

	it("fills in a film already in the vault instead of adding it twice", async () => {
		const vault = new FakeApp({ "Films/Stalker (1979).md": buildNoteContent(stalker, null) });
		const outcome = await importer(vault).importRow(
			fakeTmdb({ films: [stalker], search: searchStalker }),
			{ name: "Stalker", year: 1979, watchedDate: "2024-03-01" },
			true,
		);

		expect(outcome).toBe("skipped");
		expect(vault.notes.size).toBe(1);
		expect(vault.frontmatter("Films/Stalker (1979).md")).toMatchObject({ watch_date: "2024-03-01", watched: true });
	});

	it("refuses a row with nothing within a year, rather than guessing", async () => {
		const vault = new FakeApp();
		await expect(
			importer(vault).importRow(
				fakeTmdb({ films: [stalker], search: searchStalker }),
				{ name: "Stalker", year: 1990, watchedDate: null },
				true,
			),
		).rejects.toThrow('No TMDB match found for "Stalker" within a year of 1990.');
		expect(vault.notes.size).toBe(0);
	});
});

describe("a Letterboxd import run", () => {
	beforeEach(() => {
		// The pause between rows is a `window` timer, as Obsidian wants.
		vi.stubGlobal("window", { setTimeout });
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("stops before the next row once cancelled, and turns a second import away meanwhile", async () => {
		const vault = new FakeApp();
		const notes = new VaultNotes(vault.app);
		const importer = new LetterboxdImporter(vault.app, notes, new FilmActions(vault.app, notes, settings()));
		const client = fakeTmdb({ films: [stalker], search: () => [{ id: 1398, title: "Stalker", originalTitle: "", year: 1979 }] });
		const rows = [
			{ name: "Stalker", year: 1979, watchedDate: null },
			{ name: "Solaris", year: 1972, watchedDate: null },
		];
		let cancelled = false;
		let closed = false;
		const progress = {
			isCancelled: () => cancelled,
			// The user closes the dialog while the first row is being imported.
			setStatus: () => {
				cancelled = true;
			},
			close: () => {
				closed = true;
			},
		};

		const first = importer.run(client, rows, false, progress);
		expect(importer.running).toBe(true);
		await expect(importer.run(client, rows, false, progress)).rejects.toThrow("already running");
		await first;

		expect(importer.running).toBe(false);
		expect(closed).toBe(true);
		expect(client.calls.filter((call) => call.startsWith("search"))).toEqual(["search Stalker 1979"]);
		expect(Notice.shown).toContain("Imported 1, skipped 0 duplicates, 0 not matched (cancelled).");
	});
});
