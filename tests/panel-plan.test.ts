import { describe, expect, it } from "vitest";
import { extractNames, hasMangaBlock, panelPlanFor } from "../src/panels/panel-plan";

/*
 * Which panels each kind of note gets. These pin down exactly what 3.0.0
 * drew, so moving the drawing code around can't quietly change it.
 */

const film = { title: "Inception", directors: ["[[Christopher Nolan]]"], tmdb_id: 27205, watched: false };
const director = { name: "Christopher Nolan", aliases: ["Christopher Nolan", "Chris Nolan"], tmdb_id: 525 };
const anime = { title: "Shingeki no Kyojin", media_type: "tv", episodes: 25, studios: [], mal_id: 16498 };
const mangaBlock = { title: "Shingeki no Kyojin", mal_id: 23390 };
const mangaka = { name: "Hajime Isayama", mal_id: 1 };
const tv = { title: "Breaking Bad", creators: [], tmdb_tv_id: 1396, seasons: [] };

describe("panelPlanFor", () => {
	it("gives a film CONNECTIONS", () => {
		expect(panelPlanFor(film)).toEqual({ kind: "work" });
	});

	it("gives a director FILMOGRAPHY and TV SERIES, matched on every spelling of their name", () => {
		expect(panelPlanFor(director)).toEqual({
			kind: "person",
			names: new Set(["Christopher Nolan", "Chris Nolan"]),
		});
	});

	it("gives a person note written by hand its filmography too", () => {
		expect(panelPlanFor({ name: "Agnès Varda" })).toEqual({ kind: "person", names: new Set(["Agnès Varda"]) });
	});

	it("gives a TV series SEASONS and CONNECTIONS, and MANGA when it carries one", () => {
		expect(panelPlanFor(tv)).toEqual({ kind: "tv", manga: false });
		expect(panelPlanFor({ ...tv, manga: mangaBlock })).toEqual({ kind: "tv", manga: true });
	});

	it("gives a Series note with a manga side the MANGA panel, with or without its anime", () => {
		expect(panelPlanFor({ ...anime, manga: mangaBlock })).toEqual({ kind: "manga" });
		expect(panelPlanFor({ manga: mangaBlock })).toEqual({ kind: "manga" });
	});

	it("gives an anime-only note nothing", () => {
		expect(panelPlanFor(anime)).toEqual({ kind: "none" });
	});

	it("gives a mangaka MANGAGRAPHY", () => {
		expect(panelPlanFor(mangaka)).toEqual({ kind: "mangaka", names: new Set(["Hajime Isayama"]) });
	});

	it("never takes a note that only has a title for a person", () => {
		expect(panelPlanFor({ title: "My note" })).toEqual({ kind: "work" });
		expect(panelPlanFor({ name: "  " })).toEqual({ kind: "work" });
		expect(panelPlanFor({})).toEqual({ kind: "work" });
		expect(panelPlanFor(undefined)).toEqual({ kind: "work" });
	});

	it("gives an artist DISCOGRAPHY, matched on every name they go by", () => {
		const artist = { name: "Joe Hisaishi", original_name: "久石譲", aliases: ["Joe Hisaishi", "久石譲", "Hisaishi-sensei"], mb_artist_id: "44c6" };
		expect(panelPlanFor(artist)).toEqual({ kind: "artist", names: new Set(["Joe Hisaishi", "久石譲", "Hisaishi-sensei"]) });
	});

	it("gives an album TRACKLIST", () => {
		expect(panelPlanFor({ title: "OK Computer", artists: ["Radiohead"], mb_album_id: "b139" })).toEqual({ kind: "album" });
	});

	it("reads a manga block only when it has its MAL id", () => {
		expect(hasMangaBlock({ manga: { title: "x" } })).toBe(false);
		expect(hasMangaBlock({ manga: "One Piece" })).toBe(false);
		expect(panelPlanFor({ ...anime, manga: { title: "x" } })).toEqual({ kind: "none" });
	});
});

describe("extractNames", () => {
	it("reads links and plain names alike, and drops the rest", () => {
		expect(extractNames(["[[Hans Zimmer]]", "Lorne Balfe", "[[A|B]]", "", 3])).toEqual(["Hans Zimmer", "Lorne Balfe", "A"]);
		expect(extractNames("Hans Zimmer")).toEqual([]);
	});
});
