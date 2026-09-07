import { describe, expect, it } from "vitest";
import {
	buildMangakaFileName,
	buildMangakaNoteContent,
	refreshMangakaFrontmatter,
} from "../src/mangaka-note";
import type { MangakaMetadata } from "../src/mal";

const togashi: MangakaMetadata = {
	name: "Yoshihiro Togashi",
	birthday: "1966-04-27",
	malId: 1893,
	photoUrl: "https://example.com/togashi.jpg",
};

describe("buildMangakaFileName", () => {
	it("sanitizes the name the same way a director's is sanitized", () => {
		expect(buildMangakaFileName("Yoshihiro Togashi")).toBe("Yoshihiro Togashi");
		expect(buildMangakaFileName("Question/Mark")).toBe("Question Mark");
	});
});

describe("buildMangakaNoteContent", () => {
	it("writes name, birthday, poster and mal_id", () => {
		const content = buildMangakaNoteContent(togashi, "[[Mangaka/Yoshihiro Togashi.jpg]]");
		expect(content).toBe(
			[
				"---",
				"name: Yoshihiro Togashi",
				"birthday: 1966-04-27",
				'poster: "[[Mangaka/Yoshihiro Togashi.jpg]]"',
				"mal_id: 1893",
				"---",
				"",
			].join("\n"),
		);
	});

	it("leaves the poster line empty when there is no photo", () => {
		const content = buildMangakaNoteContent(togashi, null);
		expect(content).toContain("\nposter:\n");
	});

	it("leaves birthday empty when MAL has none", () => {
		const content = buildMangakaNoteContent({ ...togashi, birthday: null }, null);
		expect(content).toContain("\nbirthday: \n");
	});
});

describe("refreshMangakaFrontmatter", () => {
	const existingNote = [
		"---",
		"name: Yoshihiro Togashi",
		"birthday: 1966-04-27",
		'poster: "[[Mangaka/Yoshihiro Togashi.jpg]]"',
		"mal_id: 1893",
		"---",
		"",
		"My own notes about this mangaka.",
		"",
	].join("\n");

	it("rewrites only the plugin-owned fields, leaving the body untouched", () => {
		const updated = refreshMangakaFrontmatter(existingNote, { ...togashi, birthday: "1966-04-28" });
		expect(updated).toContain("birthday: 1966-04-28");
		expect(updated).toContain("My own notes about this mangaka.");
	});

	it("never overwrites an existing photo", () => {
		const updated = refreshMangakaFrontmatter(existingNote, togashi, "[[new-photo.jpg]]");
		expect(updated).toContain('poster: "[[Mangaka/Yoshihiro Togashi.jpg]]"');
	});

	it("fills in a photo only when the poster field is empty", () => {
		const noPhoto = existingNote.replace(
			'poster: "[[Mangaka/Yoshihiro Togashi.jpg]]"',
			"poster:",
		);
		const updated = refreshMangakaFrontmatter(noPhoto, togashi, "[[new-photo.jpg]]");
		expect(updated).toContain('poster: "[[new-photo.jpg]]"');
	});

	it("preserves a property the user added and the key order", () => {
		const withExtra = existingNote.replace("mal_id: 1893", "mal_id: 1893\nfavorite: true");
		const updated = refreshMangakaFrontmatter(withExtra, togashi);
		expect(updated).toContain("favorite: true");
	});

	it("returns the content unchanged when there is no frontmatter", () => {
		expect(refreshMangakaFrontmatter("No frontmatter here.", togashi)).toBe(
			"No frontmatter here.",
		);
	});
});
