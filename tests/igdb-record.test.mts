import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IgdbClient, forgetIgdbTokens, type IgdbRequest, type IgdbResponse, type IgdbWeb } from "../src/igdb";

/*
 * Saves IGDB's real answers into tests/fixtures/igdb, for the replayed tests
 * to read. Run on its own, with IGDB_CLIENT_ID and IGDB_CLIENT_SECRET set in
 * the same terminal:
 *
 *     $env:IGDB_CLIENT_ID = "…"; $env:IGDB_CLIENT_SECRET = "…"
 *     npx vitest run --config vitest.record.config.mts
 *
 * Without them it fails and says so, rather than skipping in silence.
 * Only the games' data is written: never a request's headers, the client ID,
 * the secret or the token — and the files are checked for all three before
 * they are kept.
 */

const CLIENT_ID = process.env.IGDB_CLIENT_ID?.trim() ?? "";
const CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET?.trim() ?? "";
// Beside this file, wherever the terminal is.
const OUT = fileURLToPath(new URL("./fixtures/igdb", import.meta.url));

const SEARCHES = ["Hollow Knight", "The Witcher 3", "Final Fantasy VII", "Persona 5", "Breath of the Wild"];

describe("recording IGDB's answers", () => {
	it("saves each search and each game's details, and nothing of the keys", { timeout: 120_000 }, async () => {
		if (CLIENT_ID === "" || CLIENT_SECRET === "") {
			throw new Error(
				"IGDB_CLIENT_ID and IGDB_CLIENT_SECRET aren't set in this terminal. Set both in the same PowerShell window, then run this again.",
			);
		}
		forgetIgdbTokens();
		const saved = new Map<string, unknown>();
		const secrets = [CLIENT_ID, CLIENT_SECRET];
		const web: IgdbWeb = {
			request: async (request: IgdbRequest): Promise<IgdbResponse> => {
				const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body });
				const buffer = await response.arrayBuffer();
				let json: unknown = null;
				try {
					json = JSON.parse(new TextDecoder().decode(buffer)) as unknown;
				} catch {
					// A picture: nothing to save.
				}
				if (request.url.startsWith("https://id.twitch.tv/")) {
					const token = (json as { access_token?: string } | null)?.access_token;
					if (typeof token === "string") secrets.push(token);
				} else if (request.url.startsWith("https://api.igdb.com/") && request.body !== undefined) {
					saved.set(request.body, json);
				}
				return { status: response.status, json, arrayBuffer: buffer };
			},
			sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		};

		const client = new IgdbClient(CLIENT_ID, CLIENT_SECRET, web);
		const ids = new Set<number>();
		for (const query of SEARCHES) {
			const results = await client.search(query);
			// The first three of each search, and every remake, remaster or expanded game among them.
			results.slice(0, 3).forEach((game) => ids.add(game.id));
			results.filter((game) => game.type !== null).slice(0, 3).forEach((game) => ids.add(game.id));
		}
		for (const id of ids) await client.getGame(id);
		// The DLCs of a game with expansions, of one with free updates, and of one with an expansion pass.
		for (const id of [1942, 14593, 7346]) await client.dlcs(id);

		mkdirSync(OUT, { recursive: true });
		const indexPath = `${OUT}/index.json`;
		const index = existsSync(indexPath) ? (JSON.parse(readFileSync(indexPath, "utf8")) as Record<string, string>) : {};
		let n = Object.keys(index).length;
		for (const [body, json] of saved) {
			const text = `${JSON.stringify(json, null, "\t")}\n`;
			for (const secret of secrets) expect(text.includes(secret), "a key or token in a saved answer").toBe(false);
			for (const secret of secrets) expect(body.includes(secret), "a key or token in a request").toBe(false);
			const file = index[body] ?? `${String(++n).padStart(2, "0")}-${body.startsWith("search") ? "search" : "game"}.json`;
			writeFileSync(`${OUT}/${file}`, text);
			index[body] = file;
		}
		writeFileSync(indexPath, `${JSON.stringify(index, null, "\t")}\n`);
		expect(saved.size).toBeGreaterThan(SEARCHES.length);
	});
});
