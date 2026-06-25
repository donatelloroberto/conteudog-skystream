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
## v2 Playback Fix

This build fixes the playback failure by switching stream wrapping to SkyStream's documented `MAGIC_PROXY_v1` format and passing required host headers through `StreamResult.headers`. It also improves resolver coverage for XFileSharing-style hosts such as EarnVids/minochinos and Vinovo, plus broader direct MP4/HLS candidate detection.



## v3 Playback Fix

This build fixes the StreamTape playback failure shown by SkyStream logs. The previous build returned an obfuscated StreamTape path such as `/get_vixyzadeo?...`, which the local proxy received as a valid stream URL but StreamTape returned as HTTP 404. v3 reconstructs `/get_video?...&stream=1`, sanitizes injected junk in StreamTape paths, avoids returning HTML landing/download pages as streams, and logs per-host resolver counts for debugging.
