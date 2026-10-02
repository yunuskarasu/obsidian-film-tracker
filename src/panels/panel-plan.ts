import { classifyNote } from "../note-kind";
import { parseWikilink } from "../note";

/**
 * Which panels a note gets under its properties, decided from its
 * frontmatter alone — the one place that says so. Each kind of note is a
 * line here and a panel module of its own under `src/panels/`; adding a kind
 * of note means adding a line, not threading it through the drawing code.
 *
 * - `tv`: SEASONS, then MANGA when the show carries one, then CONNECTIONS.
 * - `manga`: a Series note with a manga side — the MANGA panel only.
 * - `mangaka`: MANGAGRAPHY, matched on the mangaka's name.
 * - `none`: an anime-only note, which has no panel.
 * - `person`: FILMOGRAPHY, then TV SERIES, matched on the person's names.
 * - `work`: CONNECTIONS — drawn only when the note is a film.
 * - `artist`: DISCOGRAPHY, matched on every name the artist goes by.
 * - `album`: TRACKLIST.
 * - `song`: LYRICS.
 * - `game`: DLC.
 */
export type PanelPlan =
	| { kind: "tv"; manga: boolean }
	| { kind: "artist"; names: Set<string> }
	| { kind: "album" }
	| { kind: "song" }
	| { kind: "game" }
	| { kind: "manga" }
	| { kind: "mangaka"; names: Set<string> }
	| { kind: "none" }
	| { kind: "person"; names: Set<string> }
	| { kind: "work" };

/** The names a list property holds, links or plain text alike: `[[Hans Zimmer]]` reads as "Hans Zimmer". */
export function extractNames(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string")
		.map((item) => (parseWikilink(item) ?? item).trim())
		.filter((name) => name !== "");
}

/** A `manga` block the plugin wrote: an object with its MAL id. */
export function hasMangaBlock(frontmatter: Record<string, unknown> | undefined): boolean {
	const manga: unknown = frontmatter?.manga;
	return typeof manga === "object" && manga !== null && typeof (manga as Record<string, unknown>).mal_id === "number";
}

export function panelPlanFor(frontmatter: Record<string, unknown> | undefined): PanelPlan {
	const manga = hasMangaBlock(frontmatter);
	const kind = classifyNote(frontmatter)?.kind;
	if (kind === "tv") return { kind: "tv", manga };
	if (kind === "album") return { kind: "album" };
	if (kind === "song") return { kind: "song" };
	if (kind === "game") return { kind: "game" };
	if (kind === "artist") return { kind: "artist", names: artistNames(frontmatter ?? {}) };
	if (manga) return { kind: "manga" };
	if (frontmatter === undefined) return { kind: "work" };

	const mangaka = mangakaNames(frontmatter);
	if (mangaka !== null) return { kind: "mangaka", names: mangaka };

	// Anime-only notes have none of these panels.
	if (frontmatter.mal_id !== undefined) return { kind: "none" };

	const person = personNames(frontmatter);
	if (person !== null) return { kind: "person", names: person };

	return { kind: "work" };
}

/** An artist by every name an album might credit them under: 久石譲 as well as Joe Hisaishi. */
function artistNames(frontmatter: Record<string, unknown>): Set<string> {
	const names = [frontmatter.name, frontmatter.original_name]
		.filter((name): name is string => typeof name === "string" && name.trim() !== "")
		.map((name) => name.trim());
	return new Set([...names, ...extractNames(frontmatter.aliases)]);
}

/**
 * A mangaka note has `name` + `mal_id` but never `title` — an anime or
 * Series note always has `title`, even a manga-only one. No `aliases` here:
 * MAL's `/people/{id}` gives no alternate names to carry, unlike TMDB for
 * directors.
 */
function mangakaNames(frontmatter: Record<string, unknown>): Set<string> | null {
	if (frontmatter.title !== undefined) return null;
	if (typeof frontmatter.mal_id !== "number") return null;
	const name: unknown = frontmatter.name;
	if (typeof name !== "string" || name.trim() === "") return null;
	return new Set([name.trim()]);
}

/**
 * A director note has `name` but never `directors` — a film note always
 * writes `directors`, even as an empty list. `aliases` (which already holds
 * `name` itself, and `original_name` when one was found) is every spelling a
 * film's `directors` entry might use. Any note of the user's own with a
 * `name` reads the same way, so a person note written by hand gets its
 * filmography too.
 */
function personNames(frontmatter: Record<string, unknown>): Set<string> | null {
	if (frontmatter.directors !== undefined) return null;
	const name: unknown = frontmatter.name;
	if (typeof name !== "string" || name.trim() === "") return null;
	return new Set([name.trim(), ...extractNames(frontmatter.aliases)]);
}
