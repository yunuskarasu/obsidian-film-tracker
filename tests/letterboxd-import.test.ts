import { describe, expect, it } from "vitest";
import { parseLetterboxdCsv, pickBestMatch } from "../src/letterboxd-import";
import type { FilmSearchResult } from "../src/tmdb";

describe("parseLetterboxdCsv", () => {
	it("reads watched.csv (no Watched Date column)", () => {
		const csv = [
			"Date,Name,Year,Letterboxd URI",
			"2024-01-01,La La Land,2016,https://boxd.it/x",
		].join("\n");

		expect(parseLetterboxdCsv(csv)).toEqual([
			{ name: "La La Land", year: 2016, watchedDate: null },
		]);
	});

	it("reads diary.csv, using Watched Date for watch_date", () => {
		const csv = [
			"Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date",
			"2024-03-02,Stalker,1979,https://boxd.it/y,4.5,,,2024-03-01",
		].join("\n");

		expect(parseLetterboxdCsv(csv)).toEqual([
			{ name: "Stalker", year: 1979, watchedDate: "2024-03-01" },
		]);
	});

	it("never reads Rating, Tags or Rewatch", () => {
		const csv = [
			"Name,Year,Rating,Rewatch,Tags,Watched Date",
			"Amélie,2001,5,Yes,favourite,2024-03-01",
		].join("\n");

		expect(parseLetterboxdCsv(csv)).toEqual([
			{ name: "Amélie", year: 2001, watchedDate: "2024-03-01" },
		]);
	});

	it("handles quoted fields containing commas", () => {
		const csv = [
			"Name,Year",
			'"Amélie, the film",2001',
		].join("\n");

		expect(parseLetterboxdCsv(csv)[0].name).toBe("Amélie, the film");
	});

	it("handles escaped quotes inside quoted fields", () => {
		const csv = ["Name,Year", '"The ""Best"" Film",2001'].join("\n");
		expect(parseLetterboxdCsv(csv)[0].name).toBe('The "Best" Film');
	});

	it("strips a leading byte-order mark", () => {
		const csv = "﻿Name,Year\nStalker,1979";
		expect(parseLetterboxdCsv(csv)).toEqual([{ name: "Stalker", year: 1979, watchedDate: null }]);
	});

	it("skips blank rows", () => {
		const csv = ["Name,Year", "Stalker,1979", ",", ""].join("\n");
		expect(parseLetterboxdCsv(csv)).toEqual([{ name: "Stalker", year: 1979, watchedDate: null }]);
	});

	it("treats a missing or malformed year as unknown", () => {
		const csv = ["Name,Year", "Stalker,", "Solaris,unknown"].join("\n");
		expect(parseLetterboxdCsv(csv)).toEqual([
			{ name: "Stalker", year: null, watchedDate: null },
			{ name: "Solaris", year: null, watchedDate: null },
		]);
	});

	it("throws when the file has no Name column", () => {
		const csv = ["Letterboxd URI", "https://boxd.it/x"].join("\n");
		expect(() => parseLetterboxdCsv(csv)).toThrow(/Name/);
	});

	it("returns an empty list for an empty file", () => {
		expect(parseLetterboxdCsv("")).toEqual([]);
	});
});

describe("pickBestMatch", () => {
	const results: FilmSearchResult[] = [
		{ id: 1, title: "Solaris", originalTitle: "Солярис", year: 2002 },
		{ id: 2, title: "Solaris", originalTitle: "Солярис", year: 1972 },
	];

	it("prefers the result whose year matches", () => {
		expect(pickBestMatch(results, 1972)).toEqual(results[1]);
	});

	it("falls back to the top result when no year matches", () => {
		expect(pickBestMatch(results, 1999)).toEqual(results[0]);
	});

	it("falls back to the top result when the year is unknown", () => {
		expect(pickBestMatch(results, null)).toEqual(results[0]);
	});

	it("returns null when there are no results", () => {
		expect(pickBestMatch([], 2002)).toBeNull();
	});
});
