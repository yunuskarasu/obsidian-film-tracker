import { needsQuoting } from "./note";

/*
 * One `{ … }` line per entry of a list block — a TV note's seasons, an
 * album's tracks. Each line reads as a row, and a key the user adds to one
 * of them is kept (see the `extra` of each entry).
 */

/** A value always written in quotes, whatever it looks like: "4:44" is a number in base 60 to some YAML readers. */
export class Quoted {
	constructor(readonly text: string) {}
}

/**
 * A value inside a `{ … }` line. Flow style has more characters it cannot
 * take plainly than a normal YAML value — a comma or a brace would end the
 * entry — so those are quoted on top of what `needsQuoting` catches.
 */
export function flowValue(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (value instanceof Quoted) return JSON.stringify(value.text);
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	if (typeof value !== "string") return JSON.stringify(value);
	// A JSON string is a valid double-quoted YAML one, and gives the value
	// back exactly: nothing is added to it, however often it is written.
	return needsQuoting(value) || /[,[\]{}]/.test(value) ? JSON.stringify(value) : value;
}

/** One entry's line, leaving out the keys it has no value for. */
export function flowEntry(pairs: [string, unknown][]): string {
	const written = pairs
		.filter(([, value]) => value !== null && value !== undefined)
		.map(([key, value]) => `${key}: ${flowValue(value)}`);
	return `  - { ${written.join(", ")} }`;
}
