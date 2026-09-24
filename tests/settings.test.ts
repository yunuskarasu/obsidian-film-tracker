import type { App, Plugin, SettingDefinitionItem } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, FilmTrackerSettingTab, type FilmTrackerSettings } from "../src/settings";

/**
 * The settings tab, as data: Obsidian 1.13 renders `getSettingDefinitions`
 * itself, and each control names the settings key it writes — a name with a
 * typo in it would save nothing, quietly.
 */

/** Descriptions are built as document fragments, which a Node test has no DOM for. */
class FakeFragment {
	append(): void {
		/* the text only matters in the app */
	}

	createEl(): HTMLElement {
		return {} as HTMLElement;
	}
}

function fakePlugin(overrides: Partial<FilmTrackerSettings> = {}) {
	const saves: number[] = [];
	const panels: string[] = [];
	const plugin = {
		settings: { ...DEFAULT_SETTINGS, ...overrides },
		saveSettings: async () => {
			saves.push(1);
		},
		refreshPanels: () => panels.push("refreshed"),
	};
	return { plugin, saves, panels };
}

// The descriptions are built whenever the definitions are read, so this
// stands in for the DOM for the whole file.
vi.stubGlobal("DocumentFragment", FakeFragment);

function tabFor(plugin: unknown): FilmTrackerSettingTab {
	return new FilmTrackerSettingTab({} as App, plugin as Plugin as never);
}

/** Every row, groups flattened out. */
function rows(items: SettingDefinitionItem[]): SettingDefinitionItem[] {
	return items.flatMap((item) => ("type" in item ? [...(("items" in item ? item.items : undefined) ?? [])] : [item]));
}

describe("the setting definitions", () => {
	const { plugin } = fakePlugin();
	const definitions = tabFor(plugin).getSettingDefinitions();
	const all = rows(definitions);
	const controls = all.flatMap((row) => ("control" in row && row.control !== undefined ? [row.control] : []));

	it("writes every control to a setting that exists", () => {
		for (const control of controls) {
			expect(Object.keys(DEFAULT_SETTINGS), control.key).toContain(control.key);
		}
	});

	it("covers every setting: with a control, or with the keychain picker the two keys use", () => {
		const covered = new Set(controls.map((control) => control.key));
		const keys = ["apiKey", "apiKeySecretName", "malClientId", "malClientIdSecretName"];
		for (const key of Object.keys(DEFAULT_SETTINGS)) {
			if (keys.includes(key)) continue;
			expect(covered, key).toContain(key);
		}
		expect(all.filter((row) => "render" in row && row.render !== undefined).length).toBeGreaterThanOrEqual(2);
	});

	it("gives the folder settings a folder control, so Obsidian suggests the vault's folders", () => {
		const folders = controls.filter((control) => control.type === "folder").map((control) => control.key);
		expect(folders).toEqual([
			"filmFolder",
			"posterFolder",
			"directorFolder",
			"directorPhotoFolder",
			"tvFolder",
			"tvPosterFolder",
			"animeFolder",
			"animePosterFolder",
			"mangakaFolder",
			"mangakaPhotoFolder",
		]);
	});

	it("names every group and every row", () => {
		for (const item of definitions) {
			if ("type" in item) expect("heading" in item ? item.heading : "").not.toBe("");
			else expect(item.name).not.toBe("");
		}
		for (const row of all) expect("name" in row ? row.name : "").not.toBe("");
	});
});

describe("saving a setting", () => {
	it("trims what was typed and saves it", async () => {
		const { plugin, saves } = fakePlugin();
		await tabFor(plugin).setControlValue("filmFolder", "  Movies/Watched  ");

		expect(plugin.settings.filmFolder).toBe("Movies/Watched");
		expect(saves).toHaveLength(1);
	});

	it("redraws the panels when one of theirs is switched", async () => {
		const { plugin, panels } = fakePlugin();
		const tab = tabFor(plugin);
		for (const key of ["showConnections", "showFilmography", "showSeasons", "showTvSeries"]) {
			await tab.setControlValue(key, false);
		}
		await tab.setControlValue("linkGenres", true);

		// Every panel setting redraws; nothing else does.
		expect(panels).toEqual(["refreshed", "refreshed", "refreshed", "refreshed"]);
		expect(plugin.settings.linkGenres).toBe(true);
	});

	it("reads a setting back the way the definitions name it", () => {
		const { plugin } = fakePlugin({ castCount: 9 });
		expect(tabFor(plugin).getControlValue("castCount")).toBe(9);
	});
});
