/// <reference types="vite/client" />
import { MusicBrainzClient, type WebAccess, type WebResponse } from "../src/musicbrainz";

/*
 * MusicBrainz, Wikidata, Commons and Deezer as they answered on 2026-09-24:
 * tests/fixtures/musicbrainz holds each answer, trimmed to the fields the
 * plugin reads, and index.json says which request each one answers.
 */

const FILES = import.meta.glob<unknown>("./fixtures/musicbrainz/*.json", { eager: true, import: "default" });
const INDEX = FILES["./fixtures/musicbrainz/index.json"] as Record<string, string>;

function answer(file: string): unknown {
	// A fresh copy each time: nothing a test does to one answer can leak into the next.
	return structuredClone(FILES[`./fixtures/musicbrainz/${file}`]);
}

/** A saved answer by its name, without the number in front: "album-ok-computer". */
export function fixture<T>(name: string): T {
	const file = Object.values(INDEX).find((entry) => entry.replace(/^\d+-/, "") === `${name}.json`);
	if (file === undefined) throw new Error(`No fixture named ${name}`);
	return answer(file) as T;
}

/** A picture's bytes: anything but an API answer is an image here. */
const IMAGE = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer;

/**
 * The web as the fixtures remember it. `images` says which picture URLs
 * answer (the Cover Art Archive's, say); every other unrecorded URL is a 404,
 * and every request is kept in `requests` in the order it was made.
 */
export function replayWeb(
	images: (url: string) => boolean = () => true,
): WebAccess & { requests: string[]; userAgents: string[] } {
	const requests: string[] = [];
	const userAgents: string[] = [];
	return {
		requests,
		userAgents,
		get: async (url, headers): Promise<WebResponse> => {
			requests.push(url);
			userAgents.push(headers["User-Agent"] ?? "");
			const file = INDEX[url];
			if (file !== undefined) return { status: 200, json: answer(file), arrayBuffer: new ArrayBuffer(0) };
			const isApi = url.includes("musicbrainz.org/ws/") || url.includes("/w/api.php") || url.includes("api.deezer.com");
			if (!isApi && images(url)) return { status: 200, json: null, arrayBuffer: IMAGE, contentType: "image/jpeg" };
			return { status: 404, json: null, arrayBuffer: new ArrayBuffer(0) };
		},
		sleep: async () => {},
	};
}

export function replayClient(images?: (url: string) => boolean) {
	const web = replayWeb(images);
	return { client: new MusicBrainzClient("3.1.0", web), web };
}

/** The MusicBrainz id a saved artist or album answer is for. */
export function idOf(name: string): string {
	return fixture<{ id: string }>(name).id;
}
