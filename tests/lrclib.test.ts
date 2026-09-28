import { describe, expect, it } from "vitest";
import { LrclibBusy, LrclibClient, LrclibOffline } from "../src/lrclib";
import type { WebAccess, WebResponse } from "../src/musicbrainz";
import { replayLrclib } from "./lrclib-fixtures";

/*
 * The LRCLIB client end to end, against LRCLIB's saved answers: which
 * requests it makes, and when it would rather find nothing than the wrong
 * song.
 */

const client = () => {
	const web = replayLrclib();
	return { web, lrclib: new LrclibClient("3.1.0", web) };
};

const answer = (status: number, json: unknown = null): WebResponse => ({ status, json, arrayBuffer: new ArrayBuffer(0) });

describe("find", () => {
	it("finds a song by its title, artist, album and length in one request", async () => {
		const { web, lrclib } = client();
		const found = await lrclib.find({ title: "Airbag", artists: ["Radiohead"], album: "OK Computer", seconds: 284 });
		expect(found).toEqual({ kind: "text", text: "Line 1 of Airbag\nLine 2 of Airbag\nLine 3 of Airbag\nLine 4 of Airbag" });
		expect(web.requests).toEqual(["https://lrclib.net/api/get?artist_name=Radiohead&track_name=Airbag&album_name=OK+Computer&duration=284"]);
	});

	it("says an instrumental is one", async () => {
		const { lrclib } = client();
		const found = await lrclib.find({
			title: "Cornfield Chase",
			artists: ["Hans Zimmer"],
			album: "Interstellar (Original Motion Picture Soundtrack)",
			seconds: 126,
		});
		expect(found).toEqual({ kind: "instrumental" });
	});

	it("finds nothing for a song LRCLIB doesn't have, after looking it up and searching for it", async () => {
		const { web, lrclib } = client();
		expect(await lrclib.find({ title: "Nothing Qqq Zzz", artists: ["Nobody Xyz"], album: null, seconds: 200 })).toBeNull();
		expect(web.requests).toHaveLength(2);
		// An album it doesn't know is left out of the request, not sent empty.
		expect(web.requests[0]).not.toContain("album_name");
	});

	it("would rather find nothing than a recording of another length", async () => {
		const { lrclib } = client();
		expect(await lrclib.find({ title: "Airbag", artists: ["Radiohead"], album: "OK Computer", seconds: 400 })).toBeNull();
	});

	it("looks a song of unknown length up without one", async () => {
		const { web, lrclib } = client();
		const found = await lrclib.find({ title: "Tank!", artists: ["The Seatbelts", "シートベルツ"], album: "COWBOY BEBOP", seconds: null });
		expect(found?.kind).toBe("text");
		expect(web.requests[0]).not.toContain("duration");
	});

	it("tries the artist's other name when the first finds nothing", async () => {
		const requests: string[] = [];
		const web: WebAccess = {
			get: async (url) => {
				requests.push(url);
				if (url.includes("/api/search")) return answer(200, []);
				if (url.includes("%E5%AE%87")) return answer(200, { id: 1, trackName: "First Love", plainLyrics: "Line 1" });
				return answer(404);
			},
			sleep: async () => {},
		};
		const found = await new LrclibClient("3.1.0", web).find({
			title: "First Love",
			artists: ["Hikaru Utada", "宇多田ヒカル"],
			album: "First Love",
			seconds: 258,
		});
		expect(found).toEqual({ kind: "text", text: "Line 1" });
		expect(requests).toHaveLength(3);
	});

	it("sends nothing but the song's own details, and says who is asking", async () => {
		const { web, lrclib } = client();
		await lrclib.find({ title: "Here Comes the Sun", artists: ["The Beatles"], album: "Abbey Road", seconds: 186 });
		for (const url of web.requests) expect(url.startsWith("https://lrclib.net/api/")).toBe(true);
		expect(web.userAgents).toEqual(["FilmTracker/3.1.0 ( https://github.com/yunuskarasu/obsidian-film-tracker )"]);
	});
});

describe("manners", () => {
	it("asks a busy LRCLIB twice more, waiting longer each time, then says so", async () => {
		let calls = 0;
		const pauses: number[] = [];
		const web: WebAccess = {
			get: async () => {
				calls += 1;
				return answer(503);
			},
			sleep: async (ms) => void pauses.push(ms),
		};
		await expect(new LrclibClient("3.1.0", web).find({ title: "x", artists: ["y"], album: null, seconds: 1 })).rejects.toBeInstanceOf(LrclibBusy);
		expect(calls).toBe(3);
		expect(pauses).toEqual([1500, 3000]);
	});

	it("gets past a connection dropped once", async () => {
		let dropped = false;
		const web: WebAccess = {
			get: async () => {
				if (!dropped) {
					dropped = true;
					throw new Error("net::ERR_CONNECTION_CLOSED");
				}
				return answer(200, { id: 1, trackName: "x", plainLyrics: "Words" });
			},
			sleep: async () => {},
		};
		expect(await new LrclibClient("3.1.0", web).find({ title: "x", artists: ["y"], album: null, seconds: 1 })).toEqual({
			kind: "text",
			text: "Words",
		});
	});

	it("says it is offline when no request gets through", async () => {
		const web: WebAccess = {
			get: async () => {
				throw new Error("net::ERR_INTERNET_DISCONNECTED");
			},
			sleep: async () => {},
		};
		await expect(new LrclibClient("3.1.0", web).find({ title: "x", artists: ["y"], album: null, seconds: 1 })).rejects.toBeInstanceOf(
			LrclibOffline,
		);
	});
});
