# ConteudoG SkyStream Plugin Repository

SkyStream Gen 2 plugin repository for `conteudog.com.br`.

## Files

- `conteudog/plugin.json` — SkyStream plugin manifest.
- `conteudog/plugin.js` — scraper and stream resolver.
- `dist/com.conteudog.skystream.conteudog.sky` — prebuilt plugin bundle.
- `dist/plugins.json` and `repo.json` — repository indexes.

## What the plugin does

- Parses homepage/category cards from ConteudoG.
- Implements `getHome`, `search`, `load`, and `loadStreams`.
- Extracts the site `players` array from video pages.
- Resolves iframe hosts into direct app-playable streams where possible.
- Returns only direct/proxied MP4/HLS stream URLs, not browser iframe URLs.
- Marks metadata as adult content with `contentRating: "18+"` and `isAdult: true`.

## Local commands

```bash
npm install -g skystream-cli
skystream validate
skystream test -p conteudog -f getHome
skystream test -p conteudog -f load -q https://conteudog.com.br/drafted-3
skystream test -p conteudog -f loadStreams -q https://conteudog.com.br/drafted-3
```

## Deploy

Update `USER_NAME` in `repo.json`, `dist/plugins.json`, and `package.json`, then push to GitHub.

```bash
skystream deploy -u https://raw.githubusercontent.com/USER_NAME/conteudog-skystream-plugin/main
```

In SkyStream: Extensions → Add Source → paste the raw `repo.json` URL.
