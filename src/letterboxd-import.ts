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
 * Prefers the result whose year matches the diary entry; falls back to
 * TMDB's own top result when there is no year or nothing matches it.
 */
export function pickBestMatch(
	results: FilmSearchResult[],
	year: number | null,
): FilmSearchResult | null {
	if (results.length === 0) return null;
	if (year !== null) {
		const exact = results.find((result) => result.year === year);
		if (exact) return exact;
	}
	return results[0];
}
