import { describe, expect, it } from "vitest";
import {
	airedBySeason,
	detailsLookLikeAnime,
	seasonToCount,
	toTvMetadata,
	toTvSearchResult,
	type TmdbTvDetails,
} from "../src/tmdb-tv";
import attackOnTitan from "./fixtures/tmdb-tv/tv-attack-on-titan.json";
import breakingBad from "./fixtures/tmdb-tv/tv-breaking-bad.json";
import chernobyl from "./fixtures/tmdb-tv/tv-chernobyl.json";
import doctorWho from "./fixtures/tmdb-tv/tv-doctor-who.json";
import ezel from "./fixtures/tmdb-tv/tv-ezel.json";
import firefly from "./fixtures/tmdb-tv/tv-firefly.json";
import severance from "./fixtures/tmdb-tv/tv-severance.json";
import simpsons from "./fixtures/tmdb-tv/tv-the-simpsons.json";
import trueDetective from "./fixtures/tmdb-tv/tv-true-detective.json";
import simpsons37 from "./fixtures/tmdb-tv/season-the-simpsons-37.json";
import simpsons38 from "./fixtures/tmdb-tv/season-the-simpsons-38.json";
import searchAttackOnTitan from "./fixtures/tmdb-tv/search-attack-on-titan.json";
import searchSimpsons from "./fixtures/tmdb-tv/search-the-simpsons.json";

/*
 * Real TMDB answers, fetched on 2026-09-22 and cut down to the fields the
 * plugin reads (see tests/fixtures/tmdb-tv). `TODAY` is that day, so what
 * counts as aired is what TMDB itself said had aired then.
 */
const TODAY = "2026-09-22";

const details = (value: unknown) => value as TmdbTvDetails;
const counts = (show: ReturnType<typeof toTvMetadata>) => show.seasons.map((season) => season.episodes);
const total = (show: ReturnType<typeof toTvMetadata>) => counts(show).reduce((sum, count) => sum + count, 0);

describe("toTvMetadata", () => {
	it("reads a show that has ended in full", () => {
		const show = toTvMetadata(details(breakingBad), TODAY);
		expect(show).toMatchObject({
			title: "Breaking Bad",
			originalTitle: "Breaking Bad",
			year: 2008,
			endYear: 2013,
			creators: ["Vince Gilligan"],
			genres: ["Drama", "Crime"],
			networks: ["AMC"],
			status: "Ended",
			finished: true,
			tmdbTvId: 1396,
		});
		expect(show.cast.slice(0, 2)).toEqual(["Bryan Cranston", "Aaron Paul"]);
		expect(counts(show)).toEqual([7, 13, 13, 13, 16]);
		expect(show.seasons[0]).toEqual({ season: 1, name: null, year: 2008, episodes: 7 });
	});

	it("never counts episodes that are only announced", () => {
		// TMDB listed 803 episodes, two of them in a season 38 that starts on the 27th.
		const show = toTvMetadata(details(simpsons), TODAY);
		expect(simpsons.number_of_episodes).toBe(803);
		expect(total(show)).toBe(801);
		expect(show.seasons[show.seasons.length - 1]).toMatchObject({ season: 37, episodes: 15 });
		expect(show.finished).toBe(false);
		expect(show.endYear).toBeNull();
	});

	it("leaves out a season that has nothing out yet", () => {
		// Severance's season 3 is listed with no episodes and no date.
		const show = toTvMetadata(details(severance), TODAY);
		expect(show.seasons.map((season) => season.season)).toEqual([1, 2]);
		expect(total(show)).toBe(19);
	});

	it("leaves the specials out", () => {
		const show = toTvMetadata(details(doctorWho), TODAY);
		expect(show.seasons.every((season) => season.season > 0)).toBe(true);
		expect(total(show)).toBe(153);
		expect(total(toTvMetadata(details(attackOnTitan), TODAY))).toBe(87);
	});

	it("keeps a season's own name, and only that", () => {
		const show = toTvMetadata(details(trueDetective), TODAY);
		expect(show.seasons.map((season) => season.name)).toEqual([null, null, null, "Night Country"]);
		expect(toTvMetadata(details(attackOnTitan), TODAY).seasons[3].name).toBe("The Final Season");
	});

	it("treats a canceled show as finished", () => {
		const show = toTvMetadata(details(firefly), TODAY);
		expect(show).toMatchObject({ finished: true, endYear: 2002, status: "Canceled" });
		expect(counts(show)).toEqual([11]);
	});

	it("reads a miniseries and a Turkish series like any other show", () => {
		expect(counts(toTvMetadata(details(chernobyl), TODAY))).toEqual([5]);
		const show = toTvMetadata(details(ezel), TODAY);
		expect(show.creators).toEqual(["Pınar Bulut", "Kerem Deren"]);
		expect(total(show)).toBe(71);
	});

	it("leaves out what TMDB left blank", () => {
		const show = toTvMetadata({ id: 1 }, TODAY);
		expect(show).toMatchObject({
			title: "",
			year: null,
			endYear: null,
			creators: [],
			cast: [],
			status: null,
			finished: false,
			seasons: [],
			posterPath: null,
		});
	});
});

describe("seasonToCount / airedBySeason", () => {
	it("needs no second request when the last aired episode says where the show is", () => {
		for (const show of [breakingBad, simpsons, severance, trueDetective, firefly]) {
			expect(seasonToCount(details(show), TODAY)).toBeNull();
		}
	});

	it("counts the latest season by date when the last aired episode was a special", () => {
		const special = { ...details(simpsons), last_episode_to_air: { season_number: 0, episode_number: 60, air_date: "2026-09-01" } };
		// Season 38 hasn't started on the 22nd, so season 37 is the one under way.
		expect(seasonToCount(special, TODAY)).toBe(37);
		expect(airedBySeason(special, TODAY, simpsons37).get(37)).toBe(15);
		expect(airedBySeason(special, TODAY, simpsons37).get(38)).toBe(0);

		// A week later, one episode of season 38 is out.
		expect(seasonToCount(special, "2026-09-28")).toBe(38);
		const later = airedBySeason(special, "2026-09-28", simpsons38);
		expect(later.get(38)).toBe(1);
		expect(later.get(37)).toBe(15);
	});

	it("counts nothing as aired when nothing says so", () => {
		const unknown = { ...details(severance), last_episode_to_air: null };
		expect([...airedBySeason(unknown, TODAY).values()].every((count) => count === 0)).toBe(true);
	});
});

describe("anime", () => {
	it("recognizes Japanese animation, in a search result and in a show's details", () => {
		expect(toTvSearchResult(searchAttackOnTitan.results[0])).toMatchObject({
			title: "Attack on Titan",
			originalTitle: "進撃の巨人",
			year: 2013,
			looksLikeAnime: true,
		});
		expect(detailsLookLikeAnime(details(attackOnTitan))).toBe(true);
	});

	it("never takes other animation for anime", () => {
		expect(toTvSearchResult(searchSimpsons.results[0]).looksLikeAnime).toBe(false);
		expect(detailsLookLikeAnime(details(simpsons))).toBe(false);
		expect(detailsLookLikeAnime(details(breakingBad))).toBe(false);
	});
});
