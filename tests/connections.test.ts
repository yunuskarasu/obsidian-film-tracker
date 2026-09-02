import { describe, expect, it } from "vitest";
import { findConnections, type FilmNoteInfo } from "../src/connections";

function film(overrides: Partial<FilmNoteInfo> & { path: string; title: string }): FilmNoteInfo {
	return { directors: [], cast: [], composers: [], ...overrides };
}

describe("findConnections", () => {
	it("finds a film sharing a director", () => {
		const current = film({ path: "a", title: "A", directors: ["Damien Chazelle"] });
		const other = film({ path: "b", title: "B", directors: ["Damien Chazelle"] });

		const result = findConnections(current, [other]);
		expect(result).toEqual([
			{ file: other, shared: [{ name: "Damien Chazelle", role: "director" }] },
		]);
	});

	it("finds a film sharing a cast member", () => {
		const current = film({ path: "a", title: "A", cast: ["Ryan Gosling"] });
		const other = film({ path: "b", title: "B", cast: ["Ryan Gosling", "Emma Stone"] });

		const result = findConnections(current, [other]);
		expect(result).toEqual([{ file: other, shared: [{ name: "Ryan Gosling", role: "cast" }] }]);
	});

	it("finds a film sharing a composer", () => {
		const current = film({ path: "a", title: "A", composers: ["Justin Hurwitz"] });
		const other = film({ path: "b", title: "B", composers: ["Justin Hurwitz"] });

		expect(findConnections(current, [other])[0].shared).toEqual([
			{ name: "Justin Hurwitz", role: "composer" },
		]);
	});

	it("prefers director or composer over cast when a name matches both", () => {
		const current = film({ path: "a", title: "A", directors: ["Multi Hyphenate"] });
		const other = film({
			path: "b",
			title: "B",
			cast: ["Multi Hyphenate"],
			directors: ["Multi Hyphenate"],
		});

		expect(findConnections(current, [other])[0].shared).toEqual([
			{ name: "Multi Hyphenate", role: "director" },
		]);
	});

	it("never counts genres as a connection", () => {
		const current = film({ path: "a", title: "A" });
		const other = film({ path: "b", title: "B" });
		expect(findConnections(current, [other])).toEqual([]);
	});

	it("excludes the current film even if it appears in the candidate list", () => {
		const current = film({ path: "a", title: "A", directors: ["Damien Chazelle"] });
		expect(findConnections(current, [current])).toEqual([]);
	});

	it("returns an empty list when nothing overlaps", () => {
		const current = film({ path: "a", title: "A", directors: ["Damien Chazelle"] });
		const other = film({ path: "b", title: "B", directors: ["Someone Else"] });
		expect(findConnections(current, [other])).toEqual([]);
	});

	it("sorts by most shared names first, then by title", () => {
		const current = film({
			path: "a",
			title: "A",
			directors: ["D"],
			cast: ["X", "Y"],
		});
		const oneShared = film({ path: "b", title: "Zebra", cast: ["X"] });
		const twoShared = film({ path: "c", title: "Beta", cast: ["X", "Y"] });
		const alsoOneShared = film({ path: "d", title: "Alpha", cast: ["X"] });

		const result = findConnections(current, [oneShared, twoShared, alsoOneShared]);
		expect(result.map((c) => c.file.title)).toEqual(["Beta", "Alpha", "Zebra"]);
	});

	it("does not report the same shared name twice when the other film credits it in two roles", () => {
		const current = film({ path: "a", title: "A", directors: ["D"] });
		const other = film({ path: "b", title: "B", directors: ["D"], composers: ["D"] });
		expect(findConnections(current, [other])[0].shared).toEqual([{ name: "D", role: "director" }]);
	});
});
