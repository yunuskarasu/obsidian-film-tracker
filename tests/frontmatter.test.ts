import { describe, expect, it } from "vitest";
import {
	formatNames,
	refreshFrontmatter,
	relinkFrontmatter,
	setWatchDate,
	type FilmMetadata,
	type LinkOptions,
} from "../src/note";

const laLaLand: FilmMetadata = {
	title: "La La Land",
	originalTitle: "La La Land",
	year: 2016,
	directors: ["Damien Chazelle"],
	genres: ["Comedy", "Drama", "Romance"],
	cast: ["Ryan Gosling", "Emma Stone"],
	composers: ["Justin Hurwitz"],
	runtime: 129,
	tmdbId: 313369,
	posterPath: "/poster.jpg",
};

const resolves = (...existing: string[]) => (name: string) => existing.includes(name);

const linkDirectors = (...existing: string[]): LinkOptions => ({
	directors: true,
	genres: false,
	cast: false,
	composers: false,
	addCast: false,
	addComposers: false,
	castCount: 5,
	isResolved: resolves(...existing),
});

/** A note the user has since made their own: a rating, a watch date and a body. */
const userNote = [
	"---",
	"title: La La Land",
	"original_title: La La Land",
	"year: 2016",
	"directors:",
	"  - Damien Chazelle",
	"genres:",
	"  - Comedy",
	"  - Drama",
	"  - Romance",
	"runtime: 128",
	'poster: "[[La La Land (2016).jpg]]"',
	"tmdb_id: 313369",
	"watch_date: 2024-03-01",
	"rating: 8",
	"---",
	"",
	"My own notes about the film.",
	"Second line.",
	"",
].join("\n");

describe("formatNames", () => {
	it("links a name only when a note by that name exists", () => {
		expect(formatNames(["Damien Chazelle"], resolves("Damien Chazelle"))).toEqual([
			"[[Damien Chazelle]]",
		]);
		expect(formatNames(["Damien Chazelle"], resolves())).toEqual(["Damien Chazelle"]);
	});

	it("leaves names that are already links alone", () => {
		expect(formatNames(["[[Damien Chazelle]]"], resolves())).toEqual(["[[Damien Chazelle]]"]);
	});

	it("strips characters that would break the link before resolving", () => {
		expect(formatNames(["Bob | Alice"], resolves("Bob  Alice"))).toEqual(["[[Bob  Alice]]"]);
		expect(formatNames(["#Tag^Name"], resolves("TagName"))).toEqual(["[[TagName]]"]);
	});

	it("handles co-directors and empty lists", () => {
		expect(formatNames(["Joel Coen", "Ethan Coen"], resolves("Joel Coen"))).toEqual([
			"[[Joel Coen]]",
			"Ethan Coen",
		]);
		expect(formatNames([], resolves("Anyone"))).toEqual([]);
	});
});

describe("refreshFrontmatter", () => {
	it("rewrites the fields the plugin owns", () => {
		const result = refreshFrontmatter(userNote, laLaLand);
		expect(result).toContain("runtime: 129");
		expect(result).toContain("tmdb_id: 313369");
	});

	it("never touches watch_date", () => {
		expect(refreshFrontmatter(userNote, laLaLand)).toContain("watch_date: 2024-03-01");
	});

	it("never touches an existing watched value", () => {
		const watched = userNote.replace("watch_date: 2024-03-01", "watch_date: 2024-03-01\nwatched: true");
		expect(refreshFrontmatter(watched, laLaLand)).toContain("watched: true");
	});

	it("never invents a watched field on a note that predates it", () => {
		expect(refreshFrontmatter(userNote, laLaLand)).not.toContain("watched");
	});

	it("keeps an empty watch_date empty rather than writing null", () => {
		const unwatched = userNote.replace("watch_date: 2024-03-01", "watch_date:");
		const result = refreshFrontmatter(unwatched, laLaLand);
		expect(result).toContain("\nwatch_date:\n");
		expect(result).not.toContain("watch_date: null");
	});

	it("preserves properties the user added", () => {
		expect(refreshFrontmatter(userNote, laLaLand)).toContain("rating: 8");
	});

	it("preserves the body byte for byte", () => {
		const result = refreshFrontmatter(userNote, laLaLand);
		expect(result.split("---\n")[2]).toBe("\nMy own notes about the film.\nSecond line.\n");
	});

	it("preserves the existing key order", () => {
		const result = refreshFrontmatter(userNote, laLaLand);
		const keys = result
			.split("\n")
			.slice(1)
			.filter((line) => /^[a-z_]+:/.test(line))
			.map((line) => line.slice(0, line.indexOf(":")));
		expect(keys).toEqual([
			"title",
			"original_title",
			"year",
			"directors",
			"genres",
			"runtime",
			"poster",
			"tmdb_id",
			"watch_date",
			"rating",
			"aliases",
		]);
	});

	it("writes links when the setting is on and the note exists", () => {
		const result = refreshFrontmatter(userNote, laLaLand, linkDirectors("Damien Chazelle"));
		expect(result).toContain('  - "[[Damien Chazelle]]"');
	});

	it("leaves an existing poster alone", () => {
		const result = refreshFrontmatter(userNote, laLaLand, undefined, "[[Other.jpg]]");
		expect(result).toContain('poster: "[[La La Land (2016).jpg]]"');
		expect(result).not.toContain("Other.jpg");
	});

	it("fills in a poster that is missing", () => {
		const noPoster = userNote.replace('poster: "[[La La Land (2016).jpg]]"', "poster:");
		const result = refreshFrontmatter(noPoster, laLaLand, undefined, "[[La La Land (2016).jpg]]");
		expect(result).toContain('poster: "[[La La Land (2016).jpg]]"');
	});

	it("adds an owned key that the note is missing", () => {
		const withoutRuntime = userNote.replace("runtime: 128\n", "");
		expect(refreshFrontmatter(withoutRuntime, laLaLand)).toContain("runtime: 129");
	});

	it("returns notes without frontmatter untouched", () => {
		const plain = "# Just a note\n\nNothing structured here.\n";
		expect(refreshFrontmatter(plain, laLaLand)).toBe(plain);
	});

	it("adds aliases from title and original title on refresh", () => {
		const result = refreshFrontmatter(userNote, laLaLand);
		expect(result).toContain("aliases:\n  - La La Land\n");
	});

	it("recomputes aliases from fresh TMDB data instead of keeping stale ones", () => {
		const withStaleAliases = userNote.replace(
			"tmdb_id: 313369",
			"tmdb_id: 313369\naliases:\n  - Old Title",
		);
		const updatedFilm: FilmMetadata = { ...laLaLand, title: "New Title", originalTitle: "New Title" };
		const result = refreshFrontmatter(withStaleAliases, updatedFilm);
		expect(result).toContain("aliases:\n  - New Title\n");
		expect(result).not.toContain("Old Title");
	});

	it("still preserves watch_date and rating when aliases are refreshed", () => {
		const result = refreshFrontmatter(userNote, laLaLand);
		expect(result).toContain("watch_date: 2024-03-01");
		expect(result).toContain("rating: 8");
	});
});

describe("refreshFrontmatter: cast and composers", () => {
	const withCast: LinkOptions = {
		directors: false,
		genres: false,
		cast: false,
		composers: false,
		addCast: true,
		addComposers: true,
		castCount: 5,
		isResolved: resolves(),
	};

	it("adds cast and composers once their settings are turned on", () => {
		const result = refreshFrontmatter(userNote, laLaLand, withCast);
		expect(result).toContain("cast:\n  - Ryan Gosling\n  - Emma Stone");
		expect(result).toContain("composers:\n  - Justin Hurwitz");
	});

	it("leaves an existing cast field alone once the setting is turned back off", () => {
		const withCastField = refreshFrontmatter(userNote, laLaLand, withCast);
		const result = refreshFrontmatter(withCastField, laLaLand);
		expect(result).toContain("cast:\n  - Ryan Gosling\n  - Emma Stone");
	});
});

describe("setWatchDate", () => {
	it("fills in an empty watch_date", () => {
		const unwatched = userNote.replace("watch_date: 2024-03-01", "watch_date:");
		const result = setWatchDate(unwatched, "2024-06-15");
		expect(result).toContain("watch_date: 2024-06-15");
	});

	it("never overwrites an existing watch_date", () => {
		const result = setWatchDate(userNote, "2024-06-15");
		expect(result).toContain("watch_date: 2024-03-01");
		expect(result).not.toContain("2024-06-15");
	});

	it("preserves the body and the user's own properties", () => {
		const unwatched = userNote.replace("watch_date: 2024-03-01", "watch_date:");
		const result = setWatchDate(unwatched, "2024-06-15");
		expect(result).toContain("rating: 8");
		expect(result).toContain("My own notes about the film.");
	});

	it("returns notes without frontmatter untouched", () => {
		const plain = "# Just a note\n\nNothing structured here.\n";
		expect(setWatchDate(plain, "2024-06-15")).toBe(plain);
	});
});

describe("relinkFrontmatter", () => {
	it("links cast and composers when the values are given", () => {
		const withCastField = userNote.replace(
			"tmdb_id: 313369",
			"tmdb_id: 313369\ncast:\n  - Ryan Gosling",
		);
		const result = relinkFrontmatter(
			withCastField,
			{ cast: ["Ryan Gosling"] },
			resolves("Ryan Gosling"),
		);
		expect(result).toContain('  - "[[Ryan Gosling]]"');
	});

	it("links plain names whose notes now exist", () => {
		const result = relinkFrontmatter(
			userNote,
			{ directors: ["Damien Chazelle"] },
			resolves("Damien Chazelle"),
		);
		expect(result).toContain('  - "[[Damien Chazelle]]"');
	});

	it("leaves the note alone when nothing resolves", () => {
		expect(relinkFrontmatter(userNote, { directors: ["Damien Chazelle"] }, resolves())).toBe(
			userNote,
		);
	});

	it("does not touch fields it was not given", () => {
		const result = relinkFrontmatter(
			userNote,
			{ directors: ["Damien Chazelle"] },
			resolves("Damien Chazelle", "Drama"),
		);
		expect(result).toContain("  - Drama");
		expect(result).not.toContain("[[Drama]]");
	});

	it("keeps the body and the user's own properties", () => {
		const result = relinkFrontmatter(
			userNote,
			{ directors: ["Damien Chazelle"] },
			resolves("Damien Chazelle"),
		);
		expect(result).toContain("rating: 8");
		expect(result).toContain("watch_date: 2024-03-01");
		expect(result).toContain("My own notes about the film.");
	});
});
