import { describe, expect, it } from "vitest";
import { animeNoteTitles, animeTitles, looksLikeSameWork, showTitles, tvNoteTitles } from "../src/anime-match";

/*
 * TMDB lists anime among its TV shows and knows nothing of MyAnimeList's
 * numbering, so the only thing the two catalogues share is the titles. A
 * match here never decides anything — it asks the user (see
 * `already-tracked-modal.ts`).
 */

const aot = { title: "Attack on Titan", originalTitle: "進撃の巨人" };

describe("looksLikeSameWork", () => {
	it("matches a show and the anime note of the same work", () => {
		const note = animeNoteTitles({
			title: "Shingeki no Kyojin",
			english_title: "Attack on Titan",
			japanese_title: "進撃の巨人",
		});
		expect(looksLikeSameWork(showTitles(aot), note)).toBe(true);
	});

	it("matches on the original title alone, whatever the English one says", () => {
		const note = animeNoteTitles({ title: "Shingeki no Kyojin", japanese_title: "進撃の巨人" });
		expect(looksLikeSameWork(showTitles(aot), note)).toBe(true);
	});

	it("looks past case, spacing and punctuation", () => {
		const note = animeNoteTitles({ title: "attack on titan!" });
		expect(looksLikeSameWork(showTitles(aot), note)).toBe(true);
	});

	it("matches a season MyAnimeList keeps as its own entry", () => {
		// TMDB keeps every season under the one show; MAL does not.
		const note = animeNoteTitles({ title: "Attack on Titan Season 3" });
		expect(looksLikeSameWork(showTitles(aot), note)).toBe(true);
	});

	it("never matches a different work", () => {
		for (const title of ["Naruto", "Death Note", "Attack", "Attack on Titan Junior High"]) {
			expect(looksLikeSameWork(showTitles(aot), animeNoteTitles({ title }))).toBe(false);
		}
	});

	it("matches nothing when either side has no titles at all", () => {
		expect(looksLikeSameWork(showTitles(aot), animeNoteTitles(undefined))).toBe(false);
		expect(looksLikeSameWork(showTitles({ title: "", originalTitle: "" }), ["naruto"])).toBe(false);
	});
});

describe("the titles each side goes by", () => {
	it("reads an anime note, a TV note and MyAnimeList's own titles", () => {
		expect(animeNoteTitles({ title: "Naruto", aliases: ["NARUTO -ナルト-"] })).toEqual(["naruto", "narutoナルト"]);
		expect(tvNoteTitles({ title: "Ezel", original_title: "Ezel", aliases: [] })).toEqual(["ezel"]);
		expect(animeTitles({ title: "Shingeki no Kyojin", englishTitle: null, japaneseTitle: "進撃の巨人" })).toEqual([
			"shingekinokyojin",
			"進撃の巨人",
		]);
	});
});
