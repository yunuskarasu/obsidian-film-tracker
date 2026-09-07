import { describe, expect, it } from "vitest";
import {
	findMangagraphy,
	mangagraphyProgress,
	type MangagraphyEntry,
	type MangagraphyManga,
} from "../src/mangagraphy";

function manga(overrides: Partial<MangagraphyManga> & { path: string; title: string }): MangagraphyManga {
	return { year: null, read: false, mangaka: [], ...overrides };
}

function entry(overrides: Partial<MangagraphyEntry> & { path: string; title: string }): MangagraphyEntry {
	return { year: null, read: false, ...overrides };
}

describe("findMangagraphy", () => {
	it("finds a manga written by a matching name", () => {
		const hxh = manga({ path: "a", title: "Hunter x Hunter", mangaka: ["Yoshihiro Togashi"] });
		expect(findMangagraphy(new Set(["Yoshihiro Togashi"]), [hxh])).toEqual([
			{ path: "a", title: "Hunter x Hunter", year: null, read: false },
		]);
	});

	it("carries the read flag through", () => {
		const hxh = manga({
			path: "a",
			title: "Hunter x Hunter",
			read: true,
			mangaka: ["Yoshihiro Togashi"],
		});
		expect(findMangagraphy(new Set(["Yoshihiro Togashi"]), [hxh])[0].read).toBe(true);
	});

	it("matches a manga with multiple authors, not just the first", () => {
		const deathNote = manga({
			path: "a",
			title: "Death Note",
			mangaka: ["Tsugumi Ohba", "Takeshi Obata"],
		});
		expect(findMangagraphy(new Set(["Takeshi Obata"]), [deathNote])).toEqual([
			{ path: "a", title: "Death Note", year: null, read: false },
		]);
	});

	it("excludes manga by someone else", () => {
		const other = manga({ path: "a", title: "Other Manga", mangaka: ["Someone Else"] });
		expect(findMangagraphy(new Set(["Yoshihiro Togashi"]), [other])).toEqual([]);
	});

	it("excludes manga with no mangaka credited", () => {
		const noMangaka = manga({ path: "a", title: "Mystery Manga" });
		expect(findMangagraphy(new Set(["Yoshihiro Togashi"]), [noMangaka])).toEqual([]);
	});

	it("sorts oldest first, then by title", () => {
		const names = new Set(["Yoshihiro Togashi"]);
		const newer = manga({ path: "a", title: "Level E", year: 1995, mangaka: ["Yoshihiro Togashi"] });
		const older = manga({ path: "b", title: "YuYu Hakusho", year: 1990, mangaka: ["Yoshihiro Togashi"] });

		const result = findMangagraphy(names, [newer, older]);
		expect(result.map((m) => m.title)).toEqual(["YuYu Hakusho", "Level E"]);
	});

	it("sorts a manga with no year after every dated manga", () => {
		const names = new Set(["Yoshihiro Togashi"]);
		const dated = manga({ path: "a", title: "YuYu Hakusho", year: 1990, mangaka: ["Yoshihiro Togashi"] });
		const undated = manga({ path: "b", title: "Untitled Project", mangaka: ["Yoshihiro Togashi"] });

		const result = findMangagraphy(names, [dated, undated]);
		expect(result.map((m) => m.title)).toEqual(["YuYu Hakusho", "Untitled Project"]);
	});

	it("returns an empty list for an empty catalog", () => {
		expect(findMangagraphy(new Set(["Yoshihiro Togashi"]), [])).toEqual([]);
	});
});

describe("mangagraphyProgress", () => {
	it("returns null for an empty list", () => {
		expect(mangagraphyProgress([])).toBeNull();
	});

	it("returns 0 when nothing is read", () => {
		expect(
			mangagraphyProgress([entry({ path: "a", title: "A" }), entry({ path: "b", title: "B" })]),
		).toBe(0);
	});

	it("returns 100 when everything is read", () => {
		expect(
			mangagraphyProgress([
				entry({ path: "a", title: "A", read: true }),
				entry({ path: "b", title: "B", read: true }),
			]),
		).toBe(100);
	});

	it("rounds a mixed fraction to the nearest whole percent", () => {
		const mangas = [
			entry({ path: "a", title: "A", read: true }),
			entry({ path: "b", title: "B", read: true }),
			entry({ path: "c", title: "C", read: true }),
			entry({ path: "d", title: "D" }),
		];
		expect(mangagraphyProgress(mangas)).toBe(75);
	});
});
