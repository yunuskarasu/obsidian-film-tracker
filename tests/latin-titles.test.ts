import { beforeEach, describe, expect, it } from "vitest";
import type { AlbumSearchResult, MbRelease } from "../src/music";
import { latinReleasesOf } from "../src/music";
import { MusicActions } from "../src/music-actions";
import { albumTracksOf } from "../src/music-note";
import { lyricsQueryOf } from "../src/lyrics-service";
import { trackTitleShown } from "../src/panels/tracklist-panel";
import { albumsShown, latinTitleOf, VaultScan } from "../src/panels/vault-scan";
import { VaultNotes } from "../src/vault-notes";
import { FakeApp, settings } from "./fake-app";
import { fixture, idOf, replayClient } from "./music-fixtures";
import { Notice } from "./obsidian-stub";

/*
 * Albums titled in another script: their title and tracks in Latin letters
 * as well — romaji first, then English — shown or used as names only when
 * the settings say so, and never written into a note already in the vault.
 */

const ROMAJI = "Sen to Chihiro no Kamikakushi";
const ENGLISH = "Spirited Away Soundtrack";
const OWN = "千と千尋の神隠し サウンドトラック";

const result = (name: string): AlbumSearchResult => ({ id: idOf(`album-${name}`), title: "", albumType: "", year: null, artists: "" });
const ui = { pickPhoto: async () => null, pickVaultImage: async () => null, askImageUrl: async () => null, confirm: async () => null };

function setUp(overrides = {}, notes: Record<string, string> = {}) {
	const app = new FakeApp(notes);
	const music = new MusicActions(app.app, new VaultNotes(app.app), settings(overrides), ui);
	return { app, music, ...replayClient() };
}

const onlyNote = (app: FakeApp) => [...app.notes.keys()].find((path) => path.startsWith("Music/Albums/"))!;

beforeEach(() => {
	Notice.shown.length = 0;
});

describe("latinReleasesOf", () => {
	it("finds the romaji release first, then the English one", () => {
		const releases = fixture<{ releases: MbRelease[] }>("releases-spirited-away").releases;
		expect(latinReleasesOf(OWN, releases).map((release) => release.title)).toEqual([ROMAJI, ENGLISH]);
	});

	it("looks for none on an album titled in Latin letters already", () => {
		const releases = fixture<{ releases: MbRelease[] }>("releases-spirited-away").releases;
		expect(latinReleasesOf("OK Computer", releases)).toEqual([]);
	});
});

describe("getAlbum", () => {
	it("reads the Latin title with the releases, and the Latin tracks with one request more", async () => {
		const { client, web } = replayClient();
		const album = await client.getAlbum(idOf("album-spirited-away"), true);
		expect(album.latin?.titles).toEqual([ROMAJI, ENGLISH]);
		expect(album.latin?.tracks.slice(0, 2)).toEqual(["Ano Natsu he", "Toorimichi"]);
		expect(album.latin?.tracks).toHaveLength(album.tracks.length);
		expect(web.requests.filter((url) => url.includes("inc=recordings&"))).toHaveLength(2);
	});

	it("asks nothing more when not asked for it — a refresh — nor for an album in Latin letters", async () => {
		const { client, web } = replayClient();
		expect((await client.getAlbum(idOf("album-spirited-away"))).latin).toBeUndefined();
		expect(web.requests.filter((url) => url.includes("inc=recordings&"))).toHaveLength(1);
		expect((await client.getAlbum(idOf("album-ok-computer"), true)).latin).toBeUndefined();
	});
});

describe("Add album", () => {
	it("keeps its own title, with every form of it in aliases and each track's in its line", async () => {
		const { app, music, client } = setUp();
		await music.addAlbum(client, result("spirited-away"));
		const path = onlyNote(app);
		const note = app.note(path);

		expect(path).toBe(`Music/Albums/${OWN} (2001)/${OWN} (2001).md`);
		expect(note).toContain(`title: ${OWN}\naliases:\n  - ${ROMAJI}\n  - ${ENGLISH}\n  - ${OWN}\nartists:`);
		expect(note).not.toContain("original_title");
		expect(note).toContain("{ n: 1, title: あの夏へ, length: \"3:10\", latin: Ano Natsu he }");
	});

	it("is named and titled in Latin letters when asked, keeping its own title", async () => {
		const { app, music, client } = setUp({ latinNoteNames: true });
		await music.addAlbum(client, result("spirited-away"));
		const path = onlyNote(app);

		expect(path).toBe(`Music/Albums/${ROMAJI} (2001)/${ROMAJI} (2001).md`);
		expect(app.note(path)).toContain(`title: ${ROMAJI}\noriginal_title: ${OWN}\naliases:\n  - ${ROMAJI}\n`);
		expect(Notice.shown[Notice.shown.length - 1]).toBe(`Added ${ROMAJI}`);
	});

	it("writes an album titled in Latin letters exactly as before, whatever the settings", async () => {
		const off = setUp();
		await off.music.addAlbum(off.client, result("ok-computer"));
		const on = setUp({ latinNoteNames: true, showLatinTitles: true });
		await on.music.addAlbum(on.client, result("ok-computer"));

		const path = onlyNote(off.app);
		expect(on.app.note(path)).toBe(off.app.note(path));
		expect(off.app.note(path)).not.toMatch(/aliases|original_title|latin:/);
	});
});

describe("Refresh", () => {
	it("keeps a Latin-named album's title, its aliases and its tracks' Latin titles", async () => {
		const { app, music, client } = setUp({ latinNoteNames: true });
		await music.addAlbum(client, result("spirited-away"));
		const path = onlyNote(app);
		const written = app.note(path);

		await music.refresh(client, app.file(path));
		expect(app.note(path)).toBe(written);
	});

	it("adds nothing to an album note from before", async () => {
		const { app, music, client } = setUp();
		await music.addAlbum(client, result("spirited-away"));
		const path = onlyNote(app);
		// An album note as 3.3 wrote it: no aliases, no Latin titles.
		const before = app
			.note(path)
			.replace(/aliases:\n( {2}- .*\n)+/, "")
			.replace(/, latin: [^}]*\}/g, " }");
		app.notes.set(path, before);

		await music.refresh(client, app.file(path));
		expect(app.note(path)).toBe(before);
	});
});

describe("Add song", () => {
	it("names a song in Latin letters from its album's line, and still looks its lyrics up by its own title", async () => {
		const { app, music, client } = setUp({ latinNoteNames: true });
		await music.addAlbum(client, result("spirited-away"));
		const album = app.file(onlyNote(app));
		const first = albumTracksOf(app.frontmatter(album.path))[0];
		await music.addSong(client, album, first, false);

		const song = [...app.notes.keys()].find((path) => path.endsWith("/Ano Natsu he.md"))!;
		expect(song).toBe(`Music/Albums/${ROMAJI} (2001)/Ano Natsu he.md`);
		expect(app.note(song)).toContain("title: Ano Natsu he\noriginal_title: あの夏へ\naliases:\n  - Ano Natsu he (Joe Hisaishi)\n  - あの夏へ\n");
		expect(lyricsQueryOf(app.app, app.file(song))).toMatchObject({ title: "あの夏へ", album: OWN });
	});

	it("keeps a song's own title with the setting off", async () => {
		const { app, music, client } = setUp();
		await music.addAlbum(client, result("spirited-away"));
		const album = app.file(onlyNote(app));
		await music.addSong(client, album, albumTracksOf(app.frontmatter(album.path))[0], false);
		expect([...app.notes.keys()]).toContain(`Music/Albums/${OWN} (2001)/あの夏へ.md`);
	});
});

describe("showing titles in Latin letters", () => {
	it("takes an album's first alias in Latin letters, only for a title in another script", () => {
		expect(latinTitleOf(OWN, [ROMAJI, ENGLISH, OWN])).toBe(ROMAJI);
		expect(latinTitleOf(OWN, [OWN])).toBeNull();
		expect(latinTitleOf("OK Computer", ["OKC"])).toBeNull();
	});

	it("shows the panels' albums and tracks by them only with the setting on", async () => {
		const { app, music, client } = setUp();
		await music.addAlbum(client, result("spirited-away"));
		const albums = new VaultScan(app.app).albums();
		expect(albumsShown(albums, false)[0].title).toBe(OWN);
		expect(albumsShown(albums, true)[0].title).toBe(ROMAJI);

		const [track] = albumTracksOf(app.frontmatter(onlyNote(app)));
		expect(trackTitleShown(track)).toBe("Ano Natsu he");
		expect(trackTitleShown({ ...track, extra: {} })).toBe("あの夏へ");
	});
});
