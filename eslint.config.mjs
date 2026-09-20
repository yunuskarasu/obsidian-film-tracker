import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
// The rule's own lists. Passing `brands` or `acronyms` replaces them rather
// than adding to them, so they are spread back in below.
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";
import { DEFAULT_ACRONYMS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js";

export default tseslint.config(
	// Nothing that ships lives in a dot directory, and the tools that keep
	// their settings in one are not this project's code to lint.
	{ ignores: ["main.js", "node_modules/", ".*/", "**/*.mjs", "**/*.mts"] },
	js.configs.recommended,
	tseslint.configs.recommended,
	obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// Same as the recommended setting, plus the names this plugin's UI
			// text uses, which sentence case would otherwise lowercase.
			"obsidianmd/ui/sentence-case": [
				"warn",
				{
					enforceCamelCaseLower: true,
					brands: [...DEFAULT_BRANDS, "Film + Anime-Manga Tracker", "MyAnimeList", "Letterboxd"],
					acronyms: [...DEFAULT_ACRONYMS, "TMDB", "MAL"],
				},
			],
		},
	},
	{
		// The fake vault stands a stub in for Obsidian's TFile, whose constructor
		// isn't public, so it has to cast. The rule guards plugin code at run time;
		// nothing under tests/ ships.
		files: ["tests/**/*.ts"],
		rules: {
			"obsidianmd/no-tfile-tfolder-cast": "off",
		},
	},
);
