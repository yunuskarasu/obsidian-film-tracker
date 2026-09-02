# Film Tracker

Add a film to your Obsidian vault as a note with metadata and a poster.

Search for a film, pick it from the list, and Film Tracker creates a note containing exactly two things: a frontmatter block with the film's metadata, and the poster. Nothing else. No rating, no review section, no template. What you write in the note is up to you.

## Installing

Film Tracker isn't in the Community Plugins store yet, so for now it installs through [BRAT](https://github.com/TfTHacker/obsidian42-brat) (Beta Reviewer's Auto-update Tool):

1. Install **BRAT** from Community Plugins and enable it.
2. Open BRAT's settings → **Add Beta plugin**.
3. Enter `yunuskarasu/obsidian-film-tracker` as the repository and confirm.
4. Enable **Film Tracker** under Community Plugins.

BRAT also handles updates: when a new release goes out, BRAT picks it up the same way it installed the first one.

## Setup

1. Create a free TMDB account and open [your API settings](https://www.themoviedb.org/settings/api).
2. Copy the **API Key (v3 auth)** value — the short one, not the long read access token.
3. Paste it into **Settings → Film Tracker → TMDB API key**. Every user needs their own key — it's free and takes a minute.

## Tips for a smooth start

A handful of mistakes account for most of the confusion new users hit:

- **Everyone needs their own TMDB API key.** It isn't bundled with the plugin and can't be shared — each person pastes their own free key into settings (see [Setup](#setup)). Without it, search silently returns nothing.
- **Set `watch_date` to a Date property once.** Fresh out of the box it's plain text, so sorting by date won't work until you do the one-time [type change](#make-watch_date-a-date-property) on any note. Obsidian remembers it vault-wide after that.
- **Don't set Film folder / Director folder after you've already added notes elsewhere.** Duplicate detection (by `tmdb_id`) only looks inside the currently configured folder, so changing the folder path mid-use can let the same film get added twice — pick your folders early, or move existing notes into the new folder yourself before continuing.
- **Turning on Add cast / Add composers later doesn't back-fill old notes.** Those settings only apply going forward. Run **Refresh metadata from TMDB** on a note to pull in fields you enabled after creating it.
- **Never delete or hand-edit `tmdb_id`.** It's the only thing Film Tracker uses to recognize "this note already exists" and to know what to refresh — renaming the file itself is safe, but losing `tmdb_id` isn't.
- **Picking from search:** when a title has several versions (remakes, franchises), check the year shown next to each result before choosing — titles alone are often ambiguous.
- **Letterboxd import runs once per file.** Films already in your vault (matched by `tmdb_id`) are skipped rather than duplicated, so re-running the same export after adding more notes by hand is safe — it only fills gaps.
- **A blank poster/photo isn't necessarily a bug.** Some TMDB entries genuinely have no image; the note is still created with full metadata either way.

## Usage

Run **Add film** from the command palette, or click the film icon in the ribbon and pick **Add film**. Type at least two characters, pick the right film, and the note is created and opened.

Search works in any language: typing `Amelie`, `Amélie`, or `Le Fabuleux Destin d'Amélie Poulain` all find the same film.

Directors work the same way: run **Add director**, or click the ribbon icon and pick **Add director**. The note gets the director's name, birthday, place of birth and a photo — nothing else, same philosophy as a film note.

### Commands

| Command | What it does |
| --- | --- |
| **Add film** | Search TMDB and create the note. |
| **Add director** | Search TMDB for a person and create a director note: name, birthday, place of birth and a photo. |
| **Refresh metadata from TMDB** | Re-fetch the film or director and rewrite only the fields the plugin owns. Your `watch_date`, your body text and any property you added are left exactly as they were. Only appears on film or director notes. |
| **Relink directors and genres** | Turn plain names into `[[wikilinks]]` wherever a note by that name now exists. No network calls, so it runs in a second. |
| **Import from Letterboxd** | Bulk-create notes from a Letterboxd export. See below. |

## Importing from Letterboxd

1. On Letterboxd, go to **Settings → Import & Export → Export your data**, and unzip the download.
2. Drag `diary.csv` into your vault (or `watched.csv` if you only want the list of films without watch dates).
3. Run **Import from Letterboxd** from the command palette, or use the button in settings, and pick that file.
4. Film Tracker searches TMDB for each entry and creates a note for anything not already in your vault — the same note, with the same two things, as adding a film by hand.

From `diary.csv`, the **Watched Date** column fills in `watch_date` on notes it creates. Nothing else from the export is imported: **Rating**, **Tags** and **Rewatch** are your own commentary, not the plugin's, so they are never read.

A film already in your vault (matched by `tmdb_id`) is skipped rather than duplicated; if it has no `watch_date` yet, the import fills that in from the diary entry. When a title in the CSV has no confident TMDB match, it is left out and listed, with the reason, in a **Film Tracker Import Report** note created at the end.

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
- `watch_date` is left empty on purpose. Film Tracker never fills it in — it is yours to complete when you have seen the film.
- `watched` is a plain checkbox, separate from `watch_date`, for exactly the "I know I've seen it but don't remember when" case. Film Tracker never touches it after creation — tick or untick freely, it's yours.

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

Same philosophy as a film note: structured data and a photo, nothing else. The photo is written to the `poster` property on purpose — Film Tracker's layout renders any note carrying `tmdb_id` and `poster` beside its properties, so a director note gets the exact same two-column layout as a film note for free.

`original_name` is a best-effort guess: TMDB doesn't tag alternate names by language, so Film Tracker infers the director's native writing system from `place_of_birth` (Russia → Cyrillic, Japan → Japanese, China → Chinese, and similarly for Korean, Arabic, Hebrew, Greek and Thai) and picks the first alternate name written in it. `aliases` then holds just `name` and `original_name` — not TMDB's full, noisy list of transliterations. For a director from a Latin-script country (France, Poland, Germany, …), or when nothing matches, `original_name` is left empty for you to fill in by hand, the same way `watch_date` is.

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

## Behaviour worth knowing

- **Duplicates.** If a note with the same `tmdb_id` already exists in the relevant folder (Film folder for films, Director folder for directors), Film Tracker opens it instead of creating a second one. It never overwrites a note you have written in.
- **Missing posters.** If TMDB has no poster or photo, or the download fails, the note is still created with its metadata. The image is never worth losing the note over.
- **File names.** Film notes are named `English Title (Year).md`; director notes are named after the person. Characters that are illegal in file names or that break wikilinks are removed, so `Face/Off` becomes `Face Off (1997)`.
- **Layout.** In a note that has a `tmdb_id` and a poster, the title and properties sit in a left column with the poster beside them, in both live preview and reading view. The poster is drawn from the `poster` property rather than embedded in the body, so the body stays empty and entirely yours. Narrow windows and mobile stack it vertically. To change the poster size, override `--film-tracker-poster-width` in a CSS snippet.

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

Below a film's properties (and poster, if it has one), Film Tracker shows other films in your vault that share a director, a composer or a cast member — with the shared name next to each one. This works whether or not **Link cast**/**Link directors**/**Link composers** are on: it compares the names directly, not the links. Genres are deliberately left out — two films both being "Drama" is not a connection.

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

## Development

```bash
npm install
npm test      # file naming, YAML output, TMDB mapping, frontmatter rewriting
npm run lint  # includes the official eslint-plugin-obsidianmd rules
npm run dev   # esbuild watch
npm run build # typecheck + production bundle
```

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.
