import { describe, expect, it } from "vitest";
import { classifyNote, isAnimeOnlySeries, isMangaOnlySeries, matchesRef } from "../src/note-kind";

/** Each note type's frontmatter as the plugin writes it, cut down to the fields that matter here. */
const film = {
	title: "Stalker",
	original_title: "Сталкер",
	directors: ["Andrei Tarkovsky"],
	tmdb_id: 1398,
};
const director = {
	name: "Andrei Tarkovsky",
	original_name: "Андрей Арсеньевич Тарковский",
	aliases: ["Andrei Tarkovsky", "Андрей Арсеньевич Тарковский"],
	tmdb_id: 8452,
};
const animeOnly = {
	title: "Hunter x Hunter",
	media_type: "tv",
	episodes: 148,
	studios: ["Madhouse"],
	mal_id: 11061,
};
const mangaOnly = { manga: { mal_id: 26, title: "Hunter x Hunter" } };
const series = { ...animeOnly, manga: { mal_id: 26, title: "Hunter x Hunter" } };
const mangaka = { name: "Yoshihiro Togashi", birthday: "1966-04-27", mal_id: 1893 };

describe("classifyNote", () => {
	it("tells a film and a director apart by their own properties", () => {
		expect(classifyNote(film)).toEqual({ kind: "film", tmdbId: 1398 });
		expect(classifyNote(director)).toEqual({ kind: "director", tmdbId: 8452 });
	});

	it("tells an anime and a mangaka apart by their own properties", () => {
		expect(classifyNote(animeOnly)).toEqual({ kind: "series", animeMalId: 11061, mangaMalId: null });
		expect(classifyNote(mangaka)).toEqual({ kind: "mangaka", malId: 1893 });
	});

	it("reads both sides of a Series note", () => {
		expect(classifyNote(mangaOnly)).toEqual({ kind: "series", animeMalId: null, mangaMalId: 26 });
		expect(classifyNote(series)).toEqual({ kind: "series", animeMalId: 11061, mangaMalId: 26 });
	});

	it("keeps a person note a person when the user adds a title to it", () => {
		expect(classifyNote({ ...director, title: "Director" })).toEqual({ kind: "director", tmdbId: 8452 });
		expect(classifyNote({ ...mangaka, title: "Mangaka" })).toEqual({ kind: "mangaka", malId: 1893 });
	});

	it("keeps a work a work when the user adds a name to it", () => {
		expect(classifyNote({ ...film, name: "A favourite" })).toEqual({ kind: "film", tmdbId: 1398 });
		expect(classifyNote({ ...animeOnly, name: "HxH" })).toEqual({
			kind: "series",
			animeMalId: 11061,
			mangaMalId: null,
		});
	});

	it("still treats a person note whose name was cleared as a person", () => {
		expect(classifyNote({ ...director, name: null })).toEqual({ kind: "director", tmdbId: 8452 });
		expect(classifyNote({ ...mangaka, name: null })).toEqual({ kind: "mangaka", malId: 1893 });
	});

	it("never mistakes a mangaka note with a stray manga block for a Series note", () => {
		expect(classifyNote({ ...mangaka, manga: { mal_id: 401 } })).toEqual({ kind: "mangaka", malId: 1893 });
	});

	it("ignores notes the plugin didn't create, and ids that aren't numbers", () => {
		expect(classifyNote(undefined)).toBeNull();
		expect(classifyNote({})).toBeNull();
		expect(classifyNote({ title: "Meeting notes", tags: ["work"] })).toBeNull();
		expect(classifyNote({ ...film, tmdb_id: "1398" })).toBeNull();
		expect(classifyNote({ ...animeOnly, mal_id: "11061" })).toBeNull();
	});
});

/**
 * Regression coverage for a real bug: duplicate checks used to be scoped by
 * folder, and with a folder setting left empty (or two types sharing one)
 * a director was taken for the film with the same numeric TMDB id.
 */
describe("matchesRef", () => {
	it("never takes a director for a film with the same numeric id", () => {
		const directorWithFilmsId = { ...director, tmdb_id: 1398 };
		expect(matchesRef(classifyNote(directorWithFilmsId), { kind: "film", tmdbId: 1398 })).toBe(false);
		expect(matchesRef(classifyNote(film), { kind: "director", tmdbId: 1398 })).toBe(false);
		expect(matchesRef(classifyNote(film), { kind: "film", tmdbId: 1398 })).toBe(true);
	});

	it("never takes a mangaka for an anime with the same numeric id", () => {
		const mangakaWithAnimesId = { ...mangaka, mal_id: 11061 };
		expect(matchesRef(classifyNote(mangakaWithAnimesId), { kind: "anime", malId: 11061 })).toBe(false);
		expect(matchesRef(classifyNote(animeOnly), { kind: "mangaka", malId: 11061 })).toBe(false);
		expect(matchesRef(classifyNote(mangaka), { kind: "mangaka", malId: 1893 })).toBe(true);
	});

	it("finds a manga by its own id, never by the Series note's anime id", () => {
		expect(matchesRef(classifyNote(series), { kind: "manga", malId: 26 })).toBe(true);
		expect(matchesRef(classifyNote(series), { kind: "manga", malId: 11061 })).toBe(false);
		expect(matchesRef(classifyNote(series), { kind: "anime", malId: 11061 })).toBe(true);
		expect(matchesRef(classifyNote(mangaOnly), { kind: "anime", malId: 26 })).toBe(false);
	});

	it("matches nothing for a note that isn't the plugin's", () => {
		expect(matchesRef(null, { kind: "film", tmdbId: 1398 })).toBe(false);
	});

	it("finds a pairing only on the note that holds both this anime and this manga", () => {
		const pair = { kind: "pair" as const, animeMalId: 11061, mangaMalId: 26 };
		expect(matchesRef(classifyNote(series), pair)).toBe(true);
		expect(matchesRef(classifyNote(animeOnly), pair)).toBe(false);
		expect(matchesRef(classifyNote(mangaOnly), pair)).toBe(false);
		expect(matchesRef(classifyNote(series), { ...pair, mangaMalId: 401 })).toBe(false);
	});
});

/**
 * Regression coverage for a real bug: a mangaka note (`name` + `mal_id`, no
 * `manga` block) used to pass as an anime-only Series note whenever the
 * Mangaka folder setting was empty or shared, and Add manga then merged a
 * `manga:` block straight into it.
 */
describe("isAnimeOnlySeries / isMangaOnlySeries", () => {
	it("a mangaka note is never a merge target, whatever folder it is in", () => {
		expect(isAnimeOnlySeries(classifyNote(mangaka))).toBe(false);
		expect(isMangaOnlySeries(classifyNote(mangaka))).toBe(false);
	});

	it("an anime-only Series note is what Add manga merges into", () => {
		expect(isAnimeOnlySeries(classifyNote(animeOnly))).toBe(true);
		expect(isMangaOnlySeries(classifyNote(animeOnly))).toBe(false);
	});

	it("a manga-only Series note is what Add anime merges into", () => {
		expect(isMangaOnlySeries(classifyNote(mangaOnly))).toBe(true);
		expect(isAnimeOnlySeries(classifyNote(mangaOnly))).toBe(false);
	});

	it("a Series note that already has both sides takes neither", () => {
		expect(isAnimeOnlySeries(classifyNote(series))).toBe(false);
		expect(isMangaOnlySeries(classifyNote(series))).toBe(false);
	});

	it("a mangaka note with a stray manga block takes neither", () => {
		const corrupted = classifyNote({ ...mangaka, manga: { mal_id: 401 } });
		expect(isAnimeOnlySeries(corrupted)).toBe(false);
		expect(isMangaOnlySeries(corrupted)).toBe(false);
	});

	it("films, directors and notes the plugin didn't create take neither", () => {
		for (const note of [classifyNote(film), classifyNote(director), null]) {
			expect(isAnimeOnlySeries(note)).toBe(false);
			expect(isMangaOnlySeries(note)).toBe(false);
		}
	});
});
