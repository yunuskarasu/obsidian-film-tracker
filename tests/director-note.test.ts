import { describe, expect, it } from "vitest";
import {
	buildDirectorFileName,
	buildDirectorNoteContent,
	refreshDirectorFrontmatter,
} from "../src/director-note";
import type { DirectorMetadata } from "../src/tmdb";

/** No detectable original name: London is a Latin-script birthplace. */
const nolan: DirectorMetadata = {
	name: "Christopher Nolan",
	originalName: null,
	aliases: ["Christopher Nolan"],
	birthday: "1970-07-30",
	deathday: null,
	placeOfBirth: "London, England, UK",
	tmdbId: 525,
	photoPath: "/nolan.jpg",
};

/** A detectable original name, and a deceased director (deathday set). */
const tarkovsky: DirectorMetadata = {
	name: "Andrei Tarkovsky",
	originalName: "Андрей Арсеньевич Тарковский",
	aliases: ["Andrei Tarkovsky", "Андрей Арсеньевич Тарковский"],
	birthday: "1932-04-04",
	deathday: "1986-12-29",
	placeOfBirth: "Zavrazhye, USSR",
	tmdbId: 8452,
	photoPath: "/tarkovsky.jpg",
};

describe("buildDirectorFileName", () => {
	it("sanitizes the name the same way a film title is sanitized", () => {
		expect(buildDirectorFileName("David Lynch")).toBe("David Lynch");
		expect(buildDirectorFileName("Face/Off")).toBe("Face Off");
	});
});

describe("buildDirectorNoteContent", () => {
	it("writes name, original_name, aliases, birthday, deathday, place of birth, poster and tmdb_id", () => {
		const content = buildDirectorNoteContent(tarkovsky, "[[Directors/Andrei Tarkovsky.jpg]]");
		expect(content).toBe(
			[
				"---",
				"name: Andrei Tarkovsky",
				"original_name: Андрей Арсеньевич Тарковский",
				"aliases:",
				"  - Andrei Tarkovsky",
				"  - Андрей Арсеньевич Тарковский",
				"birthday: 1932-04-04",
				"deathday: 1986-12-29",
				"place_of_birth: Zavrazhye, USSR",
				'poster: "[[Directors/Andrei Tarkovsky.jpg]]"',
				"tmdb_id: 8452",
				"---",
				"",
			].join("\n"),
		);
	});

	it("leaves original_name empty and aliases to just the name when nothing was detected", () => {
		const content = buildDirectorNoteContent(nolan, null);
		expect(content).toContain("\noriginal_name:\n");
		expect(content).toContain("\naliases:\n  - Christopher Nolan\n");
	});

	it("leaves the poster line empty when there is no photo", () => {
		const content = buildDirectorNoteContent(nolan, null);
		expect(content).toContain("\nposter:\n");
	});

	it("leaves birthday, deathday and place of birth empty when TMDB has none", () => {
		const content = buildDirectorNoteContent(
			{ ...nolan, birthday: null, deathday: null, placeOfBirth: null },
			null,
		);
		expect(content).toContain("\nbirthday: \n");
		expect(content).toContain("\ndeathday: \n");
		expect(content).toContain("\nplace_of_birth:\n");
	});
});

describe("refreshDirectorFrontmatter", () => {
	const existingNote = [
		"---",
		"name: Andrei Tarkovsky",
		"original_name: Андрей Арсеньевич Тарковский",
		"aliases:",
		"  - Andrei Tarkovsky",
		"  - Андрей Арсеньевич Тарковский",
		"birthday: 1932-04-04",
		"deathday: 1986-12-29",
		"place_of_birth: Zavrazhye, USSR",
		'poster: "[[Directors/Andrei Tarkovsky.jpg]]"',
		"tmdb_id: 8452",
		"---",
		"",
		"My own notes about this director.",
		"",
	].join("\n");

	it("rewrites only the plugin-owned fields, leaving the body untouched", () => {
		const updated = refreshDirectorFrontmatter(existingNote, {
			...tarkovsky,
			deathday: "1986-12-30",
		});
		expect(updated).toContain("deathday: 1986-12-30");
		expect(updated).toContain("My own notes about this director.");
	});

	it("trims a note's old bloated aliases list down on refresh", () => {
		const bloated = existingNote.replace(
			"aliases:\n  - Andrei Tarkovsky\n  - Андрей Арсеньевич Тарковский",
			"aliases:\n  - Andrei Tarkovsky\n  - Andrei Tarkovskiy\n  - 安德烈·塔尔科夫斯基\n  - Андрей Арсеньевич Тарковский",
		);
		const updated = refreshDirectorFrontmatter(bloated, tarkovsky);
		expect(updated).toContain(
			"aliases:\n  - Andrei Tarkovsky\n  - Андрей Арсеньевич Тарковский",
		);
		expect(updated).not.toContain("Andrei Tarkovskiy");
	});

	it("never overwrites an existing photo", () => {
		const updated = refreshDirectorFrontmatter(existingNote, tarkovsky, "[[new-photo.jpg]]");
		expect(updated).toContain('poster: "[[Directors/Andrei Tarkovsky.jpg]]"');
	});

	it("fills in a photo only when the poster field is empty", () => {
		const noPhoto = existingNote.replace(
			'poster: "[[Directors/Andrei Tarkovsky.jpg]]"',
			"poster:",
		);
		const updated = refreshDirectorFrontmatter(noPhoto, tarkovsky, "[[new-photo.jpg]]");
		expect(updated).toContain('poster: "[[new-photo.jpg]]"');
	});

	it("preserves a property the user added and the key order", () => {
		const withExtra = existingNote.replace(
			"tmdb_id: 8452",
			"tmdb_id: 8452\nfavorite: true",
		);
		const updated = refreshDirectorFrontmatter(withExtra, tarkovsky);
		expect(updated).toContain("favorite: true");
	});

	it("returns the content unchanged when there is no frontmatter", () => {
		expect(refreshDirectorFrontmatter("No frontmatter here.", tarkovsky)).toBe(
			"No frontmatter here.",
		);
	});
});
