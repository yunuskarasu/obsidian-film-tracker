# Film + Anime-Manga Tracker

Add films, anime and manga to your Obsidian vault as notes with metadata and a poster.

Search for a film, pick it from the list, and Film + Anime-Manga Tracker creates a note containing exactly two things: a frontmatter block with the film's metadata, and the poster. Nothing else. No rating, no review section, no template. What you write in the note is up to you.

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

## Tips for a smooth start

A handful of mistakes account for most of the confusion new users hit:

- **Everyone needs their own TMDB API key.** It isn't bundled with the plugin and can't be shared — each person pastes their own free key into settings (see [Setup](#setup)). Without it, search silently returns nothing.
- **Set `watch_date` to a Date property once.** Fresh out of the box it's plain text, so sorting by date won't work until you do the one-time [type change](#make-watch_date-a-date-property) on any note. Obsidian remembers it vault-wide after that.
- **Don't set Film folder / Director folder after you've already added notes elsewhere.** Duplicate detection (by `tmdb_id`) only looks inside the currently configured folder, so changing the folder path mid-use can let the same film get added twice — pick your folders early, or move existing notes into the new folder yourself before continuing.
- **Turning on Add cast / Add composers later doesn't back-fill old notes.** Those settings only apply going forward. Run **Refresh metadata from TMDB** on a note to pull in fields you enabled after creating it.
- **Never delete or hand-edit `tmdb_id`.** It's the only thing Film + Anime-Manga Tracker uses to recognize "this note already exists" and to know what to refresh — renaming the file itself is safe, but losing `tmdb_id` isn't.
- **Picking from search:** when a title has several versions (remakes, franchises), check the year shown next to each result before choosing — titles alone are often ambiguous.
- **Letterboxd import runs once per file.** Films already in your vault (matched by `tmdb_id`) are skipped rather than duplicated, so re-running the same export after adding more notes by hand is safe — it only fills gaps.
- **A blank poster/photo isn't necessarily a bug.** Some TMDB entries genuinely have no image; the note is still created with full metadata either way.
- **Anime and manga only merge into one note when you open the right note first.** There's no automatic matching — if you want a Series note with both, add one half, keep that note open, then run the other **Add** command (see [Anime and manga](#anime-and-manga)).
- **Never delete or hand-edit `mal_id`, or the `manga` block's `mal_id`.** Same rule as `tmdb_id`: they're what Film + Anime-Manga Tracker uses to recognize a note and know what to refresh.

## Usage

Run **Add film** from the command palette, or click the film icon in the ribbon and pick **Add film**. Type at least two characters, pick the right film, and the note is created and opened.

Search works in any language: typing `Amelie`, `Amélie`, or `Le Fabuleux Destin d'Amélie Poulain` all find the same film.

Directors work the same way: run **Add director**, or click the ribbon icon and pick **Add director**. The note gets the director's name, birthday, place of birth and a photo — nothing else, same philosophy as a film note.

Anime and manga work the same way too: run **Add anime** or **Add manga**, search MyAnimeList, pick a result. See [Anime and manga](#anime-and-manga) for how the two combine into one Series note.

Mangaka work a little differently: open the manga or Series note whose author you want to add, then run **Add mangaka** — it reads that note's own manga metadata to find the author on MyAnimeList directly, rather than opening a search box. One credited author adds straight away; more than one shows a quick pick list. See [Anime and manga](#anime-and-manga) for the MANGAGRAPHY panel it unlocks.

### Commands

| Command | What it does |
| --- | --- |
| **Add film** | Search TMDB and create the note. |
| **Add director** | Search TMDB for a person and create a director note: name, birthday, place of birth and a photo. |
| **Add anime** | Search MyAnimeList and create (or merge into) a Series note. |
| **Add manga** | Search MyAnimeList and create (or merge into) a Series note. |
| **Add mangaka** | Reads the active manga/Series note's credited author(s) from MyAnimeList and creates (or updates) their note. Requires a manga or Series note to be open — see [Anime and manga](#anime-and-manga). |
| **Refresh metadata from TMDB** | Re-fetch the film or director and rewrite only the fields the plugin owns. Your `watch_date`, your body text and any property you added are left exactly as they were. Only appears on film or director notes. |
| **Refresh anime/manga metadata from MAL** | Re-fetches whichever side(s) the note has and rewrites only the fields the plugin owns. `watched`, `read`, your body text and any property you added are left exactly as they were. On a mangaka note, refreshes their name, birthday and photo instead. Only appears on anime, manga or mangaka notes. |
| **Relink directors and genres** | Turn plain names into `[[wikilinks]]` wherever a note by that name now exists. No network calls, so it runs in a second. |
| **Import from Letterboxd** | Bulk-create notes from a Letterboxd export. See below. |

## Importing from Letterboxd

1. On Letterboxd, go to **Settings → Import & Export → Export your data**, and unzip the download.
2. Drag `diary.csv` into your vault (or `watched.csv` if you only want the list of films without watch dates).
3. Run **Import from Letterboxd** from the command palette, or use the button in settings, and pick that file.
4. Film + Anime-Manga Tracker searches TMDB for each entry and creates a note for anything not already in your vault — the same note, with the same two things, as adding a film by hand.

From `diary.csv`, the **Watched Date** column fills in `watch_date` on notes it creates. Nothing else from the export is imported: **Rating**, **Tags** and **Rewatch** are your own commentary, not the plugin's, so they are never read.

A film already in your vault (matched by `tmdb_id`) is skipped rather than duplicated; if it has no `watch_date` yet, the import fills that in from the diary entry. When a title in the CSV has no confident TMDB match, it is left out and listed, with the reason, in a **Film + Anime-Manga Tracker Import Report** note created at the end.

## What gets written

```yaml
---
title: Amélie
original_title: Le Fabuleux Destin d'Amélie Poulain
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
- `watch_date` is left empty on purpose. Film + Anime-Manga Tracker never fills it in — it is yours to complete when you have seen the film.
- `watched` is a plain checkbox, separate from `watch_date`, for exactly the "I know I've seen it but don't remember when" case. Film + Anime-Manga Tracker never touches it after creation — tick or untick freely, it's yours.

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

`original_name` is a best-effort guess: TMDB doesn't tag alternate names by language, so Film + Anime-Manga Tracker infers the director's native writing system from `place_of_birth` (Russia → Cyrillic, Japan → Japanese, China → Chinese, and similarly for Korean, Arabic, Hebrew, Greek and Thai) and picks the first alternate name written in it. `aliases` then holds just `name` and `original_name` — not TMDB's full, noisy list of transliterations. For a director from a Latin-script country (France, Poland, Germany, …), or when nothing matches, `original_name` is left empty for you to fill in by hand, the same way `watch_date` is.

### Anime notes

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
poster: "[[Attachments/Hunter x Hunter.jpg]]"
mal_id: 11061
watched: false
---
```

Same philosophy as a film note: structured metadata and a poster, nothing else. `watched` is a plain checkbox Film + Anime-Manga Tracker sets once and never touches again — same role as a film's `watched`.

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
| TMDB API key | empty | Your personal key. Required. |
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
| Show connections | on | Below a film's properties, list other films in your vault that share a director, composer or cast member. |
| Show filmography | on | Below a director's properties, list their films in your vault, linked directly. |
| MyAnimeList client ID | empty | Your personal client ID. Required for Add anime / Add manga. |
| Anime/manga folder | `Anime` | Where notes are created. Shared by both, since a Series note can hold either or both. Empty means the vault root. |
| Anime/manga poster folder | empty | Where anime and manga posters are saved (as two separate files). Empty follows your normal attachment folder setting. |
| Mangaka folder | `Mangaka` | Where mangaka notes are created. Kept separate from the anime/manga folder, the same way directors have their own folder apart from films. Empty means the vault root. |
| Mangaka photo folder | empty | Where mangaka photos are saved. Empty follows your normal attachment folder setting. |

## Behaviour worth knowing

- **Duplicates.** If a note with the same `tmdb_id` already exists in the relevant folder (Film folder for films, Director folder for directors), Film + Anime-Manga Tracker opens it instead of creating a second one. It never overwrites a note you have written in.
- **Missing posters.** If TMDB has no poster or photo, or the download fails, the note is still created with its metadata. The image is never worth losing the note over.
- **File names.** Film notes are named `English Title (Year).md`; director notes are named after the person. Characters that are illegal in file names or that break wikilinks are removed, so `Face/Off` becomes `Face Off (1997)`.
- **Layout.** In a note that has a `tmdb_id` or `mal_id` and a poster, the title and properties sit in a left column with the poster beside them, in both live preview and reading view. The poster is drawn from the `poster` property rather than embedded in the body, so the body stays empty and entirely yours. Narrow windows and mobile stack it vertically. To change the poster size, override `--film-tracker-poster-width` in a CSS snippet.
- **Anime duplicates.** Same rule as film duplicates, matched by `mal_id` inside the Anime/manga folder.
- **Manga duplicates.** Matched by the manga side's own MAL id, wherever it's currently stored (a fresh note, or nested inside an existing Series note next to an anime side).
- **Mangaka duplicates.** Same rule as film duplicates, matched by `mal_id` inside the Mangaka folder — kept separate from the Anime/manga folder so an anime's id and a mangaka's id (different MyAnimeList id spaces) never get mismatched for one another.
- **Anime and manga never merge automatically.** MyAnimeList's own anime↔manga relation data turned out to be unreliable via the official API (empty even for very well-known pairs), so merging is manual: open the note that already has one side, then run **Add anime** or **Add manga** for the other — see [Anime and manga](#anime-and-manga).

## Films as part of your vault

The point of keeping films as notes rather than rows in an app is that they can connect to everything else you write.

With **Link directors** on, a film's `directors` are written as links:

```yaml
directors:
  - "[[Damien Chazelle]]"
```

Open `Damien Chazelle` and every one of their films is waiting in the backlinks pane — no query, no configuration. The graph grows director clusters on its own.

Links are only written when a note by that name already exists, so your vault never fills up with links to notes you did not want. When you *do* write a note about a director later, run **Relink directors and genres** and the films you added earlier catch up (this also relinks cast and composers, when those settings are on).

Turn on **Add cast** and **Link cast** and the same thing happens for actors — open an actor's note and every film of theirs in your vault is in the backlinks pane. **Add composers**/**Link composers** does the same for the score composer.

### Connections

Below a film's properties (and poster, if it has one), Film + Anime-Manga Tracker shows other films in your vault that share a director, a composer or a cast member — with the shared name next to each one. This works whether or not **Link cast**/**Link directors**/**Link composers** are on: it compares the names directly, not the links. Genres are deliberately left out — two films both being "Drama" is not a connection.

This panel is rendered, not written to the note — it appears and disappears as your vault changes, and never touches the file.

### Filmography

A director note gets the same panel, labeled **Filmography** instead: every film in your vault whose `directors` credits that person — matched against `name` and `aliases` (so both the English and native-language spelling work), oldest first, linked directly. Like Connections, it is rendered rather than written to the note, and a note only ever shows one or the other, never both.

The heading also shows what share of those films have `watched` ticked, e.g. "FILMOGRAPHY · 90% watched" — computed from the films already in your vault, not TMDB's full catalog for that director, and equally rendered-only: nothing is written to the director note.

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

## Anime and manga

An anime and a manga of the same series don't have to live in two separate notes. **Add anime** and **Add manga** are independent — either can come first — but when you want them combined, open the note that already has one side and run the other command: it merges into that note instead of creating a new one. There's no automatic matching (MyAnimeList's own anime↔manga relation data turned out to be empty via the official API even for very well-known pairs, so guessing was dropped in favor of this simple, explicit rule).

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
poster: "[[Attachments/Hunter x Hunter.jpg]]"
mal_id: 11061
watched: false
manga:
  mal_id: 26
  title: Hunter x Hunter
  media_type: manga
  status: currently_publishing
  year: 1998
  chapters: 400
  volumes: 37
  mangaka:
    - "[[Yoshihiro Togashi]]"
  poster: "[[Attachments/Hunter x Hunter (Manga).jpg]]"
  read: false
---
```

The properties above `manga:` are the anime side — same fields, same rules as any [anime note](#anime-notes). `watched` (anime) and `manga.read` are independent: watching the anime never touches `read`, and finishing the manga never touches `watched`.

### The MANGA panel

Obsidian's Properties view has no widget for a nested value like `manga:` — it would otherwise show up as a single property rendered as raw, unreadable JSON. Film + Anime-Manga Tracker hides that one row instead (only on notes that actually have a `manga` block — a `manga` property you've added yourself on some unrelated note is never touched) and shows the same data properly below the properties, in its own collapsible **MANGA** panel: title, media type, status, chapters, volumes, mangaka (linked, same as directors — see below), the manga's own poster, and a **Read** checkbox.

That Read checkbox is the one place in Film + Anime-Manga Tracker that writes to the note from a rendered panel rather than through Properties directly — ticking it flips `manga.read` and nothing else. Refreshing never touches it, the same guarantee `watched` and a film's `watch_date` already have.

Since a Series note can have its own top-level `poster` (the anime's) and a separate `manga.poster`, both are downloaded and kept independently — refreshing one side never overwrites the other's poster, or a poster that's already saved.

The panel also carries **Change manga** and **Remove manga**, for when the wrong manga ended up on a note. **Change manga** opens the same search box **Add manga** uses and swaps in whatever you pick, poster included; **Remove manga** drops the manga side entirely. Both edit only the `manga:` block — the note is never recreated, so the anime side, its poster, `watched`, your own properties and the body are all left exactly as they are. Since the old `manga.read` and any sub-field you hand-added under `manga` described a different work, they don't survive the change.

**Change manga** is also how you attach one manga to a second anime adaptation. **Add manga** won't do it: a manga MyAnimeList id that already sits on some Series note counts as a duplicate, so running **Add manga** for it again just opens that first note ("Already in your vault") rather than linking it a second time — the plugin never copies the same manga record into a second note. When you do want two adaptations pointing at the same manga (a remake, say), open the second anime's Series note, run **Add manga** for any manga at all as a placeholder, then use **Change manga** to swap it for the one you actually wanted. **Change manga** touches nothing but the `manga:` block, so the second note's anime side, poster, `watched` and body come through untouched.

### The MANGAGRAPHY panel

Run **Add mangaka** with a manga or Series note open and it reads that note's own manga metadata to find the credited author(s) on MyAnimeList — there's no search box, since MyAnimeList has no way to search for a person by name. One author adds them straight away; more than one shows a quick pick list to choose from. The resulting note lives in the Mangaka folder, with the same two-column poster layout as a film or director note.

That mangaka note's properties get a **MANGAGRAPHY** panel — the mangaka equivalent of [Filmography](#filmography): every manga in your vault credited to that person, linked directly, oldest first, matched against their `name` (MyAnimeList gives no alternate-name equivalent to a director's `aliases` to widen the match with). The heading shows what share of those are marked `read`, e.g. "MANGAGRAPHY · 60% read" — computed the same rendered-only way Filmography's `% watched` is. Clicking a manga in the list goes straight to that manga's own note, wherever it currently lives — a manga-only note, or a Series note it's merged into — never a separate or duplicate note.

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
