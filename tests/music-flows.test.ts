import { beforeEach, describe, expect, it } from "vitest";
import type { ConfirmAnswer, ConfirmRequest } from "../src/confirm-modal";
import type { AlbumSearchResult, ArtistSearchResult } from "../src/music";
import { MusicActions } from "../src/music-actions";
import type { PhotoCandidate } from "../src/musicbrainz";
import type { PhotoChoice } from "../src/photo-picker-modal";
import type { TFile } from "obsidian";
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

		const note = app.note("Music/Albums/OK Computer (1997).md");
		expect(note).toContain("title: OK Computer\n");
		expect(note).toContain("tracks_count: 12\n");
		expect(note).toContain('poster: "[[OK Computer (1997).jpg]]"');
		expect(app.images.has("Music/Pics/Covers/OK Computer (1997).jpg")).toBe(true);
		expect(app.opened).toEqual(["Music/Albums/OK Computer (1997).md"]);
		expect(Notice.shown).toEqual(["Adding OK Computer…", "Added OK Computer"]);
	});

	it("never creates the artist's note, nor any other", async () => {
		const { app, music, client } = setUp();
		await music.addAlbum(client, album("cowboy-bebop", "COWBOY BEBOP"));

		expect([...app.notes.keys()]).toEqual(["Music/Albums/COWBOY BEBOP (1998).md"]);
		// The artists are named — in English, the way their own notes would be — and nothing more.
		expect(app.note("Music/Albums/COWBOY BEBOP (1998).md")).toContain("artists:\n  - Yoko Kanno\n  - The Seatbelts\n");
	});

	it("links an artist whose note is already there", async () => {
		const { app, music, client } = setUp({ "Music/Artists/Radiohead.md": "---\nname: Radiohead\nmb_artist_id: a74b\n---\n" });
		await music.addAlbum(client, album("my-iron-lung", "My Iron Lung"));
		expect(app.note("Music/Albums/My Iron Lung (1994).md")).toContain('artists:\n  - "[[Radiohead]]"\n');
	});

	it("leaves an artist unlinked when Link artists is off", async () => {
		const { app, music, client } = setUp({ "Music/Artists/Radiohead.md": "---\nname: Radiohead\n---\n" }, { linkArtists: false });
		await music.addAlbum(client, album("my-iron-lung", "My Iron Lung"));
		expect(app.note("Music/Albums/My Iron Lung (1994).md")).toContain("artists:\n  - Radiohead\n");
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

		expect(app.note("Music/Albums/Sözüm Meclisten Dışarı (1981).md")).toContain("\nposter:\n");
		expect(Notice.shown[Notice.shown.length - 1]).toBe("Added Sözüm Meclisten Dışarı. No cover was found.");
	});

	it("follows the folders the user set", async () => {
		const { app, music, client } = setUp({}, { albumFolder: "Plaklar", albumCoverFolder: "" });
		await music.addAlbum(client, album("gulumse", "Gülümse"));
		expect(app.notes.has("Plaklar/Gülümse (1991).md")).toBe(true);
		expect(app.images.has("Music/Pics/Covers/Gülümse (1991).jpg")).toBe(false);
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
		const file = app.file("Music/Albums/OK Computer (1997).md");
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
		const file = app.file("Music/Albums/OK Computer (1997).md");
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

	it("brings back a cover whose file was deleted, with the note still linking it", async () => {
		const { app, music, client } = setUp();
		await music.addAlbum(client, album("ok-computer", "OK Computer"));
		const file = app.file("Music/Albums/OK Computer (1997).md");
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
		const file = app.file("Music/Albums/OK Computer (1997).md");
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
		const file = app.file("Music/Albums/OK Computer (1997).md");
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
