import type { TFile } from "obsidian";
import type { LyricsState } from "../lyrics-service";
import { ensurePanel, panelOf, redrawPanel, renderAction, type PanelContext } from "./kit";

/** Whether the note's body already has a "Lyrics" heading: then the lyrics are the user's, and the panel steps aside. */
export function noteHasLyrics(context: PanelContext, file: TFile): boolean {
	const headings = context.app.metadataCache.getFileCache(file)?.headings ?? [];
	return headings.some((heading) => heading.heading.trim().toLowerCase() === "lyrics");
}

/** The line a panel without lyrics to show says instead. */
function messageOf(state: LyricsState): string | null {
	switch (state.status) {
		case "loading":
			return "Looking for the lyrics…";
		case "instrumental":
			return "Instrumental.";
		case "none":
			return "LRCLIB has no lyrics for this song.";
		case "wrong":
			return "Marked as the wrong lyrics.";
		case "busy":
			return "LRCLIB is busy right now.";
		case "offline":
			return "LRCLIB couldn't be reached. Lyrics already fetched show without a connection.";
		case "text":
			return null;
	}
}

/**
 * LYRICS, under a song's properties: the song's lyrics from LRCLIB, shown in
 * a box of their own height — a long song scrolls inside it — with
 * **Copy lyrics into note** to make them the note's own, where they can be
 * edited, and **Wrong lyrics** for a record that isn't this song. Once the
 * note has its own "Lyrics" section the panel steps aside: the note shows
 * them. The panel only reads; the note is only written by Copy.
 */
export function applyLyricsPanel(context: PanelContext, anchor: HTMLElement, file: TFile): void {
	if (!context.settings().showLyrics || noteHasLyrics(context, file)) {
		panelOf(anchor, "main")?.detach();
		return;
	}
	const state = context.actions.lyricsState(file);
	if (state === null) {
		panelOf(anchor, "main")?.detach();
		return;
	}

	const panel = ensurePanel(anchor, "main");
	if (!redrawPanel(panel, JSON.stringify(["lyrics", file.path, state]), "LYRICS")) return;

	const message = messageOf(state);
	if (state.status === "text") {
		panel.createDiv({ cls: "film-tracker-lyrics", text: state.text });
	} else if (message !== null) {
		panel.createDiv({ cls: "film-tracker-lyrics-message", text: message });
	}

	const actions = panel.createDiv({ cls: "film-tracker-manga-actions film-tracker-panel-actions" });
	const { copyLyrics, fetchLyricsAgain, markLyricsWrong } = context.actions;
	switch (state.status) {
		case "text":
			renderAction(actions, "Copy lyrics into note", () => copyLyrics(file));
			renderAction(actions, "Wrong lyrics", () => markLyricsWrong(file));
			break;
		case "busy":
		case "offline":
			renderAction(actions, "Try again", () => fetchLyricsAgain(file));
			break;
		case "loading":
			actions.detach();
			break;
		default:
			renderAction(actions, "Fetch again", () => fetchLyricsAgain(file));
	}
}
