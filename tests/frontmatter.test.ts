import { describe, expect, it } from "vitest";
import {
	formatNames,
	markWatched,
	parseFrontmatterBlocks,
	refreshFrontmatter,
	relinkFrontmatter,
	serializeFrontmatterBlocks,
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

/** `previous` is what Obsidian parsed from the note before the refresh, as main.ts passes it. */
describe("refreshFrontmatter: aliases the user added", () => {
	const withOwnAlias = userNote.replace(
		"tmdb_id: 313369",
		"tmdb_id: 313369\naliases:\n  - La La Land\n  - Aşıklar Şehri",
	);
	const previous = {
		title: "La La Land",
		original_title: "La La Land",
		aliases: ["La La Land", "Aşıklar Şehri"],
	};

	/** Regression: a refresh used to rebuild the list from TMDB alone, deleting this alias. */
	it("keeps an alias the user added", () => {
		const result = refreshFrontmatter(withOwnAlias, laLaLand, undefined, null, previous);
		expect(result).toContain("aliases:\n  - La La Land\n  - Aşıklar Şehri\n");
	});

	it("still replaces the aliases it wrote itself when TMDB's titles have changed", () => {
		const renamed = withOwnAlias.replace("aliases:\n  - La La Land", "aliases:\n  - Old Title");
		const result = refreshFrontmatter(renamed, laLaLand, undefined, null, {
			title: "Old Title",
			original_title: "Old Title",
			aliases: ["Old Title", "Aşıklar Şehri"],
		});
		expect(result).toContain("aliases:\n  - La La Land\n  - Aşıklar Şehri\n");
		expect(result).not.toContain("Old Title");
	});

	it("writes an alias only once when the user's matches a generated one", () => {
		// "La La Land" here isn't one the plugin wrote (the old titles were
		// different), yet it equals the new title: it must not appear twice.
		const result = refreshFrontmatter(withOwnAlias, laLaLand, undefined, null, {
			...previous,
			title: "Old Title",
			original_title: "Old Original",
		});
		expect(result).toContain("aliases:\n  - La La Land\n  - Aşıklar Şehri\n");
	});

	it("keeps an alias YAML read as a number", () => {
		const result = refreshFrontmatter(withOwnAlias, laLaLand, undefined, null, {
			...previous,
			aliases: ["La La Land", 2016],
		});
		expect(result).toContain('aliases:\n  - La La Land\n  - "2016"\n');
	});
});

describe("refreshFrontmatter: links already in the note", () => {
	const linked = userNote
		.replace("  - Damien Chazelle", '  - "[[Damien Chazelle]]"')
		.replace("  - Drama", '  - "[[Drama|Dram]]"');
	const previous = { directors: ["[[Damien Chazelle]]"], genres: ["Comedy", "[[Drama|Dram]]", "Romance"] };

	/** Regression: with "Link directors" off, a refresh wrote every director back as plain text. */
	it("keeps them with the Link settings off", () => {
		const result = refreshFrontmatter(linked, laLaLand, undefined, null, previous);
		expect(result).toContain('directors:\n  - "[[Damien Chazelle]]"\n');
		expect(result).toContain('genres:\n  - Comedy\n  - "[[Drama|Dram]]"\n  - Romance\n');
	});

	it("keeps one whose note doesn't exist yet with the setting on", () => {
		const result = refreshFrontmatter(linked, laLaLand, linkDirectors(), null, previous);
		expect(result).toContain('directors:\n  - "[[Damien Chazelle]]"\n');
	});
});

describe("lines before the first property", () => {
	const commented = userNote.replace("---\ntitle:", "---\n# Kept by hand, see README\n\ntitle:");

	/** Regression: a comment above the first property was deleted by every rewrite. */
	it("are read and written back as they are", () => {
		const doc = parseFrontmatterBlocks(commented);
		if (doc === null) throw new Error("The note should parse");
		expect(doc.preamble).toEqual(["# Kept by hand, see README", ""]);
		expect(serializeFrontmatterBlocks(doc)).toBe(commented);
	});

	it("survive a refresh and ticking watched", () => {
		const refreshed = refreshFrontmatter(commented, laLaLand);
		expect(refreshed.startsWith("---\n# Kept by hand, see README\n\ntitle: La La Land\n")).toBe(true);
		expect(markWatched(commented).startsWith("---\n# Kept by hand, see README\n\ntitle:")).toBe(true);
	});

	it("keep their place in frontmatter that has nothing else yet", () => {
		const doc = parseFrontmatterBlocks("---\n# empty for now\n---\nBody\n");
		if (doc === null) throw new Error("The note should parse");
		expect(serializeFrontmatterBlocks(doc)).toBe("---\n# empty for now\n---\nBody\n");
	});
});

describe("frontmatter with Windows (CRLF) line endings", () => {
	const crlfNote = userNote.replace(/\n/g, "\r\n");

	/** Regression: a CRLF note used to parse as "no frontmatter", so every rewrite silently did nothing. */
	it("reads the note and writes it back byte for byte", () => {
		const doc = parseFrontmatterBlocks(crlfNote);
		if (doc === null) throw new Error("A CRLF note should parse");
		expect(doc.order).toContain("tmdb_id");
		expect(serializeFrontmatterBlocks(doc)).toBe(crlfNote);
	});

	it("refreshes it, keeping CRLF line endings throughout", () => {
		const result = refreshFrontmatter(crlfNote, laLaLand);
		expect(result).toContain("runtime: 129\r\n");
		expect(result.replace(/\r\n/g, "")).not.toContain("\n");
		expect(result.endsWith("\r\nMy own notes about the film.\r\nSecond line.\r\n")).toBe(true);
	});

	it("fills in watch_date on it", () => {
		const unwatched = crlfNote.replace("watch_date: 2024-03-01", "watch_date:");
		expect(setWatchDate(unwatched, "2024-06-15")).toBe(crlfNote.replace("2024-03-01", "2024-06-15"));
	});

	it("never adds a carriage return to a note written with plain LF endings", () => {
		expect(refreshFrontmatter(userNote, laLaLand)).not.toContain("\r");
	});
});

describe("markWatched", () => {
	const unwatched = userNote.replace("rating: 8", "rating: 8\nwatched: false");

	it("ticks watched", () => {
		expect(markWatched(unwatched)).toBe(unwatched.replace("watched: false", "watched: true"));
	});

	it("fills in an empty watched", () => {
		const empty = unwatched.replace("watched: false", "watched:");
		expect(markWatched(empty)).toContain("\nwatched: true\n");
	});

	it("leaves a note that is already ticked exactly as it is", () => {
		const watched = unwatched.replace("watched: false", "watched: true");
		expect(markWatched(watched)).toBe(watched);
	});

	it("adds watched to a note that predates the field", () => {
		expect(markWatched(userNote)).toContain("rating: 8\nwatched: true\n---");
	});

	it("preserves the body and the user's own properties", () => {
		const result = markWatched(unwatched);
		expect(result).toContain("rating: 8");
		expect(result).toContain("watch_date: 2024-03-01");
		expect(result).toContain("My own notes about the film.");
	});

	it("returns notes without frontmatter untouched", () => {
		const plain = "# Just a note\n\nNothing structured here.\n";
		expect(markWatched(plain)).toBe(plain);
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
