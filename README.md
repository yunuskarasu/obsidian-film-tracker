# Film + Anime-Manga Tracker

Add films, TV series, anime and manga to your Obsidian vault as notes with metadata and a poster.

Search for a film, pick it from the list, and Film + Anime-Manga Tracker creates a note containing exactly two things: a frontmatter block with the film's metadata, and the poster. Nothing else. No rating, no review section, no template. What you write in the note is up to you.

TV series work the same way, also from TMDB: one note per show, with its seasons kept in the note itself and a SEASONS panel to tick them off as you watch. See [TV series](#tv-series).

Anime and manga follow the same philosophy, sourced from MyAnimeList. The two even share a single note when they're the same series: search for either half and Film + Anime-Manga Tracker creates or merges into one **Series note**, with a separate panel below the properties for the manga side. See [Anime and manga](#anime-and-manga) for details.

## Design philosophy

This plugin is not meant to turn your vault into a Wikipedia.

It's a personal tracker, not a database. It automates the parts that are just busywork — metadata, posters, connecting a film to its director or a manga to its author — so you don't have to type them in by hand or go hunting for a poster image every time. It has no interest in being a complete encyclopedia of everything you've ever watched or read.

The goal is narrower than that: keep a record of what you've seen, link the people and works behind it, and leave the rest of the note empty. Metadata is scaffolding, not content — it's there to support your own thoughts, not replace them. The note's body is where those actually live, and the plugin never touches it.

## Installing

Film + Anime-Manga Tracker is available in the Obsidian Community Plugins.

1. Open **Settings → Community plugins**.
2. Click **Browse** and search for **Film + Anime-Manga Tracker**.
3. Click **Install**.
4. Enable **Film + Anime-Manga Tracker** under Community plugins.

### Updating

Obsidian will notify you when a new version is available.

## Setup

1. Create a free TMDB account and open [your API settings](https://www.themoviedb.org/settings/api).
2. Copy the **API Key (v3 auth)** value — the short one, not the long read access token.
3. Paste it into **Settings → Film + Anime-Manga Tracker → TMDB API key**. Every user needs their own key — it's free and takes a minute.

For anime and manga, register a free app in your [MyAnimeList API config](https://myanimelist.net/apiconfig) and paste its **Client ID** into **Settings → Film + Anime-Manga Tracker → MyAnimeList client ID**. No OAuth, no redirect URI to configure — search and metadata only need the client ID.

On Obsidian 1.11.4 or later, both go into Obsidian's keychain instead of the plugin's settings file: next to **TMDB API key** and **MyAnimeList client ID**, add a new secret and paste the value into it, or pick one you already have. The keychain keeps them out of the vault — and out of anything that syncs or backs it up — but it's kept per device, so on a second device you add them there once too. Keys typed into an earlier version move to the keychain on their own the first time the plugin loads. On older versions of Obsidian, the keys are typed in and saved with the other settings, as before.

## Tips for a smooth start

A handful of mistakes account for most of the confusion new users hit:

- **Everyone needs their own TMDB API key.** It isn't bundled with the plugin and can't be shared — each person pastes their own free key into settings (see [Setup](#setup)). Without it, the TMDB commands (Add film, Add director, Refresh metadata from TMDB, Import from Letterboxd) don't run — each shows a notice pointing you to settings instead.
- **Set `watch_date` to a Date property once.** Fresh out of the box it's plain text, so sorting by date won't work until you do the one-time [type change](#make-watch_date-a-date-property) on any note. Obsidian remembers it vault-wide after that.
- **Folders only decide where new notes go.** Film + Anime-Manga Tracker recognizes a note by its properties, not by its folder, so moving notes around, changing a folder setting later, or leaving a folder empty (the vault root) is safe — duplicates are still caught, and a director is never mistaken for a film.
- **Turning on Add cast / Add composers later doesn't back-fill old notes.** Those settings only apply going forward. Run **Refresh metadata from TMDB** on a note to pull in fields you enabled after creating it.
- **Never delete or hand-edit `tmdb_id`.** It's the only thing Film + Anime-Manga Tracker uses to recognize "this note already exists" and to know what to refresh — renaming the file itself is safe, but losing `tmdb_id` isn't.
- **Picking from search:** when a title has several versions (remakes, franchises), check the year shown next to each result before choosing — titles alone are often ambiguous.
- **Letterboxd import runs once per file.** Films already in your vault (matched by `tmdb_id`) are skipped rather than duplicated, so re-running the same export after adding more notes by hand is safe — it only fills gaps: a missing `watch_date`, and `watched` if you choose to mark the films as watched.
- **A blank poster/photo isn't necessarily a bug.** Some TMDB entries genuinely have no image; the note is still created with full metadata either way.
- **Anime and manga only merge into one note when you open the right note first.** There's no automatic matching — if you want a Series note with both, add one half, keep that note open in the editor, run the other **Add** command and confirm **Link to this note** (see [Anime and manga](#anime-and-manga)).
- **Never delete or hand-edit `mal_id`, or the `manga` block's `mal_id`.** Same rule as `tmdb_id`: they're what Film + Anime-Manga Tracker uses to recognize a note and know what to refresh.

## Usage

Run **Add film** from the command palette, or click the film icon in the ribbon and pick **Add film**. Type at least two characters, pick the right film, and the note is created and opened.

Search works in any language: typing `Amelie`, `Amélie`, or `Le Fabuleux Destin d'Amélie Poulain` all find the same film.

TV series work the same way: run **Add TV series**, search, and pick the show. The note holds the whole series — every season that has aired, with its own episode count — so there is nothing to pick twice and nothing to keep in step by hand. See [TV series](#tv-series).

Directors work the same way: run **Add director**, or click the ribbon icon and pick **Add director**. The note gets the director's name, birthday, place of birth and a photo — nothing else, same philosophy as a film note.

Anime and manga work the same way too: run **Add anime** or **Add manga**, search MyAnimeList, pick a result. Each result shows its type and year next to the title (TV, Movie, Manga, Light novel…), since MyAnimeList often has several entries sharing one title. See [Anime and manga](#anime-and-manga) for how the two combine into one Series note.

Mangaka work a little differently: open the manga or Series note whose author you want to add, then run **Add mangaka** — it reads that note's own manga metadata to find the author on MyAnimeList directly, rather than opening a search box. One credited author adds straight away; more than one shows a quick pick list. See [Anime and manga](#anime-and-manga) for the MANGAGRAPHY panel it unlocks.

### Commands

| Command | What it does |
| --- | --- |
| **Add film** | Search TMDB and create the note. |
| **Add TV series** | Search TMDB and create the note, with a line for each season that has aired. See [TV series](#tv-series). |
| **Add director** | Search TMDB for a person and create a director note: name, birthday, place of birth and a photo. |
| **Add anime** | Search MyAnimeList and create a Series note — or, after asking, link into the manga-only note open in the editor. |
| **Add manga** | Search MyAnimeList and create a Series note — or, after asking, link into the note open in the editor, whether that is an anime note with no manga or a TV series note. |
| **Add mangaka** | Reads the active manga/Series note's credited author(s) from MyAnimeList and creates (or updates) their note. Requires a manga or Series note to be open — see [Anime and manga](#anime-and-manga). |
| **Refresh metadata from TMDB** | Re-fetch the film, TV series or director and rewrite only the fields the plugin owns. On a TV series it brings in seasons that have started since, and new episodes of the season you are on, without touching what you have watched. Your `watch_date`, your body text, any property you added, any alias you added, any link already in a list (a director, a genre) and any comment above the first property are left exactly as they were. Only appears on film or director notes. |
| **Refresh anime/manga metadata from MAL** | On a TV series note, refreshes its manga side. Otherwise re-fetches whichever side(s) the note has and rewrites only the fields the plugin owns. `watched`, `read`, your body text, any property you added, any link already in a list (a genre, a studio, a mangaka) and any comment above the first property are left exactly as they were. On a mangaka note, refreshes their name, birthday and photo instead. Only appears on anime, manga or mangaka notes. |
| **Mark as watched today** | Ticks `watched` on the film, TV or anime note you have open and writes today into `watch_date`. A date already there is kept — the day you first saw it. On a TV series it also fills in every season that has aired. Only appears on film, TV and anime notes. Also a **Watched today** button under the poster, and an entry on the note's right-click menu. |
| **Mark manga as read today** | The manga side of the same thing: `read`, `read_date` and the full chapter count, on every note carrying that manga. Only appears on notes with a manga side. |
| **Watch one more episode** | `episodes_watched` up by one. On a TV series it counts into the earliest season with something left, and the SEASONS panel has a **+1** for each season on its own. The last episode also ticks `watched` and dates it — on a TV series only once the show has ended. Only appears on TV and anime notes. Also a **+1 episode** button under the poster. |
| **Read one more chapter** | `chapters_read` up by one, on every note carrying that manga. The last chapter also ticks `read`. Only appears on notes with a manga side. Also a **+1 chapter** button on the MANGA panel. |
| **Remove anime** | Takes the anime off a Series note: its own properties and nothing else. The manga side, every property you added and the whole body stay as they are, and a poster no other note uses can be deleted along with it. Only appears on notes with an anime. Also on the note's right-click menu. |
| **Relink directors and genres** | Turn plain names into `[[wikilinks]]` wherever a note by that name now exists, on film and TV series notes — a show's creators follow the **Link directors** setting. No network calls, so it runs in a second. |
| **Import from Letterboxd** | Bulk-create notes from a Letterboxd export. See below. |
| **Import from MyAnimeList** | Bulk-create notes from a public MyAnimeList list, marking what you have completed. See below. |

## Importing from Letterboxd

1. On Letterboxd, go to **Settings → Import & Export → Export your data**, and unzip the download.
2. Drag `diary.csv` into your vault (or `watched.csv` if you only want the list of films without watch dates).
3. Run **Import from Letterboxd** from the command palette, or use the button in settings, and pick that file.
4. Choose whether to **mark these films as watched**. It starts on for `diary.csv`, `watched.csv`, `ratings.csv` and `reviews.csv`, which only list films you've seen, and off for anything else — `watchlist.csv` has exactly the same columns as `watched.csv`, so its name is the only way to tell them apart.
5. Film + Anime-Manga Tracker searches TMDB for each entry and creates a note for anything not already in your vault — the same note, with the same two things, as adding a film by hand.

From `diary.csv`, the **Watched Date** column fills in `watch_date` on notes it creates. Nothing else from the export is imported: **Rating**, **Tags** and **Rewatch** are your own commentary, not the plugin's, so they are never read.

A film already in your vault (matched by `tmdb_id`) is skipped rather than duplicated; if it has no `watch_date` yet, the import fills that in from the diary entry, and with **mark these films as watched** on it ticks `watched` (it never unticks it). Letterboxd and TMDB sometimes put a film a year apart, so a result within a year of the export's year still counts. When a title in the CSV has no TMDB match that close, it is left out rather than guessed and listed, with the reason, in a **Film + Anime-Manga Tracker Import Report** note created at the end.

Closing the progress window, with Esc or its close button, stops the import the same way **Cancel** does; what was imported by then stays. Only one import runs at a time: starting a second while one is running just tells you so.

## Importing from MyAnimeList

1. Run **Import from MyAnimeList**, or use the button in settings.
2. Type the MyAnimeList username whose list to read — your own, usually.
3. Choose the anime list, the manga list, or both, and which shelves to take: **Completed** and **Watching or reading** to start with, and **On hold**, **Dropped** and **Plan to watch or read** if you want them too.
4. Film + Anime-Manga Tracker reads the list a hundred entries at a time and writes a note for each one, with its poster.

What you have **completed** arrives ticked: an anime as `watched`, a manga as `read` — and `read` is set on every note carrying that manga, the way the Read checkbox does. Anything already in your vault is recognized by its MyAnimeList id, wherever its note lives, and is never written a second time; a completed entry whose note isn't ticked yet gets ticked, and nothing is ever unticked.

Nothing is matched by title, so there is no guessing. What can still go wrong is a name: when a note of your own already has the name an entry would take, that entry is left out and listed in the **Film + Anime-Manga Tracker Import Report** note written at the end. Closing the progress window stops the import, the same as **Cancel**, and only one import runs at a time.

The list has to be public. That's a MyAnimeList setting (**Account settings → My List → List visibility**), not something the plugin can change: MyAnimeList only shares a private list with the account that owns it, which would need signing in.

## What gets written

```yaml
---
title: Amélie
original_title: Le Fabuleux Destin d'Amélie Poulain
aliases:
  - Amélie
  - Le Fabuleux Destin d'Amélie Poulain
year: 2001
directors:
  - Jean-Pierre Jeunet
genres:
  - Comedy
  - Romance
runtime: 122
poster: "[[Attachments/Amélie (2001).jpg]]"
tmdb_id: 194
watch_date:
watched: false
---
```

`cast` and `composers` are optional and off by default — turn them on in settings to have them written too.

That is the whole file. The body is left empty: the poster is rendered from the `poster` property, beside the properties, so everything below the top of the note is yours.

- `title` is the English title. When TMDB has no English translation for a film, it falls back to the original title.
- `original_title` is always the title in the film's own language.
- `aliases` holds the title and the original title, so either one finds the note in search and link suggestions. Add your own aliases freely: a refresh only replaces the ones it wrote.
- `watch_date` is left empty on purpose. Film + Anime-Manga Tracker never fills it in — it is yours to complete when you have seen the film.
- `watched` is a plain checkbox, separate from `watch_date`, for exactly the "I know I've seen it but don't remember when" case. Film + Anime-Manga Tracker never touches it after creation — tick or untick freely, it's yours. The one exception is the [Letterboxd import](#importing-from-letterboxd), which can tick it (never untick it) for films your export says you've seen.

### Director notes

```yaml
---
name: Andrei Tarkovsky
original_name: Андрей Арсеньевич Тарковский
aliases:
  - Andrei Tarkovsky
  - Андрей Арсеньевич Тарковский
birthday: 1932-04-04
deathday: 1986-12-29
place_of_birth: Zavrazhye, USSR
poster: "[[Directors/Andrei Tarkovsky.jpg]]"
tmdb_id: 8452
---
```

Same philosophy as a film note: structured data and a photo, nothing else. The photo is written to the `poster` property on purpose — Film + Anime-Manga Tracker's layout renders any note carrying `tmdb_id` and `poster` beside its properties, so a director note gets the exact same two-column layout as a film note for free.

`original_name` is a best-effort guess: TMDB doesn't tag alternate names by language, so Film + Anime-Manga Tracker infers the director's native writing system from `place_of_birth` (Russia → Cyrillic, Japan → Japanese, China → Chinese, and similarly for Korean, Arabic, Hebrew, Greek and Thai) and picks the first alternate name written in it. `aliases` then holds just `name` and `original_name` — not TMDB's full, noisy list of transliterations — plus any alias you add yourself, which a refresh keeps. For a director from a Latin-script country (France, Poland, Germany, …), or when nothing matches, `original_name` is left empty for you to fill in by hand, the same way `watch_date` is.

### Anime notes

```yaml
---
title: Hunter x Hunter
english_title: Hunter x Hunter
japanese_title: ハンター×ハンター
media_type: tv
episodes: 148
episodes_watched: 148
genres:
  - Action
  - Adventure
studios:
  - Madhouse
status: finished_airing
year: 2011
end_year: 2014
poster: "[[Attachments/Hunter x Hunter.jpg]]"
mal_id: 11061
watch_start:
watch_date: 2026-04-02
watched: true
---
```

Same philosophy as a film note: structured metadata and a poster, nothing else. `watched` is a plain checkbox Film + Anime-Manga Tracker sets once and never touches again — same role as a film's `watched`.

`episodes_watched` and `watch_date` are yours: **Watch one more episode** counts up, **Mark as watched today** fills both in, and a refresh from MyAnimeList never touches either. `watch_start` — the day you started — is yours alone: the plugin makes room for it and never writes it, since only you know when you began. The poster carries a small bar showing how far through the episodes you are, with **+1 episode** and **Watched today** under it; both disappear once there is nothing left to mark. All four commands are on the note's own menus too — right-click in the editor, the tab's menu, or the file explorer.

`year` and `end_year` are the years it started and finished, as MyAnimeList has them. Something still running has no `end_year`, and neither has anything MyAnimeList never gave an end date. Both are years rather than full dates: MyAnimeList often knows only the year for older works.

When the same note also has a manga side, its metadata lives in a single nested `manga` property instead of being mixed into the fields above — see [Anime and manga](#anime-and-manga) for why, and for the panel that actually shows it.

### Mangaka notes

```yaml
---
name: Yoshihiro Togashi
birthday: 1966-04-27
poster: "[[Mangaka/Yoshihiro Togashi.jpg]]"
mal_id: 1893
---
```

Same philosophy as a director note, with a smaller field set: MyAnimeList's person data only ever gives a name, a birthday and a photo — there's no equivalent of a director's `original_name`, `aliases`, `deathday` or `place_of_birth` to carry. See [Anime and manga](#anime-and-manga) for how this note gets created and the MANGAGRAPHY panel it comes with.

### Make `watch_date` a date property

The first time you add a film, open the note's properties, click the type icon next to `watch_date` and choose **Date**. Obsidian remembers the type for that property across your whole vault, so you only do this once.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| TMDB API key | empty | Your personal key. Required. On Obsidian 1.11.4 or later, kept in Obsidian's keychain on each device (see [Setup](#setup)). |
| Film folder | `Films` | Where notes are created. Empty means the vault root. |
| Poster folder | empty | Where posters are saved. Empty follows your normal attachment folder setting. |
| Director folder | `Directors` | Where director notes are created. Empty means the vault root. |
| Director photo folder | empty | Where director photos are saved. Empty follows your normal attachment folder setting. |
| Link directors | on | Write directors as wikilinks when a note by that name exists. |
| Link genres | off | The same for genres. Off by default: genre notes turn into very busy hubs. |
| Add cast | off | Write a `cast` property with the film's top-billed actors. |
| Cast count | 5 | How many top-billed actors to include. Only used when Add cast is on. |
| Link cast | off | The same wikilink behaviour, for cast. |
| Add composers | off | Write a `composers` property with the film's original score composer. |
| Link composers | off | The same wikilink behaviour, for composers. |
| Link creators | on | Write a series' creators as wikilinks when a note by that name exists. A series' own setting, apart from **Link directors**. |
| Link genres (TV series) | off | The same for a series' genres. |
| Add cast (TV series) | off | Write a `cast` property with the series' top-billed actors, across every season. |
| Cast count (TV series) | 5 | How many of them. Only used when its **Add cast** is on. |
| Link cast (TV series) | off | The same wikilink behaviour, for a series' cast. |
| Show connections | on | Below a film's or TV series' properties, list other films and series in your vault that share a director, creator, composer or cast member. |
| Show filmography | on | Below a person's properties, list their films in your vault, linked directly. |
| Show seasons | on | Below a TV series' properties, list its seasons with a checkbox and a bar for each. |
| Show TV series | on | Below a person's properties, list the series they created, under the filmography. |
| TV series folder | `TV` | Where TV series notes are created. Empty means the vault root. |
| TV series poster folder | empty | Where TV series posters are saved. Empty follows your normal attachment folder setting. |
| MyAnimeList client ID | empty | Your personal client ID. Required for Add anime / Add manga. On Obsidian 1.11.4 or later, kept in Obsidian's keychain like the TMDB key. |
| Anime/manga folder | `Anime` | Where notes are created. Shared by both, since a Series note can hold either or both. Empty means the vault root. |
| Anime/manga poster folder | empty | Where anime and manga posters are saved (as two separate files). Empty follows your normal attachment folder setting. |
| Mangaka folder | `Mangaka` | Where mangaka notes are created. Kept separate from the anime/manga folder, the same way directors have their own folder apart from films. Empty means the vault root. |
| Mangaka photo folder | empty | Where mangaka photos are saved. Empty follows your normal attachment folder setting. |

On Obsidian 1.13 or later these settings appear in Obsidian's own settings search, and each folder setting suggests the folders in your vault as you type. On earlier versions the plugin draws the same settings itself, with the same folder suggestions.

## Behaviour worth knowing

- **Duplicates.** If a film or director with the same `tmdb_id` already exists anywhere in your vault, Film + Anime-Manga Tracker opens it instead of creating a second one. It never overwrites a note you have written in.
- **How notes are recognized.** By their properties, never by their folder. A film's and a director's TMDB ids can be the same number, so they're told apart by what each note holds: a director note has `name`, a film has `directors`. That's what keeps a refresh from ever writing a film's data into a director note (or an anime's into a mangaka note), whatever your folder settings are.
- **Missing posters.** If TMDB has no poster or photo, or the download fails, the note is still created with its metadata. The image is never worth losing the note over.
- **File names.** Film notes are named `English Title (Year).md`; director notes are named after the person. Characters that are illegal in file names or that break wikilinks are removed, so `Face/Off` becomes `Face Off (1997)`. A title that already ends in its year — MyAnimeList writes remakes as `Hunter x Hunter (2011)` — keeps it once.
- **Same-named works.** When another of the plugin's notes already has the name a new note would get (two films with one title and year, a light novel and its manga), the new note takes the next free name: a manga-only note tries its title with the year added, and past that a number is added (`Home (2015) 2.md`). A note of your own under that name is never written beside — the plugin opens it and leaves both alone.
- **Layout.** In a note that has a `tmdb_id` or `mal_id` and a poster, the title and properties sit in a left column with the poster beside them, in both live preview and reading view. The poster is drawn from the `poster` property rather than embedded in the body, so the body stays empty and entirely yours. Narrow windows and mobile stack it vertically. To change the poster size, override `--film-tracker-poster-width` in a CSS snippet.
- **Poster links.** Posters and photos are always linked as `[[wikilinks]]`, even with Obsidian's **Use [[Wikilinks]]** setting turned off, since that's the link a property understands. Posters an earlier version wrote as Markdown links still show.
- **Anime duplicates.** Same rule as film duplicates, matched by `mal_id` anywhere in your vault.
- **Manga duplicates.** Matched by the manga side's own MAL id, wherever it's currently stored (a fresh note, or nested inside an existing Series note next to an anime side). This only stops a second *note of its own*: the same manga — or the same anime — can be linked into as many Series notes as it has adaptations (see [Adaptations](#adaptations)).
- **Mangaka duplicates.** Same rule as film duplicates, matched by `mal_id` anywhere in your vault. An anime's id and a mangaka's id (different MyAnimeList id spaces) can be the same number, so a mangaka note is told apart by its properties — `name`, and none of an anime's fields — never by its folder.
- **Anime and manga never merge automatically.** MyAnimeList's own anime↔manga relation data turned out to be unreliable via the official API (empty even for very well-known pairs), so merging is manual: open the note that already has one side, run **Add anime** or **Add manga** for the other, and confirm — see [Anime and manga](#anime-and-manga).

## Films as part of your vault

The point of keeping films as notes rather than rows in an app is that they can connect to everything else you write.

With **Link directors** on, a film's `directors` are written as links:

```yaml
directors:
  - "[[Damien Chazelle]]"
```

Open `Damien Chazelle` and every one of their films is waiting in the backlinks pane — no query, no configuration. The graph grows director clusters on its own.

Links are only written when a note by that name already exists, so your vault never fills up with links to notes you did not want. When you *do* write a note about a director later, run **Relink directors and genres** and the films you added earlier catch up (this also relinks cast and composers, when those settings are on).

A refresh never takes a link away. A name that's already linked in a note stays linked, written exactly as it was — even with its **Link** setting off, and even before its note exists — so a link you added by hand is safe.

Turn on **Add cast** and **Link cast** and the same thing happens for actors — open an actor's note and every film of theirs in your vault is in the backlinks pane. **Add composers**/**Link composers** does the same for the score composer.

### Connections

Below a film's or a TV series' properties (and poster, if it has one), Film + Anime-Manga Tracker shows other films and series in your vault that share a director, a creator, a composer or a cast member — with the shared name next to each one. A film and a series count as connected when the same person directed one and created the other. This works whether or not **Link cast**/**Link directors**/**Link composers** are on: it compares the names directly, not the links. Genres are deliberately left out — two films both being "Drama" is not a connection.

This panel is rendered, not written to the note — it appears and disappears as your vault changes, and never touches the file.

### Filmography

A person note gets the same panel, labeled **Filmography** instead: every film in your vault whose `directors` credits that person — matched against `name` and `aliases` (so both the English and native-language spelling work), oldest first, linked directly. Like Connections, it is rendered rather than written to the note.

Under it, **TV series** lists the series in your vault whose `creators` credits them, in a box of its own. Two lists rather than one, because a percentage over both would say nothing: a five-season series and a film are not the same unit.

Each heading shows what share of that list has `watched` ticked, e.g. "FILMOGRAPHY · 90% watched" — computed from what is already in your vault, not TMDB's full catalog for that person, and equally rendered-only: nothing is written to the note.

Every one of these panels can be turned off on its own in settings: **Show connections**, **Show filmography**, **Show TV series** and **Show seasons**.

### Queries worth keeping

Films you have not watched yet:

````markdown
```dataview
TABLE year, directors
FROM "Films"
WHERE !watch_date
SORT year DESC
```
````

Everything by one director, ordered by year:

````markdown
```dataview
TABLE year, runtime
FROM "Films"
WHERE contains(directors, this.file.link)
SORT year ASC
```
````

Put that second one in the director's own note and it fills itself in.

What you watched, most recent first:

````markdown
```dataview
TABLE watch_date, year
FROM "Films"
WHERE watch_date
SORT watch_date DESC
```
````

If you use **Bases** (Obsidian 1.9+), point a new base at the `Films` folder and set the card image to the `poster` property to get a poster wall.

## TV series

One note per show. The seasons live in the note, as a line each, and they are the only record of what you have watched: the counts above them are written from the seasons, never the other way round.

```yaml
---
title: Breaking Bad
original_title: Breaking Bad
aliases:
  - Breaking Bad
year: 2008
end_year: 2013
creators:
  - Vince Gilligan
genres:
  - Drama
  - Crime
networks:
  - AMC
status: Ended
episodes: 62
episodes_watched: 20
poster: "[[Breaking Bad (2008).jpg]]"
tmdb_tv_id: 1396
watch_start:
watch_date:
watched: false
seasons:
  - { season: 1, year: 2008, episodes: 7, watched: 7, watch_date: 2026-09-01 }
  - { season: 2, year: 2009, episodes: 13, watched: 13, watch_date: 2026-09-10 }
  - { season: 3, year: 2010, episodes: 13, watched: 0 }
  - { season: 4, year: 2011, episodes: 13, watched: 0 }
  - { season: 5, year: 2012, episodes: 16, watched: 0 }
---
```

- `episodes` counts what has **aired**, not what has been announced: a season listed with episodes still to come only counts the ones that are out.
- `episodes_watched` is the sum of the seasons, rewritten on every change. Edit the seasons, not this.
- `seasons` holds one line per season that has at least one episode out. Specials (TMDB's "season 0") are left out. A season name that says more than its number is kept ("Night Country").
- `watch_start` is left empty and never written to: a series is watched over weeks, and the day you started is yours to fill in. `watch_date` is the day you finished, written when the last episode of a show that has ended goes in — or when you say **Mark as watched today**.
- `creators`, `genres` and `cast` follow the **TV series** settings, not the film ones: a cast list that is right for a film is often not what you want on a series that ran for years.
- `tmdb_tv_id` is TMDB's id for the **show**. It is deliberately not `tmdb_id`: TMDB numbers films and shows separately, and the same number is usually both.
- `watched` is ticked for you only when a show that has **ended** is fully watched. A show still running never ticks itself off, however much of it you have seen — being caught up is not the same as being finished. **Mark as watched today** ticks it whenever you say so.

### The SEASONS panel

Below the properties, each season gets a row: a checkbox that ticks the whole season off (and dates it), a bar showing how far into it you are, and **+1** for one more episode. Unticking a season sets it back to nothing and takes the show's own tick off with it.

Under the poster, the bar reads where you are the way a viewer counts: "S3E6 · 25 / 62 episodes", with **+1 episode** and **Watched today** beside it. **+1 episode** goes into the earliest season with something left, so a show watched in order needs nothing else.

Obsidian has no widget for a list like `seasons`, so the raw property row is hidden on TV notes and the panel is the view of it. The data is untouched, and the note is still an ordinary Markdown file.

A TV note shows **Connections** as well, in its own box under the seasons: other films and series sharing a creator, a composer or a cast member. A show's creators are the same people, on the same notes, as a film's directors — **Add director** writes them, and they show up in that person's [Filmography](#filmography) under **TV series**.

### The manga a series adapts

A TV series note can hold a manga, the same block a Series note holds: open the series, run **Add manga**, and answer **Link to this note**. The manga side keeps everything it has elsewhere — the MANGA panel, the Read checkbox, **+1 chapter**, **Add mangaka**, and a refresh from MyAnimeList — while the episodes go on coming from TMDB, season by season.

That is what makes a long-running anime work well here: TMDB has its seasons in one place, MyAnimeList has its manga, and the note holds both. A note like that shows three boxes under its properties: **SEASONS**, **MANGA**, then **CONNECTIONS**.

**Refresh metadata from TMDB** rewrites the series; **Refresh anime/manga metadata from MAL** rewrites the manga. Neither touches the other's half.

### Anime on TMDB

TMDB lists anime among its TV shows, where a show is every season at once with its cast and crew; MyAnimeList has each season as an entry of its own, with the manga beside it. Every search result says which catalogue it came from, so the choice is between what the two give rather than between two names — and either way the manga can sit on the note (see above). If you add one anyway, and the work is already in your vault as an anime note, you are asked first — and the same question comes up the other way round, adding an anime the vault already has as a TV series. Neither is refused: the two are simply counted separately, from two catalogues that share no ids.

## Anime and manga

An anime and a manga of the same series don't have to live in two separate notes. **Add anime** and **Add manga** are independent — either can come first — but when you want them combined, open the note that already has one side in the editor and run the other command. Film + Anime-Manga Tracker asks **Link to this note?**: link it, or keep it as a separate note. Only the note in the active editor tab is ever offered — not one you looked at earlier while Graph view or a canvas has the focus. There's no automatic matching (MyAnimeList's own anime↔manga relation data turned out to be empty via the official API even for very well-known pairs, so guessing was dropped in favor of this simple, explicit rule).

A merged Series note looks like this:

```yaml
---
title: Hunter x Hunter
english_title: Hunter x Hunter
japanese_title: ハンター×ハンター
media_type: tv
episodes: 148
genres:
  - Action
  - Adventure
studios:
  - Madhouse
status: finished_airing
year: 2011
end_year: 2014
poster: "[[Attachments/Hunter x Hunter.jpg]]"
mal_id: 11061
watched: false
manga:
  mal_id: 26
  title: Hunter x Hunter
  media_type: manga
  status: currently_publishing
  year: 1998
  end_year:
  chapters: 400
  volumes: 37
  mangaka:
    - "[[Yoshihiro Togashi]]"
  poster: "[[Attachments/Hunter x Hunter (Manga).jpg]]"
  read: false
---
```

The properties above `manga:` are the anime side — same fields, same rules as any [anime note](#anime-notes). `watched` (anime) and `manga.read` are independent: watching the anime never touches `read`, and finishing the manga never touches `watched`. The manga side keeps its own `chapters_read` and `read_date`, written by **Read one more chapter** and **Mark manga as read today** and carried over by every refresh — the same way the anime side keeps `episodes_watched` and `watch_date`.

### The MANGA panel

Obsidian's Properties view has no widget for a nested value like `manga:` — it would otherwise show up as a single property rendered as raw, unreadable JSON. Film + Anime-Manga Tracker hides that one row instead (only on notes that actually have a `manga` block — a `manga` property you've added yourself on some unrelated note is never touched) and shows the same data properly below the properties, in its own collapsible **MANGA** panel: the title, a line with type, year and status ("Manga · 1998 · Currently publishing") followed by the volume and chapter counts when MyAnimeList has them, mangaka (linked, same as directors — see below), the manga's own poster, how far through the chapters you are, a **Read** checkbox and a **+1 chapter** button.

That Read checkbox is the one place in Film + Anime-Manga Tracker that writes to the note from a rendered panel rather than through Properties directly — ticking it sets `manga.read`, today's `manga.read_date` and the full `manga.chapters_read`, on every note that carries the same manga (see [Adaptations](#adaptations)). Refreshing never touches it, the same guarantee `watched` and a film's `watch_date` already have.

Since a Series note can have its own top-level `poster` (the anime's) and a separate `manga.poster`, both are downloaded and kept independently — refreshing one side never overwrites the other's poster, or a poster that's already saved.

The panel also carries **Change manga** and **Remove manga**, for when the wrong manga ended up on a note. **Change manga** opens the same search box **Add manga** uses and swaps in whatever you pick, poster included; **Remove manga** asks first, then drops the manga side entirely. Both edit only the `manga:` block — the note is never recreated, so the anime side, its poster, `watched`, your own properties and the body are all left exactly as they are. Since the old `manga.read` and any sub-field you hand-added under `manga` described a different work, they don't survive the change.

The old manga's poster file stays in your vault unless you say otherwise. When nothing else uses it any more — no other note shows it as a poster (another adaptation, say), links to it or embeds it — **Remove manga** offers to delete it along with the manga, and **Change manga** asks whether to delete it once the new manga is in. A deleted poster goes wherever Obsidian's **Deleted files** setting sends deleted files.

### Adaptations

One manga can have several anime — a remake (*Hunter x Hunter* 1999 and 2011), a second series, a film — and one anime can adapt more than one manga (*Cowboy Bebop* has two manga of its own). Each pairing gets a Series note of its own, so the same manga, or the same anime, can sit on several notes:

What happens to one of those notes happens to them all: reading a chapter, and watching an episode, are counted once and written to every note carrying that manga or that anime. **Add adaptation** pairs the work with the note it was run from, the same note **Add anime** and **Add manga** offer.

- **Add adaptation** on the MANGA panel pairs that note's manga with another anime in one step. The pairing goes on the note you ran it from when that note can take an anime; a note that already has one hands it to the anime's own anime-only note, or to a new Series note when there is none.
- The long way works too: with an anime-only note open, **Add manga** links a manga into it even when that manga is already on another note (and **Add anime** the same way into a manga-only note). The **Link to this note?** dialog tells you where else it already is.
- A work arriving on another note comes in step with the notes it's already on: the same poster file (never a second download), a manga already **Read** elsewhere arrives read, an anime already `watched` elsewhere arrives watched. From then on, **Read** is kept in step across every note carrying that manga; `watched` is an ordinary property of each note, yours to tick.
- A pairing only ever has one note: asking for the same anime and manga together again opens the note that already pairs them.
- **Add manga** or **Add anime** with no note of the right kind open still refuses a second note of its own for something already in your vault, and opens the existing one instead.

### The MANGAGRAPHY panel

Run **Add mangaka** with a manga or Series note open and it reads that note's own manga metadata to find the credited author(s) on MyAnimeList — there's no search box, since MyAnimeList has no way to search for a person by name. One author adds them straight away; more than one shows a quick pick list to choose from. The resulting note lives in the Mangaka folder, with the same two-column poster layout as a film or director note.

That mangaka note's properties get a **MANGAGRAPHY** panel — the mangaka equivalent of [Filmography](#filmography): every manga in your vault credited to that person, linked directly, oldest first, matched against their `name` (MyAnimeList gives no alternate-name equivalent to a director's `aliases` to widen the match with). The heading shows what share of those are marked `read`, e.g. "MANGAGRAPHY · 60% read" — computed the same rendered-only way Filmography's `% watched` is. Clicking a manga in the list goes straight to that manga's own note, wherever it currently lives — a manga-only note, or a Series note it's merged into. A manga on several Series notes (see [Adaptations](#adaptations)) is listed once, with the other notes linked after it ("also in …"), and counts once in the read percentage.

### Mangaka links

`mangaka` follows the exact same rule as a film's `directors` or `cast`: written as a plain name, and only turned into a `[[wikilink]]` once a note by that name already exists in your vault. Running **Add mangaka** creates that note and updates the manga side in the same step, so the wikilink appears immediately. If a mangaka note comes to exist some other way instead, run **Refresh anime/manga metadata from MAL** on the series afterwards to pick it up — **Relink directors and genres** is TMDB-only and doesn't touch anime/manga notes.

## Development

```bash
npm install
npm test      # file naming, YAML output, TMDB/MAL mapping, frontmatter rewriting
npm run lint  # includes the official eslint-plugin-obsidianmd rules
npm run dev   # esbuild watch
npm run build # typecheck + production bundle
```

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.

Anime and manga metadata and posters come from the [MyAnimeList API](https://myanimelist.net/apiconfig/references/api/v2).
