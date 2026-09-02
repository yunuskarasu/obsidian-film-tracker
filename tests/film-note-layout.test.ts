import { describe, expect, it } from "vitest";
import { parseWikilink } from "../src/note";

describe("parseWikilink", () => {
	it("reads the target of a plain wikilink", () => {
		expect(parseWikilink("[[Stalker (1979).jpg]]")).toBe("Stalker (1979).jpg");
		expect(parseWikilink("[[Afiş/Stalker (1979).jpg]]")).toBe("Afiş/Stalker (1979).jpg");
	});

	it("drops an alias", () => {
		expect(parseWikilink("[[poster.jpg|Stalker]]")).toBe("poster.jpg");
	});

	it("tolerates surrounding whitespace", () => {
		expect(parseWikilink("  [[poster.jpg]]  ")).toBe("poster.jpg");
	});

	it("returns null for anything that is not a wikilink", () => {
		expect(parseWikilink("")).toBeNull();
		expect(parseWikilink(undefined)).toBeNull();
		expect(parseWikilink(null)).toBeNull();
		expect(parseWikilink(1398)).toBeNull();
		expect(parseWikilink("poster.jpg")).toBeNull();
		expect(parseWikilink("https://image.tmdb.org/t/p/w500/x.jpg")).toBeNull();
		expect(parseWikilink("[[unclosed")).toBeNull();
	});
});
