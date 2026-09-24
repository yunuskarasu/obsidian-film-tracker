import { beforeEach, describe, expect, it } from "vitest";
import { AnimeActions } from "../src/anime-actions";
import { buildAnimeNoteContent, removeAnimeFields } from "../src/anime-note";
import type { AnimeMetadata, MangaMetadata } from "../src/mal";
import { applyMangaBlock } from "../src/manga-note";
import { classifyNote } from "../src/note-kind";
import { VaultNotes } from "../src/vault-notes";
import { FakeApp, fakeUi, settings } from "./fake-app";
import { Notice } from "./obsidian-stub";

/*
 * Remove anime is the manga side's own command turned around: it takes the
 * anime's properties off a note and touches nothing else — not the manga, not
 * a property the user added, and not a word of the body.
 */

const jojo: AnimeMetadata = {
	title: "JoJo no Kimyou na Bouken (TV)",
	englishTitle: "JoJo's Bizarre Adventure (2012)",
	japaneseTitle: "ジョジョの奇妙な冒険",
	mediaType: "tv",
	status: "finished_airing",
	episodes: 26,
	genres: ["Action"],
	studios: ["David Production"],
	year: 2012,
	endYear: 2013,
	malId: 14719,
	posterUrl: "https://cdn.example/jojo.jpg",
};

const partOne: MangaMetadata = {
	title: "JoJo no Kimyou na Bouken Part 1: Phantom Blood",
	mediaType: "manga",
	status: "finished",
	year: 1986,
	endYear: 1987,
	chapters: 44,
	volumes: 5,
	mangaka: [{ name: "Hirohiko Araki", malId: 1866 }],
	malId: 610,
	posterUrl: "https://cdn.example/part1.jpg",
};

const BODY = "\n## My notes\n\nPart 1 is the one that sets the tone.\n";

/** A Series note with both sides, a property of the user's own, and a body. */
function seriesNote(): string {
	const anime = buildAnimeNoteContent(jojo, "[[JoJo (2012).jpg]]").replace(
		"watched: false",
		"watched: true\nmy_rating: 9",
	);
	return applyMangaBlock(anime, partOne, "[[Part 1.jpg]]", () => false) + BODY;
}

const PATH = "Seriler/JoJo/JoJo.md";

function setUp(notes: Record<string, string> = { [PATH]: seriesNote() }, images: string[] = ["JoJo (2012).jpg"]) {
	const app = new FakeApp(notes, images);
	const { ui, confirmed } = fakeUi(null, { option: false });
	const anime = new AnimeActions(app.app, new VaultNotes(app.app), settings(), ui);
	Notice.shown.length = 0;
	return { app, anime, confirmed };
}

beforeEach(() => {
	Notice.shown.length = 0;
});

describe("removeAnimeFields", () => {
	it("takes out what the plugin wrote and leaves everything else", () => {
		const left = removeAnimeFields(seriesNote());

		for (const key of ["title:", "media_type:", "episodes:", "studios:", "status:", "mal_id:", "poster:", "watched:"]) {
			expect(left, key).not.toContain(`\n${key}`);
		}
		expect(left).toContain("my_rating: 9");
		expect(left).toContain("manga:");
		expect(left).toContain("  mal_id: 610");
		expect(left).toContain(BODY.trim());
	});

	it("leaves the note as it is when there is no anime on it", () => {
		const mangaOnly = applyMangaBlock("---\n---\n", partOne, null, () => false);
		expect(removeAnimeFields(mangaOnly)).toBe(mangaOnly);
	});

	it("leaves a note whose properties can't be read alone", () => {
		expect(removeAnimeFields("no frontmatter here\n")).toBe("no frontmatter here\n");
	});
});

describe("Remove anime", () => {
	it("asks first, and a dismissed dialog changes nothing", async () => {
		const app = new FakeApp({ [PATH]: seriesNote() }, ["JoJo (2012).jpg"]);
		const { ui, confirmed } = fakeUi(null, null);
		const anime = new AnimeActions(app.app, new VaultNotes(app.app), settings(), ui);
		const before = app.note(PATH);
		await anime.removeAnime(app.file(PATH));

		expect(confirmed[0].title).toBe("Remove the anime?");
		expect(confirmed[0].message).toContain("only its anime properties are deleted");
		expect(confirmed[0].message).toContain("The manga and the rest of the note stay as they are.");
		expect(app.note(PATH)).toBe(before);
	});

	it("removes the anime and leaves the manga, the user's property and the body", async () => {
		const app = new FakeApp({ [PATH]: seriesNote() }, ["JoJo (2012).jpg"]);
		const anime = new AnimeActions(app.app, new VaultNotes(app.app), settings(), fakeUi(null, { option: false }).ui);
		await anime.removeAnime(app.file(PATH));

		const note = app.note(PATH);
		expect(classifyNote(app.frontmatter(PATH))).toEqual({ kind: "series", animeMalId: null, mangaMalId: 610 });
		expect(note).toContain("my_rating: 9");
		expect(note).toContain(BODY.trim());
		expect(app.images.has("JoJo (2012).jpg")).toBe(true);
		expect(Notice.shown).toEqual(["Removed the anime from JoJo"]);
	});

	it("offers to delete a poster no other note uses, and does when asked", async () => {
		const app = new FakeApp({ [PATH]: seriesNote() }, ["JoJo (2012).jpg", "Part 1.jpg"]);
		const { ui, confirmed } = fakeUi(null, { option: true });
		const anime = new AnimeActions(app.app, new VaultNotes(app.app), settings(), ui);
		await anime.removeAnime(app.file(PATH));

		expect(confirmed[0].option?.desc).toContain("JoJo (2012).jpg");
		expect(app.images.has("JoJo (2012).jpg")).toBe(false);
		// The manga's own poster is nobody's business here.
		expect(app.images.has("Part 1.jpg")).toBe(true);
		expect(Notice.shown).toEqual(["Removed the anime and its poster from JoJo"]);
	});

	it("never offers a poster another note is using", async () => {
		const other = "Anime/JoJo elsewhere.md";
		const app = new FakeApp(
			{ [PATH]: seriesNote(), [other]: buildAnimeNoteContent(jojo, "[[JoJo (2012).jpg]]") },
			["JoJo (2012).jpg"],
		);
		const { ui, confirmed } = fakeUi(null, { option: true });
		const anime = new AnimeActions(app.app, new VaultNotes(app.app), settings(), ui);
		await anime.removeAnime(app.file(PATH));

		expect(confirmed[0].option).toBeUndefined();
		expect(app.images.has("JoJo (2012).jpg")).toBe(true);
	});

	it("never offers a poster the manga side of the same note uses", async () => {
		const shared = seriesNote().replace("[[Part 1.jpg]]", "[[JoJo (2012).jpg]]");
		const { app, anime, confirmed } = setUp({ [PATH]: shared });
		await anime.removeAnime(app.file(PATH));

		expect(confirmed[0].option).toBeUndefined();
		expect(app.images.has("JoJo (2012).jpg")).toBe(true);
	});

	it("never offers a poster a property of the user's own links to", async () => {
		const linked = seriesNote().replace("my_rating: 9", 'my_rating: 9\ncover: "[[JoJo (2012).jpg]]"');
		const { app, anime, confirmed } = setUp({ [PATH]: linked });
		await anime.removeAnime(app.file(PATH));

		expect(confirmed[0].option).toBeUndefined();
		expect(app.note(PATH)).toContain('cover: "[[JoJo (2012).jpg]]"');
	});

	it("says so on a note with no anime, and writes nothing", async () => {
		const mangaOnly = applyMangaBlock("---\n---\n", partOne, null, () => false);
		const { app, anime } = setUp({ "Anime/Part 1.md": mangaOnly }, []);
		await anime.removeAnime(app.file("Anime/Part 1.md"));

		expect(app.note("Anime/Part 1.md")).toBe(mangaOnly);
		expect(Notice.shown).toEqual(["This note has no anime."]);
	});

	it("warns when nothing the plugin tracks would be left", async () => {
		const animeOnly = buildAnimeNoteContent(jojo, null);
		const { app, anime, confirmed } = setUp({ "Anime/JoJo.md": animeOnly }, []);
		await anime.removeAnime(app.file("Anime/JoJo.md"));

		expect(confirmed[0].message).toContain("a plain note the plugin no longer tracks");
	});
});
