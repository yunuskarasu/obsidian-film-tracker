/// <reference types="vite/client" />
import type { WebAccess, WebResponse } from "../src/musicbrainz";

/*
 * LRCLIB as it answered on 2026-09-28: tests/fixtures/lrclib holds each
 * answer, and index.json which request it answers and with what status.
 * The lyrics in them are stand-ins ("Line 1 of Airbag") — a song's words
 * are not the repository's to publish — kept to the shape LRCLIB sends.
 */

const FILES = import.meta.glob<unknown>("./fixtures/lrclib/*.json", { eager: true, import: "default" });
const INDEX = FILES["./fixtures/lrclib/index.json"] as Record<string, { status: number; file: string | null }>;

/** A saved answer by its name, without the number in front: "search-airbag-too-long". */
export function lrclibFixture<T>(name: string): T {
	const file = Object.keys(FILES).find((path) => path.replace(/^.*\/\d+-/, "") === `${name}.json`);
	if (file === undefined) throw new Error(`No LRCLIB fixture named ${name}`);
	return structuredClone(FILES[file]) as T;
}

/** LRCLIB as the fixtures remember it; any other request is a 404. Every request is kept in `requests`. */
export function replayLrclib(): WebAccess & { requests: string[]; userAgents: string[] } {
	const requests: string[] = [];
	const userAgents: string[] = [];
	return {
		requests,
		userAgents,
		get: async (url, headers): Promise<WebResponse> => {
			requests.push(url);
			userAgents.push(headers["User-Agent"] ?? "");
			const saved = INDEX[url];
			if (saved === undefined) return { status: 404, json: null, arrayBuffer: new ArrayBuffer(0) };
			const json = saved.file === null ? null : structuredClone(FILES[`./fixtures/lrclib/${saved.file}`]);
			return { status: saved.status, json, arrayBuffer: new ArrayBuffer(0) };
		},
		sleep: async () => {},
	};
}
