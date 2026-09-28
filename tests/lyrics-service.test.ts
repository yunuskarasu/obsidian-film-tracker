import { describe, expect, it } from "vitest";
import { LrclibBusy, LrclibOffline, type LyricsQuery } from "../src/lrclib";
import type { Lyrics } from "../src/lyrics";
import { LyricsCache, type CacheFile } from "../src/lyrics-cache";
import { LyricsService, lyricsQueryOf, type LyricsSource, type LyricsState } from "../src/lyrics-service";
import { FakeApp } from "./fake-app";

/*
 * The lyrics a song note shows: looked up once, kept in the plugin's own
 * file so they show again without a connection, and never looked up again
 * once the user says they were wrong.
 */

const PATH = "plugins/film-tracker/lyrics.json";
const AIRBAG = "4a7fea2e-545b-4c63-bc9a-9943cc3a29d7";
const query = (): LyricsQuery => ({ title: "Airbag", artists: ["Radiohead"], album: "OK Computer", seconds: 284 });

function memoryFile(initial: Record<string, string> = {}): CacheFile & { files: Map<string, string>; writes: number } {
	const files = new Map(Object.entries(initial));
	const file = {
		files,
		writes: 0,
		exists: async (path: string) => files.has(path),
		read: async (path: string) => files.get(path) ?? "",
		write: async (path: string, data: string) => {
			file.writes += 1;
			files.set(path, data);
		},
	};
	return file;
}

/** A lyrics source answering `answer`, counting how often it was asked. */
function source(answer: () => Promise<Lyrics | null>): LyricsSource & { asked: number } {
	const counted = {
		asked: 0,
		find: async () => {
			counted.asked += 1;
			return answer();
		},
	};
	return counted;
}

/** Waits for the service to say a lookup has finished, and gives the state it ended in. */
async function settle(service: LyricsService, id: string): Promise<LyricsState> {
	for (let i = 0; i < 50 && service.state(id, query).status === "loading"; i++) await Promise.resolve();
	return service.state(id, query);
}

function setUp(answer: () => Promise<Lyrics | null>, file = memoryFile()) {
	const lrclib = source(answer);
	const changes = { count: 0 };
	const service = new LyricsService(() => lrclib, new LyricsCache(file, PATH), () => void (changes.count += 1));
	return { service, lrclib, file, changes };
}

const words: Lyrics = { kind: "text", text: "Line 1 of Airbag" };

describe("LyricsService", () => {
	it("looks a song up once, saves what it finds, and says when it has", async () => {
		const { service, lrclib, file, changes } = setUp(async () => words);
		expect(service.state(AIRBAG, query)).toEqual({ status: "loading" });

		expect(await settle(service, AIRBAG)).toEqual({ status: "text", text: "Line 1 of Airbag" });
		expect(lrclib.asked).toBe(1);
		expect(changes.count).toBe(1);
		expect(JSON.parse(file.files.get(PATH) ?? "{}")).toEqual({ version: 1, songs: { [AIRBAG]: words } });
	});

	it("shows saved lyrics without asking LRCLIB — without a connection", async () => {
		const file = memoryFile();
		const first = setUp(async () => words, file);
		await settle(first.service, AIRBAG);

		const offline = setUp(async () => {
			throw new LrclibOffline("offline");
		}, file);
		expect(await settle(offline.service, AIRBAG)).toEqual({ status: "text", text: "Line 1 of Airbag" });
		expect(offline.lrclib.asked).toBe(0);
	});

	it("says an instrumental is one, and remembers it", async () => {
		const file = memoryFile();
		const { service } = setUp(async () => ({ kind: "instrumental" }), file);
		expect(await settle(service, AIRBAG)).toEqual({ status: "instrumental" });
		expect(file.files.get(PATH)).toContain("instrumental");
	});

	it("remembers finding nothing only until Obsidian closes", async () => {
		const file = memoryFile();
		const { service, lrclib } = setUp(async () => null, file);
		expect(await settle(service, AIRBAG)).toEqual({ status: "none" });
		service.state(AIRBAG, query);
		expect(lrclib.asked).toBe(1);
		expect(file.files.has(PATH)).toBe(false);
	});

	it("says whether LRCLIB was busy or out of reach, saving neither", async () => {
		const busy = setUp(async () => {
			throw new LrclibBusy("busy");
		});
		expect(await settle(busy.service, AIRBAG)).toEqual({ status: "busy" });
		const offline = setUp(async () => {
			throw new LrclibOffline("offline");
		});
		expect(await settle(offline.service, AIRBAG)).toEqual({ status: "offline" });
		expect(busy.file.files.has(PATH) || offline.file.files.has(PATH)).toBe(false);
	});

	it("remembers lyrics marked wrong, and fetches them again only when asked", async () => {
		const file = memoryFile();
		const { service, lrclib } = setUp(async () => words, file);
		await settle(service, AIRBAG);
		await service.markWrong(AIRBAG);
		expect(service.state(AIRBAG, query)).toEqual({ status: "wrong" });

		const later = setUp(async () => words, file);
		expect(await settle(later.service, AIRBAG)).toEqual({ status: "wrong" });
		expect(later.lrclib.asked).toBe(0);

		await service.fetchAgain(AIRBAG, query);
		expect(service.state(AIRBAG, query)).toEqual({ status: "text", text: "Line 1 of Airbag" });
		expect(lrclib.asked).toBe(2);
	});

	it("lets go of saved lyrics LRCLIB no longer has, when fetched again", async () => {
		const file = memoryFile();
		let answer: Lyrics | null = words;
		const { service } = setUp(async () => answer, file);
		await settle(service, AIRBAG);
		answer = null;

		await service.fetchAgain(AIRBAG, query);
		expect(service.state(AIRBAG, query)).toEqual({ status: "none" });
		expect((JSON.parse(file.files.get(PATH) ?? "{}") as { songs: unknown }).songs).toEqual({});
	});
});

describe("LyricsCache", () => {
	it("counts a file it can't read as empty, and a nonsense entry as missing", async () => {
		const broken = new LyricsCache(memoryFile({ [PATH]: "{ not json" }), PATH);
		expect(await broken.get(AIRBAG)).toBeNull();

		const odd = new LyricsCache(memoryFile({ [PATH]: JSON.stringify({ songs: { [AIRBAG]: { kind: "text" }, b: { kind: "wrong" } } }) }), PATH);
		expect(await odd.get(AIRBAG)).toBeNull();
		expect(await odd.get("b")).toEqual({ kind: "wrong" });
	});
});

describe("lyricsQueryOf", () => {
	it("asks by the song's title, album and length, and every name its artist goes by", () => {
		const app = new FakeApp({
			"Music/Albums/First Love (1999)/First Love.md": [
				"---",
				"title: First Love",
				"artists:",
				'  - "[[Hikaru Utada]]"',
				'album: "[[First Love (1999)]]"',
				"track: 4",
				'length: "4:18"',
				"mb_recording_id: 5138e6be",
				"---",
				"",
			].join("\n"),
			"Music/Albums/First Love (1999)/First Love (1999).md": "---\ntitle: First Love\nmb_album_id: c60f\n---\n",
			"Music/Artists/Hikaru Utada.md":
				"---\nname: Hikaru Utada\noriginal_name: 宇多田ヒカル\naliases:\n  - Hikaru Utada\n  - 宇多田ヒカル\n  - Utada\nmb_artist_id: b539\n---\n",
		});
		expect(lyricsQueryOf(app.app, app.file("Music/Albums/First Love (1999)/First Love.md"))).toEqual({
			title: "First Love",
			artists: ["Hikaru Utada", "宇多田ヒカル", "Utada"],
			album: "First Love",
			seconds: 258,
		});
	});

	it("asks by what the song note has when neither its album nor its artist has a note", () => {
		const app = new FakeApp({ "Airbag.md": '---\ntitle: Airbag\nartists:\n  - Radiohead\nlength: "4:44"\nmb_recording_id: 4a7f\n---\n' });
		expect(lyricsQueryOf(app.app, app.file("Airbag.md"))).toEqual({ title: "Airbag", artists: ["Radiohead"], album: null, seconds: 284 });
	});
});
