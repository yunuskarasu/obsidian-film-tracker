/** A film or a TV series in the vault, as a person note's own lists read it. */
export interface FilmographyWork {
	path: string;
	title: string;
	year: number | null;
	watched: boolean;
	/** Who made it: a film's directors, a TV series' creators. */
	credits: string[];
}

export interface FilmographyEntry {
	path: string;
	title: string;
	year: number | null;
	watched: boolean;
}

/**
 * The works credited to someone matching any of `names` — the person note's
 * own `name` plus its `aliases` (which already covers `original_name`),
 * since a work's own list might use either spelling. Films and TV series are
 * kept in separate lists by the caller, so this is given one kind at a time.
 * Oldest first.
 */
export function findFilmography(names: Set<string>, works: FilmographyWork[]): FilmographyEntry[] {
	return works
		.filter((work) => work.credits.some((credit) => names.has(credit)))
		.map(({ path, title, year, watched }) => ({ path, title, year, watched }))
		.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.title.localeCompare(b.title));
}

/**
 * The share of `works` marked `watched`, rounded to a whole percent — `null`
 * for an empty list, matching how the panel itself hides when there is
 * nothing to show.
 */
export function filmographyProgress(works: FilmographyEntry[]): number | null {
	if (works.length === 0) return null;
	const watched = works.filter((work) => work.watched).length;
	return Math.round((watched / works.length) * 100);
}
