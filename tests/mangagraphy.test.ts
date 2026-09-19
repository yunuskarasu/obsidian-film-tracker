import { describe, expect, it } from "vitest";
import {
	findMangagraphy,
	mangagraphyProgress,
	type MangagraphyEntry,
	type MangagraphyManga,
} from "../src/mangagraphy";

let nextMalId = 1;

function manga(overrides: Partial<MangagraphyManga> & { path: string; title: string }): MangagraphyManga {
	return { malId: nextMalId++, year: null, read: false, hasAnime: false, mangaka: [], ...overrides };
}

function entry(overrides: Partial<MangagraphyEntry> & { title: string }): MangagraphyEntry {
	return { malId: nextMalId++, year: null, read: false, paths: [`${overrides.title}.md`], ...overrides };
}

describe("findMangagraphy", () => {
	it("finds a manga written by a matching name", () => {
		const hxh = manga({ malId: 26, path: "a", title: "Hunter x Hunter", mangaka: ["Yoshihiro Togashi"] });
		expect(findMangagraphy(new Set(["Yoshihiro Togashi"]), [hxh])).toEqual([
			{ malId: 26, title: "Hunter x Hunter", year: null, read: false, paths: ["a"] },
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
		expect(findMangagraphy(new Set(["Takeshi Obata"]), [deathNote]).map((m) => m.title)).toEqual([
			"Death Note",
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

	/**
	 * Regression: one manga on two Series notes — one per anime adaptation —
	 * used to be listed twice and counted twice in "% read".
	 */
	describe("the same manga on more than one Series note", () => {
		const names = new Set(["Yoshihiro Togashi"]);
		const on1999 = manga({
			malId: 26,
			path: "Anime/Hunter x Hunter (1999).md",
			title: "Hunter x Hunter",
			year: 1998,
			hasAnime: true,
			mangaka: ["Yoshihiro Togashi"],
		});
		const on2011 = { ...on1999, path: "Anime/Hunter x Hunter (2011).md" };
		const mangaOnly = { ...on1999, path: "Anime/Hunter x Hunter.md", hasAnime: false };

		it("lists it once, with every note that carries it", () => {
			const result = findMangagraphy(names, [on2011, on1999]);
			expect(result).toHaveLength(1);
			expect(result[0].paths).toEqual(["Anime/Hunter x Hunter (1999).md", "Anime/Hunter x Hunter (2011).md"]);
		});

		it("links the manga's own manga-only note first, when there is one", () => {
			const result = findMangagraphy(names, [on1999, on2011, mangaOnly]);
			expect(result[0].paths[0]).toBe("Anime/Hunter x Hunter.md");
		});

		it("counts it as read when any of its notes says so", () => {
			const result = findMangagraphy(names, [on1999, { ...on2011, read: true }]);
			expect(result[0].read).toBe(true);
		});

		it("counts it once in the read percentage", () => {
			const other = manga({ path: "b", title: "YuYu Hakusho", read: true, mangaka: ["Yoshihiro Togashi"] });
			expect(mangagraphyProgress(findMangagraphy(names, [on1999, on2011, other]))).toBe(50);
		});
	});
});

describe("mangagraphyProgress", () => {
	it("returns null for an empty list", () => {
		expect(mangagraphyProgress([])).toBeNull();
	});

	it("returns 0 when nothing is read", () => {
		expect(mangagraphyProgress([entry({ title: "A" }), entry({ title: "B" })])).toBe(0);
	});

	it("returns 100 when everything is read", () => {
		expect(
			mangagraphyProgress([entry({ title: "A", read: true }), entry({ title: "B", read: true })]),
		).toBe(100);
	});

	it("rounds a mixed fraction to the nearest whole percent", () => {
		const mangas = [
			entry({ title: "A", read: true }),
			entry({ title: "B", read: true }),
			entry({ title: "C", read: true }),
			entry({ title: "D" }),
		];
		expect(mangagraphyProgress(mangas)).toBe(75);
	});
});
