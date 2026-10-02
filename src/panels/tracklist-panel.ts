import { setIcon, type TFile } from "obsidian";
import { albumTracksOf, type AlbumTrackEntry } from "../music-note";
import { ensurePanel, panelOf, redrawPanel, renderPathLink, type PanelContext } from "./kit";
import { songNoteFor, type VaultScan } from "./vault-scan";

/** A track's title in Latin letters, where its line has one (`latin`), else its own. */
export function trackTitleShown(track: AlbumTrackEntry): string {
	const latin: unknown = track.extra.latin;
	return typeof latin === "string" && latin.trim() !== "" ? latin.trim() : track.title;
}

/** The heading's own summary: "12 tracks · 53 min". */
export function tracklistSummary(count: number, runtime: unknown): string {
	const tracks = `${count} ${count === 1 ? "track" : "tracks"}`;
	return typeof runtime === "number" && runtime > 0 ? `${tracks} · ${runtime} min` : tracks;
}

/**
 * TRACKLIST, under an album's properties: its tracks in order, disc by disc
 * on an album of more than one. The `tracks` property row itself is hidden
 * (Obsidian has no widget for a list of objects), and this is its readable
 * view. A track with a song note links to it; one without has a "+" that
 * writes that one song's note — never the others', and never on its own.
 */
export function applyTracklist(
	context: PanelContext,
	anchor: HTMLElement,
	file: TFile,
	frontmatter: Record<string, unknown>,
	scan: VaultScan,
): void {
	const tracks = albumTracksOf(frontmatter);
	if (!context.settings().showTracklist || tracks.length === 0) {
		panelOf(anchor, "main")?.detach();
		return;
	}

	const latin = context.settings().showLatinTitles;
	const songs = scan.songs();
	const notes = tracks.map((track) => songNoteFor(songs, file.path, track));
	const panel = ensurePanel(anchor, "main");
	const summary = tracklistSummary(tracks.length, frontmatter.runtime);
	if (!redrawPanel(panel, JSON.stringify(["tracklist", file.path, tracks, notes, summary, latin]), "TRACKLIST", summary)) return;

	const list = panel.createDiv({ cls: "film-tracker-connections-list film-tracker-tracks" });
	const discs = new Set(tracks.map((track) => track.disc ?? 1));
	let disc: number | null = null;
	tracks.forEach((track, index) => {
		if (discs.size > 1 && track.disc !== disc) {
			disc = track.disc;
			list.createDiv({ cls: "film-tracker-track-disc", text: `Disc ${disc ?? 1}` });
		}
		renderTrack(context, list, file, track, notes[index], latin);
	});
}

function renderTrack(
	context: PanelContext,
	list: HTMLElement,
	file: TFile,
	track: AlbumTrackEntry,
	note: string | null,
	latin: boolean,
): void {
	const row = list.createDiv({ cls: "film-tracker-track" });
	row.createSpan({ cls: "film-tracker-track-number", text: String(track.n) });
	const title = row.createSpan({ cls: "film-tracker-track-title" });
	const shown = latin ? trackTitleShown(track) : track.title;
	if (note === null) title.setText(shown);
	else renderPathLink(context.app, title, shown, note, file.path);
	if (track.length !== null) row.createSpan({ cls: "film-tracker-track-length", text: track.length });

	// A fixed-width slot either way, so the lengths stay in one column.
	const slot = row.createSpan({ cls: "film-tracker-track-add" });
	if (note !== null) return;
	const add = slot.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `Add a note for ${track.title}` } });
	setIcon(add, "plus");
	add.addEventListener("click", (event) => {
		event.preventDefault();
		add.disabled = true;
		context.actions.addSong(file, track);
	});
}
