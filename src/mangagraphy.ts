export interface MangagraphyManga {
	path: string;
	title: string;
	year: number | null;
	read: boolean;
	mangaka: string[];
}

export interface MangagraphyEntry {
	path: string;
	title: string;
	year: number | null;
	read: boolean;
}

/**
 * Manga written by someone matching any of `names` — the mangaka note's own
 * `name` (MAL gives no alternate-name equivalent to carry alongside it, so
 * unlike a director there is no `aliases` set to widen this with). Oldest
 * first, same ordering as Filmography.
 */
export function findMangagraphy(names: Set<string>, mangas: MangagraphyManga[]): MangagraphyEntry[] {
	return mangas
		.filter((manga) => manga.mangaka.some((mangaka) => names.has(mangaka)))
		.map(({ path, title, year, read }) => ({ path, title, year, read }))
		.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.title.localeCompare(b.title));
}

/**
 * The share of `mangas` marked `read`, rounded to a whole percent — `null`
 * for an empty list, matching how the panel itself hides when there is
 * nothing to show. Anime's own `watched` never factors into this: it is
 * computed purely from the manga side.
 */
export function mangagraphyProgress(mangas: MangagraphyEntry[]): number | null {
	if (mangas.length === 0) return null;
	const read = mangas.filter((manga) => manga.read).length;
	return Math.round((read / mangas.length) * 100);
}
