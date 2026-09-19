import type { FilmSearchResult } from "./tmdb";

export interface LetterboxdRow {
	name: string;
	year: number | null;
	watchedDate: string | null;
}

/**
 * A small RFC4180-ish tokenizer: handles quoted fields, commas and quotes
 * inside them ("" is an escaped quote), and either line ending.
 */
function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let inQuotes = false;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];

		if (inQuotes) {
			if (char === '"' && text[i + 1] === '"') {
				field += '"';
				i += 1;
			} else if (char === '"') {
				inQuotes = false;
			} else {
				field += char;
			}
			continue;
		}

		if (char === '"') {
			inQuotes = true;
		} else if (char === ",") {
			row.push(field);
			field = "";
		} else if (char === "\r") {
			// skipped: CRLF is normalized by the following \n
		} else if (char === "\n") {
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else {
			field += char;
		}
	}

	if (field !== "" || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	return rows;
}

/**
 * Reads a Letterboxd `diary.csv` or `watched.csv` export. Only `Name` is
 * required; `Year` narrows the TMDB match and `Watched Date` (diary.csv only)
 * fills in `watch_date`. Rating, Tags and Rewatch are never read — that is
 * the user's own commentary, not the plugin's.
 */
export function parseLetterboxdCsv(content: string): LetterboxdRow[] {
	const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
	const rows = parseCsv(withoutBom);
	if (rows.length === 0) return [];

	const header = rows[0];
	const nameIndex = header.indexOf("Name");
	const yearIndex = header.indexOf("Year");
	const watchedDateIndex = header.indexOf("Watched Date");

	if (nameIndex === -1) {
		throw new Error(
			'This file has no "Name" column. Export diary.csv or watched.csv from Letterboxd.',
		);
	}

	return rows
		.slice(1)
		.filter((row) => row.some((value) => value.trim() !== ""))
		.map((row) => {
			const yearValue = yearIndex === -1 ? "" : (row[yearIndex] ?? "").trim();
			const watchedDateValue =
				watchedDateIndex === -1 ? "" : (row[watchedDateIndex] ?? "").trim();

			return {
				name: (row[nameIndex] ?? "").trim(),
				year: /^\d{4}$/.test(yearValue) ? Number(yearValue) : null,
				watchedDate: watchedDateValue === "" ? null : watchedDateValue,
			};
		})
		.filter((row) => row.name !== "");
}

/**
 * Letterboxd and TMDB can put the same film a year apart (a festival
 * premiere against the general release), so a result within this many years
 * of the export's own year still counts as that film.
 */
const YEAR_TOLERANCE = 1;

/**
 * Prefers the result whose year matches the export's, then one within
 * `YEAR_TOLERANCE` of it. When the export gives a year and nothing is close
 * to it, there is no confident match: `null`, so the film is listed in the
 * import report instead of being created as some other film of the same
 * name. With no year to check against, TMDB's own top result is used.
 */
export function pickBestMatch(
	results: FilmSearchResult[],
	year: number | null,
): FilmSearchResult | null {
	if (results.length === 0) return null;
	if (year === null) return results[0];

	const exact = results.find((result) => result.year === year);
	if (exact) return exact;

	const near = results.find(
		(result) => result.year !== null && Math.abs(result.year - year) <= YEAR_TOLERANCE,
	);
	return near ?? null;
}

/**
 * Whether the films in an export were watched — the starting value of the
 * import's "Mark as watched" toggle. diary.csv, watched.csv, ratings.csv
 * and reviews.csv only list films the user has seen, but watchlist.csv has
 * the same columns as watched.csv, so the file name is the only tell.
 */
export function isWatchedExport(fileName: string): boolean {
	return /diary|watched|rating|review/i.test(fileName);
}
