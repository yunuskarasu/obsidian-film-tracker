import { describe, expect, it } from "vitest";
import type { AlbumMetadata, ArtistMetadata } from "../src/music";
import {
	albumTracksOf,
	buildAlbumNoteContent,
	buildArtistNoteContent,
	listenProgressOf,
	markAlbumListened,
	readTracks,
	refreshAlbumFrontmatter,
	refreshArtistFrontmatter,
	setArtistPhoto,
	tracksReadable,
	NO_MUSIC_LINKS,
} from "../src/music-note";
import { classifyNote } from "../src/note-kind";
import { parseYaml } from "obsidian";

/*
 * Artist and album notes as they are written, and what a refresh or a
 * "Listened today" may change in them — never what the user wrote.
 */

const hisaishi: ArtistMetadata = {
	name: "Joe Hisaishi",
	originalName: "久石譲",
	aliases: ["Joe Hisaishi", "久石譲"],
	type: "Person",
	country: "JP",
	begin: "1950-12-06",
	end: null,
	genres: ["classical", "cinematic classical"],
	mbArtistId: "44c64a30-1d58-49c5-b314-6e02fba49526",
	wikidataId: "Q275900",
	deezerId: "66582",
};

const okComputer: AlbumMetadata = {
	title: "OK Computer",
	artists: ["Radiohead"],
	year: 1997,
	albumType: "Album",
	genres: ["alternative rock", "art rock"],
	runtime: 53,
	tracks: [
		{ disc: null, n: 1, title: "Airbag", length: "4:44" },
		{ disc: null, n: 2, title: "Paranoid Android", length: "6:27" },
		{ disc: null, n: 3, title: "Subterranean Homesick Alien", length: "4:27" },
	],
	mbAlbumId: "b1392450-e666-3926-a536-22c65f834433",
	deezerAlbumIds: ["14879699"],
};

const frontmatter = (content: string) =>
	parseYaml(content.replace(/\r\n/g, "\n").split("---")[1]) as Record<string, unknown>;

describe("an artist note", () => {
	it("is written with both names, the dates a person has, the photo and who took it", () => {
		expect(buildArtistNoteContent(hisaishi, "[[Joe Hisaishi.jpg]]", "citykane · CC BY 2.0")).toBe(
			[
				"---",
				"name: Joe Hisaishi",
				"original_name: 久石譲",
				"aliases:",
				"  - Joe Hisaishi",
				"  - 久石譲",
				"type: Person",
				"country: JP",
				"born: 1950-12-06",
				"died:",
				"genres:",
				"  - classical",
				"  - cinematic classical",
				'poster: "[[Joe Hisaishi.jpg]]"',
				"photo_credit: citykane · CC BY 2.0",
				"mb_artist_id: 44c64a30-1d58-49c5-b314-6e02fba49526",
				"---",
				"",
			].join("\n"),
		);
	});

	it("gives a group the years it was formed and broke up, not a birthday", () => {
		const daftPunk = { ...hisaishi, name: "Daft Punk", originalName: null, aliases: ["Daft Punk"], type: "Group", begin: "1993", end: "2021-02-22" };
		const content = buildArtistNoteContent(daftPunk, null, null);
		expect(content).toContain("\nformed: 1993\ndisbanded: 2021-02-22\n");
		expect(content).not.toContain("born:");
		expect(content).toContain("\nposter:\nphoto_credit:\n");
	});

	it("is read as an artist, and never as anything the plugin already knew", () => {
		expect(classifyNote(frontmatter(buildArtistNoteContent(hisaishi, null, null)))).toEqual({
			kind: "artist",
			mbArtistId: hisaishi.mbArtistId,
		});
	});

	it("comes back from a refresh with nothing new byte for byte the same", () => {
		const note = buildArtistNoteContent(hisaishi, "[[Joe Hisaishi.jpg]]", "citykane · CC BY 2.0");
		expect(refreshArtistFrontmatter(note, hisaishi, null, frontmatter(note))).toBe(note);
		const crlf = note.replace(/\n/g, "\r\n");
		expect(refreshArtistFrontmatter(crlf, hisaishi, null, frontmatter(crlf))).toBe(crlf);
	});

	it("keeps the user's aliases, properties and body, and the photo already there", () => {
		const note =
			buildArtistNoteContent(hisaishi, "[[Mine.jpg]]", "me")
				.replace("  - 久石譲\n", "  - 久石譲\n  - Hisaishi-sensei\n")
				.replace("mb_artist_id:", "favourite: Nausicaä\nmb_artist_id:") + "\n## Notes\n\nMy own words.\n";
		const refreshed = refreshArtistFrontmatter(note, { ...hisaishi, genres: ["film score"] }, { link: "[[New.jpg]]", credit: "x" }, frontmatter(note));

		expect(refreshed).toContain("  - Hisaishi-sensei\n");
		expect(refreshed).toContain("favourite: Nausicaä\n");
		expect(refreshed).toContain('poster: "[[Mine.jpg]]"\nphoto_credit: me\n');
		expect(refreshed).toContain("genres:\n  - film score\n");
		expect(refreshed.endsWith("\n## Notes\n\nMy own words.\n")).toBe(true);
	});

	it("fills in a photo and its credit on a note that has none", () => {
		const note = buildArtistNoteContent(hisaishi, null, null);
		const refreshed = refreshArtistFrontmatter(note, hisaishi, { link: "[[Joe Hisaishi.jpg]]", credit: "citykane · CC BY 2.0" }, frontmatter(note));
		expect(refreshed).toContain('poster: "[[Joe Hisaishi.jpg]]"\nphoto_credit: citykane · CC BY 2.0\n');
	});
});

describe("Change photo", () => {
	it("swaps the photo and its credit, and nothing else", () => {
		const note = buildArtistNoteContent(hisaishi, "[[Joe Hisaishi.jpg]]", "citykane · CC BY 2.0") + "\nMy notes.\n";
		const changed = setArtistPhoto(note, "[[Joe Hisaishi 1.jpg]]", "Deezer");
		expect(changed).toBe(
			note.replace('poster: "[[Joe Hisaishi.jpg]]"\nphoto_credit: citykane · CC BY 2.0', 'poster: "[[Joe Hisaishi 1.jpg]]"\nphoto_credit: Deezer'),
		);
	});
});

describe("Change photo, to a picture of the user's own", () => {
	it("leaves the credit empty", () => {
		const note = buildArtistNoteContent(hisaishi, "[[Joe Hisaishi.jpg]]", "Deezer");
		expect(setArtistPhoto(note, "[[My photos/Joe.png]]", null)).toContain('poster: "[[My photos/Joe.png]]"\nphoto_credit:\n');
	});
});

describe("an album note", () => {
	const written = () => buildAlbumNoteContent(okComputer, "[[OK Computer (1997).jpg]]", NO_MUSIC_LINKS);

	it("is written with its facts, the listening fields, and one line per track", () => {
		expect(written()).toBe(
			[
				"---",
				"title: OK Computer",
				"artists:",
				"  - Radiohead",
				"year: 1997",
				"album_type: Album",
				"genres:",
				"  - alternative rock",
				"  - art rock",
				"runtime: 53",
				"tracks_count: 3",
				'poster: "[[OK Computer (1997).jpg]]"',
				"mb_album_id: b1392450-e666-3926-a536-22c65f834433",
				"listened: false",
				"listen_date:",
				"listen_count: 0",
				"tracks:",
				'  - { n: 1, title: Airbag, length: "4:44" }',
				'  - { n: 2, title: Paranoid Android, length: "6:27" }',
				'  - { n: 3, title: Subterranean Homesick Alien, length: "4:27" }',
				"---",
				"",
			].join("\n"),
		);
	});

	it("reads back exactly what it wrote, lengths as text", () => {
		const fm = frontmatter(written());
		expect(classifyNote(fm)).toEqual({ kind: "album", mbAlbumId: okComputer.mbAlbumId });
		expect(albumTracksOf(fm)[1]).toEqual({ disc: null, n: 2, title: "Paranoid Android", length: "6:27", extra: {} });
	});

	it("links an artist whose note exists — and only then", () => {
		const links = { artists: true, genres: false, isResolved: (name: string) => name === "Radiohead" };
		expect(buildAlbumNoteContent(okComputer, null, links)).toContain('artists:\n  - "[[Radiohead]]"\n');
		expect(buildAlbumNoteContent({ ...okComputer, artists: ["Someone Else"] }, null, links)).toContain("artists:\n  - Someone Else\n");
	});

	it("quotes a track title YAML would otherwise cut short", () => {
		const content = buildAlbumNoteContent(
			{ ...okComputer, tracks: [{ disc: 2, n: 4, title: "Everybody's Got Something to Hide Except Me and My Monkey, {live}", length: null }] },
			null,
			NO_MUSIC_LINKS,
		);
		expect(albumTracksOf(frontmatter(content))[0]).toMatchObject({
			disc: 2,
			title: "Everybody's Got Something to Hide Except Me and My Monkey, {live}",
			length: null,
		});
	});

	it("comes back from a refresh with nothing new byte for byte the same", () => {
		const note = written();
		expect(refreshAlbumFrontmatter(note, okComputer, NO_MUSIC_LINKS, null, frontmatter(note))).toBe(note);
	});

	it("never touches the listening, the cover, a key added to a track, the user's properties or the body", () => {
		const listened = markAlbumListened(written(), "2026-09-24", 0)
			.replace('title: Airbag, length: "4:44" }', 'title: Airbag, length: "4:44", favourite: true }')
			.replace("tracks:", "my_rating: 10\ntracks:") + "\nWhat a record.\n";
		const refreshed = refreshAlbumFrontmatter(
			listened,
			{ ...okComputer, genres: ["rock"], runtime: 54 },
			NO_MUSIC_LINKS,
			"[[Another.jpg]]",
			frontmatter(listened),
		);

		expect(refreshed).toContain("listened: true\nlisten_date: 2026-09-24\nlisten_count: 1\n");
		expect(refreshed).toContain('poster: "[[OK Computer (1997).jpg]]"');
		expect(refreshed).toContain('title: Airbag, length: "4:44", favourite: true }');
		expect(refreshed).toContain("my_rating: 10\n");
		expect(refreshed).toContain("genres:\n  - rock\n");
		expect(refreshed).toContain("runtime: 54\n");
		expect(refreshed.endsWith("\nWhat a record.\n")).toBe(true);
	});

	it("keeps an artist link the user made", () => {
		const note = written().replace("  - Radiohead", '  - "[[Radiohead]]"');
		expect(refreshAlbumFrontmatter(note, okComputer, NO_MUSIC_LINKS, null, frontmatter(note))).toContain('  - "[[Radiohead]]"');
	});

	it("leaves a note whose tracks can't be read exactly as it is", () => {
		const broken = written().replace('  - { n: 2, title: Paranoid Android, length: "6:27" }', "  - { title: no number }");
		expect(tracksReadable(broken)).toBe(false);
		expect(readTracks(["tracks:", "  - { title: no number }"])).toBeNull();
		expect(refreshAlbumFrontmatter(broken, okComputer, NO_MUSIC_LINKS, null)).toBe(broken);
	});
});

describe("Listened today", () => {
	it("ticks the album, dates it the first time, and counts every listen", () => {
		const once = markAlbumListened(buildAlbumNoteContent(okComputer, null, NO_MUSIC_LINKS), "2026-09-24", 0);
		expect(listenProgressOf(frontmatter(once))).toEqual({ listened: true, count: 1, date: "2026-09-24" });

		const twice = markAlbumListened(once, "2026-10-02", 1);
		expect(listenProgressOf(frontmatter(twice))).toEqual({ listened: true, count: 2, date: "2026-09-24" });
		expect(twice.replace("listen_count: 2", "listen_count: 1")).toBe(once);
	});

	it("counts a note the user edited by hand from what it says", () => {
		expect(listenProgressOf({ listened: true, listen_count: 7 }).count).toBe(7);
		expect(listenProgressOf({ listen_count: "many" }).count).toBe(0);
		expect(listenProgressOf(undefined)).toEqual({ listened: false, count: 0, date: null });
	});
});
