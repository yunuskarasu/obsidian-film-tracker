import type { TFile } from "obsidian";
import { tvProgressOf, type TvSeasonEntry } from "../tv-note";
import {
	PROGRESS_CLASS,
	ensurePanel,
	panelOf,
	progressLabel,
	progressPercent,
	redrawPanel,
	renderAction,
	renderProgressBar,
	type PanelContext,
} from "./kit";

/** A season's own line in the SEASONS panel: "Season 4 · Night Country · 2024 · 6 episodes". */
export function seasonSummary(season: TvSeasonEntry): string {
	const count = `${season.episodes} ${season.episodes === 1 ? "episode" : "episodes"}`;
	return [`Season ${season.season}`, season.name, season.year === null ? null : String(season.year), count]
		.filter((part): part is string => part !== null)
		.join(" · ");
}

/**
 * The SEASONS panel: one row per season, with how much of it has been
 * watched, a checkbox that ticks the whole season off and a "+1". The
 * seasons are where a TV note keeps what was watched, so this is the
 * panel that writes it — the bar under the poster only reads them.
 */
export function applySeasonsPanel(
	context: PanelContext,
	anchor: HTMLElement,
	file: TFile,
	frontmatter: Record<string, unknown>,
): void {
	const progress = tvProgressOf(frontmatter);
	if (!context.settings().showSeasons || progress.seasons.length === 0) {
		panelOf(anchor, "seasons")?.detach();
		return;
	}

	const panel = ensurePanel(anchor, "seasons");
	const heading = progressLabel(progress.watched, progress.episodes, "episode") ?? undefined;
	if (!redrawPanel(panel, JSON.stringify(["seasons", file.path, progress]), "SEASONS", heading)) return;

	const list = panel.createDiv({ cls: "film-tracker-connections-list film-tracker-seasons" });
	for (const season of progress.seasons) {
		renderSeasonRow(context, list, file, season);
	}
}

function renderSeasonRow(context: PanelContext, list: HTMLElement, file: TFile, season: TvSeasonEntry): void {
	const complete = season.watched >= season.episodes;
	const row = list.createDiv({ cls: "film-tracker-season" });

	const toggle = row.createEl("label", { cls: "film-tracker-manga-read film-tracker-season-tick" });
	const checkbox = toggle.createEl("input", { attr: { type: "checkbox" } });
	checkbox.checked = complete;
	checkbox.addEventListener("change", () => {
		context.actions.setSeasonWatched(file, season.season, checkbox.checked);
	});

	const details = row.createDiv({ cls: "film-tracker-season-details" });
	details.createDiv({ cls: "film-tracker-season-title", text: seasonSummary(season) });
	const label = progressLabel(season.watched, season.episodes, "episode");
	if (label !== null) {
		renderProgressBar(
			details.createDiv({ cls: PROGRESS_CLASS }),
			complete && season.watchDate !== null ? `${label} · ${season.watchDate}` : label,
			progressPercent(season.watched, season.episodes),
		);
	}

	if (!complete) {
		renderAction(row.createDiv({ cls: "film-tracker-season-actions" }), "+1", () =>
			context.actions.watchSeason(file, season.season),
		);
	}
}
