import { beforeAll, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { FakeApp } from "./fake-app";
import { Menu, Modal, Notice } from "./obsidian-stub";

/*
 * Everything the plugin hands Obsidian when it loads, written down: every
 * command and the notes it shows on, the ribbon icon and its menu, the
 * right-click menu of each kind of note, the views and the events it listens
 * to. The snapshot is the plugin's face — a command's id is what a user's
 * hotkey is bound to — so a change in it is either meant, and the snapshot
 * updated with it, or a mistake caught here.
 */

/** One note of every kind the plugin knows, and two it doesn't. */
const NOTES: Record<string, string> = {
	"Films/Film (2010).md": "---\ntitle: Film\ndirectors:\n  - Someone\ntmdb_id: 1\nwatch_date:\nwatched: false\n---\n",
	"Directors/Someone.md": "---\nname: Someone\ntmdb_id: 2\n---\n",
	"TV/Show (2008).md": "---\ntitle: Show\ntmdb_tv_id: 3\n---\n",
	"TV/Show with manga (2008).md": "---\ntitle: Show with manga\ntmdb_tv_id: 4\nmanga:\n  mal_id: 5\n---\n",
	"Anime/Anime (2013).md": "---\ntitle: Anime\nmal_id: 6\nmedia_type: tv\n---\n",
	"Manga/Manga (1989).md": "---\ntitle: Manga\nmanga:\n  mal_id: 7\n---\n",
	"Anime/Both (2011).md": "---\ntitle: Both\nmal_id: 8\nmedia_type: tv\nmanga:\n  mal_id: 9\n---\n",
	"Mangaka/Mangaka.md": "---\nname: Mangaka\nmal_id: 10\n---\n",
	"Music/Albums/Album (2017)/Album (2017).md": "---\ntitle: Album\nmb_album_id: a1\n---\n",
	"Music/Loose album (2017).md": "---\ntitle: Loose album\nmb_album_id: a2\n---\n",
	"Music/Artists/Artist.md": "---\nname: Artist\nmb_artist_id: r1\n---\n",
	"Music/Albums/Album (2017)/Song.md": "---\ntitle: Song\nmb_recording_id: s1\n---\n",
	"Games/Game (2018).md": "---\ntitle: Game\nigdb_id: 11\n---\n",
	"Books/Book (1987).md": "---\ntitle: Book\nopenlibrary_id: OL1W\n---\n",
	"Authors/Author.md": "---\nname: Author\nopenlibrary_id: OL2A\n---\n",
	"Notes/My own note.md": "---\ntitle: My own note\n---\n",
};

type Command = {
	id: string;
	name: string;
	callback?: () => unknown;
	checkCallback?: (checking: boolean) => boolean | void;
	editorCallback?: unknown;
	editorCheckCallback?: (checking: boolean, editor: unknown, view: unknown) => boolean | void;
};

type Recorded = {
	settings: Record<string, unknown>;
	commands: Command[];
	ribbons: { icon: string; title: string; open: (event: unknown) => unknown }[];
	views: string[];
	settingTabs: unknown[];
	domEvents: string[];
};

const fake = new FakeApp(NOTES);
const handlers = new Map<string, ((...args: unknown[]) => unknown)[]>();
const events: string[] = [];
/** The views a command opened a tab for: the diary's, say. */
const viewsOpened: string[] = [];
let layoutReady = 0;
let plugin: Recorded;

/** The fake vault's app, with the event hubs the plugin subscribes to. */
function appWithEvents(): App {
	const app = fake.app as unknown as Record<string, Record<string, unknown>>;
	const hub = (source: string) => (name: string, handler: (...args: unknown[]) => unknown) => {
		events.push(`${source}: ${name}`);
		handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		return { source, name };
	};
	app.workspace.on = hub("workspace");
	const getLeaf = app.workspace.getLeaf as () => Record<string, unknown>;
	app.workspace.getLeaf = () => ({ ...getLeaf(), setViewState: async (state: { type: string }) => void viewsOpened.push(state.type) });
	app.workspace.getLeavesOfType = () => [];
	app.workspace.setActiveLeaf = () => {};
	app.workspace.onLayoutReady = () => (layoutReady += 1);
	app.metadataCache.on = hub("metadataCache");
	app.vault.on = hub("vault");
	return app as unknown as App;
}

/** The menu a handler of `name` fills, for `args`. */
function menuFrom(name: string, ...args: unknown[]): Menu["items"] {
	const menu = new Menu();
	for (const handler of handlers.get(name) ?? []) handler(menu, ...args);
	return menu.items;
}

beforeAll(async () => {
	// main.ts listens to the document's scroll and asks for animation frames; neither happens here.
	vi.stubGlobal("document", {});
	vi.stubGlobal("window", { requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout: () => {} });
	// Today, always the same day: what a command writes is compared word for word.
	vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-12T12:00:00") });
	const { default: FilmTrackerPlugin } = await import("../src/main");
	const instance = new FilmTrackerPlugin(appWithEvents(), { id: "film-tracker" } as never);
	await instance.onload();
	plugin = instance as unknown as Recorded;
});

/** The note the command palette would be asked about, or none at all. */
function open(path: string | null): TFile | null {
	if (path === null) {
		fake.visible = null;
		fake.lastActive = null;
		return null;
	}
	return fake.show(path);
}

describe("what the plugin registers", () => {
	// By id: the order they are registered in shows nowhere — the command palette and the hotkey list sort them.
	it("registers the same commands, by id and name", () => {
		const commands = [...plugin.commands].sort((a, b) => a.id.localeCompare(b.id)).map((command) => ({
			id: command.id,
			name: command.name,
			shows:
				command.checkCallback !== undefined
					? "on some notes"
					: command.editorCheckCallback !== undefined
						? "on some notes, in the editor"
						: command.editorCallback !== undefined
							? "in the editor"
							: "always",
		}));
		expect(commands).toMatchSnapshot();
	});

	it("offers each command on the same notes", () => {
		const shown: Record<string, string[]> = {};
		for (const path of [null, ...Object.keys(NOTES)]) {
			const file = open(path);
			shown[path ?? "(no note open)"] = plugin.commands
				.filter((command) => {
					if (command.checkCallback !== undefined) return command.checkCallback(true) === true;
					if (command.editorCheckCallback !== undefined) {
						return file !== null && command.editorCheckCallback(true, {}, { file }) === true;
					}
					return command.callback !== undefined || (command.editorCallback !== undefined && file !== null);
				})
				.map((command) => command.id)
				.sort();
		}
		open(null);
		expect(shown).toMatchSnapshot();
	});

	it("has the same ribbon icon and menu", () => {
		Menu.made.length = 0;
		const ribbons = plugin.ribbons.map((ribbon) => {
			ribbon.open({});
			const menu = Menu.made[Menu.made.length - 1];
			return { icon: ribbon.icon, title: ribbon.title, menu: menu?.items ?? null, shown: menu?.shown ?? false };
		});
		expect(ribbons).toMatchSnapshot();
	});

	it("has the same right-click menu on each kind of note", () => {
		const menus: Record<string, { fileMenu: Menu["items"]; editorMenu: Menu["items"] }> = {};
		for (const path of Object.keys(NOTES)) {
			const file = fake.file(path);
			menus[path] = {
				fileMenu: menuFrom("file-menu", file, "file-explorer"),
				editorMenu: menuFrom("editor-menu", {}, { file }),
			};
		}
		// A folder, which the file menu is opened on too.
		menus["(a folder)"] = { fileMenu: menuFrom("file-menu", { path: "Films" }, "file-explorer"), editorMenu: [] };
		expect(menus).toMatchSnapshot();
	});

	it("registers the same views, settings, and events", () => {
		expect({
			views: plugin.views,
			settingTabs: plugin.settingTabs.length,
			events,
			domEvents: plugin.domEvents,
			layoutReady,
		}).toMatchSnapshot();
	});
});

/** With every key set, or none: without them most commands stop at "Set your … key". */
function keys(set: boolean): string {
	for (const field of ["apiKey", "malClientId", "igdbClientId", "igdbClientSecret"]) plugin.settings[field] = set ? "test-key" : "";
	return set ? "with keys" : "without keys";
}

/** What one click or command did: the notes it changed, the dialogs and notices it showed, the notes it opened. */
type Outcome = { notices: string[]; dialogs: string[]; changed: Record<string, string>; opened: string[]; views: string[] };

/** Runs `act` on a vault just as `NOTES` has it, and writes down what came of it once everything it started has settled. */
async function outcomeOf(act: () => unknown): Promise<Outcome> {
	fake.notes.clear();
	for (const [path, content] of Object.entries(NOTES)) fake.notes.set(path, content);
	fake.images.clear();
	fake.folders.clear();
	fake.opened.length = 0;
	Notice.shown.length = 0;
	Modal.opened.length = 0;
	viewsOpened.length = 0;
	act();
	// The fake vault answers at once: everything a command starts settles within these turns.
	for (let turn = 0; turn < 500; turn++) await Promise.resolve();
	const changed: Record<string, string> = {};
	for (const path of new Set([...Object.keys(NOTES), ...fake.notes.keys(), ...fake.images])) {
		const now = fake.notes.get(path) ?? (fake.images.has(path) ? "(an image)" : "(gone)");
		if (now !== NOTES[path]) changed[path] = now;
	}
	return { notices: [...Notice.shown], dialogs: [...Modal.opened], changed, opened: [...fake.opened], views: [...viewsOpened] };
}

describe("what each command and menu entry does", () => {
	it("runs each command the same way", async () => {
		const outcomes: Record<string, Outcome> = {};
		for (const set of [false, true]) {
			const label = keys(set);
			for (const command of plugin.commands) {
				if (command.callback !== undefined) {
					open(null);
					outcomes[`${command.id}, ${label}`] = await outcomeOf(() => command.callback?.());
					continue;
				}
				for (const path of Object.keys(NOTES)) {
					open(path);
					if (command.checkCallback?.(true) !== true) continue;
					outcomes[`${command.id} on ${path}, ${label}`] = await outcomeOf(() => command.checkCallback?.(false));
				}
			}
		}
		keys(false);
		open(null);
		expect(outcomes).toMatchSnapshot();
	});

	it("runs each entry of the ribbon menu the same way", async () => {
		const outcomes: Record<string, Outcome> = {};
		for (const set of [false, true]) {
			const label = keys(set);
			for (const path of [null, "Manga/Manga (1989).md"]) {
				open(path);
				Menu.made.length = 0;
				plugin.ribbons[0].open({});
				const menu = Menu.made[Menu.made.length - 1];
				for (const [index, click] of menu.clicks.entries()) {
					if (click === null) continue;
					outcomes[`${menu.items[index].title}, with ${path ?? "no note"} open, ${label}`] = await outcomeOf(() => click());
				}
			}
		}
		keys(false);
		open(null);
		expect(outcomes).toMatchSnapshot();
	});

	it("runs each entry of a note's menu the same way", async () => {
		const outcomes: Record<string, Outcome> = {};
		for (const set of [false, true]) {
			const label = keys(set);
			for (const path of Object.keys(NOTES)) {
				const menu = new Menu();
				for (const handler of handlers.get("file-menu") ?? []) handler(menu, fake.file(path), "file-explorer");
				for (const [index, click] of menu.clicks.entries()) {
					if (click !== null) outcomes[`${menu.items[index].title} on ${path}, ${label}`] = await outcomeOf(() => click());
				}
			}
		}
		keys(false);
		expect(outcomes).toMatchSnapshot();
	});
});
