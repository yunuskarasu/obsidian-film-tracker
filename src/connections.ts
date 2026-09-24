/** A film or a TV series note, as the Connections panel reads it. */
export interface WorkNoteInfo {
	path: string;
	title: string;
	directors: string[];
	/** A TV series' own, from `created_by`: what a director is to a film. */
	creators: string[];
	cast: string[];
	composers: string[];
}

export type SharedRole = "director" | "creator" | "composer" | "cast";

export interface SharedCredit {
	name: string;
	role: SharedRole;
}

export interface Connection {
	file: WorkNoteInfo;
	shared: SharedCredit[];
}

/**
 * Director, creator and composer are checked before cast on purpose: a work
 * is far more likely to share a large cast than the person who made it, so
 * when a name matches on more than one role the rarer, more meaningful one
 * wins.
 */
function creditsOf(work: WorkNoteInfo): SharedCredit[] {
	return [
		...work.directors.map((name) => ({ name, role: "director" as const })),
		...work.creators.map((name) => ({ name, role: "creator" as const })),
		...work.composers.map((name) => ({ name, role: "composer" as const })),
		...work.cast.map((name) => ({ name, role: "cast" as const })),
	];
}

/**
 * Works that share a director, a creator, a composer or a cast member with
 * `current`, most shared names first. Films and TV series are compared
 * against each other as well as among themselves: the same person directs a
 * film and creates a series, and that is exactly the connection worth
 * seeing. Genres are deliberately not compared — two works sharing "Drama"
 * is not a connection, it is noise.
 */
export function findConnections(current: WorkNoteInfo, others: WorkNoteInfo[]): Connection[] {
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
