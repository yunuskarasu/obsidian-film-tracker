import { beforeEach, describe, expect, it } from "vitest";
import type { ConfirmAnswer, ConfirmRequest } from "../src/confirm-modal";
import type { AlbumSearchResult, ArtistSearchResult } from "../src/music";
import { MusicActions } from "../src/music-actions";
import type { PhotoCandidate } from "../src/musicbrainz";
import type { PhotoChoice } from "../src/photo-picker-modal";
import type { TFile } from "obsidian";
import type { FilmTrackerSettings } from "../src/settings";
import { songNoteFor, VaultScan } from "../src/panels/vault-scan";
import { VaultNotes } from "../src/vault-notes";
import { FakeApp, settings } from "./fake-app";
import { idOf, replayClient } from "./music-fixtures";
import { Notice } from "./obsidian-stub";

/*
 * Add artist, Add album, Refresh and Listened today end to end: the real
 * MusicBrainz client on its saved answers, writing into the in-memory vault.
 * Above all, each command writes the one note it was asked for.
 */

/**
 * Makes the choice `pick` makes in "Change photo" — none when it returns
 * `null` — answers every "Delete?" with `answer`, and hands over `vaultImage`
 * and `url` when asked for a picture from the vault or a web address.
 */
function musicUi(
	pick: (candidates: PhotoCandidate[]) => PhotoChoice | null = () => null,
	answer: ConfirmAnswer = null,
	vaultImage: TFile | null = null,
	url: string | null = null,
) {
	const offered: PhotoCandidate[][] = [];
	const confirmed: ConfirmRequest[] = [];
	const ui = {
		pickPhoto: async (_name: string, candidates: PhotoCandidate[]) => {
			offered.push(candidates);
			return pick(candidates);
		},
		pickVaultImage: async () => vaultImage,
		askImageUrl: async () => url,
		confirm: async (request: ConfirmRequest) => {
			confirmed.push(request);
			return answer;
		},
	};
	return { ui, offered, confirmed };
}

function setUp(notes: Record<string, string> = {}, overrides = {}, ui = musicUi().ui) {
	const app = new FakeApp(notes);
	const music = new MusicActions(app.app, new VaultNotes(app.app), settings(overrides), ui);
	return { app, music, ...replayClient() };
}

const album = (name: string, title: string): AlbumSearchResult => ({
	id: idOf(`album-${name}`),
	title,
	albumType: "Album",
	year: null,
	artists: "",
});

const artist = (name: string, shown: string): ArtistSearchResult => ({
	id: idOf(`artist-${name}`),
	name: shown,
	originalName: null,
	details: [],
});

beforeEach(() => {
	Notice.shown.length = 0;
});

describe("Add album", () => {
	it("writes the album's note and cover into the music folders", async () => {
		const { app, music, client } = setUp();
		await music.addAlbum(client, album("ok-computer", "OK Computer"));

		const note = app.note("Music/Albums/OK Computer (1997)/OK Computer (1997).md");
		expect(note).toContain("title: OK Computer\n");
		expect(note).toContain("tracks_count: 12\n");
		expect(note).toContain('poster: "[[OK Computer (1997).jpg]]"');
		expect(app.images.has("Music/Pics/Covers/OK Computer (1997).jpg")).toBe(true);
		expect(app.opened).toEqual(["Music/Albums/OK Computer (1997)/OK Computer (1997).md"]);
		expect(Notice.shown).toEqual(["Adding OK Computer…", "Added OK Computer"]);
	});

	it("never creates the artist's note, nor any other", async () => {
		const { app, music, client } = setUp();
		await music.addAlbum(client, album("cowboy-bebop", "COWBOY BEBOP"));

		expect([...app.notes.keys()]).toEqual(["Music/Albums/COWBOY BEBOP (1998)/COWBOY BEBOP (1998).md"]);
		// The artists are named — in English, the way their own notes would be — and nothing more.
		expect(app.note("Music/Albums/COWBOY BEBOP (1998)/COWBOY BEBOP (1998).md")).toContain("artists:\n  - Yoko Kanno\n  - The Seatbelts\n");
	});

	it("links an artist whose note is already there", async () => {
		const { app, music, client } = setUp({ "Music/Artists/Radiohead.md": "---\nname: Radiohead\nmb_artist_id: a74b\n---\n" });
		await music.addAlbum(client, album("my-iron-lung", "My Iron Lung"));
		expect(app.note("Music/Albums/My Iron Lung (1994)/My Iron Lung (1994).md")).toContain('artists:\n  - "[[Radiohead]]"\n');
	});

	it("leaves an artist unlinked when Link artists is off", async () => {
		const { app, music, client } = setUp({ "Music/Artists/Radiohead.md": "---\nname: Radiohead\n---\n" }, { linkArtists: false });
		await music.addAlbum(client, album("my-iron-lung", "My Iron Lung"));
		expect(app.note("Music/Albums/My Iron Lung (1994)/My Iron Lung (1994).md")).toContain("artists:\n  - Radiohead\n");
	});

	it("opens the note it already has rather than writing a second one", async () => {
		const { app, music, client, web } = setUp();
		await music.addAlbum(client, album("ok-computer", "OK Computer"));
		const requests = web.requests.length;
		Notice.shown.length = 0;

		await music.addAlbum(client, album("ok-computer", "OK Computer"));
		expect([...app.notes.keys()]).toHaveLength(1);
		expect(Notice.shown).toEqual(["Already in your vault: OK Computer (1997)"]);
		// Found in the vault before anything is asked of MusicBrainz.
		expect(web.requests.length).toBe(requests);
	});

	it("says so when no cover was found, and writes the note all the same", async () => {
		const app = new FakeApp();
		const music = new MusicActions(app.app, new VaultNotes(app.app), settings(), musicUi().ui);
		const { client } = replayClient((url) => !url.includes("coverartarchive"));
		await music.addAlbum(client, album("sozum-meclisten-disari", "Sözüm Meclisten Dışarı"));

		expect(app.note("Music/Albums/Sözüm Meclisten Dışarı (1981)/Sözüm Meclisten Dışarı (1981).md")).toContain("\nposter:\n");
		expect(Notice.shown[Notice.shown.length - 1]).toBe("Added Sözüm Meclisten Dışarı. No cover was found.");
	});

	it("follows the folders the user set", async () => {
		const { app, music, client } = setUp({}, { albumFolder: "Plaklar", albumCoverFolder: "" });
		await music.addAlbum(client, album("gulumse", "Gülümse"));
		expect(app.notes.has("Plaklar/Gülümse (1991)/Gülümse (1991).md")).toBe(true);
		expect(app.images.has("Music/Pics/Covers/Gülümse (1991).jpg")).toBe(false);
	});
});

describe("Add song", () => {
	const ABBEY_ROAD = "Music/Albums/Abbey Road (1969)/Abbey Road (1969).md";
	const SUN = "Music/Albums/Abbey Road (1969)/Here Comes the Sun.md";
	const sun = { disc: null, n: 7, title: "Here Comes the Sun" };

	async function withAbbeyRoad(overrides: Partial<FilmTrackerSettings> = {}, images?: (url: string) => boolean) {
		const app = new FakeApp();
		const music = new MusicActions(app.app, new VaultNotes(app.app), settings(overrides), musicUi().ui);
		const { client, web } = replayClient(images);
		await music.addAlbum(client, album("abbey-road", "Abbey Road"));
		app.opened.length = 0;
		Notice.shown.length = 0;
		const albumFile = app.file(overrides.albumFolderNotes === false ? "Music/Albums/Abbey Road (1969).md" : ABBEY_ROAD);
		return { app, music, client, web, albumFile };
	}

	it("writes the one song's note, linking its album and the album's own cover", async () => {
		const { app, music, client, albumFile } = await withAbbeyRoad();
		const images = [...app.images];
		await music.addSong(client, albumFile, sun, true);

		expect(app.frontmatter(SUN)).toMatchObject({
			title: "Here Comes the Sun",
			artists: ["The Beatles"],
			album: "[[Abbey Road (1969)]]",
			track: 7,
			length: "3:06",
			year: 1969,
			poster: "[[Abbey Road (1969).jpg]]",
			mb_recording_id: "440f60e8-0b25-4ec4-abb1-c6beec624ab0",
		});
		// The cover is linked, never downloaded a second time.
		expect([...app.images]).toEqual(images);
		expect(app.opened).toEqual([SUN]);
		expect(Notice.shown).toEqual(["Adding Here Comes the Sun…", "Added Here Comes the Sun"]);
	});

	it("never creates the album's other songs, nor its artist's note, and leaves the album as it was", async () => {
		const { app, music, client, albumFile } = await withAbbeyRoad();
		const before = app.note(ABBEY_ROAD);
		await music.addSong(client, albumFile, sun, true);

		expect([...app.notes.keys()].sort()).toEqual([ABBEY_ROAD, SUN]);
		expect(app.note(ABBEY_ROAD)).toBe(before);
	});

	it("stays on the album when TRACKLIST's + asks, and that track then finds its note", async () => {
		const { app, music, client, albumFile } = await withAbbeyRoad();
		await music.addSong(client, albumFile, sun, false);

		expect(app.opened).toEqual([]);
		const songs = new VaultScan(app.app).songs();
		expect(songNoteFor(songs, ABBEY_ROAD, { disc: null, n: 7 })).toBe(SUN);
		expect(songNoteFor(songs, ABBEY_ROAD, { disc: null, n: 8 })).toBeNull();
	});

	it("opens the note it already has rather than writing a second one", async () => {
		const { app, music, client, albumFile } = await withAbbeyRoad();
		await music.addSong(client, albumFile, sun, false);
		Notice.shown.length = 0;

		await music.addSong(client, albumFile, sun, true);
		expect([...app.notes.keys()]).toHaveLength(2);
		expect(app.opened).toEqual([SUN]);
		expect(Notice.shown[Notice.shown.length - 1]).toBe("Already in your vault: Here Comes the Sun");
	});

	it("says so, and writes nothing, for a track MusicBrainz no longer has on the album", async () => {
		const { app, music, client, albumFile } = await withAbbeyRoad();
		await music.addSong(client, albumFile, { disc: null, n: 7, title: "Not a Beatles Song" }, true);

		expect([...app.notes.keys()]).toEqual([ABBEY_ROAD]);
		expect(Notice.shown[Notice.shown.length - 1]).toBe("Not a Beatles Song is no longer on this album on MusicBrainz. Refresh the album, then try again.");
	});

	it("links the artist once their note exists", async () => {
		const { app, music, client, albumFile } = await withAbbeyRoad();
		app.notes.set("Music/Artists/The Beatles.md", "---\nname: The Beatles\n---\n");
		await music.addSong(client, albumFile, sun, false);
		expect(app.frontmatter(SUN).artists).toEqual(["[[The Beatles]]"]);
	});

	it("has no cover when its album has none", async () => {
		const { app, music, client, albumFile } = await withAbbeyRoad({}, () => false);
		await music.addSong(client, albumFile, sun, false);
		expect(app.frontmatter(SUN).poster).toBeNull();
	});

	it("says which disc a song of a double album is on", async () => {
		const app = new FakeApp();
		const music = new MusicActions(app.app, new VaultNotes(app.app), settings(), musicUi().ui);
		const { client } = replayClient();
		await music.addAlbum(client, album("white-album", "The Beatles"));
		const albumFile = app.file("Music/Albums/The Beatles (1968)/The Beatles (1968).md");

		await music.addSong(client, albumFile, { disc: 2, n: 1, title: "Birthday" }, false);
		expect(app.frontmatter("Music/Albums/The Beatles (1968)/Birthday.md")).toMatchObject({ track: 1, disc: 2 });
	});

	it("names a song after its first artist, and says so in its aliases, when its title alone is taken", async () => {
		const { app, music, client, albumFile } = await withAbbeyRoad();
		app.notes.set("Notes/Here Comes the Sun.md", "My own note.\n");
		await music.addSong(client, albumFile, sun, false);

		expect(app.notes.has("Music/Albums/Abbey Road (1969)/Here Comes the Sun (The Beatles).md")).toBe(true);
		expect(app.frontmatter("Music/Albums/Abbey Road (1969)/Here Comes the Sun (The Beatles).md")).not.toHaveProperty("aliases");
	});

	it("is also found by its title and first artist when named by its title alone", async () => {
		const { app, music, client, albumFile } = await withAbbeyRoad();
		await music.addSong(client, albumFile, sun, false);
		expect(app.frontmatter(SUN).aliases).toEqual(["Here Comes the Sun (The Beatles)"]);
	});

	it("puts a song of an album that is still a single file in a folder of the album's name beside it", async () => {
		const { app, client } = await withAbbeyRoad({ albumFolderNotes: false });
		const flat = app.file("Music/Albums/Abbey Road (1969).md");
		// Turned on again after the album was added: the album note stays where it is.
		const on = new MusicActions(app.app, new VaultNotes(app.app), settings(), musicUi().ui);
		await on.addSong(client, flat, sun, false);

		expect(app.notes.has("Music/Albums/Abbey Road (1969).md")).toBe(true);
		expect(app.frontmatter(SUN)).toMatchObject({ album: "[[Abbey Road (1969)]]" });
	});

	it("with album folder notes off, keeps albums side by side and songs in the song folder", async () => {
		const { app, music, client } = await withAbbeyRoad({ albumFolderNotes: false, songFolder: "Songs" });
		await music.addSong(client, app.file("Music/Albums/Abbey Road (1969).md"), sun, false);
		expect(app.notes.has("Songs/Here Comes the Sun (The Beatles).md")).toBe(true);
		expect(app.frontmatter("Songs/Here Comes the Sun (The Beatles).md")).not.toHaveProperty("aliases");
	});

	it("does nothing from a note that isn't an album", async () => {
		const app = new FakeApp({ "Film.md": "---\ntitle: Film\ndirectors: []\ntmdb_id: 1\n---\n" });
		const music = new MusicActions(app.app, new VaultNotes(app.app), settings(), musicUi().ui);
		const { client, web } = replayClient();
		await music.addSong(client, app.file("Film.md"), sun, true);
		expect(web.requests).toEqual([]);
		expect([...app.notes.keys()]).toEqual(["Film.md"]);
	});
});

describe("Copy lyrics into note", () => {
	const SONG = "Music/Albums/OK Computer (1997)/Airbag.md";
	const song = '---\ntitle: Airbag\nartists:\n  - Radiohead\nmb_recording_id: 4a7f\n---\n\nMy notes.\n';

	it("adds the lyrics at the end of the note, under their own heading", async () => {
		const { app, music } = setUp({ [SONG]: song });
		await music.copyLyrics(app.file(SONG), "Line 1\nLine 2");
		expect(app.note(SONG)).toBe(`${song}\n## Lyrics\n\nLine 1\nLine 2\n`);
		expect(Notice.shown).toEqual(["Copied the lyrics into Airbag."]);
	});

	it("never writes over lyrics the note already has", async () => {
		const own = `${song}\n## Lyrics\n\nMy own version.\n`;
		const { app, music } = setUp({ [SONG]: own });
		await music.copyLyrics(app.file(SONG), "Line 1");
		expect(app.note(SONG)).toBe(own);
		expect(Notice.shown).toEqual(["Airbag already has its own lyrics."]);
	});
});

describe("Move album into its folder", () => {
	it("moves an album note from before folder notes into a folder of its own name, beside its songs", async () => {
		const app = new FakeApp();
		const off = new MusicActions(app.app, new VaultNotes(app.app), settings({ albumFolderNotes: false }), musicUi().ui);
		const on = new MusicActions(app.app, new VaultNotes(app.app), settings(), musicUi().ui);
		const { client } = replayClient();
		await off.addAlbum(client, album("abbey-road", "Abbey Road"));
		const flat = app.file("Music/Albums/Abbey Road (1969).md");
		await on.addSong(client, flat, { disc: null, n: 7, title: "Here Comes the Sun" }, false);
		const content = app.note(flat.path);
		Notice.shown.length = 0;

		await on.moveAlbumIntoFolder(flat);
		expect(app.notes.has(flat.path)).toBe(false);
		expect(app.note("Music/Albums/Abbey Road (1969)/Abbey Road (1969).md")).toBe(content);
		expect(new VaultScan(app.app).songs()[0].albumPath).toBe("Music/Albums/Abbey Road (1969)/Abbey Road (1969).md");
		expect(Notice.shown).toEqual(["Moved Abbey Road (1969) into its own folder."]);
	});

	it("leaves an album that is already a folder note where it is", async () => {
		const { app, music, client } = setUp();
		await music.addAlbum(client, album("ok-computer", "OK Computer"));
		const file = app.file("Music/Albums/OK Computer (1997)/OK Computer (1997).md");
		await music.moveAlbumIntoFolder(file);
		expect(app.notes.has(file.path)).toBe(true);
	});

	it("never moves anything but an album", async () => {
		const app = new FakeApp({ "Film.md": "---\ntitle: Film\ndirectors: []\ntmdb_id: 1\n---\n" });
		const music = new MusicActions(app.app, new VaultNotes(app.app), settings(), musicUi().ui);
		await music.moveAlbumIntoFolder(app.file("Film.md"));
		expect([...app.notes.keys()]).toEqual(["Film.md"]);
	});
});

describe("Add artist", () => {
	it("writes the artist's note under their English name, with both names and a photo from their Deezer page", async () => {
		const { app, music, client } = setUp();
		await music.addArtist(client, artist("joe-hisaishi", "Joe Hisaishi"));

		const note = app.note("Music/Artists/Joe Hisaishi.md");
		expect(note).toContain("name: Joe Hisaishi\noriginal_name: 久石譲\naliases:\n  - Joe Hisaishi\n  - 久石譲\n");
		expect(note).toContain("born: 1950-12-06\n");
		expect(note).toContain('poster: "[[Joe Hisaishi.jpg]]"\nphoto_credit: Deezer\n');
		expect(app.images.has("Music/Pics/Artists/Joe Hisaishi.jpg")).toBe(true);
		expect(Notice.shown).toEqual(["Added Joe Hisaishi"]);
	});

	it("never creates any of their albums", async () => {
		const { app, music, client } = setUp();
		await music.addArtist(client, artist("radiohead", "Radiohead"));
		expect([...app.notes.keys()]).toEqual(["Music/Artists/Radiohead.md"]);
	});

	it("opens the note it already has, before asking MusicBrainz anything", async () => {
		const existing = `---\nname: Radiohead\nmb_artist_id: ${idOf("artist-radiohead")}\n---\n`;
		const { app, music, client, web } = setUp({ "Somewhere/Radiohead.md": existing });
		await music.addArtist(client, artist("radiohead", "Radiohead"));

		expect(app.opened).toEqual(["Somewhere/Radiohead.md"]);
		expect(web.requests).toEqual([]);
	});
});

describe("Change photo", () => {
	const commons = (candidates: PhotoCandidate[]): PhotoChoice | null => {
		const candidate = candidates.find((item) => item.source === "Wikimedia Commons");
		return candidate === undefined ? null : { kind: "candidate", candidate };
	};

	async function withArtist(
		pick: (candidates: PhotoCandidate[]) => PhotoChoice | null,
		answer: ConfirmAnswer,
		vaultImage: string | null = null,
		url: string | null = null,
	) {
		const { ui, offered, confirmed } = musicUi(pick, answer, null, url);
		if (vaultImage !== null) ui.pickVaultImage = async () => setupRef.app.file(vaultImage);
		const setup = setUp({}, {}, ui);
		setupRef.app = setup.app;
		if (vaultImage !== null) setup.app.images.add(vaultImage);
		await setup.music.addArtist(setup.client, artist("joe-hisaishi", "Joe Hisaishi"));
		Notice.shown.length = 0;
		return { ...setup, offered, confirmed, file: setup.app.file("Music/Artists/Joe Hisaishi.md") };
	}
	const setupRef = {} as { app: FakeApp };

	it("offers every photo on offer, and the one picked becomes the note's, credited", async () => {
		const { app, music, client, offered, file } = await withArtist(commons, null);
		const before = app.note(file.path);
		await music.changePhoto(client, file);

		expect(offered[0].map((candidate) => candidate.source)).toEqual(["Deezer", "Wikimedia Commons"]);
		expect(app.note(file.path)).toBe(
			before.replace('poster: "[[Joe Hisaishi.jpg]]"\nphoto_credit: Deezer', 'poster: "[[Joe Hisaishi 1.jpg]]"\nphoto_credit: citykane · CC BY 2.0'),
		);
		expect(app.images.has("Music/Pics/Artists/Joe Hisaishi 1.jpg")).toBe(true);
		expect(Notice.shown).toContain("Changed the photo of Joe Hisaishi");
	});

	it("asks before deleting the old photo, and keeps it when told to", async () => {
		const { app, music, client, confirmed, file } = await withArtist(commons, null);
		await music.changePhoto(client, file);

		expect(confirmed[0]).toMatchObject({ title: "Delete the old photo?", confirmLabel: "Delete", cancelLabel: "Keep" });
		expect(app.images.has("Music/Pics/Artists/Joe Hisaishi.jpg")).toBe(true);
	});

	it("deletes the old photo when told to", async () => {
		const { app, music, client, file } = await withArtist(commons, { option: false });
		await music.changePhoto(client, file);
		expect(app.images.has("Music/Pics/Artists/Joe Hisaishi.jpg")).toBe(false);
		expect(app.images.has("Music/Pics/Artists/Joe Hisaishi 1.jpg")).toBe(true);
	});

	it("changes nothing when the window is closed without a pick", async () => {
		const { app, music, client, confirmed, file } = await withArtist(() => null, { option: false });
		const before = app.note(file.path);
		await music.changePhoto(client, file);

		expect(app.note(file.path)).toBe(before);
		expect([...app.images]).toEqual(["Music/Pics/Artists/Joe Hisaishi.jpg"]);
		expect(confirmed).toEqual([]);
	});

	it("links a picture from the vault as it is, with no credit, copying nothing", async () => {
		const { app, music, client, file } = await withArtist(() => ({ kind: "vault" }), null, "My photos/Joe.png");
		await music.changePhoto(client, file);

		expect(app.note(file.path)).toContain('poster: "[[Joe.png]]"\nphoto_credit:\n');
		expect([...app.images].sort()).toEqual(["Music/Pics/Artists/Joe Hisaishi.jpg", "My photos/Joe.png"]);
	});

	it("downloads a picture from a web address and credits the site", async () => {
		const address = "https://www.example.org/joe.jpg";
		const { app, music, client, file } = await withArtist(() => ({ kind: "url" }), null, null, address);
		await music.changePhoto(client, file);

		expect(app.note(file.path)).toContain('poster: "[[Joe Hisaishi 1.jpg]]"\nphoto_credit: example.org\n');
	});

	it("says so, and changes nothing, when the address leads to no picture", async () => {
		const { app, music, client, file } = await withArtist(() => ({ kind: "url" }), null, null, "https://api.deezer.com/not-a-picture");
		const before = app.note(file.path);
		await music.changePhoto(client, file);

		expect(app.note(file.path)).toBe(before);
		expect(Notice.shown).toContain("That address didn't lead to a picture. Copy the address of the image itself.");
	});

	it("changes nothing when the vault or the address is asked for and then cancelled", async () => {
		for (const kind of ["vault", "url"] as const) {
			const { app, music, client, file } = await withArtist(() => ({ kind }), { option: false });
			const before = app.note(file.path);
			await music.changePhoto(client, file);
			expect(app.note(file.path)).toBe(before);
		}
	});

	it("never offers to delete a photo another note uses", async () => {
		const { app, music, client, confirmed, file } = await withArtist(commons, { option: false });
		app.notes.set("Mine.md", "I love this one: ![[Joe Hisaishi.jpg]]\n");
		await music.changePhoto(client, file);

		expect(confirmed).toEqual([]);
		expect(app.images.has("Music/Pics/Artists/Joe Hisaishi.jpg")).toBe(true);
	});
});

describe("Listened today", () => {
	it("counts every listen and keeps the first day", async () => {
		const { app, music, client } = setUp();
		await music.addAlbum(client, album("ok-computer", "OK Computer"));
		const file = app.file("Music/Albums/OK Computer (1997)/OK Computer (1997).md");
		Notice.shown.length = 0;

		await music.markListenedToday(file);
		await music.markListenedToday(file);

		const note = app.note(file.path);
		expect(note).toMatch(/\nlistened: true\nlisten_date: \d{4}-\d{2}-\d{2}\nlisten_count: 2\n/);
		expect(Notice.shown).toEqual([
			"Listened to OK Computer (1997) today — the first time.",
			"Listened to OK Computer (1997) today — 2 times so far.",
		]);
	});
});

describe("Refresh", () => {
	it("rewrites the album from MusicBrainz and leaves the listening alone", async () => {
		const { app, music, client } = setUp();
		await music.addAlbum(client, album("ok-computer", "OK Computer"));
		const file = app.file("Music/Albums/OK Computer (1997)/OK Computer (1997).md");
		await music.markListenedToday(file);
		const before = app.note(file.path);
		Notice.shown.length = 0;

		await music.refresh(client, file);
		expect(app.note(file.path)).toBe(before);
		expect(Notice.shown).toEqual(["Refreshed OK Computer"]);
	});

	it("brings an artist note up to date without touching the photo it has", async () => {
		const { app, music, client } = setUp();
		await music.addArtist(client, artist("joe-hisaishi", "Joe Hisaishi"));
		const file = app.file("Music/Artists/Joe Hisaishi.md");
		const before = app.note(file.path);

		await music.refresh(client, file);
		expect(app.note(file.path)).toBe(before);
		expect([...app.images]).toEqual(["Music/Pics/Artists/Joe Hisaishi.jpg"]);
	});

	it("brings a song note up to date, touching nothing that was already right", async () => {
		const { app, music, client } = setUp();
		await music.addAlbum(client, album("ok-computer", "OK Computer"));
		await music.addSong(client, app.file("Music/Albums/OK Computer (1997)/OK Computer (1997).md"), { disc: null, n: 1, title: "Airbag" }, false);
		const file = app.file("Music/Albums/OK Computer (1997)/Airbag.md");
		const before = app.note(file.path);
		Notice.shown.length = 0;

		await music.refresh(client, file);
		expect(app.note(file.path)).toBe(before);
		expect(Notice.shown).toEqual(["Refreshed Airbag"]);
	});

	it("gives a song its album's cover back from the album, never downloading one", async () => {
		const { app, music, client } = setUp();
		await music.addAlbum(client, album("ok-computer", "OK Computer"));
		await music.addSong(client, app.file("Music/Albums/OK Computer (1997)/OK Computer (1997).md"), { disc: null, n: 1, title: "Airbag" }, false);
		const file = app.file("Music/Albums/OK Computer (1997)/Airbag.md");
		const before = app.note(file.path);
		app.notes.set(file.path, before.replace('poster: "[[OK Computer (1997).jpg]]"', "poster:"));
		const images = [...app.images];

		await music.refresh(client, file);
		expect(app.note(file.path)).toBe(before);
		expect([...app.images]).toEqual(images);
	});

	it("brings back a cover whose file was deleted, with the note still linking it", async () => {
		const { app, music, client } = setUp();
		await music.addAlbum(client, album("ok-computer", "OK Computer"));
		const file = app.file("Music/Albums/OK Computer (1997)/OK Computer (1997).md");
		const before = app.note(file.path);
		app.images.delete("Music/Pics/Covers/OK Computer (1997).jpg");

		await music.refresh(client, file);
		expect(app.images.has("Music/Pics/Covers/OK Computer (1997).jpg")).toBe(true);
		expect(app.note(file.path)).toBe(before);
	});

	it("brings back an artist's photo whose file was deleted, credit and all", async () => {
		const { app, music, client } = setUp();
		await music.addArtist(client, artist("joe-hisaishi", "Joe Hisaishi"));
		const file = app.file("Music/Artists/Joe Hisaishi.md");
		const before = app.note(file.path);
		app.images.delete("Music/Pics/Artists/Joe Hisaishi.jpg");

		await music.refresh(client, file);
		expect([...app.images]).toEqual(["Music/Pics/Artists/Joe Hisaishi.jpg"]);
		expect(app.note(file.path)).toBe(before);
	});

	it("never touches a cover that is there, whatever its name", async () => {
		const { app, music, client } = setUp();
		await music.addAlbum(client, album("ok-computer", "OK Computer"));
		const file = app.file("Music/Albums/OK Computer (1997)/OK Computer (1997).md");
		app.images.add("Music/Pics/Covers/Mine.png");
		app.notes.set(file.path, app.note(file.path).replace('"[[OK Computer (1997).jpg]]"', '"[[Mine.png]]"'));
		app.images.delete("Music/Pics/Covers/OK Computer (1997).jpg");
		const before = app.note(file.path);

		await music.refresh(client, file);
		expect(app.note(file.path)).toBe(before);
		expect([...app.images]).toEqual(["Music/Pics/Covers/Mine.png"]);
	});

	it("leaves a poster that is a web address alone", async () => {
		const { app, music, client } = setUp();
		await music.addAlbum(client, album("ok-computer", "OK Computer"));
		const file = app.file("Music/Albums/OK Computer (1997)/OK Computer (1997).md");
		app.notes.set(
			file.path,
			app.note(file.path).replace('"[[OK Computer (1997).jpg]]"', "https://example.com/cover.jpg"),
		);
		app.images.delete("Music/Pics/Covers/OK Computer (1997).jpg");
		const before = app.note(file.path);

		await music.refresh(client, file);
		expect(app.note(file.path)).toBe(before);
		expect(app.images.size).toBe(0);
	});
});
