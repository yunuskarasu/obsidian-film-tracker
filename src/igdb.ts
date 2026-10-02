import { requestUrl } from "obsidian";
import { coverUrl, dlcQuery, gameQuery, rankSearch, searchQuery, toGameDlc, type GameDlc, toGameMetadata, toGameSearchResult, type GameMetadata, type GameSearchResult, type IgdbGame } from "./game";

const API_BASE = "https://api.igdb.com/v4";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";

/** IGDB takes four requests a second; a little over a quarter second apart keeps well under it. */
const GAP_MS = 260;

export class IgdbError extends Error {}

/** One answer, the way `requestUrl` gives it. */
export interface IgdbResponse {
	status: number;
	json: unknown;
	arrayBuffer: ArrayBuffer;
}

export interface IgdbRequest {
	url: string;
	method: "GET" | "POST";
	headers?: Record<string, string>;
	body?: string;
}

/** What the client needs from the outside world: tests hand it saved answers instead. */
export interface IgdbWeb {
	request(request: IgdbRequest): Promise<IgdbResponse>;
	sleep(ms: number): Promise<void>;
}

export const OBSIDIAN_IGDB_WEB: IgdbWeb = {
	request: async ({ url, method, headers, body }) => {
		const response = await requestUrl({ url, method, headers, body, throw: false });
		return {
			status: response.status,
			get json(): unknown {
				try {
					return response.json as unknown;
				} catch {
					return null;
				}
			},
			arrayBuffer: response.arrayBuffer,
		};
	},
	sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
};

/**
 * The access token Twitch hands out for a client ID and secret, good for
 * about two months. It is kept in memory only — never in the settings — for
 * as long as Obsidian is open, and asked for again whenever IGDB turns it
 * away. The user never has to do anything about it.
 */
const tokens = new Map<string, { token: string; expiresAt: number }>();
let nextRequestAt = 0;
let queue: Promise<void> = Promise.resolve();

/** Forgets every token: for tests, and nothing else. */
export function forgetIgdbTokens(): void {
	tokens.clear();
	nextRequestAt = 0;
}

/**
 * IGDB, the games database run by Twitch. It is reached with a Twitch app's
 * client ID and secret, which the user keeps in Obsidian's keychain; the
 * client trades them for an access token itself.
 */
export class IgdbClient {
	private readonly clientId: string;
	private readonly clientSecret: string;
	private readonly web: IgdbWeb;

	constructor(clientId: string, clientSecret: string, web: IgdbWeb = OBSIDIAN_IGDB_WEB) {
		this.clientId = clientId.trim();
		this.clientSecret = clientSecret.trim();
		this.web = web;
	}

	async search(query: string): Promise<GameSearchResult[]> {
		const games = await this.post<IgdbGame[]>("games", searchQuery(query));
		return rankSearch(games, query).map(toGameSearchResult).filter((game) => game.title !== "");
	}

	async getGame(id: number): Promise<GameMetadata> {
		const [game] = await this.post<IgdbGame[]>("games", gameQuery(id));
		if (game === undefined) throw new IgdbError("IGDB has no such game any more.");
		return toGameMetadata(game);
	}

	/** A game's own DLCs and expansions, oldest first. */
	async dlcs(gameId: number): Promise<GameDlc[]> {
		const games = await this.post<IgdbGame[]>("games", dlcQuery(gameId));
		return games.map(toGameDlc).filter((dlc) => dlc.title !== "");
	}

	/** A game's cover. The image server needs no token. */
	async downloadCover(imageId: string): Promise<ArrayBuffer> {
		const response = await this.send({ url: coverUrl(imageId), method: "GET" });
		if (response.status !== 200 || response.arrayBuffer.byteLength === 0) {
			throw new IgdbError(`Cover download failed (HTTP ${response.status}).`);
		}
		return response.arrayBuffer;
	}

	/** One query to one of IGDB's endpoints, with a fresh token once if the one kept is turned away. */
	private async post<T>(endpoint: string, body: string): Promise<T> {
		for (let attempt = 0; attempt < 2; attempt++) {
			const token = await this.token(attempt > 0);
			await this.waitForTurn();
			const response = await this.send({
				url: `${API_BASE}/${endpoint}`,
				method: "POST",
				headers: { "Client-ID": this.clientId, Authorization: `Bearer ${token}`, Accept: "application/json" },
				body,
			});
			if (response.status === 200) return (Array.isArray(response.json) ? response.json : []) as T;
			if (response.status === 401 || response.status === 403) continue;
			if (response.status === 429) throw new IgdbError("IGDB is busy right now. Try again in a moment.");
			throw new IgdbError(`IGDB request failed (HTTP ${response.status}).`);
		}
		throw new IgdbError("IGDB turned the request away. Check your IGDB client ID and secret.");
	}

	private async token(fresh: boolean): Promise<string> {
		const kept = tokens.get(this.clientId);
		if (!fresh && kept !== undefined && kept.expiresAt > Date.now()) return kept.token;

		const params = new URLSearchParams({
			client_id: this.clientId,
			client_secret: this.clientSecret,
			grant_type: "client_credentials",
		});
		const response = await this.send({ url: `${TOKEN_URL}?${params.toString()}`, method: "POST" });
		const answer = response.json as { access_token?: unknown; expires_in?: unknown } | null;
		if (response.status !== 200 || typeof answer?.access_token !== "string") {
			tokens.delete(this.clientId);
			throw new IgdbError("Twitch didn't accept your IGDB client ID and secret. Check them in Film + Anime-Manga Tracker settings.");
		}
		// A minute early, so a token never runs out halfway through a command.
		const seconds = typeof answer.expires_in === "number" ? answer.expires_in : 3600;
		tokens.set(this.clientId, { token: answer.access_token, expiresAt: Date.now() + (seconds - 60) * 1000 });
		return answer.access_token;
	}

	private async send(request: IgdbRequest): Promise<IgdbResponse> {
		try {
			return await this.web.request(request);
		} catch (error) {
			console.error("Film + Anime-Manga Tracker: IGDB request failed", error);
			throw new IgdbError("Could not reach IGDB. Check your internet connection.");
		}
	}

	/** Requests take their turns one after another, a little apart — see `GAP_MS`. */
	private async waitForTurn(): Promise<void> {
		const turn = queue.then(async () => {
			const wait = nextRequestAt - Date.now();
			if (wait > 0) await this.web.sleep(wait);
			nextRequestAt = Date.now() + GAP_MS;
		});
		queue = turn.catch(() => undefined);
		await turn;
	}
}
