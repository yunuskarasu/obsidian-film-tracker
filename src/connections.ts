export interface FilmNoteInfo {
	path: string;
	title: string;
	directors: string[];
	cast: string[];
	composers: string[];
}

export type SharedRole = "director" | "composer" | "cast";

export interface SharedCredit {
	name: string;
	role: SharedRole;
}

export interface Connection {
	file: FilmNoteInfo;
	shared: SharedCredit[];
}

/**
 * Director and composer are checked before cast on purpose: a film is far
 * more likely to share a large cast than a director or composer, so when a
 * name matches on more than one role the rarer, more meaningful one wins.
 */
function creditsOf(film: FilmNoteInfo): SharedCredit[] {
	return [
		...film.directors.map((name) => ({ name, role: "director" as const })),
		...film.composers.map((name) => ({ name, role: "composer" as const })),
		...film.cast.map((name) => ({ name, role: "cast" as const })),
	];
}

/**
 * Films that share a director, a composer or a cast member with `current`,
 * most shared names first. Genres are deliberately not compared — two films
 * sharing "Drama" is not a connection, it is noise.
 */
export function findConnections(current: FilmNoteInfo, others: FilmNoteInfo[]): Connection[] {
	const currentNames = new Set(creditsOf(current).map((credit) => credit.name));
	const connections: Connection[] = [];

	for (const other of others) {
		if (other.path === current.path) continue;

		const seen = new Set<string>();
		const shared: SharedCredit[] = [];
		for (const credit of creditsOf(other)) {
			if (!currentNames.has(credit.name) || seen.has(credit.name)) continue;
			seen.add(credit.name);
			shared.push(credit);
		}

		if (shared.length > 0) connections.push({ file: other, shared });
	}

	return connections.sort(
		(a, b) => b.shared.length - a.shared.length || a.file.title.localeCompare(b.file.title),
	);
}
