import { beforeEach, describe, expect, it } from "vitest";
import { GameActions } from "../src/game-actions";
import { VaultNotes } from "../src/vault-notes";
import { FakeApp, settings } from "./fake-app";
import { replayIgdbClient } from "./igdb-fixtures";
import { Notice } from "./obsidian-stub";

/*
 * Add game and its search end to end, on IGDB's real answers: what is
 * offered, in which order, and the note each pick writes.
 */

beforeEach(() => {
	Notice.shown.length = 0;
});

describe("the game search, on IGDB's answers", () => {
	it("puts a game titled exactly as searched first, then the best known", async () => {
		const { client } = replayIgdbClient();
		expect((await client.search("Persona 5")).slice(0, 3).map((game) => [game.title, game.type])).toEqual([
			["Persona 5", null],
			["Persona 5 Royal", "Expanded game"],
			["Persona 5 Strikers", null],
		]);
	});

	it("offers Final Fantasy VII itself before its ports and the fan games of the same name", async () => {
		const { client } = replayIgdbClient();
		const results = await client.search("Final Fantasy VII");
		expect(results[0]).toMatchObject({ id: 427, title: "Final Fantasy VII", year: 1997, type: "Expanded game" });
		expect(results[1]).toMatchObject({ title: "Final Fantasy VII", type: "Port", year: 2015 });
		expect(results.map((game) => game.title)).toContain("Final Fantasy VII Remake");
	});

	it("says a remaster is one, and never offers a DLC", async () => {
		const { client } = replayIgdbClient();
		const witcher = await client.search("The Witcher 3");
		expect(witcher.map((game) => [game.title, game.type])).toEqual([
			["The Witcher 3: Wild Hunt", null],
			["The Witcher 3: Wild Hunt Remastered", "Remaster"],
		]);
		// Hearts of Stone and Blood and Wine are its DLCs: not here.
		expect(witcher.some((game) => /Hearts of Stone|Blood and Wine/.test(game.title))).toBe(false);
	});

	it("names each result's platforms short", async () => {
		const { client } = replayIgdbClient();
		const [hollowKnight] = await client.search("Hollow Knight");
		expect(hollowKnight.title).toBe("Hollow Knight");
		expect(hollowKnight.platforms).toContain("PC");
		expect(hollowKnight.platforms).toContain("Switch");
	});
});

describe("Add game, on IGDB's answers", () => {
	function setUp() {
		const app = new FakeApp();
		const games = new GameActions(app.app, new VaultNotes(app.app), settings());
		return { app, games, ...replayIgdbClient() };
	}
	const pick = (id: number, title: string) => ({ id, title, year: null, type: null, platforms: [] });

	it("writes Hollow Knight's note, with its cover beside it", async () => {
		const { app, games, client, web } = setUp();
		await games.addGame(client, pick(14593, "Hollow Knight"));

		const path = "Games/Hollow Knight (2017).md";
		const note = app.frontmatter(path);
		expect(note).toMatchObject({
			title: "Hollow Knight",
			aliases: ["Hollow Knight"],
			year: 2017,
			developers: ["Team Cherry"],
			publishers: ["Team Cherry"],
			series: ["Hollow Knight"],
			url: "https://www.igdb.com/games/hollow-knight",
			igdb_id: 14593,
			play_status: "backlog",
			completed_count: 0,
		});
		// Short names by default, at most ten of them.
		expect(note.platforms).toContain("PC");
		expect(note.platforms).toContain("Switch");
		expect((note.platforms as string[]).length).toBeLessThanOrEqual(10);
		expect(note.poster).toBe("[[Hollow Knight (2017).jpg]]");
		expect(web.requests.some((request) => request.url.includes("/t_cover_big_2x/"))).toBe(true);
		expect(Notice.shown).toEqual(["Added Hollow Knight"]);
	});

	it("keeps a game's Japanese titles in its aliases, and none of its other names", async () => {
		const { app, games, client } = setUp();
		await games.addGame(client, pick(117731, "Persona 5 Strikers"));
		expect(app.frontmatter("Games/Persona 5 Strikers (2020).md").aliases).toEqual([
			"Persona 5 Strikers",
			"ペルソナ５スクランブル ザ ファントムストライカーズ",
		]);
	});

	it("gives a port its own note, apart from the game it ports", async () => {
		const { app, games, client } = setUp();
		await games.addGame(client, pick(427, "Final Fantasy VII"));
		await games.addGame(client, pick(207026, "Final Fantasy VII"));
		expect([...app.notes.keys()]).toEqual(["Games/Final Fantasy VII (1997).md", "Games/Final Fantasy VII (2015).md"]);
	});

	it("refreshes a played game without touching what the user wrote", async () => {
		const { app, games, client } = setUp();
		await games.addGame(client, pick(1942, "The Witcher 3: Wild Hunt"));
		const path = "Games/The Witcher 3 Wild Hunt (2015).md";
		const file = app.file(path);
		await games.startPlaying(file);
		await games.markCompletedToday(file);
		app.notes.set(path, app.note(path).replace("hours:", "hours: 120").replace("played_on:", "played_on: PS5") + "\nGeralt.\n");
		const played = app.note(path);

		await games.refresh(client, file);
		expect(app.note(path)).toBe(played);
	});
});

describe("Add DLC, on IGDB's answers", () => {
	function setUp() {
		const app = new FakeApp();
		const games = new GameActions(app.app, new VaultNotes(app.app), settings());
		return { app, games, ...replayIgdbClient() };
	}
	const pick = (id: number, title: string) => ({ id, title, year: null, type: null, platforms: [] });

	it("offers a game's DLCs and expansions, oldest first, and says which is which", async () => {
		const { client } = replayIgdbClient();
		const witcher = await client.dlcs(1942);
		expect(witcher).toHaveLength(8);
		expect(witcher.filter((dlc) => dlc.type === "Expansion").map((dlc) => dlc.title)).toEqual([
			"The Witcher 3: Wild Hunt - Hearts of Stone",
			"The Witcher 3: Wild Hunt - Blood and Wine",
			"The Witcher 3: Wild Hunt - Songs of the Past",
		]);
		expect((await client.dlcs(7346)).map((dlc) => dlc.type)).toEqual(["DLC", "DLC"]);
		// Hollow Knight's free updates aren't DLCs on IGDB.
		expect(await client.dlcs(14593)).toEqual([]);
	});

	it("adds the one picked to the game's note, and never offers it again", async () => {
		const { app, games, client } = setUp();
		await games.addGame(client, pick(1942, "The Witcher 3: Wild Hunt"));
		const file = app.file("Games/The Witcher 3 Wild Hunt (2015).md");

		const choices = (await games.dlcChoices(client, file)) ?? [];
		const hearts = choices.find((dlc) => dlc.title.endsWith("Hearts of Stone"));
		expect(hearts).toBeDefined();
		await games.addDlc(file, hearts!);

		expect((await games.dlcChoices(client, file))?.some((dlc) => dlc.id === hearts!.id)).toBe(false);
		expect(app.note(file.path)).toContain(`dlcs:\n  - { title: "The Witcher 3: Wild Hunt - Hearts of Stone", year: 2015, igdb_id: ${hearts!.id}, done: false }\n`);
	});
});
