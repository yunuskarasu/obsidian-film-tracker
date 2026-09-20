import type { App } from "obsidian";
import type { VaultNotes } from "./vault-notes";

/** A row of an import report: what didn't make it into the vault, and why. */
export interface ImportFailure {
	name: string;
	/** The column beside the name: a film's year, a work's type. */
	detail: string;
	reason: string;
}

/** What an import leaves behind — see `writeImportReport`. */
export interface ImportReport {
	/** What the import was, e.g. "Imported from Letterboxd". */
	intro: string;
	/** The tally, as "Imported: 12" lines. */
	counts: [string, number][];
	/** The heading of the column beside each failure's name. */
	detailColumn: string;
	failures: ImportFailure[];
}

const TITLE = "Film + Anime-Manga Tracker Import Report";

/**
 * The note an import leaves behind when something didn't make it: the tally,
 * and a table of what was left out with the reason. An import where nothing
 * was left out writes nothing — its Notice says all there is to say.
 */
export async function writeImportReport(app: App, notes: VaultNotes, report: ImportReport): Promise<void> {
	if (report.failures.length === 0) return;

	const cell = (value: string) => value.replace(/\|/g, "\\|");
	const lines = [
		`# ${TITLE}`,
		"",
		report.intro,
		"",
		...report.counts.map(([label, count]) => `${label}: ${count}`),
		"",
		`| Name | ${report.detailColumn} | Reason |`,
		"| --- | --- | --- |",
		...report.failures.map((failure) => `| ${cell(failure.name)} | ${cell(failure.detail)} | ${cell(failure.reason)} |`),
		"",
	];

	await app.vault.create(notes.availablePath(`${TITLE}.md`), lines.join("\n"));
}
