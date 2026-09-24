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
 *
 * A TV series note carries `tmdb_tv_id`, never `tmdb_id`: TMDB numbers
 * films and shows separately, so a show's id is very often some film's id
 * too, and a note read as a film would be refreshed with that film's data.
 * It is only a TV series when it carries neither `tmdb_id` nor an anime's
 * `mal_id` — a note someone gave both keeps the meaning it has always had,
 * and every version before TV series existed skips these notes entirely.
 *
 * A TV series note can hold a `manga` block as well, the same one a Series
 * note holds: the manga side belongs to the work, not to where its episodes
 * were read from.
 */
export type NoteKind =
	| { kind: "film"; tmdbId: number }
	| { kind: "director"; tmdbId: number }
	| { kind: "series"; animeMalId: number | null; mangaMalId: number | null }
	| { kind: "mangaka"; malId: number }
	| { kind: "tv"; tmdbTvId: number; mangaMalId: number | null };

type Frontmatter = Record<string, unknown> | undefined;

/** Written on every anime note and never on a mangaka note, so a `title` a user adds to a mangaka note can't flip it. */
const ANIME_KEYS = ["media_type", "episodes", "studios"];

function tmdbIdFrom(frontmatter: Frontmatter): number | null {
	const id: unknown = frontmatter?.tmdb_id;
	return typeof id === "number" ? id : null;
}

function tmdbTvIdFrom(frontmatter: Frontmatter): number | null {
	const id: unknown = frontmatter?.tmdb_tv_id;
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
	const tmdbTvId = tmdbTvIdFrom(frontmatter);
	if (malId === null && tmdbTvId !== null) return { kind: "tv", tmdbTvId, mangaMalId };
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
	| { kind: "mangaka"; malId: number }
	| { kind: "tv"; tmdbTvId: number };

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
			// The same manga can sit on a Series note and on a TV series note:
			// which catalogue the episodes came from says nothing about it.
			return (note.kind === "series" || note.kind === "tv") && note.mangaMalId === ref.malId;
		case "pair":
			return (
				note.kind === "series" &&
				note.animeMalId === ref.animeMalId &&
				note.mangaMalId === ref.mangaMalId
			);
		case "mangaka":
			return note.kind === "mangaka" && note.malId === ref.malId;
		case "tv":
			return note.kind === "tv" && note.tmdbTvId === ref.tmdbTvId;
	}
}

/** A Series note with its anime side and no manga yet: the only note Add manga merges into. */
export function isAnimeOnlySeries(
	note: NoteKind | null,
): note is Series & { animeMalId: number; mangaMalId: null } {
	return note?.kind === "series" && note.animeMalId !== null && note.mangaMalId === null;
}

/** A note Add manga may write its block into: a Series note with no manga, or a TV series with none. */
export function takesMangaBlock(note: NoteKind | null): note is
	| (Series & { animeMalId: number; mangaMalId: null })
	| { kind: "tv"; tmdbTvId: number; mangaMalId: null } {
	if (note === null) return false;
	if (note.kind === "tv") return note.mangaMalId === null;
	return isAnimeOnlySeries(note);
}

/** A Series note with its manga side and no anime yet: the only note Add anime merges into. */
export function isMangaOnlySeries(
	note: NoteKind | null,
): note is Series & { animeMalId: null; mangaMalId: number } {
	return note?.kind === "series" && note.mangaMalId !== null && note.animeMalId === null;
}
