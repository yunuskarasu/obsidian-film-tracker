# Changelog

All notable changes to Film + Anime-Manga Tracker are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-09-20

### Added

- **Adaptations.** The same manga, or the same anime, can sit on several Series notes, one per pairing: a remake, a second series, a film. **Add adaptation** on the MANGA panel pairs the note's manga with another anime in one step. **Add anime** and **Add manga** link into the note open in the editor, after asking (**Link to this note?**), even when the work is already on another note. A work arriving on another note reuses that note's poster file, and arrives **Read** or `watched` if it already is elsewhere. **Read** stays in step across every note carrying the manga.
- **Mark these films as watched** in the Letterboxd import dialog. It starts on for `diary.csv`, `watched.csv`, `ratings.csv` and `reviews.csv`, and off for anything else, since `watchlist.csv` looks exactly like `watched.csv`. Importing an export again with it on ticks `watched` on films already in the vault.
- Anime and manga search results show their type and year, e.g. "TV · 2011" or "Light novel · 2010".
- The MANGA panel shows the manga's year and reads its type and status as text: "Manga · 1998 · Currently publishing".
- **Remove manga** asks before it removes anything. When no other note uses the manga's poster, **Remove manga** offers to delete it too, and **Change manga** asks whether to delete the old one.
- On Obsidian 1.11.4 or later, the TMDB API key and the MyAnimeList client ID live in Obsidian's keychain instead of the plugin's `data.json`. Keys typed into an earlier version move there on their own. The keychain is kept per device and doesn't sync.

### Changed

- Notes are recognized by their properties, never by their folder, and duplicates are caught anywhere in the vault. Moving notes, changing a folder setting later or leaving a folder empty is safe.
- A new note whose name another of the plugin's notes already has takes the next free name. A manga-only note tries its title with the year first; after that a number is added (`Home (2015) 2.md`). A note of your own under that name is opened instead of written beside.
- The Letterboxd import only takes a film within a year of the export's year, and searches TMDB with the year first. A title with nothing that close goes to the import report instead of being guessed.
- **Add anime** and **Add manga** only ever link into the note open in the editor. Before, they could link into the last note used while Graph view or a canvas had the focus.
- MANGAGRAPHY lists a manga that is on several notes once, with the other notes after it ("also in …"). It also counts that manga once in the read percentage.
- Closing the Letterboxd progress window stops the import, the same as **Cancel**. Only one import runs at a time.
- The ribbon icon's tooltip reads "Add film, anime or manga".

### Fixed

- **Refresh wrote a film's data into a director note** at the vault root (Director folder left empty). The same mix-up happened between films and directors in a shared folder, and between anime and mangaka.
- Refresh deleted aliases you had added to a film or a director.
- Refresh took away links in lists: directors, genres, cast, composers, studios and mangaka. It did so with the list's **Link** setting off, or before the linked note existed.
- Refresh deleted comment lines at the top of a note's properties.
- Posters never showed with Obsidian's **Use [[Wikilinks]]** setting turned off. Posters are now always written as wikilinks, and ones written as Markdown links show too.
- Notes with Windows (CRLF) line endings were never updated, yet a success notice was shown. A note whose properties can't be read now says so.
- A MyAnimeList title that already ends in its year got the year twice in its file name, e.g. `Hunter x Hunter (2011) (2011).md`.
- The Letterboxd import picked the first TMDB result even when its year was far off.
- The Letterboxd import gave the wrong reason when the Film folder setting named a file.
- The MANGA panel's Read checkbox fell out of step with the file on a quick double click, and reset `read: True`. It could also break a `read:` you had nested under a field of your own.
- The MANGA panel read "1 volumes".
- README: without a TMDB key, the TMDB commands show a notice. The README said search silently returned nothing.

### Development

- `obsidian` is pinned to 1.13.1 instead of `latest`. `tsconfig.json` drops `baseUrl` and uses `moduleResolution: bundler`, both deprecated in TypeScript 6 and 7.
- GitHub Actions: lint, tests and build on every push to `master` and every pull request. Pushing a version tag creates a draft release with `main.js`, `manifest.json` and `styles.css`.
- `main.ts` is split into modules, one search box class serves all four searches, and duplicated helpers are merged.
- End-to-end tests of the commands against an in-memory vault.
- The note layout redraws once after a burst of changes rather than on each one. It skips panels whose content hasn't changed, and removes its timers and its elements in popout windows when the plugin is disabled.
- `package.json` carries the real version, 2.1.0 instead of 1.0.0. `versions.json` lists every release, and `version-bump.mjs` keeps both files' formatting.
- Removed the unused `example.css`.

## [2.1.0] - 2026-09-07

### Added

- **Change manga** and **Remove manga** on the MANGA panel, for a Series note that ended up with the wrong manga.

### Changed

- Merging an anime and a manga into one note is fully manual. The plugin no longer compares their titles first.

## [2.0.1] - 2026-09-07

### Fixed

- The plugin's name for the Community plugins directory is now "Film + Anime-Manga Tracker", and the release metadata matches it.

## [2.0.0] - 2026-09-07

### Added

- MyAnimeList support:
  - **Add anime** and **Add manga**, with Series notes that hold either or both.
  - The MANGA panel with a Read checkbox.
  - **Add mangaka**, with mangaka notes and the MANGAGRAPHY panel.
  - **Refresh anime/manga metadata from MAL**.

### Changed

- Renamed from "Film Tracker" to "Film, Anime & Manga Tracker".

## [1.0.0] - 2026-09-02

### Added

- Film and director notes from TMDB, with a poster beside the properties.
- Connections and Filmography panels.
- Relinking of directors and genres.
- Import from Letterboxd.

[Unreleased]: https://github.com/yunuskarasu/obsidian-film-tracker/compare/2.2.0...HEAD
[2.2.0]: https://github.com/yunuskarasu/obsidian-film-tracker/compare/2.1.0...2.2.0
[2.1.0]: https://github.com/yunuskarasu/obsidian-film-tracker/compare/2.0.1...2.1.0
[2.0.1]: https://github.com/yunuskarasu/obsidian-film-tracker/compare/v2.0.0...2.0.1
[2.0.0]: https://github.com/yunuskarasu/obsidian-film-tracker/compare/1.0.0...v2.0.0
[1.0.0]: https://github.com/yunuskarasu/obsidian-film-tracker/releases/tag/1.0.0
