import { workIdOf } from "./book";

/*
 * A book's editions: the printings Open Library files under one work, and
 * the one the user owns. Pure functions only, like book.ts: the requests are
 * in openlibrary.ts.
 */

/** An edition as Open Library's record of it holds it, with only the fields read here. */
export interface OlEdition {
	/** "/books/OL46545042M". */
	key?: string;
	title?: string;
	publishers?: string[];
	/** Free text: "2022-06-13", "Apr 13, 2019", "1962". */
	publish_date?: string;
	number_of_pages?: number;
	isbn_13?: string[];
	isbn_10?: string[];
	languages?: { key?: string }[];
	covers?: number[];
	physical_format?: string;
	/** Who did what, as printed on the title page: "Cormac McCarthy ; çeviren, Roza Hakmen". */
	by_statement?: string;
	contributors?: { role?: string; name?: string }[];
	works?: { key?: string }[];
}

/** The most editions one work's list is read to: Harry Potter has 400. */
export const EDITIONS_MAX = 1000;

export interface BookEdition {
	/** "OL46545042M". */
	id: string;
	/** The work Open Library files the edition under. */
	workId: string | null;
	title: string | null;
	publisher: string | null;
	year: number | null;
	pages: number | null;
	isbn: string | null;
	/** Open Library's language codes, MARC's: "tur", "eng". */
	languages: string[];
	format: string | null;
	coverId: number | null;
	/** Only the ones it names for certain — see `translatorsOf`. */
	translators: string[];
}

/** "/books/OL46545042M" or "OL46545042M": the id alone. */
export function editionIdOf(key: string | undefined): string | null {
	const match = (key ?? "").match(/(OL\d+M)$/);
	return match === null ? null : match[1];
}

/** The year in a publishing date as Open Library keeps it, written any way: "Apr 13, 2019" is 2019. */
export function editionYear(date: string | undefined): number | null {
	for (const match of (date ?? "").matchAll(/\d{4}/g)) {
		const year = Number(match[0]);
		if (year >= 1450 && year <= 2100) return year;
	}
	return null;
}

/**
 * An ISBN as typed, from the back of a book or a shop's page — with hyphens,
 * spaces, "ISBN" before it — down to its digits: 13 of them, or 10 with an X
 * last. `null` for anything else, and for a mistyped one: an ISBN's last
 * digit checks the others.
 */
export function normalizeIsbn(text: string): string | null {
	const digits = text.replace(/^\s*isbn(?:-1[03])?:?/i, "").replace(/[\s-]/g, "").toUpperCase();
	if (/^\d{13}$/.test(digits)) {
		const sum = [...digits].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
		return sum % 10 === 0 ? digits : null;
	}
	if (/^\d{9}[\dX]$/.test(digits)) {
		const sum = [...digits].reduce((total, digit, index) => total + (digit === "X" ? 10 : Number(digit)) * (10 - index), 0);
		return sum % 11 === 0 ? digits : null;
	}
	return null;
}

/** Words that come before a translator's name on a title page, in the languages most books on Open Library are in. */
const TRANSLATED_BY = [
	/\btranslated\b[^;]*?\bby\s+(.+)/i,
	/\btranslation\s+by\s+(.+)/i,
	/(?:^|\s)(?:çeviren|çeviri|çev\.|türkçesi)(?=[\s:,]|$)\s*[:,]?\s*(.+)/iu,
	/(?:^|\s)(?:übersetzt\s+von|übersetzung\s*:?)\s*(.+)/iu,
	/\baus\s+dem\s+\S+\s+von\s+(.+)/i,
	/\btraduit(?:e|s|es)?\b[^;]*?\bpar\s+(.+)/i,
	/\b(?:traducción\s+de|traducido\s+por)\s+(.+)/iu,
	/\b(?:traduzione\s+di|tradotto\s+da)\s+(.+)/i,
	/\b(?:tradução\s+de|traduzido\s+por)\s+(.+)/iu,
	/\bvertaald\s+door\s+(.+)/i,
];

/** Where the translators' names end and the next credit begins: "…by Curt Columbus, with an introduction by…". */
const NEXT_CREDIT = /\s*,?\s*(?:^|[^\p{L}])(?:with|and\s+with|introduc\p{L}*|illustrat\p{L}*|edited|ed\.|notes?|foreword|afterword|preface|önsöz|sunuş|resimleyen|editör)(?!\p{L}).*$/iu;

/** Between two translators' names. */
const NAME_SEPARATORS = /\s*(?:,|&|\band\b|\bve\b|\bund\b|\bet\b)\s*/i;

function cleanName(text: string): string {
	return text
		.replace(/\[[^\]]*\]/g, "")
		.replace(/[.\s,:;=/]+$/, "")
		.replace(/^[\s,:]+/, "")
		.trim();
}

/** A translator's name looks like one: a few words, no digits, no brackets left over. */
function isName(text: string): boolean {
	return text.length >= 3 && text.length <= 60 && /\p{L}/u.test(text) && !/\d/.test(text) && text.split(/\s+/).length <= 6;
}

/**
 * The edition's translators, only where Open Library names them for certain:
 * a contributor whose role says so, or a title page that says "translated
 * by …", "çeviren …" and the like. Anything less certain names nobody, and
 * the user writes them in.
 */
export function translatorsOf(edition: OlEdition): string[] {
	const found: string[] = [];
	const add = (name: string) => {
		const cleaned = cleanName(name);
		if (isName(cleaned) && !found.includes(cleaned)) found.push(cleaned);
	};
	for (const contributor of edition.contributors ?? []) {
		if (/translat|çevir|übersetz|tradu|vertal/i.test(contributor.role ?? "") && contributor.name !== undefined) add(contributor.name);
	}
	if (found.length > 0) return found;

	// One credit to a part: they are parted by ";", or end a sentence — "…Yarmolinsky. Critical material…" — never at an initial, "N. Sergievsky".
	for (const part of (edition.by_statement ?? "").replace(/(\p{L}{2})\.\s+/gu, "$1;").split(";")) {
		for (const pattern of TRANSLATED_BY) {
			const match = part.match(pattern);
			if (match === null) continue;
			const names = match[1].replace(NEXT_CREDIT, "");
			for (const name of names.split(NAME_SEPARATORS)) add(name);
			break;
		}
	}
	return found;
}

/** "paperback", "Audio cd": how a format reads in a list — capitalized, CD in capitals. */
function formatName(format: string | undefined): string | null {
	const text = format?.trim() ?? "";
	if (text === "") return null;
	return (text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()).replace(/\bcd\b/gi, "CD");
}

export function toBookEdition(edition: OlEdition): BookEdition {
	const isbn = [...(edition.isbn_13 ?? []), ...(edition.isbn_10 ?? [])].map(normalizeIsbn).find((found) => found !== null) ?? null;
	const languages = (edition.languages ?? [])
		.map((language) => (language.key ?? "").replace(/^\/languages\//, ""))
		.filter((code) => code !== "");
	const pages = edition.number_of_pages;
	const work = (edition.works ?? []).map((found) => workIdOf(found.key)).find((id) => id !== null) ?? null;
	return {
		id: editionIdOf(edition.key) ?? "",
		workId: work,
		title: edition.title?.trim() || null,
		publisher: (edition.publishers ?? []).map((name) => name.trim()).find((name) => name !== "") ?? null,
		year: editionYear(edition.publish_date),
		pages: typeof pages === "number" && Number.isFinite(pages) && pages > 0 ? Math.round(pages) : null,
		isbn,
		languages: [...new Set(languages)],
		format: formatName(edition.physical_format),
		// Open Library writes -1 where a cover was taken away.
		coverId: (edition.covers ?? []).find((id) => typeof id === "number" && id > 0) ?? null,
		translators: translatorsOf(edition),
	};
}

/** Obsidian's language codes, ISO 639-1, as Open Library's (MARC's) for the same language. */
const MARC_OF_ISO: Record<string, string> = {
	ar: "ara",
	be: "bel",
	bg: "bul",
	ca: "cat",
	cs: "cze",
	da: "dan",
	de: "ger",
	el: "gre",
	en: "eng",
	es: "spa",
	fa: "per",
	fi: "fin",
	fr: "fre",
	he: "heb",
	hi: "hin",
	hu: "hun",
	id: "ind",
	it: "ita",
	ja: "jpn",
	ko: "kor",
	nl: "dut",
	no: "nor",
	nb: "nor",
	pl: "pol",
	pt: "por",
	ro: "rum",
	ru: "rus",
	sr: "srp",
	sv: "swe",
	th: "tha",
	tr: "tur",
	uk: "ukr",
	vi: "vie",
	zh: "chi",
};

/** The language names a list shows, for Open Library's codes. */
const LANGUAGE_NAMES: Record<string, string> = {
	ara: "Arabic",
	bel: "Belarusian",
	bul: "Bulgarian",
	cat: "Catalan",
	chi: "Chinese",
	cze: "Czech",
	dan: "Danish",
	dut: "Dutch",
	eng: "English",
	fin: "Finnish",
	fre: "French",
	ger: "German",
	gre: "Greek",
	heb: "Hebrew",
	hin: "Hindi",
	hun: "Hungarian",
	ind: "Indonesian",
	ita: "Italian",
	jpn: "Japanese",
	kor: "Korean",
	lat: "Latin",
	nor: "Norwegian",
	per: "Persian",
	pol: "Polish",
	por: "Portuguese",
	rum: "Romanian",
	rus: "Russian",
	srp: "Serbian",
	spa: "Spanish",
	swe: "Swedish",
	tha: "Thai",
	tur: "Turkish",
	ukr: "Ukrainian",
	vie: "Vietnamese",
};

/** "tr" or "pt-BR", as Obsidian names its language, the way Open Library names it: "tur", "por". */
export function marcLanguageOf(iso: string): string {
	return MARC_OF_ISO[iso.toLowerCase().split(/[-_]/)[0]] ?? "eng";
}

export function languageName(code: string): string {
	return LANGUAGE_NAMES[code] ?? code;
}

/**
 * The order editions are offered in: those in `language` — the user's own —
 * first, then the newest first; one with no year known goes last. Ties keep
 * Open Library's order.
 */
export function rankEditions(editions: BookEdition[], language: string): BookEdition[] {
	const own = (edition: BookEdition) => (edition.languages.includes(language) ? 1 : 0);
	const year = (edition: BookEdition) => edition.year ?? Number.MIN_SAFE_INTEGER;
	return editions
		.map((edition, index) => ({ edition, index }))
		.sort((a, b) => own(b.edition) - own(a.edition) || year(b.edition) - year(a.edition) || a.index - b.index)
		.map(({ edition }) => edition);
}
