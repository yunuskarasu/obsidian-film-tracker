import { describe, expect, it } from "vitest";
import {
	buildAliases,
	buildFileName,
	buildNoteContent,
	folderPrefix,
	joinPath,
	needsQuoting,
	sanitizeFileName,
	titleFamiliesOverlap,
	yamlString,
	type FilmMetadata,
	type LinkOptions,
} from "../src/note";

const resolves = (...existing: string[]) => (name: string) => existing.includes(name);

function linkOptions(overrides: Partial<LinkOptions> = {}): LinkOptions {
	return {
		directors: false,
		genres: false,
		cast: false,
		composers: false,
		addCast: false,
		addComposers: false,
		castCount: 5,
		isResolved: resolves(),
		...overrides,
	};
}

const stalker: FilmMetadata = {
	title: "Stalker",
	originalTitle: "Сталкер",
	year: 1979,
	directors: ["Andrei Tarkovsky"],
	genres: ["Science Fiction", "Drama"],
	cast: ["Alisa Freyndlikh", "Aleksandr Kaydanovsky", "Anatoliy Solonitsyn"],
	composers: ["Eduard Artemyev"],
	runtime: 162,
	tmdbId: 1398,
	posterPath: "/abc.jpg",
};

describe("sanitizeFileName", () => {
	it("replaces filesystem-illegal characters with a space", () => {
		expect(sanitizeFileName("Face/Off")).toBe("Face Off");
		expect(sanitizeFileName("Back\\Slash")).toBe("Back Slash");
		expect(sanitizeFileName("Am*lie: Director's Cut")).toBe("Am lie Director's Cut");
		expect(sanitizeFileName('Quote"Mark')).toBe("Quote Mark");
		expect(sanitizeFileName("Less<Greater>")).toBe("Less Greater");
		expect(sanitizeFileName("What?")).toBe("What");
	});

	it("strips characters that break wikilinks", () => {
		expect(sanitizeFileName("[[Brackets]]")).toBe("Brackets");
		expect(sanitizeFileName("Hash#Tag")).toBe("HashTag");
		expect(sanitizeFileName("Caret^Ref")).toBe("CaretRef");
		expect(sanitizeFileName("Pipe|Split")).toBe("PipeSplit");
	});

	it("trims leading dots and trailing dots or spaces", () => {
		expect(sanitizeFileName(".hidden")).toBe("hidden");
		expect(sanitizeFileName("Trailing dots...")).toBe("Trailing dots");
		expect(sanitizeFileName("Trailing space ")).toBe("Trailing space");
		expect(sanitizeFileName("  Both  ")).toBe("Both");
	});

	it("collapses repeated whitespace", () => {
		expect(sanitizeFileName("Multiple   spaces")).toBe("Multiple spaces");
	});

	it("suffixes Windows reserved names", () => {
		expect(sanitizeFileName("CON")).toBe("CON_");
		expect(sanitizeFileName("nul")).toBe("nul_");
		expect(sanitizeFileName("com1")).toBe("com1_");
		expect(sanitizeFileName("LPT9")).toBe("LPT9_");
		expect(sanitizeFileName("Contact")).toBe("Contact");
	});

	it("preserves non-ASCII characters", () => {
		expect(sanitizeFileName("Amélie")).toBe("Amélie");
		expect(sanitizeFileName("Сталкер")).toBe("Сталкер");
		expect(sanitizeFileName("千と千尋の神隠し")).toBe("千と千尋の神隠し");
		expect(sanitizeFileName("Kış Uykusu")).toBe("Kış Uykusu");
	});

	it("falls back to Untitled when nothing survives", () => {
		expect(sanitizeFileName("///")).toBe("Untitled");
		expect(sanitizeFileName("[[]]")).toBe("Untitled");
		expect(sanitizeFileName("   ")).toBe("Untitled");
	});
});

describe("buildFileName", () => {
	it("appends the year when known", () => {
		expect(buildFileName("Stalker", 1979)).toBe("Stalker (1979)");
		expect(buildFileName("Solaris", 2002)).toBe("Solaris (2002)");
	});

	it("omits the year when unknown", () => {
		expect(buildFileName("Stalker", null)).toBe("Stalker");
	});

	it("sanitizes the combined name", () => {
		expect(buildFileName("Face/Off", 1997)).toBe("Face Off (1997)");
	});
});

describe("needsQuoting", () => {
	it("leaves ordinary titles unquoted", () => {
		expect(needsQuoting("Stalker")).toBe(false);
		expect(needsQuoting("Ocean's Eleven")).toBe(false);
		expect(needsQuoting("M*A*S*H")).toBe(false);
		expect(needsQuoting("Amélie")).toBe(false);
		expect(needsQuoting("WALL-E")).toBe(false);
	});

	it("quotes values that would change YAML meaning", () => {
		expect(needsQuoting("")).toBe(true);
		expect(needsQuoting("Blade Runner 2049: The Final Cut")).toBe(true);
		expect(needsQuoting("Movie #1")).toBe(true);
		expect(needsQuoting("#Hashtag")).toBe(true);
		expect(needsQuoting("- Dash start")).toBe(true);
		expect(needsQuoting("[[poster.jpg]]")).toBe(true);
		expect(needsQuoting("Ends with:")).toBe(true);
		expect(needsQuoting(" leading space")).toBe(true);
		expect(needsQuoting("trailing space ")).toBe(true);
	});

	it("quotes YAML keywords and numeric-looking titles", () => {
		expect(needsQuoting("true")).toBe(true);
		expect(needsQuoting("NO")).toBe(true);
		expect(needsQuoting("null")).toBe(true);
		expect(needsQuoting("1917")).toBe(true);
		expect(needsQuoting("9")).toBe(true);
	});
});

describe("yamlString", () => {
	it("escapes quotes and backslashes when quoting", () => {
		expect(yamlString('"Heroes"')).toBe('"\\"Heroes\\""');
		expect(yamlString("[[a\\b.jpg]]")).toBe('"[[a\\\\b.jpg]]"');
	});

	it("returns plain scalars untouched", () => {
		expect(yamlString("Stalker")).toBe("Stalker");
	});
});

describe("buildNoteContent", () => {
	it("writes the full schema with an empty watch_date", () => {
		expect(buildNoteContent(stalker, "[[Attachments/Stalker (1979).jpg]]")).toBe(
			[
				"---",
				"title: Stalker",
				"original_title: Сталкер",
				"aliases:",
				"  - Stalker",
				"  - Сталкер",
				"year: 1979",
				"directors:",
				"  - Andrei Tarkovsky",
				"genres:",
				"  - Science Fiction",
				"  - Drama",
				"runtime: 162",
				'poster: "[[Attachments/Stalker (1979).jpg]]"',
				"tmdb_id: 1398",
				"watch_date:",
				"watched: false",
				"---",
				"",
			].join("\n"),
		);
	});

	it("leaves the body empty so it belongs entirely to the user", () => {
		const content = buildNoteContent(stalker, "[[Attachments/Stalker (1979).jpg]]");
		expect(content.split("---\n")[2]).toBe("");
		expect(content).not.toContain("![[");
	});

	it("never fills in watch_date", () => {
		const content = buildNoteContent(stalker, null);
		expect(content).toContain("\nwatch_date:\n");
		expect(content).not.toMatch(/watch_date:[ \t]*\S/);
	});

	it("always writes watched: false on a new note", () => {
		const content = buildNoteContent(stalker, null);
		expect(content).toContain("\nwatched: false\n");
	});

	it("leaves the poster property empty when there is no poster", () => {
		expect(buildNoteContent(stalker, null)).toBe(
			[
				"---",
				"title: Stalker",
				"original_title: Сталкер",
				"aliases:",
				"  - Stalker",
				"  - Сталкер",
				"year: 1979",
				"directors:",
				"  - Andrei Tarkovsky",
				"genres:",
				"  - Science Fiction",
				"  - Drama",
				"runtime: 162",
				"poster:",
				"tmdb_id: 1398",
				"watch_date:",
				"watched: false",
				"---",
				"",
			].join("\n"),
		);
	});

	it("strips a leading ! from the poster property", () => {
		const content = buildNoteContent(stalker, "![[poster.jpg]]");
		expect(content).toContain('poster: "[[poster.jpg]]"');
		expect(content).not.toContain("![[poster.jpg]]");
	});

	it("leaves unknown scalar fields empty", () => {
		const sparse: FilmMetadata = {
			...stalker,
			year: null,
			runtime: null,
			directors: [],
			genres: [],
		};
		const content = buildNoteContent(sparse, null);
		expect(content).toContain("\nyear:\n");
		expect(content).toContain("\nruntime:\n");
		expect(content).toContain("\ndirectors:\n");
		expect(content).toContain("\ngenres:\n");
	});

	it("quotes titles that would otherwise change type or break parsing", () => {
		const tricky: FilmMetadata = {
			...stalker,
			title: "1917",
			originalTitle: "Blade Runner 2049: The Final Cut",
		};
		const content = buildNoteContent(tricky, null);
		expect(content).toContain('title: "1917"');
		expect(content).toContain('original_title: "Blade Runner 2049: The Final Cut"');
	});

	it("writes every co-director", () => {
		const coen: FilmMetadata = { ...stalker, directors: ["Joel Coen", "Ethan Coen"] };
		expect(buildNoteContent(coen, null)).toContain("directors:\n  - Joel Coen\n  - Ethan Coen\n");
	});

	it("writes a single alias when title and original title are the same", () => {
		const cocoon: FilmMetadata = { ...stalker, title: "Cocoon", originalTitle: "Cocoon" };
		expect(buildNoteContent(cocoon, null)).toContain("aliases:\n  - Cocoon\n");
	});

	it("drops a blank original title from aliases", () => {
		const noOriginal: FilmMetadata = { ...stalker, title: "Stalker", originalTitle: "" };
		expect(buildNoteContent(noOriginal, null)).toContain("aliases:\n  - Stalker\n");
	});
});

describe("buildNoteContent: cast and composers", () => {
	it("omits cast and composers when their settings are off", () => {
		const content = buildNoteContent(stalker, null);
		expect(content).not.toContain("cast:");
		expect(content).not.toContain("composers:");
	});

	it("writes cast, cut to castCount, between genres and runtime", () => {
		const content = buildNoteContent(stalker, null, linkOptions({ addCast: true, castCount: 2 }));
		expect(content).toContain(
			"genres:\n  - Science Fiction\n  - Drama\ncast:\n  - Alisa Freyndlikh\n  - Aleksandr Kaydanovsky\nruntime:",
		);
		expect(content).not.toContain("Anatoliy Solonitsyn");
	});

	it("writes composers when addComposers is on", () => {
		const content = buildNoteContent(stalker, null, linkOptions({ addComposers: true }));
		expect(content).toContain("composers:\n  - Eduard Artemyev");
	});

	it("links cast and composers only when their link settings are on", () => {
		const options = linkOptions({
			addCast: true,
			cast: true,
			addComposers: true,
			composers: true,
			isResolved: resolves("Alisa Freyndlikh", "Eduard Artemyev"),
		});
		const content = buildNoteContent(stalker, null, options);
		expect(content).toContain('  - "[[Alisa Freyndlikh]]"');
		expect(content).toContain('  - "[[Eduard Artemyev]]"');
	});

	it("does not link cast when addCast is on but link cast is off", () => {
		const options = linkOptions({ addCast: true, isResolved: resolves("Alisa Freyndlikh") });
		const content = buildNoteContent(stalker, null, options);
		expect(content).toContain("  - Alisa Freyndlikh");
		expect(content).not.toContain("[[Alisa Freyndlikh]]");
	});
});

describe("buildAliases", () => {
	it("includes both names when they differ", () => {
		expect(buildAliases("Cocoon", "Koza")).toEqual(["Cocoon", "Koza"]);
	});

	it("includes only one copy when title and original title match", () => {
		expect(buildAliases("Cocoon", "Cocoon")).toEqual(["Cocoon"]);
	});

	it("drops a null or empty original title", () => {
		expect(buildAliases("Stalker", null)).toEqual(["Stalker"]);
		expect(buildAliases("Stalker", "")).toEqual(["Stalker"]);
		expect(buildAliases("Stalker", "   ")).toEqual(["Stalker"]);
	});

	it("falls back to original title when title is blank", () => {
		expect(buildAliases("", "Koza")).toEqual(["Koza"]);
		expect(buildAliases("   ", "Koza")).toEqual(["Koza"]);
	});

	it("returns an empty list when both names are blank", () => {
		expect(buildAliases("", null)).toEqual([]);
	});
});

describe("joinPath", () => {
	it("joins folder and name", () => {
		expect(joinPath("Films", "Stalker (1979).md")).toBe("Films/Stalker (1979).md");
	});

	it("treats an empty folder as the vault root", () => {
		expect(joinPath("", "Stalker (1979).md")).toBe("Stalker (1979).md");
		expect(joinPath("   ", "Stalker (1979).md")).toBe("Stalker (1979).md");
	});

	it("normalizes stray slashes and whitespace", () => {
		expect(joinPath("/Films/", "x.md")).toBe("Films/x.md");
		expect(joinPath("  Films/Sub  ", "x.md")).toBe("Films/Sub/x.md");
	});
});

describe("folderPrefix", () => {
	it("returns an empty string for the vault root, matching every path", () => {
		expect(folderPrefix("")).toBe("");
		expect(folderPrefix("   ")).toBe("");
	});

	it("returns a trailing-slash prefix for a real folder", () => {
		expect(folderPrefix("Directors")).toBe("Directors/");
		expect(folderPrefix("Mangaka")).toBe("Mangaka/");
	});

	it("normalizes stray slashes and whitespace the same way joinPath does", () => {
		expect(folderPrefix("/Directors/")).toBe("Directors/");
		expect(folderPrefix("  Mangaka  ")).toBe("Mangaka/");
	});

	/**
	 * The exact guarantee `isDirectorNote`/`isMangakaNote`/`findNoteByTmdbId`/
	 * `findNoteByMalId` all lean on: two note types that share a frontmatter
	 * field name (film/director both use `tmdb_id`; anime/mangaka both use
	 * `mal_id`) never get mismatched for one another, because a path can
	 * only start with one of two distinct, non-overlapping folder prefixes.
	 */
	it("never lets one folder's prefix match a path that belongs to a different, distinct folder", () => {
		const directorPrefix = folderPrefix("Directors");
		const mangakaPrefix = folderPrefix("Mangaka");
		expect(directorPrefix).not.toBe(mangakaPrefix);

		const mangakaNotePath = "Mangaka/Yoshihiro Togashi.md";
		const directorNotePath = "Directors/Christopher Nolan.md";

		expect(mangakaNotePath.startsWith(mangakaPrefix)).toBe(true);
		expect(mangakaNotePath.startsWith(directorPrefix)).toBe(false);
		expect(directorNotePath.startsWith(directorPrefix)).toBe(true);
		expect(directorNotePath.startsWith(mangakaPrefix)).toBe(false);
	});

	it("treats the anime and mangaka folders the same way when they differ", () => {
		const animePrefix = folderPrefix("Anime");
		const mangakaPrefix = folderPrefix("Mangaka");
		const animeNotePath = "Anime/Death Note (2006).md";

		expect(animeNotePath.startsWith(animePrefix)).toBe(true);
		expect(animeNotePath.startsWith(mangakaPrefix)).toBe(false);
	});
});

/**
 * Real MAL data (verified live before writing this): the 2011 Hunter x
 * Hunter anime bakes "(2011)" into its own `title`, but not into its
 * `alternative_titles.en` — so a single-field comparison would silently
 * miss it. This is exactly the case that makes multi-field title-family
 * matching (rather than a single title check) necessary for the anime ↔
 * manga Series-merge candidate search.
 */
describe("titleFamiliesOverlap", () => {
	it("matches Hunter x Hunter manga against the 1999 anime (exact title match)", () => {
		const manga = ["Hunter x Hunter", "Hunter x Hunter", "HUNTER×HUNTER"];
		const anime1999 = ["Hunter x Hunter", "Hunter x Hunter", "HUNTER×HUNTER（ハンター×ハンター）"];
		expect(titleFamiliesOverlap(manga, anime1999)).toBe(true);
	});

	it("matches Hunter x Hunter manga against the 2011 anime via the English alternative title, even though the anime's own title has a year baked in", () => {
		const manga = ["Hunter x Hunter", "Hunter x Hunter", "HUNTER×HUNTER"];
		const anime2011 = [
			"Hunter x Hunter (2011)",
			"Hunter x Hunter",
			"HUNTER×HUNTER（ハンター×ハンター）",
		];
		expect(titleFamiliesOverlap(manga, anime2011)).toBe(true);
	});

	it("matches Death Note manga against Death Note anime", () => {
		const mangaTitles = ["Death Note", "Death Note", "DEATH NOTE"];
		const animeTitles = ["Death Note", "Death Note", "デスノート"];
		expect(titleFamiliesOverlap(mangaTitles, animeTitles)).toBe(true);
	});

	it("never matches Death Note against JoJo's Bizarre Adventure (2012) in either direction", () => {
		const deathNote = ["Death Note", "Death Note", "デスノート"];
		const jojo2012 = [
			"JoJo no Kimyou na Bouken (TV)",
			"JoJo's Bizarre Adventure (2012)",
			"ジョジョの奇妙な冒険",
		];
		expect(titleFamiliesOverlap(deathNote, jojo2012)).toBe(false);
		expect(titleFamiliesOverlap(jojo2012, deathNote)).toBe(false);
	});

	it("is case- and whitespace-insensitive", () => {
		expect(titleFamiliesOverlap(["  Death Note  "], ["death note"])).toBe(true);
	});

	it("ignores null, undefined and blank titles on either side", () => {
		expect(titleFamiliesOverlap([null, "", "Death Note"], [undefined, "Death Note"])).toBe(true);
		expect(titleFamiliesOverlap([null, ""], [undefined, ""])).toBe(false);
	});

	it("returns false for two empty families", () => {
		expect(titleFamiliesOverlap([], [])).toBe(false);
	});
});
