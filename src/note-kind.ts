import { malIdFrom, mangaMalIdFrom } from "./manga-note";

/**
 * What a note is to this plugin, decided from its own frontmatter — never
 * from the folder it sits in. Folder settings only say where *new* notes are
 * created: a note the user moved, a folder setting left empty (the vault
 * root), or two note types sharing one folder must never turn a director
 * into a film or a mangaka into an anime, since the plugin would then
 * rewrite that note with the other one's data.
 *
 * Film and director notes both carry `tmdb_id`, and anime and mangaka notes
 * both carry `mal_id`, from id spaces that numerically collide. Every version
 * of the plugin has written a person note (director, mangaka) with `name`,
 * a film with `directors`, and an anime with `media_type`, `episodes` and
 * `studios` — that is what tells them apart.
 */
export type NoteKind =
	| { kind: "film"; tmdbId: number }
	| { kind: "director"; tmdbId: number }
	| { kind: "series"; animeMalId: number | null; mangaMalId: number | null }
	| { kind: "mangaka"; malId: number };

type Frontmatter = Record<string, unknown> | undefined;

/** Written on every anime note and never on a mangaka note, so a `title` a user adds to a mangaka note can't flip it. */
const ANIME_KEYS = ["media_type", "episodes", "studios"];

function tmdbIdFrom(frontmatter: Frontmatter): number | null {
	const id: unknown = frontmatter?.tmdb_id;
	return typeof id === "number" ? id : null;
}

export function classifyNote(frontmatter: Frontmatter): NoteKind | null {
	if (frontmatter === undefined) return null;
	const hasName = frontmatter.name !== undefined;

	const tmdbId = tmdbIdFrom(frontmatter);
	if (tmdbId !== null) {
		return hasName && frontmatter.directors === undefined
			? { kind: "director", tmdbId }
			: { kind: "film", tmdbId };
	}

	const malId = malIdFrom(frontmatter);
	if (malId !== null && hasName && ANIME_KEYS.every((key) => frontmatter[key] === undefined)) {
		return { kind: "mangaka", malId };
	}

	const mangaMalId = mangaMalIdFrom(frontmatter);
	if (malId === null && mangaMalId === null) return null;
	return { kind: "series", animeMalId: malId, mangaMalId };
}

type Series = Extract<NoteKind, { kind: "series" }>;

/**
 * The note an Add command checks for before creating a new one. `pair` is a
 * Series note holding this exact anime and this exact manga: each can sit on
 * several notes (one per adaptation), but a pairing only ever needs one.
 */
export type NoteRef =
	| { kind: "film"; tmdbId: number }
	| { kind: "director"; tmdbId: number }
	| { kind: "anime"; malId: number }
	| { kind: "manga"; malId: number }
	| { kind: "pair"; animeMalId: number; mangaMalId: number }
	| { kind: "mangaka"; malId: number };

/**
 * Whether `note` is the one `ref` names. The kind has to match as well as the
 * id: a director whose TMDB person id happens to equal a film's movie id is
 * never that film, wherever either note is kept.
 */
export function matchesRef(note: NoteKind | null, ref: NoteRef): boolean {
	if (note === null) return false;
	switch (ref.kind) {
		case "film":
			return note.kind === "film" && note.tmdbId === ref.tmdbId;
		case "director":
			return note.kind === "director" && note.tmdbId === ref.tmdbId;
		case "anime":
			return note.kind === "series" && note.animeMalId === ref.malId;
		case "manga":
			return note.kind === "series" && note.mangaMalId === ref.malId;
		case "pair":
			return (
				note.kind === "series" &&
				note.animeMalId === ref.animeMalId &&
				note.mangaMalId === ref.mangaMalId
			);
		case "mangaka":
			return note.kind === "mangaka" && note.malId === ref.malId;
	}
}

/** A Series note with its anime side and no manga yet: the only note Add manga merges into. */
export function isAnimeOnlySeries(
	note: NoteKind | null,
): note is Series & { animeMalId: number; mangaMalId: null } {
	return note?.kind === "series" && note.animeMalId !== null && note.mangaMalId === null;
}

/** A Series note with its manga side and no anime yet: the only note Add anime merges into. */
export function isMangaOnlySeries(
	note: NoteKind | null,
): note is Series & { animeMalId: null; mangaMalId: number } {
	return note?.kind === "series" && note.mangaMalId !== null && note.animeMalId === null;
}
