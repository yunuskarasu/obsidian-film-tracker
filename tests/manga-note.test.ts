import { describe, expect, it } from "vitest";
import {
	applyMangaBlock,
	mangaMalIdFrom,
	relinkMangaka,
	removeMangaBlock,
	replaceMangaBlock,
	setMangaRead,
} from "../src/manga-note";
import type { MangaMetadata } from "../src/mal";

const hxh: MangaMetadata = {
	title: "Hunter x Hunter",
	mediaType: "manga",
	status: "currently_publishing",
	year: 1998,
	chapters: 400,
	volumes: 37,
	mangaka: [{ name: "Yoshihiro Togashi", malId: 1893 }],
	malId: 26,
	posterUrl: "https://example.com/poster.jpg",
};

const neverResolved = () => false;
const alwaysResolved = () => true;

describe("applyMangaBlock", () => {
	it("writes a full manga block on an empty skeleton, with read initialized to false", () => {
		const content = applyMangaBlock("---\n---\n", hxh, "[[Attachments/HxH (Manga).jpg]]", neverResolved);
		expect(content).toBe(
			[
				"---",
				"manga:",
				"  mal_id: 26",
				"  title: Hunter x Hunter",
				"  media_type: manga",
				"  status: currently_publishing",
				"  year: 1998",
				"  chapters: 400",
				"  volumes: 37",
				"  mangaka:",
				"    - Yoshihiro Togashi",
				'  poster: "[[Attachments/HxH (Manga).jpg]]"',
				"  read: false",
				"---",
				"",
			].join("\n"),
		);
	});

	it("leaves the year line empty when MAL has none", () => {
		const content = applyMangaBlock("---\n---\n", { ...hxh, year: null }, null, neverResolved);
		expect(content).toContain("\n  year:\n");
	});

	it("links mangaka only when a note by that name already exists", () => {
		const linked = applyMangaBlock("---\n---\n", hxh, null, alwaysResolved);
		expect(linked).toContain('    - "[[Yoshihiro Togashi]]"');

		const unlinked = applyMangaBlock("---\n---\n", hxh, null, neverResolved);
		expect(unlinked).toContain("    - Yoshihiro Togashi");
	});

	it("leaves the poster line empty when there is no poster and none was downloaded", () => {
		const content = applyMangaBlock("---\n---\n", hxh, null, neverResolved);
		expect(content).toContain("\n  poster:\n");
	});

	it("preserves an existing read value across a refresh", () => {
		const withReadTrue = applyMangaBlock("---\n---\n", hxh, null, neverResolved).replace(
			"read: false",
			"read: true",
		);
		const refreshed = applyMangaBlock(withReadTrue, { ...hxh, chapters: 401 }, null, neverResolved);
		expect(refreshed).toContain("read: true");
		expect(refreshed).toContain("chapters: 401");
	});

	it("preserves a scalar sub-field the user hand-added under manga", () => {
		const withRating = [
			"---",
			"manga:",
			"  mal_id: 26",
			"  title: Hunter x Hunter",
			"  media_type: manga",
			"  status: currently_publishing",
			"  chapters: 400",
			"  volumes: 37",
			"  mangaka:",
			"    - Yoshihiro Togashi",
			"  poster:",
			"  read: false",
			"  rating: 9",
			"---",
			"",
		].join("\n");

		const refreshed = applyMangaBlock(withRating, { ...hxh, chapters: 401 }, null, neverResolved);
		expect(refreshed).toContain("chapters: 401");
		expect(refreshed).toContain("rating: 9");
	});

	it("preserves a list-type sub-field the user hand-added under manga", () => {
		const withTags = [
			"---",
			"manga:",
			"  mal_id: 26",
			"  title: Hunter x Hunter",
			"  media_type: manga",
			"  status: currently_publishing",
			"  chapters: 400",
			"  volumes: 37",
			"  mangaka:",
			"    - Yoshihiro Togashi",
			"  poster:",
			"  read: false",
			"  tags:",
			"    - shounen",
			"    - action",
			"---",
			"",
		].join("\n");

		const refreshed = applyMangaBlock(withTags, hxh, null, neverResolved);
		expect(refreshed).toContain("tags:");
		expect(refreshed).toContain("    - shounen");
		expect(refreshed).toContain("    - action");
	});

	it("never overwrites an existing poster, even when a new one is downloaded", () => {
		const first = applyMangaBlock("---\n---\n", hxh, "[[old-poster.jpg]]", neverResolved);
		const refreshed = applyMangaBlock(first, hxh, "[[new-poster.jpg]]", neverResolved);
		expect(refreshed).toContain('poster: "[[old-poster.jpg]]"');
		expect(refreshed).not.toContain("new-poster.jpg");
	});

	it("fills in a poster only when the poster field is empty", () => {
		const noPoster = applyMangaBlock("---\n---\n", hxh, null, neverResolved);
		const refreshed = applyMangaBlock(noPoster, hxh, "[[new-poster.jpg]]", neverResolved);
		expect(refreshed).toContain('poster: "[[new-poster.jpg]]"');
	});

	it("never touches top-level anime fields or the body on a merged Series note", () => {
		const animeNote = [
			"---",
			"title: Hunter x Hunter",
			"mal_id: 11061",
			"watched: true",
			"---",
			"",
			"My own thoughts.",
			"",
		].join("\n");

		const merged = applyMangaBlock(animeNote, hxh, null, neverResolved);
		expect(merged).toContain("title: Hunter x Hunter");
		expect(merged).toContain("mal_id: 11061");
		expect(merged).toContain("watched: true");
		expect(merged).toContain("My own thoughts.");
		expect(merged).toContain("manga:");
	});

	it("returns the content unchanged when there is no frontmatter", () => {
		expect(applyMangaBlock("No frontmatter here.", hxh, null, neverResolved)).toBe(
			"No frontmatter here.",
		);
	});
});

/**
 * A Series note that already carries both sides, plus a property and a body
 * the user owns — what "Change manga"/"Remove manga" have to leave alone
 * while correcting a wrongly linked manga.
 */
const mergedSeriesNote = [
	"---",
	"title: Hunter x Hunter",
	"english_title: Hunter x Hunter",
	"episodes: 148",
	'poster: "[[Attachments/Hunter x Hunter (2011).jpg]]"',
	"mal_id: 11061",
	"rating: 9",
	"watched: true",
	"manga:",
	"  mal_id: 21",
	"  title: Death Note",
	"  media_type: manga",
	"  status: finished",
	"  year: 2003",
	"  chapters: 108",
	"  volumes: 12",
	"  mangaka:",
	"    - Tsugumi Ohba",
	'  poster: "[[Attachments/Death Note (Manga).jpg]]"',
	"  read: true",
	"  note: bought volume 1",
	"---",
	"",
	"My own thoughts.",
	"",
].join("\n");

describe("applyMangaBlock: a mangaka already linked", () => {
	it("stays linked on refresh even while the mangaka's note doesn't exist", () => {
		const linked = applyMangaBlock("---\n---\n", hxh, null, alwaysResolved);
		const refreshed = applyMangaBlock(linked, hxh, null, neverResolved, {
			manga: { mangaka: ["[[Yoshihiro Togashi]]"] },
		});
		expect(refreshed).toContain('  mangaka:\n    - "[[Yoshihiro Togashi]]"\n');
	});
});

describe("replaceMangaBlock", () => {
	it("swaps in the new manga's own data, in the canonical field order", () => {
		const changed = replaceMangaBlock(mergedSeriesNote, hxh, "[[HxH (Manga).jpg]]", neverResolved);
		expect(changed).toContain("  mal_id: 26");
		expect(changed).toContain("  title: Hunter x Hunter");
		expect(changed).toContain("  chapters: 400");
		expect(changed).toContain("  volumes: 37");
		expect(changed).toContain("    - Yoshihiro Togashi");
		expect(changed).toContain('  poster: "[[HxH (Manga).jpg]]"');
	});

	it("carries nothing over from the manga that was replaced", () => {
		const changed = replaceMangaBlock(mergedSeriesNote, hxh, "[[HxH (Manga).jpg]]", neverResolved);
		expect(changed).not.toContain("Death Note");
		expect(changed).not.toContain("Tsugumi Ohba");
		expect(changed).not.toContain("note: bought volume 1");
		// read describes the previous, wrong manga — it starts over at false.
		expect(changed).toContain("  read: false");
	});

	it("leaves the anime side, its poster, watched, the user's own property and the body untouched", () => {
		const changed = replaceMangaBlock(mergedSeriesNote, hxh, null, neverResolved);
		expect(changed).toContain("title: Hunter x Hunter\n");
		expect(changed).toContain("episodes: 148");
		expect(changed).toContain('poster: "[[Attachments/Hunter x Hunter (2011).jpg]]"');
		expect(changed).toContain("mal_id: 11061");
		expect(changed).toContain("rating: 9");
		expect(changed).toContain("watched: true");
		expect(changed).toContain("My own thoughts.");
	});

	it("keeps the manga block where it already sat in the frontmatter", () => {
		const withTrailingKey = mergedSeriesNote.replace("---\n\nMy own", "tags:\n  - series\n---\n\nMy own");
		const changed = replaceMangaBlock(withTrailingKey, hxh, null, neverResolved);
		expect(changed.indexOf("manga:")).toBeLessThan(changed.indexOf("tags:"));
	});

	it("links mangaka only when a note by that name already exists, the same as a refresh", () => {
		expect(replaceMangaBlock(mergedSeriesNote, hxh, null, alwaysResolved)).toContain(
			"    - \"[[Yoshihiro Togashi]]\"",
		);
		expect(replaceMangaBlock(mergedSeriesNote, hxh, null, neverResolved)).toContain(
			"    - Yoshihiro Togashi",
		);
	});

	it("returns the content unchanged when there is no frontmatter", () => {
		expect(replaceMangaBlock("No frontmatter here.", hxh, null, neverResolved)).toBe(
			"No frontmatter here.",
		);
	});
});

describe("removeMangaBlock", () => {
	it("drops the whole manga block", () => {
		const removed = removeMangaBlock(mergedSeriesNote);
		expect(removed).not.toContain("manga:");
		expect(removed).not.toContain("Death Note");
		expect(removed).not.toContain("read: true");
		expect(removed).not.toContain("note: bought volume 1");
	});

	it("leaves the anime side, its poster, watched, the user's own property and the body untouched", () => {
		expect(removeMangaBlock(mergedSeriesNote)).toBe(
			[
				"---",
				"title: Hunter x Hunter",
				"english_title: Hunter x Hunter",
				"episodes: 148",
				'poster: "[[Attachments/Hunter x Hunter (2011).jpg]]"',
				"mal_id: 11061",
				"rating: 9",
				"watched: true",
				"---",
				"",
				"My own thoughts.",
				"",
			].join("\n"),
		);
	});

	it("leaves a note with no manga block exactly as it is", () => {
		const animeOnly = "---\ntitle: Hunter x Hunter\nmal_id: 11061\n---\n\nBody.\n";
		expect(removeMangaBlock(animeOnly)).toBe(animeOnly);
	});

	it("returns the content unchanged when there is no frontmatter", () => {
		expect(removeMangaBlock("No frontmatter here.")).toBe("No frontmatter here.");
	});
});

/**
 * `mangaMalIdFrom` is the guard behind the "Add mangaka" command (it only
 * runs when this returns non-null for the active file) and behind telling a
 * manga-only Series note apart from an anime-only one — so its correctness
 * here stands in for that guard logic, without needing an Obsidian `App`.
 */
describe("mangaMalIdFrom", () => {
	it("reads mal_id out of a nested manga block", () => {
		expect(mangaMalIdFrom({ manga: { mal_id: 26 } })).toBe(26);
	});

	it("returns null when there is no manga block at all", () => {
		expect(mangaMalIdFrom({ title: "Hunter x Hunter", mal_id: 11061 })).toBeNull();
		expect(mangaMalIdFrom({})).toBeNull();
		expect(mangaMalIdFrom(undefined)).toBeNull();
	});

	it("returns null when the manga block has no usable mal_id", () => {
		expect(mangaMalIdFrom({ manga: {} })).toBeNull();
		expect(mangaMalIdFrom({ manga: { mal_id: "26" } })).toBeNull();
		expect(mangaMalIdFrom({ manga: null })).toBeNull();
		expect(mangaMalIdFrom({ manga: "not an object" })).toBeNull();
	});

	it("never confuses a Series note's top-level anime mal_id with the manga one", () => {
		const merged = { title: "Hunter x Hunter", mal_id: 11061, manga: { mal_id: 26 } };
		expect(mangaMalIdFrom(merged)).toBe(26);
	});
});

describe("the manga block on a note with Windows (CRLF) line endings", () => {
	const crlf = [
		"---",
		"title: Hunter x Hunter",
		"manga:",
		"  mal_id: 26",
		"  read: false",
		"---",
		"Body",
		"",
	].join("\r\n");

	it("sets read and keeps the CRLF line endings", () => {
		expect(setMangaRead(crlf, true)).toBe(crlf.replace("read: false", "read: true"));
	});

	it("refreshes the block and keeps the CRLF line endings", () => {
		const result = applyMangaBlock(crlf, hxh, null, neverResolved);
		expect(result).toContain("  chapters: 400\r\n");
		expect(result.replace(/\r\n/g, "")).not.toContain("\n");
		expect(result.endsWith("---\r\nBody\r\n")).toBe(true);
	});
});

describe("relinkMangaka", () => {
	const withPlainMangaka = [
		"---",
		"manga:",
		"  mal_id: 26",
		"  title: Hunter x Hunter",
		"  media_type: manga",
		"  status: currently_publishing",
		"  year: 1998",
		"  chapters: 400",
		"  volumes: 37",
		"  mangaka:",
		"    - Yoshihiro Togashi",
		'  poster: "[[poster.jpg]]"',
		"  read: true",
		"  rating: 9",
		"---",
		"",
		"My own notes.",
		"",
	].join("\n");

	it("converts a plain name to a wikilink once it resolves", () => {
		const updated = relinkMangaka(withPlainMangaka, ["Yoshihiro Togashi"], alwaysResolved);
		expect(updated).toContain('    - "[[Yoshihiro Togashi]]"');
	});

	it("leaves a name untouched when it still doesn't resolve", () => {
		const updated = relinkMangaka(withPlainMangaka, ["Yoshihiro Togashi"], neverResolved);
		expect(updated).toContain("    - Yoshihiro Togashi");
		expect(updated).not.toContain("[[Yoshihiro Togashi]]");
	});

	it("doesn't re-wrap a name that's already a wikilink", () => {
		const alreadyLinked = withPlainMangaka.replace(
			"    - Yoshihiro Togashi",
			'    - "[[Yoshihiro Togashi]]"',
		);
		const updated = relinkMangaka(alreadyLinked, ["[[Yoshihiro Togashi]]"], alwaysResolved);
		expect(updated).toContain('    - "[[Yoshihiro Togashi]]"');
		expect(updated).not.toContain("[[[[Yoshihiro Togashi]]]]");
	});

	it("preserves read, poster, year, mal_id and an unknown sub-field", () => {
		const updated = relinkMangaka(withPlainMangaka, ["Yoshihiro Togashi"], alwaysResolved);
		expect(updated).toContain("mal_id: 26");
		expect(updated).toContain("year: 1998");
		expect(updated).toContain("read: true");
		expect(updated).toContain('poster: "[[poster.jpg]]"');
		expect(updated).toContain("rating: 9");
		expect(updated).toContain("My own notes.");
	});

	it("returns the content unchanged when there is no manga block", () => {
		const note = "---\ntitle: Something\n---\n\nBody.\n";
		expect(relinkMangaka(note, ["Someone"], alwaysResolved)).toBe(note);
	});

	it("returns the content unchanged when there is no frontmatter", () => {
		expect(relinkMangaka("No frontmatter here.", ["Someone"], alwaysResolved)).toBe(
			"No frontmatter here.",
		);
	});
});

describe("setMangaRead", () => {
	it("sets read to the value given, not a flip of what the file holds", () => {
		const created = applyMangaBlock("---\n---\n", hxh, null, neverResolved);
		expect(created).toContain("read: false");

		const readOnce = setMangaRead(created, true);
		expect(readOnce).toContain("read: true");
		expect(setMangaRead(readOnce, true)).toBe(readOnce);
		expect(setMangaRead(readOnce, false)).toBe(created);
	});

	it("leaves every other manga field and the body untouched", () => {
		const created = applyMangaBlock("---\n---\n", hxh, "[[poster.jpg]]", neverResolved);
		const read = setMangaRead(created + "My notes.\n", true);
		expect(read).toContain("chapters: 400");
		expect(read).toContain("volumes: 37");
		expect(read).toContain('poster: "[[poster.jpg]]"');
		expect(read).toContain("My notes.");
	});

	/** Regression: the old toggle rewrote every `read:` line, hoisting this one out of `progress` as a duplicate key. */
	it("never touches a read: the user nested under a field of their own", () => {
		const nested = ["---", "manga:", "  mal_id: 26", "  read: false", "  progress:", "    read: 12", "---", ""].join(
			"\n",
		);
		expect(setMangaRead(nested, true)).toBe(nested.replace("  read: false", "  read: true"));
	});

	it("gives back a read line to a block that lost it", () => {
		const note = ["---", "manga:", "  mal_id: 26", "  title: Hunter x Hunter", "---", ""].join("\n");
		expect(setMangaRead(note, true)).toContain("  title: Hunter x Hunter\n  read: true\n---");
	});

	it("returns the content unchanged when there is no manga block", () => {
		const note = "---\ntitle: Something\n---\n\nBody.\n";
		expect(setMangaRead(note, true)).toBe(note);
	});

	it("returns the content unchanged when there is no frontmatter", () => {
		expect(setMangaRead("No frontmatter here.", true)).toBe("No frontmatter here.");
	});
});

describe("applyMangaBlock: which read counts", () => {
	/** Regression: `read: True` is a YAML true, but a refresh used to reset it to false. */
	it("keeps a read written as True", () => {
		const note = ["---", "manga:", "  mal_id: 26", "  read: True", "---", ""].join("\n");
		expect(applyMangaBlock(note, hxh, null, neverResolved)).toContain("  read: true");
	});

	it("never takes a read nested under the user's own field for the block's own", () => {
		const note = ["---", "manga:", "  mal_id: 26", "  progress:", "    read: true", "  read: false", "---", ""].join(
			"\n",
		);
		const refreshed = applyMangaBlock(note, hxh, null, neverResolved);
		expect(refreshed).toContain("\n  read: false\n");
		expect(refreshed).toContain("  progress:\n    read: true");
	});
});
