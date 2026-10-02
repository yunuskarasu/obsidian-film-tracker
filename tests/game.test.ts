import { beforeEach, describe, expect, it } from "vitest";
import { GAME_TYPES, dlcQuery, gameQuery, toGameDlc, parsePlatformList, platformsShown, rankSearch, searchQuery, toGameMetadata, toGameSearchResult, yearOfTimestamp, type GameMetadata, type IgdbGame } from "../src/game";
import { GameActions, type GameSource } from "../src/game-actions";
import { NO_GAME_LINKS, addGameDlc, buildGameNoteContent, gameDlcsOf, setGameDlcDone, markGameCompleted, playProgressOf, refreshGameFrontmatter, setPlayStatus } from "../src/game-note";
import { IgdbClient, IgdbError, forgetIgdbTokens, type IgdbRequest, type IgdbResponse, type IgdbWeb } from "../src/igdb";
import { classifyNote, isGame, matchesRef } from "../src/note-kind";
import { panelPlanFor } from "../src/panels/panel-plan";
import { watchControlsFor } from "../src/panels/poster";
import { dlcSummary } from "../src/panels/dlc-panel";
import { VaultNotes } from "../src/vault-notes";
import { FakeApp, settings } from "./fake-app";
import { Notice } from "./obsidian-stub";

/*
 * Game notes, from IGDB. The answers here are written the way IGDB's own
 * documentation shows them; tests/igdb-flows.test.ts replays real ones.
 */

/** 2017-02-24, Hollow Knight's release, as the Unix time IGDB gives. */
const FEB_24_2017 = 1487894400;

const hollowKnight: IgdbGame = {
	id: 14593,
	name: "Hollow Knight",
	first_release_date: FEB_24_2017,
	game_type: 0,
	url: "https://www.igdb.com/games/hollow-knight",
	cover: { image_id: "co93cr" },
	platforms: [{ name: "PC (Microsoft Windows)" }, { name: "Nintendo Switch" }],
	genres: [{ name: "Platform" }, { name: "Adventure" }, { name: "Indie" }],
	involved_companies: [{ company: { name: "Team Cherry" }, developer: true, publisher: true }],
	franchises: [{ name: "Hollow Knight" }],
};

const persona: IgdbGame = {
	id: 1,
	name: "Persona 5",
	first_release_date: 1473984000,
	game_type: 0,
	collections: [{ name: "Persona" }],
	franchises: [{ name: "Megami Tensei" }],
	alternative_names: [
		{ name: "P5", comment: "Acronym" },
		{ name: "ペルソナ５", comment: "Japanese title - stylized" },
		{ name: "Persona 5 Scramble", comment: "Japanese title - translated" },
		{ name: "女神異聞錄5", comment: "Chinese title - traditional" },
	],
	involved_companies: [
		{ company: { name: "Atlus" }, developer: true, publisher: false },
		{ company: { name: "Deep Silver" }, developer: false, publisher: true },
		{ company: { name: "Atlus" }, developer: false, publisher: true },
	],
};

beforeEach(() => {
	Notice.shown.length = 0;
	forgetIgdbTokens();
});

describe("reading IGDB", () => {
	it("reads the year in UTC, whatever the device's time zone", () => {
		expect(yearOfTimestamp(FEB_24_2017)).toBe(2017);
		// 2016-12-31 23:30 UTC is still 2016.
		expect(yearOfTimestamp(1483227000)).toBe(2016);
		expect(yearOfTimestamp(undefined)).toBeNull();
	});

	it("says what a search result is when it isn't a main game, with its platforms' short names", () => {
		expect(toGameSearchResult({ ...hollowKnight, platforms: [{ abbreviation: "PC", name: "PC (Microsoft Windows)" }, { name: "Nintendo Switch" }] })).toEqual({
			id: 14593,
			title: "Hollow Knight",
			year: 2017,
			type: null,
			platforms: ["PC", "Nintendo Switch"],
		});
		expect(toGameSearchResult({ id: 2, name: "Final Fantasy VII Remake", game_type: 8 }).type).toBe("Remake");
		expect(GAME_TYPES[9]).toBe("Remaster");
	});

	it("searches main games, remakes, remasters, expanded games, ports and standalone expansions — never a DLC, a bundle or an edition", () => {
		const query = searchQuery('Hollow "Knight"');
		expect(query).toContain('search "Hollow Knight";');
		expect(query).toContain("where game_type = (0,4,8,9,10,11) & version_parent = null;");
		expect(gameQuery(14593)).toContain("where id = 14593;");
	});

	it("splits developers from publishers, each once, and takes the series from collections before franchises", () => {
		const game = toGameMetadata(persona);
		expect(game.developers).toEqual(["Atlus"]);
		expect(game.publishers).toEqual(["Deep Silver", "Atlus"]);
		expect(game.series).toEqual(["Persona"]);
		expect(toGameMetadata(hollowKnight).series).toEqual(["Hollow Knight"]);
	});

	it("keeps its Japanese titles — not their English translations, nor any other language's", () => {
		expect(toGameMetadata(persona).japaneseTitles).toEqual(["ペルソナ５"]);
		expect(toGameMetadata(hollowKnight).japaneseTitles).toEqual([]);
	});

	it("offers the game titled exactly as searched first, then the best known", () => {
		const games: IgdbGame[] = [
			{ id: 1, name: "Persona 5 Strikers", total_rating_count: 300 },
			{ id: 2, name: "Persona 5: Fan Game" },
			{ id: 3, name: "Persona 5", total_rating_count: 900 },
			{ id: 4, name: "Persona 5 Royal", total_rating_count: 700 },
		];
		expect(rankSearch(games, "persona 5").map((game) => game.id)).toEqual([3, 4, 1, 2]);
	});
});

const metadata = (game: IgdbGame = hollowKnight): GameMetadata => toGameMetadata(game);

describe("the game note", () => {
	it("writes what IGDB knows, then the user's own fields, ready to fill in", () => {
		expect(buildGameNoteContent(metadata(), "[[Hollow Knight (2017).jpg]]", NO_GAME_LINKS)).toBe(
			[
				"---",
				"title: Hollow Knight",
				"aliases:",
				"  - Hollow Knight",
				"year: 2017",
				"platforms:",
				"  - PC (Microsoft Windows)",
				"  - Nintendo Switch",
				"developers:",
				"  - Team Cherry",
				"publishers:",
				"  - Team Cherry",
				"genres:",
				"  - Platform",
				"  - Adventure",
				"  - Indie",
				"series:",
				"  - Hollow Knight",
				'poster: "[[Hollow Knight (2017).jpg]]"',
				"url: https://www.igdb.com/games/hollow-knight",
				"igdb_id: 14593",
				"play_status: backlog",
				"played_on:",
				"completed:",
				"completed_count: 0",
				"hours:",
				"---",
				"",
			].join("\n"),
		);
	});

	it("links a developer whose note exists, with Link developers on", () => {
		const note = buildGameNoteContent(metadata(), null, { ...NO_GAME_LINKS, companies: true, isResolved: (name) => name === "Team Cherry" });
		expect(note).toContain('developers:\n  - "[[Team Cherry]]"\npublishers:\n  - "[[Team Cherry]]"\n');
	});

	it("is a game note, and only that — with no panels of its own yet", () => {
		const frontmatter = { title: "Hollow Knight", igdb_id: 14593 };
		expect(classifyNote(frontmatter)).toEqual({ kind: "game", igdbId: 14593 });
		expect(matchesRef(classifyNote(frontmatter), { kind: "game", igdbId: 14593 })).toBe(true);
		expect(matchesRef(classifyNote({ title: "Inception", directors: [], tmdb_id: 14593 }), { kind: "game", igdbId: 14593 })).toBe(false);
		expect(isGame(classifyNote({ title: "Inception", directors: [], tmdb_id: 27205 }))).toBe(false);
		expect(panelPlanFor(frontmatter)).toEqual({ kind: "game" });
		// A text igdb_id someone typed is not the plugin's.
		expect(classifyNote({ title: "Mine", igdb_id: "14593" })).toBeNull();
	});

	it("offers Start playing and Completed today under the cover, counting each completion", () => {
		const note = { title: "Hollow Knight", igdb_id: 14593 };
		expect(watchControlsFor({ ...note, play_status: "backlog", completed_count: 0 })).toMatchObject({
			label: null,
			canStartPlaying: true,
			canMarkWatched: true,
			markText: "Completed today",
		});
		expect(watchControlsFor({ ...note, play_status: "playing", completed_count: 2 })).toMatchObject({
			label: "Playing · Completed 2 times",
			canStartPlaying: false,
		});
	});
});

describe("platforms", () => {
	const platforms = [
		{ name: "Xbox Series X|S", short: "Series X|S" },
		{ name: "PlayStation 4", short: "PS4" },
		{ name: "PC (Microsoft Windows)", short: "PC" },
		{ name: "Nintendo Switch", short: "Switch" },
	];

	it("lists every platform in full by default, or short, or only as many as asked for", () => {
		expect(platformsShown(platforms, { short: false, mine: null, count: 10 })).toEqual(platforms.map((platform) => platform.name));
		expect(platformsShown(platforms, { short: true, mine: null, count: 2 })).toEqual(["Series X|S", "PS4"]);
	});

	it("keeps only the user's own platforms, in their order, by either name in any case", () => {
		const mine = parsePlatformList("switch, PC (Microsoft Windows),  PS5 ,");
		expect(mine).toEqual(["switch", "PC (Microsoft Windows)", "PS5"]);
		expect(platformsShown(platforms, { short: true, mine, count: 10 })).toEqual(["Switch", "PC"]);
	});

	it("leaves the property out at 0 — and a refresh at 0 takes it out of a note that had it", () => {
		const none = { ...NO_GAME_LINKS, platforms: { short: true, mine: null, count: 0 } };
		const written = buildGameNoteContent(metadata(), null, NO_GAME_LINKS);
		expect(buildGameNoteContent(metadata(), null, none)).not.toContain("platforms");
		expect(refreshGameFrontmatter(written, metadata(), none, null)).toBe(written.replace(/platforms:\n( {2}- .*\n)+/, ""));
	});

	it("rewrites the list a refresh after the settings change", () => {
		const written = buildGameNoteContent(metadata(), null, NO_GAME_LINKS);
		const short = { ...NO_GAME_LINKS, platforms: { short: true, mine: ["Switch"], count: 10 } };
		expect(refreshGameFrontmatter(written, metadata({ ...hollowKnight, platforms: [{ name: "Nintendo Switch", abbreviation: "Switch" }, { name: "Linux" }] }), short, null)).toContain(
			"platforms:\n  - Switch\ndevelopers:",
		);
	});
});

describe("refresh", () => {
	const mine = (content: string) =>
		content
			.replace("play_status: backlog", "play_status: completed")
			.replace("played_on:", "played_on: Switch")
			.replace("completed:\n", "completed: 2024-03-01\n")
			.replace("completed_count: 0", "completed_count: 2")
			.replace("hours:", "hours: 41")
			.replace("  - Hollow Knight\nyear", "  - Hollow Knight\n  - HK\nyear")
			.replace("  - Team Cherry\npublishers", '  - "[[Team Cherry|TC]]"\npublishers') + "\nMy notes.\n";

	it("rewrites what IGDB knows and keeps the user's fields, aliases, links and body", () => {
		const written = mine(buildGameNoteContent(metadata(), "[[HK.jpg]]", NO_GAME_LINKS));
		const previous = { title: "Hollow Knight", aliases: ["Hollow Knight", "HK"], developers: ["[[Team Cherry|TC]]"] };
		const fresh = metadata({ ...hollowKnight, genres: [{ name: "Metroidvania" }] });

		const refreshed = refreshGameFrontmatter(written, fresh, NO_GAME_LINKS, "[[Other.jpg]]", previous);
		expect(refreshed).toBe(written.replace("  - Platform\n  - Adventure\n  - Indie\n", "  - Metroidvania\n"));
	});

	it("fills in a cover only when the note has none, or its file is gone", () => {
		const bare = buildGameNoteContent(metadata(), null, NO_GAME_LINKS);
		expect(refreshGameFrontmatter(bare, metadata(), NO_GAME_LINKS, "[[New.jpg]]")).toContain('poster: "[[New.jpg]]"');
		const gone = buildGameNoteContent(metadata(), "[[Gone.jpg]]", NO_GAME_LINKS);
		expect(refreshGameFrontmatter(gone, metadata(), NO_GAME_LINKS, "[[New.jpg]]", {}, true)).toContain('poster: "[[New.jpg]]"');
	});
});

describe("play status", () => {
	const note = buildGameNoteContent(metadata(), null, NO_GAME_LINKS);

	it("starts playing", () => {
		expect(setPlayStatus(note, "playing")).toBe(note.replace("play_status: backlog", "play_status: playing"));
	});

	it("is completed on the first day it was, and counted every time", () => {
		const once = markGameCompleted(note, "2026-09-28", 0);
		expect(playProgressOf({ play_status: "completed", completed: "2026-09-28", completed_count: 1 })).toEqual({
			status: "completed",
			completed: "2026-09-28",
			completedCount: 1,
		});
		expect(once).toContain("play_status: completed\nplayed_on:\ncompleted: 2026-09-28\ncompleted_count: 1\n");
		expect(markGameCompleted(once, "2027-01-02", 1)).toContain("completed: 2026-09-28\ncompleted_count: 2\n");
	});

	it("adds the fields beside their neighbours to a note that lost them", () => {
		const bare = "---\ntitle: Hollow Knight\nigdb_id: 14593\nmine: yes\n---\n";
		expect(markGameCompleted(bare, "2026-09-28", 0)).toBe(
			"---\ntitle: Hollow Knight\nigdb_id: 14593\nplay_status: completed\ncompleted: 2026-09-28\ncompleted_count: 1\nmine: yes\n---\n",
		);
	});
});

/** A Twitch and IGDB that answer from `games`, with a token each time one is asked for. */
function fakeIgdb(games: Record<string, IgdbGame[]>, options: { rejectToken?: boolean; expireFirst?: boolean } = {}) {
	const requests: IgdbRequest[] = [];
	let tokens = 0;
	let expired = options.expireFirst === true;
	const web: IgdbWeb = {
		request: async (request): Promise<IgdbResponse> => {
			requests.push(request);
			const empty = new ArrayBuffer(0);
			if (request.url.startsWith("https://id.twitch.tv/")) {
				if (options.rejectToken === true) return { status: 400, json: { message: "invalid client secret" }, arrayBuffer: empty };
				tokens += 1;
				return { status: 200, json: { access_token: `token-${tokens}`, expires_in: 5000000 }, arrayBuffer: empty };
			}
			if (request.url.startsWith("https://images.igdb.com/")) return { status: 200, json: null, arrayBuffer: new Uint8Array([1, 2]).buffer };
			if (expired) {
				expired = false;
				return { status: 401, json: null, arrayBuffer: empty };
			}
			const key = Object.keys(games).find((body) => request.body?.includes(body));
			return { status: 200, json: key === undefined ? [] : games[key], arrayBuffer: empty };
		},
		sleep: async () => {},
	};
	return { web, requests, tokens: () => tokens };
}

describe("IgdbClient", () => {
	it("asks Twitch for a token once, and uses it for every request after", async () => {
		const igdb = fakeIgdb({ 'search "hollow knight"': [hollowKnight], "where id = 14593": [hollowKnight] });
		const client = new IgdbClient("my-id", "my-secret", igdb.web);
		expect((await client.search("hollow knight")).map((game) => game.title)).toEqual(["Hollow Knight"]);
		expect((await client.getGame(14593)).developers).toEqual(["Team Cherry"]);

		expect(igdb.tokens()).toBe(1);
		const games = igdb.requests.filter((request) => request.url === "https://api.igdb.com/v4/games");
		expect(games).toHaveLength(2);
		for (const request of games) {
			expect(request.headers).toEqual({ "Client-ID": "my-id", Authorization: "Bearer token-1", Accept: "application/json" });
			// The secret only ever goes to Twitch, for the token.
			expect(JSON.stringify(request)).not.toContain("my-secret");
		}
	});

	it("asks for a new token when IGDB turns the kept one away — the user never has to", async () => {
		const igdb = fakeIgdb({ "where id = 14593": [hollowKnight] }, { expireFirst: true });
		const client = new IgdbClient("my-id", "my-secret", igdb.web);
		expect((await client.getGame(14593)).title).toBe("Hollow Knight");
		expect(igdb.tokens()).toBe(2);
	});

	it("says so when Twitch doesn't accept the client ID and secret", async () => {
		const client = new IgdbClient("my-id", "wrong", fakeIgdb({}, { rejectToken: true }).web);
		await expect(client.search("hollow knight")).rejects.toThrow(IgdbError);
		await expect(client.search("hollow knight")).rejects.toThrow(/client ID and secret/);
	});

	it("says a game IGDB no longer has is gone", async () => {
		const client = new IgdbClient("my-id", "my-secret", fakeIgdb({}).web);
		await expect(client.getGame(1)).rejects.toThrow("IGDB has no such game any more.");
	});
});

describe("DLCs", () => {
	const note = buildGameNoteContent(metadata(), null, NO_GAME_LINKS);
	const dreams = { id: 101, title: "Hidden Dreams", year: 2017, type: "DLC" };
	const grimm = { id: 102, title: "The Grimm Troupe", year: 2017, type: "DLC" };

	it("asks IGDB for a game's own DLCs and expansions only, oldest first", () => {
		expect(dlcQuery(1942)).toBe(
			"fields name,first_release_date,game_type; where parent_game = 1942 & game_type = (1,2); sort first_release_date asc; limit 100;",
		);
		expect(toGameDlc({ id: 5, name: "Blood and Wine", game_type: 2, first_release_date: 1464048000 })).toEqual({
			id: 5,
			title: "Blood and Wine",
			year: 2016,
			type: "Expansion",
		});
	});

	it("adds a DLC as a line at the end of the note's properties, once, and nothing else", () => {
		const once = addGameDlc(note, dreams) ?? "";
		expect(once).toBe(note.replace("hours:\n", "hours:\ndlcs:\n  - { title: Hidden Dreams, year: 2017, igdb_id: 101, done: false }\n"));
		expect(addGameDlc(once, dreams)).toBe(once);
		expect(addGameDlc(once, grimm)).toContain("igdb_id: 101, done: false }\n  - { title: The Grimm Troupe, year: 2017, igdb_id: 102, done: false }\n");
	});

	it("ticks a DLC off with the day, and back, keeping a key the user added to its line", () => {
		const added = (addGameDlc(note, dreams) ?? "").replace("done: false }", "done: false, mine: 9 }");
		const done = setGameDlcDone(added, 101, true, "2026-10-02") ?? "";
		expect(done).toContain("- { title: Hidden Dreams, year: 2017, igdb_id: 101, done: true, completed: 2026-10-02, mine: 9 }");
		// Ticked again later, it keeps the first day.
		expect(setGameDlcDone(done, 101, true, "2027-01-01")).toBe(done);
		expect(setGameDlcDone(done, 101, false, "2027-01-01")).toBe(added);
	});

	it("reads the list back, and leaves a list it can't read alone", () => {
		expect(gameDlcsOf({ dlcs: [{ title: "Hidden Dreams", year: 2017, igdb_id: 101, done: true, completed: "2026-10-02" }] })).toEqual([
			{ title: "Hidden Dreams", year: 2017, igdbId: 101, done: true, completed: "2026-10-02", extra: {} },
		]);
		expect(gameDlcsOf({})).toEqual([]);
		expect(gameDlcsOf({ dlcs: "not a list" })).toBeNull();
		const broken = note.replace("hours:\n", "hours:\ndlcs:\n  - { title: Mine }\n");
		expect(addGameDlc(broken, dreams)).toBeNull();
	});

	it("is kept as it is by a refresh", () => {
		const added = setGameDlcDone(addGameDlc(note, dreams) ?? "", 101, true, "2026-10-02") ?? "";
		expect(refreshGameFrontmatter(added, metadata(), NO_GAME_LINKS, null)).toBe(added);
	});

	it("says a DLC's line in the panel", () => {
		const [entry] = gameDlcsOf({ dlcs: [{ title: "Hidden Dreams", year: 2017, igdb_id: 101, done: true, completed: "2026-10-02" }] }) ?? [];
		expect(dlcSummary(entry)).toBe("Hidden Dreams · 2017 · 2026-10-02");
		expect(dlcSummary({ ...entry, done: false })).toBe("Hidden Dreams · 2017");
	});
});

describe("GameActions", () => {
	function setUp(notes: Record<string, string> = {}, overrides = {}) {
		const app = new FakeApp(notes);
		const games = new GameActions(app.app, new VaultNotes(app.app), settings(overrides));
		const asked: number[] = [];
		const client: GameSource = {
			getGame: async (id) => {
				asked.push(id);
				return metadata();
			},
			downloadCover: async () => new Uint8Array([1, 2]).buffer,
			dlcs: async () => [
				{ id: 101, title: "Hidden Dreams", year: 2017, type: "DLC" },
				{ id: 102, title: "The Grimm Troupe", year: 2017, type: "DLC" },
			],
		};
		return { app, games, client, asked };
	}
	const result = { id: 14593, title: "Hollow Knight", year: 2017, type: null, platforms: [] };

	it("writes the game's note and cover, and opens it", async () => {
		const { app, games, client } = setUp({}, { gameCoverFolder: "Games/Covers" });
		await games.addGame(client, result);

		expect(app.note("Games/Hollow Knight (2017).md")).toContain("igdb_id: 14593\nplay_status: backlog\n");
		expect(app.note("Games/Hollow Knight (2017).md")).toContain('poster: "[[Hollow Knight (2017).jpg]]"');
		expect(app.images.has("Games/Covers/Hollow Knight (2017).jpg")).toBe(true);
		expect(app.opened).toEqual(["Games/Hollow Knight (2017).md"]);
		expect(Notice.shown).toEqual(["Added Hollow Knight"]);
	});

	it("opens the note it already has rather than asking IGDB or writing a second", async () => {
		const { app, games, client, asked } = setUp({ "Mine/HK.md": "---\ntitle: Hollow Knight\nigdb_id: 14593\n---\n" });
		await games.addGame(client, result);
		expect(asked).toEqual([]);
		expect([...app.notes.keys()]).toEqual(["Mine/HK.md"]);
		expect(Notice.shown).toEqual(["Already in your vault: HK"]);
	});

	it("offers only the DLCs the note doesn't have, adds the one picked, and ticks it off", async () => {
		const { app, games, client } = setUp();
		await games.addGame(client, result);
		const path = "Games/Hollow Knight (2017).md";
		const file = app.file(path);

		expect((await games.dlcChoices(client, file))?.map((dlc) => dlc.title)).toEqual(["Hidden Dreams", "The Grimm Troupe"]);
		await games.addDlc(file, { id: 101, title: "Hidden Dreams", year: 2017, type: "DLC" });
		expect((await games.dlcChoices(client, file))?.map((dlc) => dlc.title)).toEqual(["The Grimm Troupe"]);
		expect(Notice.shown[Notice.shown.length - 1]).toBe("Added Hidden Dreams to Hollow Knight (2017).");

		await games.setDlcDone(file, 101, true);
		expect(gameDlcsOf(app.frontmatter(path))?.[0]).toMatchObject({ igdbId: 101, done: true });
	});

	it("refreshes, starts playing and completes, touching only what each is for", async () => {
		const { app, games, client } = setUp();
		await games.addGame(client, result);
		const path = "Games/Hollow Knight (2017).md";
		const file = app.file(path);

		await games.startPlaying(file);
		expect(app.frontmatter(path).play_status).toBe("playing");
		await games.markCompletedToday(file);
		await games.markCompletedToday(file);
		expect(app.frontmatter(path)).toMatchObject({ play_status: "completed", completed_count: 2 });
		expect(Notice.shown[Notice.shown.length - 1]).toBe("Completed Hollow Knight (2017) today — 2 times so far.");

		const played = app.note(path);
		await games.refresh(client, file);
		expect(app.note(path)).toBe(played);
	});
});
