export interface MangagraphyManga {
	malId: number;
	path: string;
	title: string;
	year: number | null;
	read: boolean;
	/** Whether the note also has an anime side — a manga-only note is the manga's own, so it's linked first. */
	hasAnime: boolean;
	mangaka: string[];
}

export interface MangagraphyEntry {
	malId: number;
	title: string;
	year: number | null;
	read: boolean;
	/**
	 * Every note that carries this manga — one per adaptation, since a manga
	 * can sit on several Series notes. The title links to the first: the
	 * manga's own manga-only note if there is one, otherwise the first note
	 * by path.
	 */
	paths: string[];
}

function linkOrder(a: MangagraphyManga, b: MangagraphyManga): number {
	return Number(a.hasAnime) - Number(b.hasAnime) || a.path.localeCompare(b.path);
}

/**
 * Manga written by someone matching any of `names` — the mangaka note's own
 * `name` (MAL gives no alternate-name equivalent to carry alongside it, so
 * unlike a director there is no `aliases` set to widen this with). One entry
 * per manga however many Series notes carry it, and it counts as read when
 * any of them says so. Oldest first, same ordering as Filmography.
 */
export function findMangagraphy(names: Set<string>, mangas: MangagraphyManga[]): MangagraphyEntry[] {
	const byManga = new Map<number, MangagraphyEntry>();

	for (const manga of [...mangas].sort(linkOrder)) {
		if (!manga.mangaka.some((mangaka) => names.has(mangaka))) continue;

		const entry = byManga.get(manga.malId);
		if (entry === undefined) {
			const { malId, title, year, read, path } = manga;
			byManga.set(malId, { malId, title, year, read, paths: [path] });
		} else {
			entry.paths.push(manga.path);
			entry.read = entry.read || manga.read;
		}
	}

	return [...byManga.values()].sort(
		(a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.title.localeCompare(b.title),
	);
}

/**
 * The share of `mangas` marked `read`, rounded to a whole percent — `null`
 * for an empty list, matching how the panel itself hides when there is
 * nothing to show. Anime's own `watched` never factors into this: it is
 * computed purely from the manga side, and each manga counts once.
 */
export function mangagraphyProgress(mangas: MangagraphyEntry[]): number | null {
	if (mangas.length === 0) return null;
	const read = mangas.filter((manga) => manga.read).length;
	return Math.round((read / mangas.length) * 100);
}
