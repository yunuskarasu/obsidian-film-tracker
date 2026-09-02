import { describe, expect, it } from "vitest";
import {
	filmographyProgress,
	findFilmography,
	type FilmographyEntry,
	type FilmographyFilm,
} from "../src/filmography";

function film(overrides: Partial<FilmographyFilm> & { path: string; title: string }): FilmographyFilm {
	return { year: null, watched: false, directors: [], ...overrides };
}

function entry(overrides: Partial<FilmographyEntry> & { path: string; title: string }): FilmographyEntry {
	return { year: null, watched: false, ...overrides };
}

describe("findFilmography", () => {
	it("finds a film directed by a matching name", () => {
		const nolan = film({ path: "a", title: "Inception", directors: ["Christopher Nolan"] });
		expect(findFilmography(new Set(["Christopher Nolan"]), [nolan])).toEqual([
			{ path: "a", title: "Inception", year: null, watched: false },
		]);
	});

	it("carries the watched flag through", () => {
		const nolan = film({
			path: "a",
			title: "Inception",
			watched: true,
			directors: ["Christopher Nolan"],
		});
		expect(findFilmography(new Set(["Christopher Nolan"]), [nolan])[0].watched).toBe(true);
	});

	it("matches on any of the given names, not just the first", () => {
		const tarkovsky = film({
			path: "a",
			title: "Stalker",
			directors: ["Андрей Арсеньевич Тарковский"],
		});
		const names = new Set(["Andrei Tarkovsky", "Андрей Арсеньевич Тарковский"]);
		expect(findFilmography(names, [tarkovsky])).toEqual([
			{ path: "a", title: "Stalker", year: null, watched: false },
		]);
	});

	it("excludes films by someone else", () => {
		const other = film({ path: "a", title: "Other Film", directors: ["Someone Else"] });
		expect(findFilmography(new Set(["Christopher Nolan"]), [other])).toEqual([]);
	});

	it("excludes films with no director credited", () => {
		const noDirector = film({ path: "a", title: "Mystery Film" });
		expect(findFilmography(new Set(["Christopher Nolan"]), [noDirector])).toEqual([]);
	});

	it("sorts oldest first, then by title", () => {
		const names = new Set(["Christopher Nolan"]);
		const newer = film({ path: "a", title: "Oppenheimer", year: 2023, directors: ["Christopher Nolan"] });
		const older = film({ path: "b", title: "Following", year: 1998, directors: ["Christopher Nolan"] });
		const sameYearB = film({ path: "c", title: "Batman Begins", year: 2005, directors: ["Christopher Nolan"] });
		const sameYearA = film({ path: "d", title: "Alien", year: 2005, directors: ["Christopher Nolan"] });

		const result = findFilmography(names, [newer, older, sameYearB, sameYearA]);
		expect(result.map((f) => f.title)).toEqual(["Following", "Alien", "Batman Begins", "Oppenheimer"]);
	});

	it("sorts a film with no year after every dated film", () => {
		const names = new Set(["Christopher Nolan"]);
		const dated = film({ path: "a", title: "Following", year: 1998, directors: ["Christopher Nolan"] });
		const undated = film({ path: "b", title: "Untitled Project", directors: ["Christopher Nolan"] });

		const result = findFilmography(names, [dated, undated]);
		expect(result.map((f) => f.title)).toEqual(["Following", "Untitled Project"]);
	});

	it("returns an empty list for an empty catalog", () => {
		expect(findFilmography(new Set(["Christopher Nolan"]), [])).toEqual([]);
	});
});

describe("filmographyProgress", () => {
	it("returns null for an empty list", () => {
		expect(filmographyProgress([])).toBeNull();
	});

	it("returns 0 when nothing is watched", () => {
		expect(
			filmographyProgress([entry({ path: "a", title: "A" }), entry({ path: "b", title: "B" })]),
		).toBe(0);
	});

	it("returns 100 when everything is watched", () => {
		expect(
			filmographyProgress([
				entry({ path: "a", title: "A", watched: true }),
				entry({ path: "b", title: "B", watched: true }),
			]),
		).toBe(100);
	});

	it("rounds a mixed fraction to the nearest whole percent", () => {
		const films = [
			entry({ path: "a", title: "A", watched: true }),
			entry({ path: "b", title: "B", watched: true }),
			entry({ path: "c", title: "C", watched: true }),
			entry({ path: "d", title: "D" }),
		];
		expect(filmographyProgress(films)).toBe(75);
	});
});
