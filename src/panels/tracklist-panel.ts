import type { TFile } from "obsidian";
import { albumTracksOf, type AlbumTrackEntry } from "../music-note";
import { ensurePanel, panelOf, redrawPanel, type PanelContext } from "./kit";

/** The heading's own summary: "12 tracks · 53 min". */
export function tracklistSummary(count: number, runtime: unknown): string {
	const tracks = `${count} ${count === 1 ? "track" : "tracks"}`;
	return typeof runtime === "number" && runtime > 0 ? `${tracks} · ${runtime} min` : tracks;
}

/**
 * TRACKLIST, under an album's properties: its tracks in order, disc by disc
 * on an album of more than one. The `tracks` property row itself is hidden
 * (Obsidian has no widget for a list of objects), and this is its readable
 * view. It only reads the note — an album is listened to as a whole.
 */
export function applyTracklist(
	context: PanelContext,
	anchor: HTMLElement,
	file: TFile,
	frontmatter: Record<string, unknown>,
): void {
	const tracks = albumTracksOf(frontmatter);
	if (!context.settings().showTracklist || tracks.length === 0) {
		panelOf(anchor, "main")?.detach();
		return;
	}

	const panel = ensurePanel(anchor, "main");
	const summary = tracklistSummary(tracks.length, frontmatter.runtime);
	if (!redrawPanel(panel, JSON.stringify(["tracklist", file.path, tracks, summary]), "TRACKLIST", summary)) return;

	const list = panel.createDiv({ cls: "film-tracker-connections-list film-tracker-tracks" });
	const discs = new Set(tracks.map((track) => track.disc ?? 1));
	let disc: number | null = null;
	for (const track of tracks) {
		if (discs.size > 1 && track.disc !== disc) {
			disc = track.disc;
			list.createDiv({ cls: "film-tracker-track-disc", text: `Disc ${disc ?? 1}` });
		}
		renderTrack(list, track);
	}
}

function renderTrack(list: HTMLElement, track: AlbumTrackEntry): void {
	const row = list.createDiv({ cls: "film-tracker-track" });
	row.createSpan({ cls: "film-tracker-track-number", text: String(track.n) });
	row.createSpan({ cls: "film-tracker-track-title", text: track.title });
	if (track.length !== null) row.createSpan({ cls: "film-tracker-track-length", text: track.length });
}
