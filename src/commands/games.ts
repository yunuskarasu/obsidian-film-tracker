import { Notice, type Plugin, type TFile } from "obsidian";
import type { GameDlc } from "../game";
import { isGame } from "../note-kind";
import { DlcModal, openGameSearch } from "../search-modal";
import type { Services } from "../services";
import { reportFailures } from "../vault-notes";

/** Games and their DLCs, from IGDB. */
export class GameCommands {
	constructor(private readonly services: Services) {}

	register(plugin: Plugin): void {
		const { services } = this;

		plugin.addCommand({
			id: "add-game",
			name: "Add game",
			callback: () => this.startAddGame(),
		});

		plugin.addCommand({
			id: "refresh-game-metadata",
			name: "Refresh metadata from IGDB",
			checkCallback: (checking) => {
				const note = services.activeNote();
				if (note === null || !isGame(note.kind)) return false;
				if (!checking) {
					const client = services.igdb();
					if (client !== null) void services.games.refresh(client, note.file);
				}
				return true;
			},
		});

		plugin.addCommand({
			id: "add-dlc",
			name: "Add DLC",
			checkCallback: (checking) => {
				const note = services.activeNote();
				if (note === null || !isGame(note.kind)) return false;
				if (!checking) void this.startAddDlc(note.file);
				return true;
			},
		});

		plugin.addCommand({
			id: "start-playing",
			name: "Start playing",
			checkCallback: (checking) => {
				const note = services.activeNote();
				if (note === null || !isGame(note.kind)) return false;
				if (!checking) void services.games.startPlaying(note.file);
				return true;
			},
		});

		plugin.addCommand({
			id: "completed-today",
			name: "Mark as completed today",
			checkCallback: (checking) => {
				const note = services.activeNote();
				if (note === null || !isGame(note.kind)) return false;
				if (!checking) void services.games.markCompletedToday(note.file);
				return true;
			},
		});
	}

	startAddGame(): void {
		const client = this.services.igdb();
		if (client === null) return;
		openGameSearch(this.services.app, client, (result) => void this.services.games.addGame(client, result));
	}

	/** "Add DLC": the game's DLCs on IGDB that its note doesn't have yet, one to pick. */
	async startAddDlc(file: TFile): Promise<void> {
		const { app, games } = this.services;
		const client = this.services.igdb();
		if (client === null) return;
		new Notice(`Looking for DLCs of ${file.basename}…`);
		let choices: GameDlc[] | null = null;
		await reportFailures("look for DLCs", async () => {
			choices = await games.dlcChoices(client, file);
		});
		if (choices === null) return;
		if ((choices as GameDlc[]).length === 0) {
			new Notice(`IGDB lists no DLC for ${file.basename} that isn't on the note already.`);
			return;
		}
		new DlcModal(app, file.basename, choices, (dlc) => void games.addDlc(file, dlc)).open();
	}
}
