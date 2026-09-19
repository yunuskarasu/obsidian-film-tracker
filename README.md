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

Directors work the same way: run **Add director**, or click the ribbon icon and pick **Add director**. The note gets the director's name, birthday, place of birth and a photo — nothing else, same philosophy as a film note.

Anime and manga work the same way too: run **Add anime** or **Add manga**, search MyAnimeList, pick a result. Each result shows its type and year next to the title (TV, Movie, Manga, Light novel…), since MyAnimeList often has several entries sharing one title. See [Anime and manga](#anime-and-manga) for how the two combine into one Series note.

Mangaka work a little differently: open the manga or Series note whose author you want to add, then run **Add mangaka** — it reads that note's own manga metadata to find the author on MyAnimeList directly, rather than opening a search box. One credited author adds straight away; more than one shows a quick pick list. See [Anime and manga](#anime-and-manga) for the MANGAGRAPHY panel it unlocks.

### Commands

| Command | What it does |
| --- | --- |
| **Add film** | Search TMDB and create the note. |
| **Add director** | Search TMDB for a person and create a director note: name, birthday, place of birth and a photo. |
| **Add anime** | Search MyAnimeList and create a Series note — or, after asking, link into the manga-only note open in the editor. |
| **Add manga** | Search MyAnimeList and create a Series note — or, after asking, link into the anime-only note open in the editor. |
| **Add mangaka** | Reads the active manga/Series note's credited author(s) from MyAnimeList and creates (or updates) their note. Requires a manga or Series note to be open — see [Anime and manga](#anime-and-manga). |
| **Refresh metadata from TMDB** | Re-fetch the film or director and rewrite only the fields the plugin owns. Your `watch_date`, your body text, any property you added, any alias you added, any link already in a list (a director, a genre) and any comment above the first property are left exactly as they were. Only appears on film or director notes. |
| **Refresh anime/manga metadata from MAL** | Re-fetches whichever side(s) the note has and rewrites only the fields the plugin owns. `watched`, `read`, your body text, any property you added, any link already in a list (a genre, a studio, a mangaka) and any comment above the first property are left exactly as they were. On a mangaka note, refreshes their name, birthday and photo instead. Only appears on anime, manga or mangaka notes. |
| **Relink directors and genres** | Turn plain names into `[[wikilinks]]` wherever a note by that name now exists. No network calls, so it runs in a second. |
| **Import from Letterboxd** | Bulk-create notes from a Letterboxd export. See below. |

## Importing from Letterboxd

1. On Letterboxd, go to **Settings → Import & Export → Export your data**, and unzip the download.
2. Drag `diary.csv` into your vault (or `watched.csv` if you only want the list of films without watch dates).
3. Run **Import from Letterboxd** from the command palette, or use the button in settings, and pick that file.
4. Choose whether to **mark these films as watched**. It starts on for `diary.csv`, `watched.csv`, `ratings.csv` and `reviews.csv`, which only list films you've seen, and off for anything else — `watchlist.csv` has exactly the same columns as `watched.csv`, so its name is the only way to tell them apart.
5. Film + Anime-Manga Tracker searches TMDB for each entry and creates a note for anything not already in your vault — the same note, with the same two things, as adding a film by hand.

From `diary.csv`, the **Watched Date** column fills in `watch_date` on notes it creates. Nothing else from the export is imported: **Rating**, **Tags** and **Rewatch** are your own commentary, not the plugin's, so they are never read.

A film already in your vault (matched by `tmdb_id`) is skipped rather than duplicated; if it has no `watch_date` yet, the import fills that in from the diary entry, and with **mark these films as watched** on it ticks `watched` (it never unticks it). Letterboxd and TMDB sometimes put a film a year apart, so a result within a year of the export's year still counts. When a title in the CSV has no TMDB match that close, it is left out rather than guessed and listed, with the reason, in a **Film + Anime-Manga Tracker Import Report** note created at the end.

Closing the progress window, with Esc or its close button, stops the import the same way **Cancel** does; what was imported by then stays. Only one import runs at a time: starting a second while one is running just tells you so.

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
| Show connections | on | Below a film's properties, list other films in your vault that share a director, composer or cast member. |
| Show filmography | on | Below a director's properties, list their films in your vault, linked directly. |
| MyAnimeList client ID | empty | Your personal client ID. Required for Add anime / Add manga. On Obsidian 1.11.4 or later, kept in Obsidian's keychain like the TMDB key. |
| Anime/manga folder | `Anime` | Where notes are created. Shared by both, since a Series note can hold either or both. Empty means the vault root. |
| Anime/manga poster folder | empty | Where anime and manga posters are saved (as two separate files). Empty follows your normal attachment folder setting. |
| Mangaka folder | `Mangaka` | Where mangaka notes are created. Kept separate from the anime/manga folder, the same way directors have their own folder apart from films. Empty means the vault root. |
| Mangaka photo folder | empty | Where mangaka photos are saved. Empty follows your normal attachment folder setting. |

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

Obsidian's Properties view has no widget for a nested value like `manga:` — it would otherwise show up as a single property rendered as raw, unreadable JSON. Film + Anime-Manga Tracker hides that one row instead (only on notes that actually have a `manga` block — a `manga` property you've added yourself on some unrelated note is never touched) and shows the same data properly below the properties, in its own collapsible **MANGA** panel: the title, a line with type, year and status ("Manga · 1998 · Currently publishing") followed by the volume and chapter counts when MyAnimeList has them, mangaka (linked, same as directors — see below), the manga's own poster, and a **Read** checkbox.

That Read checkbox is the one place in Film + Anime-Manga Tracker that writes to the note from a rendered panel rather than through Properties directly — ticking it sets `manga.read` and nothing else, on every note that carries the same manga (see [Adaptations](#adaptations)). Refreshing never touches it, the same guarantee `watched` and a film's `watch_date` already have.

Since a Series note can have its own top-level `poster` (the anime's) and a separate `manga.poster`, both are downloaded and kept independently — refreshing one side never overwrites the other's poster, or a poster that's already saved.

The panel also carries **Change manga** and **Remove manga**, for when the wrong manga ended up on a note. **Change manga** opens the same search box **Add manga** uses and swaps in whatever you pick, poster included; **Remove manga** asks first, then drops the manga side entirely. Both edit only the `manga:` block — the note is never recreated, so the anime side, its poster, `watched`, your own properties and the body are all left exactly as they are. Since the old `manga.read` and any sub-field you hand-added under `manga` described a different work, they don't survive the change.

The old manga's poster file stays in your vault unless you say otherwise. When nothing else uses it any more — no other note shows it as a poster (another adaptation, say), links to it or embeds it — **Remove manga** offers to delete it along with the manga, and **Change manga** asks whether to delete it once the new manga is in. A deleted poster goes wherever Obsidian's **Deleted files** setting sends deleted files.

### Adaptations

One manga can have several anime — a remake (*Hunter x Hunter* 1999 and 2011), a second series, a film — and one anime can adapt more than one manga (*Cowboy Bebop* has two manga of its own). Each pairing gets a Series note of its own, so the same manga, or the same anime, can sit on several notes:

- **Add adaptation** on the MANGA panel pairs that note's manga with another anime in one step. Pick the anime and the plugin keeps it on a single note where it can: the anime's existing anime-only note gets the manga. Failing that, a manga-only note takes the anime in, and otherwise the pairing gets a new Series note.
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
