/// <reference types="vite/client" />
import { IgdbClient, forgetIgdbTokens, type IgdbRequest, type IgdbResponse, type IgdbWeb } from "../src/igdb";

/*
 * IGDB as it answered on 2026-10-01: tests/fixtures/igdb holds each answer,
 * saved by tests/igdb-record.test.mts, and index.json says which query each
 * one answers. Twitch's token and the covers are stood in for here; no key,
 * secret or token was ever saved.
 */

const FILES = import.meta.glob<unknown>("./fixtures/igdb/*.json", { eager: true, import: "default" });
const INDEX = FILES["./fixtures/igdb/index.json"] as Record<string, string>;

/** IGDB's games endpoint, Twitch's token and IGDB's image server, from the saved answers; every request kept. */
export function replayIgdb(): IgdbWeb & { requests: IgdbRequest[] } {
	const requests: IgdbRequest[] = [];
	return {
		requests,
		request: async (request): Promise<IgdbResponse> => {
			requests.push(request);
			const empty = new ArrayBuffer(0);
			if (request.url.startsWith("https://id.twitch.tv/")) {
				return { status: 200, json: { access_token: "replayed-token", expires_in: 5000000 }, arrayBuffer: empty };
			}
			if (request.url.startsWith("https://images.igdb.com/")) {
				return { status: 200, json: null, arrayBuffer: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer };
			}
			const file = request.body === undefined ? undefined : INDEX[request.body];
			if (file === undefined) return { status: 200, json: [], arrayBuffer: empty };
			return { status: 200, json: structuredClone(FILES[`./fixtures/igdb/${file}`]), arrayBuffer: empty };
		},
		sleep: async () => {},
	};
}

export function replayIgdbClient() {
	forgetIgdbTokens();
	const web = replayIgdb();
	return { client: new IgdbClient("replayed-id", "replayed-secret", web), web };
}
