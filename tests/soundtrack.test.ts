import { beforeEach, describe, expect, it } from "vitest";
import type { AlbumSearchResult } from "../src/music";
import { MusicActions } from "../src/music-actions";
import { addSoundtrackLink } from "../src/music-note";
import { MusicBrainzClient } from "../src/musicbrainz";
import { classifyNote } from "../src/note-kind";
import { panelPlanFor } from "../src/panels/panel-plan";
import { VaultScan } from "../src/panels/vault-scan";
import {
	findScores,
	igdbSlugOf,
	sameWork,
	soundtrackChoices,
	soundtrackQuery,
	soundtrackWorkOf,
	workFactsOf,
	workTitles,
	type ScoredAlbum,
} from "../src/soundtrack";
import { VaultNotes } from "../src/vault-notes";
import { WikidataClient } from "../src/wikidata";
import { FakeApp, settings } from "./fake-app";
import { replayWeb } from "./music-fixtures";
import { Notice } from "./obsidian-stub";

/*
 * Soundtracks: an album note names the works it is the music of, and a
 * film's, a series' or an anime's own note is never written for it.
 */

const INTERSTELLAR_ALBUM = "4513c7b9-854e-457f-81d6-3dbeb001beb8";
const INCEPTION_ALBUM = "cba0c394-1aa2-40e0-8613-a9ead5624c21";

const INCEPTION = "Films/Inception (2010).md";
const inception = "---\ntitle: Inception\nyear: 2010\ndirectors:\n  - Christopher Nolan\ntmdb_id: 27205\n---\n\nMy notes.\n";
const INTERSTELLAR = "Films/Interstellar (2014).md";
const interstellar = "---\ntitle: Interstellar\nyear: 2014\ndirectors:\n  - Christopher Nolan\ntmdb_id: 157336\n---\n";
const SHINGEKI = "Anime/Shingeki no Kyojin (2013).md";
const shingeki =
	"---\ntitle: Shingeki no Kyojin\nenglish_title: Attack on Titan\njapanese_title: 進撃の巨人\nmedia_type: tv\nepisodes: 25\nyear: 2013\nmal_id: 16498\n---\n";

const albumResult = (id: string, title: string, year: number | null, artists = ""): AlbumSearchResult => ({
	id,
	title,
	albumType: "Soundtrack",
	year,
	artists,
});
const scored = (album: AlbumSearchResult, score: number): ScoredAlbum => ({ album, score });

function setUp(notes: Record<string, string> = {}) {
	const app = new FakeApp(notes);
	const music = new MusicActions(app.app, new VaultNotes(app.app), settings(), {
		pickPhoto: async () => null,
		pickVaultImage: async () => null,
		askImageUrl: async () => null,
		confirm: async () => null,
	});
	const web = replayWeb();
	return { app, music, web, client: new MusicBrainzClient("3.2.0", web), wikidata: new WikidataClient("3.2.0", web) };
}

beforeEach(() => {
	Notice.shown.length = 0;
});

describe("which notes have a soundtrack", () => {
	it("is a film, a TV series or an anime — never a manga-only note, a person or an album", () => {
		expect(soundtrackWorkOf(classifyNote({ title: "Inception", directors: [], tmdb_id: 27205 }))).toEqual({ kind: "film", tmdbId: 27205 });
		expect(soundtrackWorkOf(classifyNote({ title: "Breaking Bad", tmdb_tv_id: 1396 }))).toEqual({ kind: "tv", tmdbTvId: 1396 });
		expect(soundtrackWorkOf(classifyNote({ title: "Shingeki no Kyojin", media_type: "tv", mal_id: 16498 }))).toEqual({
			kind: "anime",
			malId: 16498,
		});
		expect(soundtrackWorkOf(classifyNote({ title: "Berserk", manga: { mal_id: 2 } }))).toBeNull();
		expect(soundtrackWorkOf(classifyNote({ name: "Christopher Nolan", tmdb_id: 525 }))).toBeNull();
		expect(soundtrackWorkOf(classifyNote({ title: "OK Computer", mb_album_id: "b1392450" }))).toBeNull();
	});

	it("takes nothing away from the panels a note had", () => {
		expect(panelPlanFor({ title: "Inception", directors: [], tmdb_id: 27205 })).toEqual({ kind: "work" });
		expect(panelPlanFor({ title: "Shingeki no Kyojin", media_type: "tv", mal_id: 16498 })).toEqual({ kind: "none" });
	});
});

describe("workTitles", () => {
	it("looks for a work by its title, then its own-language one, then its English one — each once", () => {
		expect(workTitles({ title: "Shingeki no Kyojin", english_title: "Attack on Titan", japanese_title: "進撃の巨人" })).toEqual([
			"Shingeki no Kyojin",
			"進撃の巨人",
			"Attack on Titan",
		]);
		expect(workTitles({ title: "Breaking Bad", original_title: "Breaking Bad" })).toEqual(["Breaking Bad"]);
		expect(workTitles({ title: "Stalker", original_title: "Сталкер" })).toEqual(["Stalker", "Сталкер"]);
		expect(workTitles({})).toEqual([]);
	});

	it("searches a title as one phrase, quotes and all", () => {
		expect(soundtrackQuery("Inception")).toBe('releasegroup:"Inception" AND secondarytype:soundtrack');
		expect(soundtrackQuery('Say "Hi"')).toBe('releasegroup:"Say \\"Hi\\"" AND secondarytype:soundtrack');
	});
});

describe("soundtrackChoices", () => {
	const wikidata = albumResult("w", "Inception: Music From the Motion Picture", 2010, "Hans Zimmer");

	it("puts Wikidata's first, and never offers an album twice", () => {
		const choices = soundtrackChoices([wikidata], [[scored(albumResult("a", "Starlight", 2016), 100), scored(wikidata, 69)]], {
			year: 2010,
			composers: [],
		});
		expect(choices.map((choice) => [choice.album.id, choice.source])).toEqual([
			["w", "Wikidata"],
			["a", "MusicBrainz"],
		]);
	});

	it("leaves out an album from before the work, keeps a later reissue, and one without a year", () => {
		const choices = soundtrackChoices(
			[],
			[[scored(albumResult("old", "Stalker", 1970), 100), scored(albumResult("reissue", "Stalker", 1995), 65), scored(albumResult("undated", "Stalker", null), 50)]],
			{ year: 1979, composers: [] },
		);
		expect(choices.map((choice) => choice.album.id)).toEqual(["reissue", "undated"]);
	});

	it("puts an album by a composer the note names above the rest", () => {
		const choices = soundtrackChoices(
			[],
			[[scored(albumResult("game", "S.T.A.L.K.E.R.", 2007, "MoozE"), 89), scored(albumResult("film", "Stalker", 1995, "Edward Artemiev"), 65)]],
			{ year: 1979, composers: ["Edward Artemiev"] },
		);
		expect(choices.map((choice) => choice.album.id)).toEqual(["film", "game"]);
	});

	it("reads the year and the composers from the note, links or not", () => {
		expect(workFactsOf({ year: 1979, composers: ["[[Edward Artemiev]]", "Someone"] })).toEqual({
			year: 1979,
			composers: ["Edward Artemiev", "Someone"],
		});
		expect(workFactsOf({})).toEqual({ year: null, composers: [] });
	});
});

describe("WikidataClient", () => {
	it("finds a soundtrack the film names", async () => {
		const { wikidata } = setUp();
		expect(await wikidata.soundtrackAlbumIds({ kind: "film", tmdbId: 157336 })).toEqual([INTERSTELLAR_ALBUM]);
	});

	it("finds a soundtrack that names the film instead", async () => {
		const { wikidata } = setUp();
		expect(await wikidata.soundtrackAlbumIds({ kind: "film", tmdbId: 27205 })).toEqual([INCEPTION_ALBUM]);
	});

	it("finds nothing for a work it has no soundtrack of", async () => {
		const { wikidata } = setUp();
		expect(await wikidata.soundtrackAlbumIds({ kind: "anime", malId: 16498 })).toEqual([]);
	});

	it("reads an album's works the other way round", async () => {
		const { wikidata } = setUp();
		expect(await wikidata.worksOfAlbum(INTERSTELLAR_ALBUM)).toEqual([{ kind: "film", tmdbId: 157336 }]);
	});

	it("answers nothing, rather than failing, when Wikidata can't be reached", async () => {
		const offline = new WikidataClient("3.2.0", {
			get: async () => {
				throw new Error("offline");
			},
			sleep: async () => {},
		});
		expect(await offline.soundtrackAlbumIds({ kind: "film", tmdbId: 157336 })).toEqual([]);
		expect(await offline.worksOfAlbum(INTERSTELLAR_ALBUM)).toEqual([]);
	});

	it("sends nothing but the work's or the album's id", async () => {
		const { wikidata, web } = setUp();
		await wikidata.soundtrackAlbumIds({ kind: "film", tmdbId: 27205 });
		for (const url of web.requests) expect(url).toMatch(/^https:\/\/www\.wikidata\.org\/w\/api\.php\?action=(query&list=search&srsearch=haswbstatement|wbgetentities&ids=Q)/);
	});
});

describe("Find soundtrack", () => {
	it("offers Wikidata's album first, then MusicBrainz's soundtracks by the same title", async () => {
		const { app, music, client, wikidata } = setUp({ [INCEPTION]: inception });
		const choices = (await music.soundtrackChoicesFor(client, wikidata, app.file(INCEPTION))) ?? [];

		expect(choices[0]).toEqual({
			source: "Wikidata",
			album: { id: INCEPTION_ALBUM, title: "Inception: Music From the Motion Picture", albumType: "Soundtrack", year: 2010, artists: "Hans Zimmer" },
		});
		expect(choices.slice(1).every((choice) => choice.source === "MusicBrainz")).toBe(true);
		// Once each, and nothing from before the film.
		expect(new Set(choices.map((choice) => choice.album.id)).size).toBe(choices.length);
		expect(choices.every((choice) => choice.album.year === null || choice.album.year >= 2009)).toBe(true);
	});

	it("looks an anime up by its Japanese title as well, where its soundtracks are filed", async () => {
		const { app, music, client, wikidata, web } = setUp({ [SHINGEKI]: shingeki });
		const choices = (await music.soundtrackChoicesFor(client, wikidata, app.file(SHINGEKI))) ?? [];

		expect(web.requests.filter((url) => url.includes("secondarytype"))).toHaveLength(3);
		expect(choices.map((choice) => choice.album.title)).toContain("TVアニメ「進撃の巨人」オリジナルサウンドトラック");
	});

	it("is only for films, TV series and anime", async () => {
		const { app, music, client, wikidata } = setUp({ "Music/Artists/Radiohead.md": "---\nname: Radiohead\nmb_artist_id: a74b\n---\n" });
		expect(await music.soundtrackChoicesFor(client, wikidata, app.file("Music/Artists/Radiohead.md"))).toBeNull();
	});

	it("adds a picked album with the link to the film, and leaves the film's note as it was", async () => {
		const { app, music, client } = setUp({ [INTERSTELLAR]: interstellar });
		await music.linkSoundtrack(client, app.file(INTERSTELLAR), albumResult(INTERSTELLAR_ALBUM, "Interstellar", 2014));

		const path = "Music/Albums/Interstellar Original Motion Picture Soundtrack (2014)/Interstellar Original Motion Picture Soundtrack (2014).md";
		expect(app.note(path)).toContain('album_type: Soundtrack\nsoundtrack_of:\n  - "[[Interstellar (2014)]]"\ngenres:');
		expect(app.note(INTERSTELLAR)).toBe(interstellar);
		// The film stays on screen, and its panel lists the album.
		expect(app.opened).toEqual([]);
		expect(new VaultScan(app.app).soundtracksOf(INTERSTELLAR).map((album) => album.path)).toEqual([path]);
		expect(Notice.shown[Notice.shown.length - 1]).toBe("Added Interstellar: Original Motion Picture Soundtrack as the soundtrack of Interstellar (2014)");
	});

	it("links an album note already in the vault, after the works it has, and only once", async () => {
		const ALBUM = "Music/Albums/Inception OST (2010).md";
		const album = `---\ntitle: "Inception: Music From the Motion Picture"\nartists:\n  - Hans Zimmer\nalbum_type: Soundtrack\nsoundtrack_of:\n  - "[[Interstellar (2014)]]"\nmb_album_id: ${INCEPTION_ALBUM}\nmy_rating: 5\n---\n\nMy notes.\n`;
		const { app, music, client, web } = setUp({ [INCEPTION]: inception, [INTERSTELLAR]: interstellar, [ALBUM]: album });

		await music.linkSoundtrack(client, app.file(INCEPTION), albumResult(INCEPTION_ALBUM, "Inception", 2010));
		expect(app.note(ALBUM)).toBe(album.replace('  - "[[Interstellar (2014)]]"\n', '  - "[[Interstellar (2014)]]"\n  - "[[Inception (2010)]]"\n'));
		expect(web.requests).toEqual([]);
		expect(Notice.shown).toEqual(["Linked Inception OST (2010) as the soundtrack of Inception (2010)."]);

		const linked = app.note(ALBUM);
		await music.linkSoundtrack(client, app.file(INCEPTION), albumResult(INCEPTION_ALBUM, "Inception", 2010));
		expect(app.note(ALBUM)).toBe(linked);
		expect(Notice.shown[Notice.shown.length - 1]).toBe("Inception OST (2010) is already linked to Inception (2010).");
		expect(app.note(INCEPTION)).toBe(inception);
	});

	it("adds the property beside the album type to an album note that never had it, touching nothing else", async () => {
		const album = "---\ntitle: X\nartists:\n  - Y\nyear: 2010\nalbum_type: Soundtrack\ngenres:\n  - ambient\nmb_album_id: z\n---\n\nBody.\n";
		expect(addSoundtrackLink(album, "[[Inception (2010)]]", () => false)).toBe(
			album.replace("genres:", 'soundtrack_of:\n  - "[[Inception (2010)]]"\ngenres:'),
		);
	});

	it("reads a single link written by hand as a list of one", () => {
		const album = '---\ntitle: X\nsoundtrack_of: "[[Inception (2010)]]"\nmb_album_id: z\n---\n';
		expect(addSoundtrackLink(album, "[[Interstellar (2014)]]", () => false)).toBe(
			'---\ntitle: X\nsoundtrack_of:\n  - "[[Inception (2010)]]"\n  - "[[Interstellar (2014)]]"\nmb_album_id: z\n---\n',
		);
	});
});

describe("Link album to film or series", () => {
	const ALBUM = "Music/Albums/Interstellar OST (2014).md";
	const album = `---\ntitle: Interstellar\nartists:\n  - Hans Zimmer\nalbum_type: Soundtrack\nmb_album_id: ${INTERSTELLAR_ALBUM}\n---\n`;

	it("offers the film Wikidata names first, then every other film, series and anime by name", async () => {
		const { app, music, wikidata } = setUp({ [ALBUM]: album, [INCEPTION]: inception, [INTERSTELLAR]: interstellar, [SHINGEKI]: shingeki });
		const works = await music.worksToLink(wikidata, app.file(ALBUM));
		expect(works.map((work) => [work.file.path, work.suggested])).toEqual([
			[INTERSTELLAR, true],
			[INCEPTION, false],
			[SHINGEKI, false],
		]);
	});

	it("leaves out the works it is linked to already", async () => {
		const linked = album.replace("album_type: Soundtrack\n", 'album_type: Soundtrack\nsoundtrack_of:\n  - "[[Interstellar (2014)]]"\n');
		const { app, music, wikidata } = setUp({ [ALBUM]: linked, [INCEPTION]: inception, [INTERSTELLAR]: interstellar });
		expect((await music.worksToLink(wikidata, app.file(ALBUM))).map((work) => work.file.path)).toEqual([INCEPTION]);
	});

	it("writes the link on the album alone", async () => {
		const { app, music } = setUp({ [ALBUM]: album, [SHINGEKI]: shingeki });
		await music.linkAlbumToWork(app.file(ALBUM), app.file(SHINGEKI));
		expect(app.note(ALBUM)).toContain('album_type: Soundtrack\nsoundtrack_of:\n  - "[[Shingeki no Kyojin (2013)]]"\nmb_album_id:');
		expect(app.note(SHINGEKI)).toBe(shingeki);
		expect(new VaultScan(app.app).soundtracksOf(SHINGEKI).map((scanned) => scanned.path)).toEqual([ALBUM]);
	});
});

describe("Refresh", () => {
	it("keeps an album's soundtrack_of as it is", async () => {
		const { app, music, client } = setUp({ [INTERSTELLAR]: interstellar });
		await music.linkSoundtrack(client, app.file(INTERSTELLAR), albumResult(INTERSTELLAR_ALBUM, "Interstellar", 2014));
		const path = [...app.notes.keys()].find((key) => key.startsWith("Music/"))!;
		const linked = app.note(path);

		await music.refresh(client, app.file(path));
		expect(app.note(path)).toBe(linked);
	});
});

describe("SCORES", () => {
	const HANS = new Set(["Hans Zimmer"]);
	const HISAISHI = new Set(["Joe Hisaishi", "久石譲"]);
	const work = (path: string, year: number | null, kind: "film" | "tv" | "anime", composers: string[] = []) => ({
		path,
		title: path,
		year,
		watched: false,
		kind,
		composers,
	});

	it("lists the films naming the artist among their composers, and the works their albums are the soundtrack of — each once, oldest first", () => {
		const works = [
			work("Interstellar", 2014, "film", ["Hans Zimmer"]),
			work("Inception", 2010, "film", ["Hans Zimmer"]),
			work("Dune", 2021, "film"),
			work("Winter Sleep", 2014, "film"),
		];
		const albums = [
			{ credits: ["Hans Zimmer"], soundtrackOf: ["Dune", "Interstellar"] },
			{ credits: ["Someone Else"], soundtrackOf: ["Winter Sleep"] },
		];
		expect(findScores(HANS, works, albums).map((scored) => scored.path)).toEqual(["Inception", "Interstellar", "Dune"]);
	});

	it("finds an anime by an album credited under the artist's name in their own script", () => {
		const works = [work("Spirited Away", 2001, "anime")];
		expect(findScores(HISAISHI, works, [{ credits: ["久石譲"], soundtrackOf: ["Spirited Away"] }])).toHaveLength(1);
		expect(findScores(HANS, works, [{ credits: ["久石譲"], soundtrackOf: ["Spirited Away"] }])).toEqual([]);
	});

	it("reads films, TV series and anime from the vault, with the albums' links", async () => {
		const ALBUM = "Music/Albums/Interstellar OST (2014).md";
		const album = `---\ntitle: Interstellar\nartists:\n  - "[[Hans Zimmer]]"\nsoundtrack_of:\n  - "[[Interstellar (2014)]]"\n  - "[[Shingeki no Kyojin (2013)]]"\nmb_album_id: ${INTERSTELLAR_ALBUM}\n---\n`;
		const { app } = setUp({ [ALBUM]: album, [INTERSTELLAR]: interstellar, [SHINGEKI]: shingeki, [INCEPTION]: inception });
		const scan = new VaultScan(app.app);
		expect(scan.scoreWorks().map((scored) => [scored.path, scored.kind])).toEqual([
			[INTERSTELLAR, "film"],
			[SHINGEKI, "anime"],
			[INCEPTION, "film"],
		]);
		expect(findScores(HANS, scan.scoreWorks(), scan.albums()).map((scored) => scored.path)).toEqual([SHINGEKI, INTERSTELLAR]);
	});
});

describe("games", () => {
	const HOLLOW = "Games/Hollow Knight (2017).md";
	const hollow = "---\ntitle: Hollow Knight\nyear: 2017\nurl: https://www.igdb.com/games/hollow-knight\nigdb_id: 14593\nplay_status: playing\n---\n";

	it("are works with a soundtrack, known to Wikidata by the end of their IGDB address", () => {
		expect(igdbSlugOf("https://www.igdb.com/games/hollow-knight")).toBe("hollow-knight");
		expect(igdbSlugOf("https://www.igdb.com/games/hollow-knight?x=1")).toBe("hollow-knight");
		expect(igdbSlugOf("https://example.com/hollow-knight")).toBeNull();
		const kind = classifyNote({ title: "Hollow Knight", igdb_id: 14593 });
		expect(soundtrackWorkOf(kind, { url: "https://www.igdb.com/games/hollow-knight" })).toEqual({ kind: "game", igdbId: 14593, slug: "hollow-knight" });
		expect(soundtrackWorkOf(kind)).toEqual({ kind: "game", igdbId: 14593, slug: null });
	});

	it("are the same game by either id", () => {
		expect(sameWork({ kind: "game", igdbId: null, slug: "hollow-knight" }, { kind: "game", igdbId: 14593, slug: "hollow-knight" })).toBe(true);
		expect(sameWork({ kind: "game", igdbId: 14593, slug: null }, { kind: "game", igdbId: 14593, slug: "x" })).toBe(true);
		expect(sameWork({ kind: "game", igdbId: 1, slug: "a" }, { kind: "game", igdbId: 2, slug: "b" })).toBe(false);
		expect(sameWork({ kind: "game", igdbId: 14593, slug: null }, { kind: "film", tmdbId: 14593 })).toBe(false);
	});

	it("find their soundtrack by title when Wikidata has none — Hollow Knight's, by Christopher Larkin", async () => {
		const { app, music, client, wikidata, web } = setUp({ [HOLLOW]: hollow });
		const choices = (await music.soundtrackChoicesFor(client, wikidata, app.file(HOLLOW))) ?? [];
		expect(web.requests[0]).toContain(encodeURIComponent("haswbstatement:P5794=hollow-knight"));
		expect(choices[0]).toEqual({
			source: "MusicBrainz",
			album: { id: "9df7cf82-6ea3-4021-829f-f2192977ac8d", title: "Hollow Knight", albumType: "Soundtrack", year: 2017, artists: "Christopher Larkin" },
		});
	});

	it("ask Wikidata nothing without an IGDB address, and still search by title", async () => {
		const { app, music, client, wikidata, web } = setUp({ [HOLLOW]: hollow.replace("url: https://www.igdb.com/games/hollow-knight\n", "") });
		const choices = (await music.soundtrackChoicesFor(client, wikidata, app.file(HOLLOW))) ?? [];
		expect(web.requests.some((url) => url.includes("wikidata"))).toBe(false);
		expect(choices[0].album.title).toBe("Hollow Knight");
	});

	it("are offered to an album, and shown in its composer's SCORES as games", async () => {
		const ALBUM = "Music/Albums/Hollow Knight OST (2017).md";
		const album = "---\ntitle: Hollow Knight\nartists:\n  - Christopher Larkin\nalbum_type: Soundtrack\nmb_album_id: 9df7cf82-6ea3-4021-829f-f2192977ac8d\n---\n";
		const { app, music, wikidata } = setUp({ [ALBUM]: album, [HOLLOW]: hollow, [INCEPTION]: inception });
		const works = await music.worksToLink(wikidata, app.file(ALBUM));
		expect(works.map((work) => [work.file.path, work.work.kind])).toEqual([
			[HOLLOW, "game"],
			[INCEPTION, "film"],
		]);

		await music.linkAlbumToWork(app.file(ALBUM), app.file(HOLLOW));
		expect(app.note(HOLLOW)).toBe(hollow);
		const scan = new VaultScan(app.app);
		expect(scan.soundtracksOf(HOLLOW).map((scanned) => scanned.path)).toEqual([ALBUM]);
		expect(findScores(new Set(["Christopher Larkin"]), scan.scoreWorks(), scan.albums()).map((work) => [work.title, work.kind])).toEqual([
			["Hollow Knight", "game"],
		]);
	});
});

describe("an album named exactly like its work", () => {
	const GAME = "Games/Hollow Knight (2017).md";
	const game = "---\ntitle: Hollow Knight\nyear: 2017\nurl: https://www.igdb.com/games/hollow-knight\nigdb_id: 14593\n---\n";
	const ALBUM = "Music/Albums/Hollow Knight (2017)/Hollow Knight (2017).md";
	const album = (link: string) =>
		`---\ntitle: Hollow Knight\nartists:\n  - Christopher Larkin\nalbum_type: Soundtrack\nsoundtrack_of:\n  - "${link}"\nmb_album_id: 9df7cf82-6ea3-4021-829f-f2192977ac8d\n---\n`;

	it("links its work by its whole path when it's about to take that same name", () => {
		const app = new FakeApp({ [GAME]: game });
		const notes = new VaultNotes(app.app);
		expect(notes.noteLink(app.file(GAME), ALBUM)).toBe("[[Games/Hollow Knight (2017)]]");
		expect(notes.noteLink(app.file(GAME), "Music/Albums/Hollow Knight OST (2017)/Hollow Knight OST (2017).md")).toBe("[[Hollow Knight (2017)]]");
	});

	it("still reads a short link Obsidian takes for the album itself as the work of that name", () => {
		// The album first, so that the short link finds it before the game — as Obsidian did, from inside the album's folder.
		const app = new FakeApp({ [ALBUM]: album("[[Hollow Knight (2017)]]"), [GAME]: game });
		expect(new VaultScan(app.app).soundtracksOf(GAME).map((found) => found.path)).toEqual([ALBUM]);
	});

	it("never offers the work it's already linked to, however the link reads", async () => {
		const { app, music, wikidata } = setUp({ [ALBUM]: album("[[Hollow Knight (2017)]]"), [GAME]: game });
		expect((await music.worksToLink(wikidata, app.file(ALBUM))).map((work) => work.file.path)).toEqual([]);
		await music.linkAlbumToWork(app.file(ALBUM), app.file(GAME));
		expect(Notice.shown[Notice.shown.length - 1]).toBe("Hollow Knight (2017) is already linked to Hollow Knight (2017).");
	});
});

describe("the SOUNDTRACK panel's covers", () => {
	it("gives each linked album its own cover, and none to an album without one", () => {
		const film = "---\ntitle: Interstellar\nyear: 2014\ndirectors:\n  - Christopher Nolan\ntmdb_id: 157336\n---\n";
		const album = (title: string, poster: string) =>
			`---\ntitle: ${title}\nalbum_type: Soundtrack\nsoundtrack_of:\n  - "[[Interstellar (2014)]]"\n${poster}mb_album_id: ${title}\n---\n`;
		const app = new FakeApp({
			[INTERSTELLAR]: film,
			"Music/Albums/Score.md": album("Score", 'poster: "[[Score.jpg]]"\n'),
			"Music/Albums/Expanded.md": album("Expanded", ""),
		}, ["Music/Pics/Covers/Score.jpg"]);
		const albums = new VaultScan(app.app).soundtracksOf(INTERSTELLAR);
		expect(albums.map((found) => [found.title, found.coverPath])).toEqual([
			["Expanded", null],
			["Score", "Music/Pics/Covers/Score.jpg"],
		]);
	});
});
