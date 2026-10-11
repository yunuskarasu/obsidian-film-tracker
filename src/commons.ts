import { photoCredit } from "./music";
import type { PhotoCandidate, WebResponse } from "./musicbrainz";

/*
 * Photos of people on Wikimedia Commons, found through their Wikidata item:
 * an artist's, an author's. Shared by the clients that need one; each passes
 * its own way of making a request, with its own name in it.
 */

/** A request that never throws: a failure is no answer, and so no photo. */
export type CommonsFetch = (url: string) => Promise<WebResponse | null>;

/**
 * Photos from Wikimedia Commons: the ones the Wikidata item names as theirs
 * first, then — for "Change photo", with `whole` — the rest of their own
 * Commons category, as many as `max` in all.
 */
export async function commonsCandidates(fetch: CommonsFetch, wikidataId: string | null, max: number, whole = false): Promise<PhotoCandidate[]> {
	if (wikidataId === null) return [];
	const files = await wikidataValues(fetch, wikidataId, "P18");
	if (whole) {
		const [category] = await wikidataValues(fetch, wikidataId, "P373");
		if (category !== undefined) {
			for (const file of await categoryFiles(fetch, category)) {
				if (!files.includes(file)) files.push(file);
			}
		}
	}
	return commonsImages(fetch, files.slice(0, max));
}

/** The text values of one Wikidata property: P18 names an item's photo, P373 its Commons category. */
async function wikidataValues(fetch: CommonsFetch, wikidataId: string, property: string): Promise<string[]> {
	const claims = await fetch(
		`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${wikidataId}&property=${property}&format=json`,
	);
	type Claim = { mainsnak?: { datavalue?: { value?: unknown } } };
	const list = (claims?.json as { claims?: Record<string, Claim[]> } | null)?.claims?.[property] ?? [];
	return list
		.map((claim) => claim.mainsnak?.datavalue?.value)
		.filter((value): value is string => typeof value === "string" && value !== "");
}

/** The photos filed straight in a Commons category: JPEGs — PNGs there are mostly logos and drawings. */
async function categoryFiles(fetch: CommonsFetch, category: string): Promise<string[]> {
	const members = await fetch(
		"https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers" +
			`&cmtitle=${encodeURIComponent(`Category:${category}`)}&cmtype=file&cmlimit=30&format=json`,
	);
	const list = (members?.json as { query?: { categorymembers?: { title?: string }[] } } | null)?.query?.categorymembers ?? [];
	return list
		.map((member) => member.title ?? "")
		.filter((title) => /\.jpe?g$/i.test(title))
		.map((title) => title.replace(/^File:/, ""));
}

/** Several Commons files at once — one request — each with its thumbnail and whom to credit. */
export async function commonsImages(fetch: CommonsFetch, files: string[]): Promise<PhotoCandidate[]> {
	if (files.length === 0) return [];
	const titles = files.map((file) => `File:${file}`).join("|");
	const info = await fetch(
		`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}` +
			"&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=500&format=json",
	);
	type ImageInfo = { thumburl?: string; extmetadata?: Record<string, { value?: string }> };
	type Page = { title?: string; imageinfo?: ImageInfo[] };
	const pages = Object.values((info?.json as { query?: { pages?: Record<string, Page> } } | null)?.query?.pages ?? {});
	// Commons answers in an order of its own: put them back in the order asked for.
	const byTitle = new Map(pages.map((page) => [(page.title ?? "").replace(/^File:/, "").replace(/_/g, " "), page]));
	const candidates: PhotoCandidate[] = [];
	for (const file of files) {
		const image = byTitle.get(file.replace(/_/g, " "))?.imageinfo?.[0];
		if (!image?.thumburl) continue;
		candidates.push({
			source: "Wikimedia Commons",
			url: image.thumburl,
			credit: photoCredit(image.extmetadata?.Artist?.value, image.extmetadata?.LicenseShortName?.value),
		});
	}
	return candidates;
}
