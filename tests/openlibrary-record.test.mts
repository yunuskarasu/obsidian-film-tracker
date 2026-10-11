import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { WebAccess, WebResponse } from "../src/musicbrainz";
import { OpenLibraryClient } from "../src/openlibrary";

/*
 * Saves Open Library's, Wikidata's and Wikimedia Commons' real answers into
 * tests/fixtures/openlibrary, for the replayed tests to read. None of them
 * needs a key. Run on its own:
 *
 *     npx vitest run --config vitest.record.config.mts tests/openlibrary-record.test.mts
 *
 * Wikidata's items are cut down to the claims and the English name the
 * plugin reads; pictures are never saved.
 */

const OUT = fileURLToPath(new URL("./fixtures/openlibrary", import.meta.url));

/** What the plugin reads of a Wikidata item. */
const KEPT_CLAIMS = ["P18", "P50", "P136", "P179", "P569", "P570", "P577", "P648", "P1476", "P1559"];

type Entity = { claims?: Record<string, unknown[]>; labels?: Record<string, unknown> };

function trimmed(url: string, json: unknown): unknown {
	if (!url.includes("wikidata.org") || !url.includes("action=wbgetentities")) return json;
	const entities = (json as { entities?: Record<string, Entity> }).entities ?? {};
	const kept: Record<string, Entity> = {};
	for (const [id, entity] of Object.entries(entities)) {
		const claims: Record<string, unknown[]> = {};
		for (const property of KEPT_CLAIMS) {
			if (entity.claims?.[property] !== undefined) claims[property] = entity.claims[property];
		}
		kept[id] = {
			...(entity.claims === undefined ? {} : { claims }),
			...(entity.labels === undefined ? {} : { labels: entity.labels }),
		};
	}
	return { entities: kept };
}

describe("recording Open Library's answers", () => {
	it("saves each search, book and author, and the Wikidata and Commons answers beside them", { timeout: 300_000 }, async () => {
		const saved = new Map<string, { label: string; json: unknown }>();
		let label = "";
		const web: WebAccess = {
			get: async (url, headers): Promise<WebResponse> => {
				const response = await fetch(url, { headers });
				const buffer = await response.arrayBuffer();
				const type = response.headers.get("content-type")?.toLowerCase() ?? null;
				let json: unknown = null;
				if (type?.includes("json")) {
					json = JSON.parse(new TextDecoder().decode(buffer)) as unknown;
					if (response.status === 200) saved.set(url, { label, json: trimmed(url, json) });
				}
				return { status: response.status, json, arrayBuffer: buffer, contentType: type };
			},
			sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		};
		const client = new OpenLibraryClient("3.5.0", web);

		for (const [name, query] of [
			["search-book-no-country", "No Country for Old Men"],
			["search-book-kurk-mantolu-madonna", "Kürk Mantolu Madonna"],
			["search-book-norwegian-wood", "Norwegian Wood"],
			["search-book-cherry-orchard", "The Cherry Orchard"],
		]) {
			label = name;
			await client.searchBooks(query);
		}
		for (const [name, query] of [
			["search-author-cormac-mccarthy", "Cormac McCarthy"],
			["search-author-sabahattin-ali", "Sabahattin Ali"],
			["search-author-haruki-murakami", "Haruki Murakami"],
		]) {
			label = name;
			await client.searchAuthors(query);
		}
		for (const [name, id] of [
			["book-no-country", "OL40875W"],
			["book-kurk-mantolu-madonna", "OL24327596W"],
			["book-harry-potter", "OL82563W"],
			["book-norwegian-wood", "OL2625457W"],
			["book-parallel-politics", "OL2627082W"],
			["book-cherry-orchard", "OL55417W"],
		]) {
			label = name;
			await client.getBook(id);
		}
		for (const [name, id] of [
			["author-cormac-mccarthy", "OL28104A"],
			["author-sabahattin-ali", "OL97057A"],
			["author-haruki-murakami", "OL382524A"],
			["author-anton-chekhov", "OL19677A"],
		]) {
			label = name;
			await client.authorPhoto(await client.getAuthor(id));
		}
		label = "works-cormac-mccarthy";
		await client.authorWorks("OL28104A");
		label = "works-anton-chekhov";
		await client.authorWorks("OL19677A");

		mkdirSync(OUT, { recursive: true });
		const indexPath = `${OUT}/index.json`;
		const index = existsSync(indexPath) ? (JSON.parse(readFileSync(indexPath, "utf8")) as Record<string, string>) : {};
		let n = Object.keys(index).length;
		for (const [url, { label: name, json }] of saved) {
			const host = url.includes("wikidata.org") ? "wikidata" : url.includes("commons.wikimedia.org") ? "commons" : "openlibrary";
			const file = index[url] ?? `${String(++n).padStart(2, "0")}-${name}-${host}.json`;
			writeFileSync(`${OUT}/${file}`, `${JSON.stringify(json, null, "\t")}\n`);
			index[url] = file;
		}
		writeFileSync(indexPath, `${JSON.stringify(index, null, "\t")}\n`);
		expect(saved.size).toBeGreaterThan(10);
	});
});
