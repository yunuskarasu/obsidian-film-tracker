import { describe, expect, it } from "vitest";
import { MusicBrainzClient, MusicBrainzError, SearchSuperseded, type WebAccess } from "../src/musicbrainz";
import { fixture, idOf, replayClient } from "./music-fixtures";

/*
 * The client end to end, against MusicBrainz's saved answers: which requests
 * it makes, in what order, and what it makes of them.
 */

const mbRequests = (requests: string[]) => requests.filter((url) => url.includes("musicbrainz.org/ws/"));

describe("getAlbum", () => {
	it("reads an album in three requests: the album, its releases, and one release's tracks", async () => {
		const { client, web } = replayClient();
		const album = await client.getAlbum(idOf("album-ok-computer"));

		expect(album).toMatchObject({
			title: "OK Computer",
			artists: ["Radiohead"],
			year: 1997,
			albumType: "Album",
			runtime: 53,
			mbAlbumId: idOf("album-ok-computer"),
		});
		expect(album.tracks).toHaveLength(12);
		expect(mbRequests(web.requests)).toHaveLength(3);
	});

	it("names an artist credited in their own script the way their note is named", async () => {
		const { client, web } = replayClient();
		expect((await client.getAlbum(idOf("album-spirited-away"))).artists).toEqual(["Joe Hisaishi"]);
		expect((await client.getAlbum(idOf("album-cowboy-bebop"))).artists).toEqual(["Yoko Kanno", "The Seatbelts"]);
		// One more request per such artist, for their aliases.
		expect(mbRequests(web.requests).filter((url) => url.includes("inc=aliases&"))).toHaveLength(3);
	});

	it("needs no extra request for artists already in Latin letters", async () => {
		const { client, web } = replayClient();
		expect((await client.getAlbum(idOf("album-sozum-meclisten-disari"))).artists).toEqual(["Barış Manço", "Kurtalan Ekspres"]);
		expect(mbRequests(web.requests)).toHaveLength(3);
	});

	it("takes the standard edition's tracks, disc by disc on a double album", async () => {
		const { client } = replayClient();
		expect((await client.getAlbum(idOf("album-interstellar"))).tracks).toHaveLength(16);
		const white = await client.getAlbum(idOf("album-white-album"));
		expect(white.tracks).toHaveLength(30);
		expect(new Set(white.tracks.map((track) => track.disc))).toEqual(new Set([1, 2]));
		expect(white.runtime).toBe(94);
	});

	it("files a soundtrack and an EP as what they are", async () => {
		const { client } = replayClient();
		expect((await client.getAlbum(idOf("album-interstellar"))).albumType).toBe("Soundtrack");
		expect((await client.getAlbum(idOf("album-my-iron-lung"))).albumType).toBe("EP");
	});
});

describe("artistAlbums", () => {
	it("reads every page of an artist's albums, oldest first", async () => {
		const { client, web } = replayClient();
		const albums = await client.artistAlbums(idOf("artist-joe-hisaishi"));

		expect(albums).toHaveLength(261);
		expect(mbRequests(web.requests)).toHaveLength(3);
		expect(web.requests.every((url) => url.includes("release-group-status=website-default"))).toBe(true);
		const years = albums.map((album) => album.year ?? 9999);
		expect([...years].sort((a, b) => a - b)).toEqual(years);
	});

	it("finds the album a search misses: Spirited Away's soundtrack, by its Japanese title", async () => {
		const { client } = replayClient();
		const albums = await client.artistAlbums(idOf("artist-joe-hisaishi"));
		expect(albums.find((album) => album.title === "千と千尋の神隠し サウンドトラック")).toMatchObject({
			albumType: "Soundtrack",
			year: 2001,
		});
	});
});

describe("searches", () => {
	it("lists the artists found, in Latin letters where MusicBrainz has them", async () => {
		const { client } = replayClient();
		const found = await client.searchArtists("Seatbelts");
		expect(found.length).toBeGreaterThan(3);
		expect(found.some((artist) => artist.originalName === "シートベルツ")).toBe(true);
	});

	it("lists albums with their kind and year", async () => {
		const { client } = replayClient();
		const [first] = await client.searchAlbums("OK Computer Radiohead");
		expect(first).toMatchObject({ title: "OK Computer", albumType: "Album", year: 1997, artists: "Radiohead" });
	});
});

describe("pictures", () => {
	it("takes an artist's photo from their own page on Deezer, found through MusicBrainz", async () => {
		const { client, web } = replayClient();
		const photo = await client.artistPhoto(await client.getArtist(idOf("artist-joe-hisaishi")));

		expect(photo?.credit).toBe("Deezer");
		expect(web.requests).toContain("https://api.deezer.com/artist/66582");
		// The right artist for certain: no search by name, and no need for Commons.
		expect(web.requests.some((url) => url.includes("search/artist") || url.includes("wikidata"))).toBe(false);
	});

	it("falls back to Wikimedia Commons, crediting who took the photo and its licence", async () => {
		const { client, web } = replayClient();
		const artist = { ...(await client.getArtist(idOf("artist-joe-hisaishi"))), deezerId: null };
		const photo = await client.artistPhoto(artist);

		expect(photo?.credit).toBe("citykane · CC BY 2.0");
		expect(web.requests.some((url) => url.includes("wikimedia.org/wikipedia/commons/thumb/"))).toBe(true);
	});

	it("falls back to Deezer by exact name for an artist with no link and no Commons photo", async () => {
		const { client } = replayClient();
		const photo = await client.artistPhoto({
			name: "Seatbelts",
			originalName: null,
			aliases: ["Seatbelts"],
			type: "Group",
			country: null,
			begin: null,
			end: null,
			genres: [],
			mbArtistId: "x",
			wikidataId: null,
			deezerId: null,
		});
		expect(photo?.credit).toBe("Deezer");
	});

	it("never takes Deezer's stand-in picture for a photo", async () => {
		const { web } = replayClient();
		const client = new MusicBrainzClient("3.1.0", {
			...web,
			get: async (url, headers) =>
				url.startsWith("https://api.deezer.com/artist/")
					? { status: 200, json: { picture_xl: "https://cdn-images.dzcdn.net/images/artist//1000x1000-000000-80-0-0.jpg" }, arrayBuffer: new ArrayBuffer(0) }
					: web.get(url, headers),
		});
		const photo = await client.artistPhoto(await client.getArtist(idOf("artist-joe-hisaishi")));
		expect(photo?.credit).toBe("citykane · CC BY 2.0");
	});

	it("takes an album's cover from its own page on Deezer, found through MusicBrainz", async () => {
		const { client, web } = replayClient();
		const album = await client.getAlbum(idOf("album-ok-computer"));
		expect(album.deezerAlbumIds).toEqual(["14879699", "43197211"]);

		expect(await client.albumCover(album)).toMatchObject({ credit: null });
		const pictures = web.requests.filter((url) => !url.includes("musicbrainz.org") && !url.includes("api.deezer.com"));
		expect(pictures).toHaveLength(1);
		expect(pictures[0]).toContain("dzcdn.net");
		expect(web.requests.some((url) => url.includes("coverartarchive"))).toBe(false);
	});

	it("takes the standard edition's cover, never a deluxe one's or a single's", async () => {
		const { client, web } = replayClient();
		await client.albumCover(await client.getAlbum(idOf("album-abbey-road")));
		const abbey = fixture<{ cover_xl: string }>("deezer-album-abbey-road-11894168").cover_xl;
		expect(web.requests[web.requests.length - 1]).toBe(abbey);

		await client.albumCover(await client.getAlbum(idOf("album-interstellar")));
		const expanded = fixture<{ cover_xl: string }>("deezer-album-interstellar-185320622").cover_xl;
		expect(web.requests[web.requests.length - 1]).toBe(expanded);
	});

	it("goes on to the Cover Art Archive by itself when Deezer has no page for the album", async () => {
		const { client, web } = replayClient();
		const album = await client.getAlbum(idOf("album-first-love"));
		expect(album.deezerAlbumIds).toEqual([]);
		await client.albumCover(album);
		expect(web.requests[web.requests.length - 1]).toBe(`https://coverartarchive.org/release-group/${idOf("album-first-love")}/front-500`);
	});

	it("would rather have no cover than the wrong one", async () => {
		// No Deezer page, nothing in the archive, and no exact match in Deezer's search.
		const { client } = replayClient((url) => !url.includes("coverartarchive"));
		expect(await client.albumCover(await client.getAlbum(idOf("album-sozum-meclisten-disari")))).toBeNull();
	});

	it("offers Deezer's photo first, then the ones Commons has", async () => {
		const { client } = replayClient();
		const candidates = await client.photoCandidates(await client.getArtist(idOf("artist-joe-hisaishi")));
		expect(candidates.map((candidate) => [candidate.source, candidate.credit])).toEqual([
			["Deezer", "Deezer"],
			["Wikimedia Commons", "citykane · CC BY 2.0"],
		]);
	});

	it("never offers Deezer's blank square — Radiohead's page has no photo — and lists the artist's Commons category", async () => {
		const { client } = replayClient();
		const candidates = await client.photoCandidates(await client.getArtist(idOf("artist-radiohead")));

		expect(candidates.every((candidate) => candidate.source === "Wikimedia Commons")).toBe(true);
		expect(candidates).toHaveLength(8);
		// The photo Wikidata names as the artist's own comes first.
		expect(candidates[0].credit).toBe("Raph_PH · CC BY 4.0");
		expect(new Set(candidates.map((candidate) => candidate.url)).size).toBe(candidates.length);
	});

	it("goes on to Commons by itself when an artist's Deezer page has only the blank square", async () => {
		const { client } = replayClient();
		const photo = await client.artistPhoto(await client.getArtist(idOf("artist-radiohead")));
		expect(photo?.credit).toBe("Raph_PH · CC BY 4.0");
	});
});

describe("a picture from a web address", () => {
	function answering(contentType: string | null, status = 200): MusicBrainzClient {
		return new MusicBrainzClient("3.1.0", {
			get: async () => ({ status, json: null, arrayBuffer: new Uint8Array([1, 2, 3]).buffer, contentType }),
			sleep: async () => {},
		});
	}

	it("is downloaded, kept in its own format, and credited to the site it came from", async () => {
		expect(await answering("image/png").downloadUrl(" https://www.example.org/band.png ")).toMatchObject({
			credit: "example.org",
			extension: "png",
		});
		expect((await answering("image/jpeg; charset=binary").downloadUrl("https://cdn.example.org/a"))?.extension).toBe("jpg");
	});

	it("is turned down when the address leads to a page, fails, or isn't a web address at all", async () => {
		expect(await answering("text/html").downloadUrl("https://example.org/band")).toBeNull();
		expect(await answering("image/png", 404).downloadUrl("https://example.org/band.png")).toBeNull();
		expect(await answering("image/png").downloadUrl("file:///C:/band.png")).toBeNull();
		expect(await answering("image/png").downloadUrl("not an address")).toBeNull();
	});
});

describe("manners", () => {
	it("says who it is in every request: the plugin, its version and its homepage — nothing personal", async () => {
		const { client, web } = replayClient();
		await client.getAlbum(idOf("album-ok-computer"));
		expect(new Set(web.userAgents)).toEqual(
			new Set(["FilmTracker/3.1.0 ( https://github.com/yunuskarasu/obsidian-film-tracker )"]),
		);
	});

	it("waits its turn between requests: one a second, as MusicBrainz asks", async () => {
		const pauses: number[] = [];
		const { web } = replayClient();
		const client = new MusicBrainzClient("3.1.0", { ...web, sleep: async (ms) => void pauses.push(ms) });
		await client.getAlbum(idOf("album-ok-computer"));
		expect(pauses.length).toBeGreaterThanOrEqual(2);
		expect(Math.min(...pauses)).toBeGreaterThan(1000);
	});

	it("asks a busy MusicBrainz twice more, waiting longer each time, then says so", async () => {
		let calls = 0;
		const pauses: number[] = [];
		const busy: WebAccess = {
			get: async () => {
				calls += 1;
				return { status: 503, json: null, arrayBuffer: new ArrayBuffer(0) };
			},
			sleep: async (ms) => void pauses.push(ms),
		};
		await expect(new MusicBrainzClient("3.1.0", busy).getArtist("x")).rejects.toThrow("MusicBrainz is busy right now");
		expect(calls).toBe(3);
		expect(pauses.filter((ms) => ms >= 2000)).toEqual([2000, 4000]);
	});

	it("drops a search the user has typed past before it is ever sent", async () => {
		const { client, web } = replayClient();
		await expect(client.searchArtists("Joe Hiash", () => false)).rejects.toBeInstanceOf(SearchSuperseded);
		expect(web.requests).toEqual([]);
	});

	it("sends the search the user stopped at, after dropping the ones typed past", async () => {
		const { client, web } = replayClient();
		const dropped = client.searchArtists("Joe Hiash", () => false).catch((error: unknown) => error);
		const sent = client.searchArtists("Joe Hisaishi", () => true);

		expect(await dropped).toBeInstanceOf(SearchSuperseded);
		expect((await sent).length).toBeGreaterThan(0);
		expect(web.requests).toHaveLength(1);
		expect(web.requests[0]).toContain("Joe%20Hisaishi");
	});

	it("turns a failed connection into a message of its own", async () => {
		const offline: WebAccess = {
			get: async () => {
				throw new Error("net::ERR_INTERNET_DISCONNECTED");
			},
			sleep: async () => {},
		};
		const error = await new MusicBrainzClient("3.1.0", offline).searchArtists("Queen").catch((thrown: unknown) => thrown);
		expect(error).toBeInstanceOf(MusicBrainzError);
		expect((error as Error).message).toBe("Could not reach MusicBrainz. Check your internet connection.");
	});
});
