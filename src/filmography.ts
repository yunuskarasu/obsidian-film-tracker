export interface FilmographyFilm {
	path: string;
	title: string;
	year: number | null;
	watched: boolean;
	directors: string[];
}

export interface FilmographyEntry {
	path: string;
	title: string;
	year: number | null;
	watched: boolean;
}

/**
 * Films directed by someone matching any of `names` — the director note's
 * own `name` plus its `aliases` (which already covers `original_name`),
 * since a film's `directors` list might use either spelling. Oldest first.
 */
export function findFilmography(names: Set<string>, films: FilmographyFilm[]): FilmographyEntry[] {
	return films
		.filter((film) => film.directors.some((director) => names.has(director)))
		.map(({ path, title, year, watched }) => ({ path, title, year, watched }))
		.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.title.localeCompare(b.title));
}

/**
 * The share of `films` marked `watched`, rounded to a whole percent — `null`
 * for an empty list, matching how the panel itself hides when there is
 * nothing to show.
 */
export function filmographyProgress(films: FilmographyEntry[]): number | null {
	if (films.length === 0) return null;
	const watched = films.filter((film) => film.watched).length;
	return Math.round((watched / films.length) * 100);
}
