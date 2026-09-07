import { describe, expect, it } from "vitest";
import {
	DETAIL_FIELDS,
	MANGA_DETAIL_FIELDS,
	PERSON_DETAIL_FIELDS,
	parseYearFromDate,
	toAnimeMetadata,
	toAnimeSearchResult,
	toMangaMetadata,
	toMangaSearchResult,
	toMangakaMetadata,
	type MalAnimeDetails,
	type MalMangaDetails,
	type MalMangaSearchNode,
	type MalPersonDetails,
	type MalSearchNode,
} from "../src/mal";

describe("DETAIL_FIELDS", () => {
	it("requests main_picture explicitly, since MAL drops it unless listed", () => {
		expect(DETAIL_FIELDS.split(",")).toContain("main_picture");
	});

	it("requests every field toAnimeMetadata reads", () => {
		const requested = new Set(DETAIL_FIELDS.split(","));
		for (const field of [
			"main_picture",
			"alternative_titles",
			"media_type",
			"num_episodes",
			"genres",
			"studios",
			"status",
			"start_date",
		]) {
			expect(requested.has(field)).toBe(true);
		}
	});
});

function details(overrides: Partial<MalAnimeDetails> = {}): MalAnimeDetails {
	return {
		id: 16498,
		title: "Shingeki no Kyojin",
		main_picture: { medium: "https://example.com/m.jpg", large: "https://example.com/l.jpg" },
		alternative_titles: { en: "Attack on Titan", ja: "進撃の巨人" },
		media_type: "tv",
		num_episodes: 25,
		genres: [{ name: "Action" }, { name: "Drama" }],
		studios: [{ name: "Wit Studio" }],
		status: "finished_airing",
		start_date: "2013-04-07",
		...overrides,
	};
}

describe("parseYearFromDate", () => {
	it("takes the year from an ISO start date", () => {
		expect(parseYearFromDate("2013-04-07")).toBe(2013);
	});

	it("returns null when the date is missing or unusable", () => {
		expect(parseYearFromDate(undefined)).toBeNull();
		expect(parseYearFromDate("")).toBeNull();
		expect(parseYearFromDate("not-a-date")).toBeNull();
	});
});

describe("toAnimeMetadata", () => {
	it("keeps the romaji title and the English/Japanese alternatives apart", () => {
		const anime = toAnimeMetadata(details());
		expect(anime.title).toBe("Shingeki no Kyojin");
		expect(anime.englishTitle).toBe("Attack on Titan");
		expect(anime.japaneseTitle).toBe("進撃の巨人");
	});

	it("prefers the large picture and falls back to medium", () => {
		expect(toAnimeMetadata(details()).posterUrl).toBe("https://example.com/l.jpg");
		expect(
			toAnimeMetadata(details({ main_picture: { medium: "https://example.com/m.jpg" } }))
				.posterUrl,
		).toBe("https://example.com/m.jpg");
	});

	it("normalizes a missing picture, alternative titles, genres and studios", () => {
		const anime = toAnimeMetadata(
			details({
				main_picture: undefined,
				alternative_titles: undefined,
				genres: undefined,
				studios: undefined,
			}),
		);
		expect(anime.posterUrl).toBeNull();
		expect(anime.englishTitle).toBeNull();
		expect(anime.japaneseTitle).toBeNull();
		expect(anime.genres).toEqual([]);
		expect(anime.studios).toEqual([]);
	});

	it("trims and drops blank genre and studio names", () => {
		const anime = toAnimeMetadata(
			details({ genres: [{ name: "  Drama  " }, { name: "   " }, {}], studios: [{ name: " Wit " }] }),
		);
		expect(anime.genres).toEqual(["Drama"]);
		expect(anime.studios).toEqual(["Wit"]);
	});

	it("treats a zero or missing episode count as unknown", () => {
		expect(toAnimeMetadata(details({ num_episodes: 0 })).episodes).toBeNull();
		expect(toAnimeMetadata(details({ num_episodes: undefined })).episodes).toBeNull();
		expect(toAnimeMetadata(details({ num_episodes: 25 })).episodes).toBe(25);
	});

	it("carries the MAL id through", () => {
		expect(toAnimeMetadata(details()).malId).toBe(16498);
	});

	it("takes the year from start_date", () => {
		expect(toAnimeMetadata(details()).year).toBe(2013);
		expect(toAnimeMetadata(details({ start_date: undefined })).year).toBeNull();
	});
});

describe("toAnimeSearchResult", () => {
	function searchNode(overrides: Partial<MalSearchNode> = {}): MalSearchNode {
		return {
			id: 16498,
			title: "Shingeki no Kyojin",
			start_season: { year: 2013 },
			...overrides,
		};
	}

	it("maps a search hit to the fields the picker shows", () => {
		expect(toAnimeSearchResult(searchNode())).toEqual({
			id: 16498,
			title: "Shingeki no Kyojin",
			year: 2013,
		});
	});

	it("handles a hit with no start season", () => {
		expect(toAnimeSearchResult(searchNode({ start_season: undefined })).year).toBeNull();
	});
});

describe("MANGA_DETAIL_FIELDS", () => {
	it("requests the nested authors sub-fields including id, since the flat form silently drops them", () => {
		expect(MANGA_DETAIL_FIELDS).toContain("authors{node{id,first_name,last_name}}");
	});

	it("requests every field toMangaMetadata reads", () => {
		for (const field of [
			"main_picture",
			"media_type",
			"num_volumes",
			"num_chapters",
			"status",
			"start_date",
		]) {
			expect(MANGA_DETAIL_FIELDS).toContain(field);
		}
	});
});

describe("PERSON_DETAIL_FIELDS", () => {
	it("requests only the fields confirmed to actually return data for a MAL person", () => {
		expect(PERSON_DETAIL_FIELDS.split(",")).toEqual([
			"first_name",
			"last_name",
			"birthday",
			"main_picture",
		]);
	});
});

function mangaDetails(overrides: Partial<MalMangaDetails> = {}): MalMangaDetails {
	return {
		id: 26,
		title: "Hunter x Hunter",
		main_picture: { medium: "https://example.com/m.jpg", large: "https://example.com/l.jpg" },
		media_type: "manga",
		num_volumes: 37,
		num_chapters: 400,
		authors: [
			{ node: { id: 1893, first_name: "Yoshihiro", last_name: "Togashi" }, role: "Story & Art" },
		],
		status: "currently_publishing",
		start_date: "1998-03-03",
		...overrides,
	};
}

describe("toMangaMetadata", () => {
	it("maps title, media type, status and the MAL id through", () => {
		const manga = toMangaMetadata(mangaDetails());
		expect(manga.title).toBe("Hunter x Hunter");
		expect(manga.mediaType).toBe("manga");
		expect(manga.status).toBe("currently_publishing");
		expect(manga.malId).toBe(26);
	});

	it("prefers the large picture and falls back to medium", () => {
		expect(toMangaMetadata(mangaDetails()).posterUrl).toBe("https://example.com/l.jpg");
		expect(
			toMangaMetadata(mangaDetails({ main_picture: { medium: "https://example.com/m.jpg" } }))
				.posterUrl,
		).toBe("https://example.com/m.jpg");
	});

	it("joins an author's first and last name, alongside their MAL person id", () => {
		expect(toMangaMetadata(mangaDetails()).mangaka).toEqual([
			{ name: "Yoshihiro Togashi", malId: 1893 },
		]);
	});

	it("handles multiple authors and drops one with no usable name", () => {
		const manga = toMangaMetadata(
			mangaDetails({
				authors: [
					{ node: { id: 1893, first_name: "Yoshihiro", last_name: "Togashi" }, role: "Story & Art" },
					{ node: {}, role: "Editor" },
				],
			}),
		);
		expect(manga.mangaka).toEqual([{ name: "Yoshihiro Togashi", malId: 1893 }]);
	});

	it("treats a missing author id as null rather than dropping the author", () => {
		const manga = toMangaMetadata(
			mangaDetails({
				authors: [{ node: { first_name: "Yoshihiro", last_name: "Togashi" }, role: "Story & Art" }],
			}),
		);
		expect(manga.mangaka).toEqual([{ name: "Yoshihiro Togashi", malId: null }]);
	});

	it("takes the manga's publication year from start_date", () => {
		expect(toMangaMetadata(mangaDetails()).year).toBe(1998);
		expect(toMangaMetadata(mangaDetails({ start_date: undefined })).year).toBeNull();
	});

	it("treats a zero or missing chapter/volume count as unknown", () => {
		expect(toMangaMetadata(mangaDetails({ num_chapters: 0 })).chapters).toBeNull();
		expect(toMangaMetadata(mangaDetails({ num_volumes: undefined })).volumes).toBeNull();
		expect(toMangaMetadata(mangaDetails()).chapters).toBe(400);
		expect(toMangaMetadata(mangaDetails()).volumes).toBe(37);
	});

	it("normalizes a missing picture and authors list", () => {
		const manga = toMangaMetadata(mangaDetails({ main_picture: undefined, authors: undefined }));
		expect(manga.posterUrl).toBeNull();
		expect(manga.mangaka).toEqual([]);
	});
});

function personDetails(overrides: Partial<MalPersonDetails> = {}): MalPersonDetails {
	return {
		id: 1893,
		first_name: "Yoshihiro",
		last_name: "Togashi",
		birthday: "1966-04-27",
		main_picture: { medium: "https://example.com/m.jpg", large: "https://example.com/l.jpg" },
		...overrides,
	};
}

describe("toMangakaMetadata", () => {
	it("joins first and last name, and carries the MAL id through", () => {
		const mangaka = toMangakaMetadata(personDetails());
		expect(mangaka.name).toBe("Yoshihiro Togashi");
		expect(mangaka.malId).toBe(1893);
	});

	it("prefers the large picture and falls back to medium", () => {
		expect(toMangakaMetadata(personDetails()).photoUrl).toBe("https://example.com/l.jpg");
		expect(
			toMangakaMetadata(personDetails({ main_picture: { medium: "https://example.com/m.jpg" } }))
				.photoUrl,
		).toBe("https://example.com/m.jpg");
	});

	it("carries the birthday through, and normalizes a missing one", () => {
		expect(toMangakaMetadata(personDetails()).birthday).toBe("1966-04-27");
		expect(toMangakaMetadata(personDetails({ birthday: undefined })).birthday).toBeNull();
	});

	it("normalizes a missing picture", () => {
		expect(toMangakaMetadata(personDetails({ main_picture: undefined })).photoUrl).toBeNull();
	});

	it("handles a person with only one name part", () => {
		expect(toMangakaMetadata(personDetails({ first_name: undefined })).name).toBe("Togashi");
		expect(toMangakaMetadata(personDetails({ last_name: undefined })).name).toBe("Yoshihiro");
	});
});

describe("toMangaSearchResult", () => {
	function searchNode(overrides: Partial<MalMangaSearchNode> = {}): MalMangaSearchNode {
		return { id: 26, title: "Hunter x Hunter", ...overrides };
	}

	it("maps a search hit to the fields the picker shows", () => {
		expect(toMangaSearchResult(searchNode())).toEqual({ id: 26, title: "Hunter x Hunter" });
	});
});
