/// <reference types="vite/client" />
import type { WebAccess, WebResponse } from "../src/musicbrainz";
import { OpenLibraryClient, resetOpenLibraryQueue } from "../src/openlibrary";

/*
 * Open Library, Wikidata and Wikimedia Commons as they answered on
 * 2026-10-11: tests/fixtures/openlibrary holds each answer, saved by
 * tests/openlibrary-record.test.mts, and index.json says which request each
 * one answers.
 */

const FILES = import.meta.glob<unknown>("./fixtures/openlibrary/*.json", { eager: true, import: "default" });
const INDEX = FILES["./fixtures/openlibrary/index.json"] as Record<string, string>;

/** A picture's bytes: anything but an API answer is an image here. */
const IMAGE = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer;

const isApi = (url: string) => url.startsWith("https://openlibrary.org/") || url.includes("/w/api.php");

/**
 * The web as the fixtures remember it, every request kept in order. With
 * `wikidataDown`, Wikidata answers nothing but errors; every other request
 * not recorded is a 404, and every picture is there.
 */
export function replayOpenLibrary(options: { wikidataDown?: boolean } = {}): WebAccess & { requests: string[]; userAgents: string[] } {
	const requests: string[] = [];
	const userAgents: string[] = [];
	return {
		requests,
		userAgents,
		get: async (url, headers): Promise<WebResponse> => {
			requests.push(url);
			userAgents.push(headers["User-Agent"] ?? "");
			if (options.wikidataDown === true && url.includes("wikidata.org")) return { status: 503, json: null, arrayBuffer: new ArrayBuffer(0) };
			const file = INDEX[url];
			if (file !== undefined) {
				return { status: 200, json: structuredClone(FILES[`./fixtures/openlibrary/${file}`]), arrayBuffer: new ArrayBuffer(0) };
			}
			if (!isApi(url)) return { status: 200, json: null, arrayBuffer: IMAGE, contentType: "image/jpeg" };
			return { status: 404, json: null, arrayBuffer: new ArrayBuffer(0) };
		},
		sleep: async () => {},
	};
}

export function replayOpenLibraryClient(options: { wikidataDown?: boolean } = {}) {
	resetOpenLibraryQueue();
	const web = replayOpenLibrary(options);
	return { client: new OpenLibraryClient("3.5.0", web), web };
}
