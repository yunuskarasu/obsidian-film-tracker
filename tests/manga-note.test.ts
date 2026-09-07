import { describe, expect, it } from "vitest";
import {
	applyMangaBlock,
	isAnimeOnlySeriesFrontmatter,
	isMangaOnlySeriesFrontmatter,
	mangaMalIdFrom,
	relinkMangaka,
	toggleMangaRead,
} from "../src/manga-note";
import type { MangaMetadata } from "../src/mal";

const hxh: MangaMetadata = {
	title: "Hunter x Hunter",
	englishTitle: "Hunter x Hunter",
	japaneseTitle: "HUNTER×HUNTER",
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

/**
 * Regression coverage for a real bug: a mangaka note (`name` + `mal_id`, no
 * `manga` block) matches the exact same frontmatter shape an anime-only
 * Series note has, since both deliberately use the top-level `mal_id`
 * field. Without the `isMangakaNote` guard, Add manga would merge a `manga:`
 * block straight into a mangaka note.
 */
describe("isAnimeOnlySeriesFrontmatter / isMangaOnlySeriesFrontmatter", () => {
	const mangakaNote = { name: "Hirohiko Araki", mal_id: 1868 };
	const animeOnlySeries = { title: "Shingeki no Kyojin", mal_id: 16498 };
	const mangaOnlySeries = { manga: { mal_id: 26 } };
	const corruptedMangakaNote = { name: "Hirohiko Araki", mal_id: 1868, manga: { mal_id: 401 } };

	it("a mangaka note is never an Add manga merge target", () => {
		expect(isAnimeOnlySeriesFrontmatter(mangakaNote, true)).toBe(false);
	});

	it("a mangaka note is never an Add anime merge target", () => {
		expect(isMangaOnlySeriesFrontmatter(mangakaNote, true)).toBe(false);
	});

	it("a real anime-only Series note can still be merged into by Add manga", () => {
		expect(isAnimeOnlySeriesFrontmatter(animeOnlySeries, false)).toBe(true);
	});

	it("a real manga-only Series note can still be merged into by Add anime", () => {
		expect(isMangaOnlySeriesFrontmatter(mangaOnlySeries, false)).toBe(true);
	});

	it("an anime-only Series note is never mistaken for a manga-only one", () => {
		expect(isMangaOnlySeriesFrontmatter(animeOnlySeries, false)).toBe(false);
	});

	it("a manga-only Series note is never mistaken for an anime-only one", () => {
		expect(isAnimeOnlySeriesFrontmatter(mangaOnlySeries, false)).toBe(false);
	});

	it("stays false for both even on an already-corrupted mangaka note with a stray manga block", () => {
		expect(isAnimeOnlySeriesFrontmatter(corruptedMangakaNote, true)).toBe(false);
		expect(isMangaOnlySeriesFrontmatter(corruptedMangakaNote, true)).toBe(false);
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

describe("toggleMangaRead", () => {
	it("flips read from false to true and back", () => {
		const created = applyMangaBlock("---\n---\n", hxh, null, neverResolved);
		expect(created).toContain("read: false");

		const toggledOn = toggleMangaRead(created);
		expect(toggledOn).toContain("read: true");

		const toggledOff = toggleMangaRead(toggledOn);
		expect(toggledOff).toContain("read: false");
	});

	it("leaves every other manga field and the body untouched", () => {
		const created = applyMangaBlock("---\n---\n", hxh, "[[poster.jpg]]", neverResolved);
		const toggled = toggleMangaRead(created + "My notes.\n");
		expect(toggled).toContain("chapters: 400");
		expect(toggled).toContain("volumes: 37");
		expect(toggled).toContain('poster: "[[poster.jpg]]"');
		expect(toggled).toContain("My notes.");
	});

	it("returns the content unchanged when there is no manga block", () => {
		const note = "---\ntitle: Something\n---\n\nBody.\n";
		expect(toggleMangaRead(note)).toBe(note);
	});

	it("returns the content unchanged when there is no frontmatter", () => {
		expect(toggleMangaRead("No frontmatter here.")).toBe("No frontmatter here.");
	});
});
