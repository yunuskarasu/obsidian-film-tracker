import { describe, expect, it } from "vitest";
import {
	detectOriginalName,
	parseYear,
	toDirectorMetadata,
	toFilmMetadata,
	toPersonSearchResult,
	toSearchResult,
	type TmdbMovieDetails,
	type TmdbPersonDetails,
	type TmdbPersonSearchItem,
} from "../src/tmdb";

function details(overrides: Partial<TmdbMovieDetails> = {}): TmdbMovieDetails {
	return {
		id: 1398,
		title: "Stalker",
		original_title: "Сталкер",
		release_date: "1979-05-25",
		runtime: 162,
		poster_path: "/abc.jpg",
		genres: [{ name: "Science Fiction" }, { name: "Drama" }],
		credits: {
			cast: [{ name: "Alisa Freyndlikh", order: 0 }, { name: "Anatoliy Solonitsyn", order: 1 }],
			crew: [
				{ job: "Director", name: "Andrei Tarkovsky" },
				{ job: "Original Music Composer", name: "Eduard Artemyev" },
			],
		},
		...overrides,
	};
}

describe("parseYear", () => {
	it("takes the year from an ISO release date", () => {
		expect(parseYear("1979-05-25")).toBe(1979);
	});

	it("returns null when the date is missing or unusable", () => {
		expect(parseYear(undefined)).toBeNull();
		expect(parseYear("")).toBeNull();
		expect(parseYear("not-a-date")).toBeNull();
	});
});

describe("toFilmMetadata", () => {
	it("keeps the English title and the original title apart", () => {
		const film = toFilmMetadata(details());
		expect(film.title).toBe("Stalker");
		expect(film.originalTitle).toBe("Сталкер");
	});

	it("mirrors the original title when TMDB has no English translation", () => {
		// TMDB falls back server-side, so both fields arrive identical.
		const film = toFilmMetadata(
			details({ title: "Kış Uykusu", original_title: "Kış Uykusu" }),
		);
		expect(film.title).toBe("Kış Uykusu");
		expect(film.originalTitle).toBe("Kış Uykusu");
	});

	it("falls back to the original title when title is empty", () => {
		const film = toFilmMetadata(details({ title: "   " }));
		expect(film.title).toBe("Сталкер");
		expect(film.originalTitle).toBe("Сталкер");
	});

	it("falls back to the English title when original_title is empty", () => {
		const film = toFilmMetadata(details({ original_title: undefined }));
		expect(film.title).toBe("Stalker");
		expect(film.originalTitle).toBe("Stalker");
	});

	it("collects every director and ignores other crew", () => {
		const film = toFilmMetadata(
			details({
				credits: {
					crew: [
						{ job: "Director of Photography", name: "Roger Deakins" },
						{ job: "Director", name: "Joel Coen" },
						{ job: "Director", name: "Ethan Coen" },
						{ job: "Writer", name: "Cormac McCarthy" },
					],
				},
			}),
		);
		expect(film.directors).toEqual(["Joel Coen", "Ethan Coen"]);
	});

	it("survives missing credits", () => {
		expect(toFilmMetadata(details({ credits: undefined })).directors).toEqual([]);
		expect(toFilmMetadata(details({ credits: { crew: [] } })).directors).toEqual([]);
	});

	it("treats an unknown runtime as empty", () => {
		expect(toFilmMetadata(details({ runtime: 0 })).runtime).toBeNull();
		expect(toFilmMetadata(details({ runtime: null })).runtime).toBeNull();
		expect(toFilmMetadata(details({ runtime: undefined })).runtime).toBeNull();
		expect(toFilmMetadata(details({ runtime: 162 })).runtime).toBe(162);
	});

	it("normalizes missing poster, genres and release date", () => {
		const film = toFilmMetadata(
			details({ poster_path: null, genres: undefined, release_date: "" }),
		);
		expect(film.posterPath).toBeNull();
		expect(film.genres).toEqual([]);
		expect(film.year).toBeNull();
	});

	it("trims and drops blank genre names", () => {
		const film = toFilmMetadata(
			details({ genres: [{ name: "  Drama  " }, { name: "   " }, {}] }),
		);
		expect(film.genres).toEqual(["Drama"]);
	});

	it("carries the TMDB id through", () => {
		expect(toFilmMetadata(details()).tmdbId).toBe(1398);
	});

	it("sorts cast by TMDB's billing order", () => {
		const film = toFilmMetadata(
			details({
				credits: {
					cast: [
						{ name: "Second Billed", order: 1 },
						{ name: "Top Billed", order: 0 },
					],
				},
			}),
		);
		expect(film.cast).toEqual(["Top Billed", "Second Billed"]);
	});

	it("sorts cast members with no order last", () => {
		const film = toFilmMetadata(
			details({
				credits: {
					cast: [{ name: "No Order" }, { name: "Top Billed", order: 0 }],
				},
			}),
		);
		expect(film.cast).toEqual(["Top Billed", "No Order"]);
	});

	it("picks up the original music composer and ignores other crew", () => {
		const film = toFilmMetadata(details());
		expect(film.composers).toEqual(["Eduard Artemyev"]);
	});

	it("survives missing cast and composer credits", () => {
		expect(toFilmMetadata(details({ credits: undefined })).cast).toEqual([]);
		expect(toFilmMetadata(details({ credits: undefined })).composers).toEqual([]);
		expect(toFilmMetadata(details({ credits: { cast: [], crew: [] } })).cast).toEqual([]);
	});
});

describe("toSearchResult", () => {
	it("maps a search hit to the fields the picker shows", () => {
		expect(
			toSearchResult({
				id: 194,
				title: "Amélie",
				original_title: "Le Fabuleux Destin d'Amélie Poulain",
				release_date: "2001-04-25",
			}),
		).toEqual({
			id: 194,
			title: "Amélie",
			originalTitle: "Le Fabuleux Destin d'Amélie Poulain",
			year: 2001,
		});
	});

	it("handles a hit with no release date", () => {
		expect(toSearchResult({ id: 1, title: "Untitled Project" }).year).toBeNull();
	});
});

function personSearchItem(overrides: Partial<TmdbPersonSearchItem> = {}): TmdbPersonSearchItem {
	return {
		id: 525,
		name: "Christopher Nolan",
		known_for_department: "Directing",
		...overrides,
	};
}

function personDetails(overrides: Partial<TmdbPersonDetails> = {}): TmdbPersonDetails {
	return {
		id: 525,
		name: "Christopher Nolan",
		birthday: "1970-07-30",
		place_of_birth: "London, England, UK",
		profile_path: "/nolan.jpg",
		also_known_as: ["Christopher Edward Nolan"],
		...overrides,
	};
}

describe("toPersonSearchResult", () => {
	it("maps a search hit to the fields the picker shows", () => {
		expect(toPersonSearchResult(personSearchItem())).toEqual({
			id: 525,
			name: "Christopher Nolan",
			department: "Directing",
		});
	});

	it("treats a missing department as null, never filtering on it", () => {
		expect(toPersonSearchResult(personSearchItem({ known_for_department: undefined })).department).toBeNull();
	});
});

describe("detectOriginalName", () => {
	it("picks the also_known_as entry matching the script implied by place of birth", () => {
		expect(
			detectOriginalName("Andrei Tarkovsky", ["Андрей Арсеньевич Тарковский"], "Zavrazhye, USSR"),
		).toBe("Андрей Арсеньевич Тарковский");
	});

	it("picks the right script even when several non-Latin scripts are present", () => {
		const alsoKnownAs = [
			"Andrei Tarkovskiy",
			"安德烈·塔尔科夫斯基",
			"アンドレイ・タルコフスキー",
			"안드레이 타르콥스키",
			"Андрей Арсеньевич Тарковский",
			"أندري تاركوفسكي",
		];
		expect(detectOriginalName("Andrei Tarkovsky", alsoKnownAs, "Zavrazhye, USSR")).toBe(
			"Андрей Арсеньевич Тарковский",
		);
		expect(detectOriginalName("Andrei Tarkovsky", alsoKnownAs, "Tokyo, Japan")).toBe(
			"アンドレイ・タルコフスキー",
		);
	});

	it("returns null for a Latin-script birthplace: nothing distinguishes the scripts", () => {
		expect(
			detectOriginalName("Christopher Nolan", ["Christopher Edward Nolan"], "London, England, UK"),
		).toBeNull();
	});

	it("returns null when place of birth is missing, unrecognized, or also_known_as is missing", () => {
		expect(detectOriginalName("Name", ["Имя"], null)).toBeNull();
		expect(detectOriginalName("Name", ["Имя"], "Somewhere Unmapped")).toBeNull();
		expect(detectOriginalName("Andrei Tarkovsky", undefined, "Zavrazhye, USSR")).toBeNull();
	});

	it("never returns a match identical to the primary name", () => {
		expect(
			detectOriginalName("Имя", ["Имя", "Other Имя"], "Moscow, Russia"),
		).toBe("Other Имя");
	});
});

describe("toDirectorMetadata", () => {
	it("maps birthday, place of birth and the TMDB id through", () => {
		const director = toDirectorMetadata(personDetails());
		expect(director.name).toBe("Christopher Nolan");
		expect(director.birthday).toBe("1970-07-30");
		expect(director.placeOfBirth).toBe("London, England, UK");
		expect(director.tmdbId).toBe(525);
		expect(director.photoPath).toBe("/nolan.jpg");
	});

	it("leaves original_name null and aliases to just the name for a Latin-script birthplace", () => {
		const director = toDirectorMetadata(personDetails());
		expect(director.originalName).toBeNull();
		expect(director.aliases).toEqual(["Christopher Nolan"]);
	});

	it("fills original_name and includes it in aliases alongside name when detected", () => {
		const director = toDirectorMetadata(
			personDetails({
				id: 8452,
				name: "Andrei Tarkovsky",
				place_of_birth: "Zavrazhye, USSR",
				also_known_as: ["Andrei Tarkovskiy", "Андрей Арсеньевич Тарковский"],
			}),
		);
		expect(director.originalName).toBe("Андрей Арсеньевич Тарковский");
		expect(director.aliases).toEqual(["Andrei Tarkovsky", "Андрей Арсеньевич Тарковский"]);
	});

	it("maps deathday, null while alive and missing entirely", () => {
		expect(toDirectorMetadata(personDetails({ deathday: "1986-12-29" })).deathday).toBe(
			"1986-12-29",
		);
		expect(toDirectorMetadata(personDetails({ deathday: null })).deathday).toBeNull();
		expect(toDirectorMetadata(personDetails({ deathday: undefined })).deathday).toBeNull();
	});

	it("normalizes missing birthday, place of birth, photo and also_known_as", () => {
		const director = toDirectorMetadata(
			personDetails({
				birthday: null,
				place_of_birth: null,
				profile_path: null,
				also_known_as: undefined,
			}),
		);
		expect(director.birthday).toBeNull();
		expect(director.placeOfBirth).toBeNull();
		expect(director.photoPath).toBeNull();
		expect(director.aliases).toEqual(["Christopher Nolan"]);
	});
});
