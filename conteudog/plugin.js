(function () {
  "use strict";

  // ── v5 fixes (from log analysis) ─────────────────────────────────────────
  // 1. Streamtape: hostname junk (streamtape.comxyza) now stripped BEFORE URL parsing.
  // 2. Streamtape: path junk (get_vixyzadeo / get_video?xyzaid=) now cleaned more aggressively.
  // 3. Streamtape: probe response that returns HTML (200 text/html on /get_video?) rejected.
  // 4. Vinovo: dedicated extractor using the actual JWPlayer/HLS pattern their pages use.
  // 5. Voe: improved multi-pattern extraction; handles redirect domain gracefully.
  // 6. MxDrop: wurl pattern fixed to also match MDCore.wurl with URL cleanup.
  // 7. minochinos.com: removed from XFileSharing alternates list (dead DNS).
  // 8. playmogo.com: added to resolveEmbed dispatcher (XFileSharing variant).
  // ─────────────────────────────────────────────────────────────────────────

  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
  const DEFAULT_POSTER = "https://conteudog.com.br/imagens/logo.png";

  function baseUrl() {
    return (manifest.baseUrl || "https://conteudog.com.br").replace(/\/+$/, "");
  }

  function cleanText(value) {
    return decodeEntities(stripTags(String(value || "")))
      .replace(/\s+/g, " ")
      .replace(/\s+-\s+Clique para Assistir$/i, "")
      .trim();
  }

  function stripTags(value) {
    return String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  }

  function decodeEntities(value) {
    return String(value || "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ");
  }

  function absoluteUrl(value, referer) {
    if (!value) return "";
    let v = decodeEntities(String(value).trim()).replace(/\\\//g, "/");
    if (!v) return "";
    if (v.startsWith("//")) return "https:" + v;
    if (/^https?:\/\//i.test(v)) return v;
    const origin = baseUrl();
    if (v.startsWith("/")) return origin + v.replace(/^\/+/, "/");
    const base = referer || origin + "/";
    try {
      return new URL(v, base.endsWith("/") ? base : base.replace(/\/[^/]*$/, "/")).toString();
    } catch (_) {
      return origin + "/" + v.replace(/^\/+/, "");
    }
  }

  function headersFor(referer) {
    return {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Referer": referer || baseUrl() + "/"
    };
  }

  async function fetchText(url, referer) {
    const target = absoluteUrl(url, referer || baseUrl() + "/");
    const res = await http_get(target, headersFor(referer));
    if (!res || (res.status && res.status >= 400)) {
      throw new Error("HTTP " + (res && (res.status || res.statusCode)) + " for " + target);
    }
    return String(res.body || "");
  }

  function firstMatch(text, patterns) {
    for (const p of patterns) {
      const m = p.exec(text);
      if (m && m[1]) return decodeEntities(m[1]);
    }
    return "";
  }

  function inferTypeFromUrl(url, category) {
    const text = String(url + " " + (category || "")).toLowerCase();
    if (text.includes("filme")) return "movie";
    if (text.includes("cena") || text.includes("video")) return "movie";
    return "movie";
  }

  function cardToItem(attrs, inner, category) {
    const href = firstMatch(attrs, [/href\s*=\s*"([^"]+)"/i, /href\s*=\s*'([^']+)'/i]);
    let title = firstMatch(attrs, [/title\s*=\s*"([^"]+)"/i, /title\s*=\s*'([^']+)'/i]);
    title = title || firstMatch(inner, [/<p\b[^>]*class\s*=\s*"[^"]*truncate-title[^"]*"[^>]*>([\s\S]*?)<\/p>/i, /<p\b[^>]*>([\s\S]*?)<\/p>/i]);
    title = cleanText(title) || "Untitled";

    const poster = firstMatch(inner, [
      /<img\b[^>]*class\s*=\s*"[^"]*front-cover[^"]*"[^>]*src\s*=\s*"([^"]+)"/i,
      /<img\b[^>]*src\s*=\s*"([^"]+)"/i,
      /<img\b[^>]*src\s*=\s*'([^']+)'/i
    ]);
    const yearText = firstMatch(inner, [/<div\b[^>]*class\s*=\s*"[^"]*etiqueta-lancamento[^"]*"[^>]*>([\s\S]*?)<\/div>/i]);
    const y = parseInt(cleanText(yearText), 10);
    const isPremium = /etiqueta-premium/i.test(inner);
    const pageUrl = absoluteUrl(href, baseUrl() + "/");
    return new MultimediaItem({
      title,
      url: pageUrl,
      posterUrl: absoluteUrl(poster, pageUrl) || DEFAULT_POSTER,
      type: inferTypeFromUrl(pageUrl, category),
      year: Number.isFinite(y) ? y : undefined,
      status: "completed",
      contentRating: "18+",
      isAdult: true,
      playbackPolicy: isPremium ? "Premium/Login may be required" : "none",
      provider: "ConteudoG",
      headers: headersFor(pageUrl)
    });
  }

  function parseCardsFromHtml(html, category) {
    const items = [];
    const re = /<a\b([^>]*class\s*=\s*"[^"]*video-card[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi;
    let m;
    const seen = {};
    while ((m = re.exec(html)) !== null) {
      const item = cardToItem(m[1], m[2], category);
      if (!item.url || seen[item.url]) continue;
      seen[item.url] = true;
      items.push(item);
    }
    return items;
  }

  function parseSections(html) {
    const data = {};
    const sectionRe = /<div\b[^>]*class\s*=\s*"chamada"[^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*class\s*=\s*"[^"]*lista-de-videos[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*class\s*=\s*"[^"]*vejaTodos/gi;
    let m;
    while ((m = sectionRe.exec(html)) !== null) {
      let category = cleanText(m[1]) || "Videos";
      const items = parseCardsFromHtml(m[2], category).slice(0, 40);
      if (!items.length) continue;
      if (/destaques/i.test(category)) category = "Trending";
      data[category] = items;
    }
    if (!Object.keys(data).length) {
      const items = parseCardsFromHtml(html, "Videos").slice(0, 60);
      if (items.length) data["Trending"] = items.slice(0, 12), data["Videos"] = items;
    }
    return data;
  }

  function dedupeItems(items) {
    const seen = {};
    const out = [];
    for (const item of items) {
      if (!item || !item.url || seen[item.url]) continue;
      seen[item.url] = true;
      out.push(item);
    }
    return out;
  }

  async function getHome(cb) {
    try {
      const html = await fetchText(baseUrl() + "/", baseUrl() + "/");
      const data = parseSections(html);
      if (!data.Trending) {
        const firstKey = Object.keys(data)[0];
        if (firstKey) data.Trending = data[firstKey].slice(0, 10);
      }
      cb({ success: true, data });
    } catch (e) {
      cb({ success: false, errorCode: "HOME_ERROR", message: String(e && (e.stack || e.message) || e) });
    }
  }

  async function search(query, cb) {
    try {
      const q = cleanText(query).toLowerCase();
      if (!q) return cb({ success: true, data: [] });
      const pages = ["/", "/Videos", "/Cenas", "/Filmes", "/Videos&opcao=Destaques", "/Videos&opcao=Lancamentos"];
      const all = [];
      for (const p of pages) {
        try {
          const html = await fetchText(baseUrl() + p, baseUrl() + "/");
          all.push(...parseCardsFromHtml(html, p));
        } catch (_) {}
      }
      const results = dedupeItems(all).filter((item) => {
        const t = String(item.title || "").toLowerCase();
        const u = String(item.url || "").toLowerCase();
        return t.includes(q) || u.includes(q.replace(/\s+/g, "-"));
      }).slice(0, 60);
      cb({ success: true, data: results });
    } catch (e) {
      cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e && (e.stack || e.message) || e) });
    }
  }

  function parseTitle(html) {
    let title = firstMatch(html, [/<span\b[^>]*class\s*=\s*"[^"]*titulo-filme[^"]*"[^>]*>([\s\S]*?)<div\b/i]);
    title = cleanText(title);
    if (!title) title = cleanText(firstMatch(html, [/<title>([\s\S]*?)<\/title>/i])).replace(/\s+-\s+Conteudo G$/i, "");
    return title || "ConteudoG Video";
  }

  function parseTags(html) {
    const tags = [];
    const rodape = firstMatch(html, [/<div\b[^>]*class\s*=\s*"rodape"[^>]*>([\s\S]*?)<\/div>/i]);
    const re = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(rodape)) !== null) {
      const tag = cleanText(m[1]);
      if (tag && tags.indexOf(tag) === -1) tags.push(tag);
    }
    return tags;
  }

  function parseActors(html) {
    const actors = [];
    const re = /<a\b[^>]*class\s*=\s*"[^"]*ator-card[^"]*"[\s\S]*?<img\b[^>]*src\s*=\s*"([^"]+)"[\s\S]*?<span\b[^>]*class\s*=\s*"[^"]*ator-nome[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const name = cleanText(m[2]);
      if (name) actors.push(new Actor({ name, image: absoluteUrl(m[1], baseUrl() + "/") }));
    }
    return actors;
  }

  async function load(url, cb) {
    try {
      const pageUrl = absoluteUrl(url, baseUrl() + "/");
      const html = await fetchText(pageUrl, baseUrl() + "/");
      const title = parseTitle(html);
      const tags = parseTags(html);
      const cast = parseActors(html);
      const poster = await findPosterForUrl(pageUrl).catch(() => DEFAULT_POSTER);
      cb({
        success: true,
        data: new MultimediaItem({
          title,
          url: pageUrl,
          posterUrl: poster || DEFAULT_POSTER,
          type: "movie",
          status: "completed",
          contentRating: "18+",
          isAdult: true,
          tags,
          cast,
          description: tags.length ? ("Tags: " + tags.join(", ")) : "ConteudoG video.",
          playbackPolicy: "none",
          provider: "ConteudoG",
          headers: headersFor(pageUrl),
          episodes: [
            new Episode({
              name: title,
              url: pageUrl,
              season: 1,
              episode: 1,
              dubStatus: "none",
              playbackPolicy: "none",
              posterUrl: poster || DEFAULT_POSTER,
              headers: headersFor(pageUrl)
            })
          ]
        })
      });
    } catch (e) {
      cb({ success: false, errorCode: "LOAD_ERROR", message: String(e && (e.stack || e.message) || e) });
    }
  }

  async function findPosterForUrl(pageUrl) {
    const slug = pageUrl.split("/").filter(Boolean).pop();
    if (!slug) return DEFAULT_POSTER;
    const html = await fetchText(baseUrl() + "/", baseUrl() + "/");
    const cards = parseCardsFromHtml(html, "home");
    for (const c of cards) {
      if (String(c.url || "").split("/").filter(Boolean).pop() === slug) return c.posterUrl;
    }
    return DEFAULT_POSTER;
  }

  function extractPlayers(html) {
    const players = [];
    const scriptMatch = /const\s+players\s*=\s*(\[[\s\S]*?\])\s*;\s*<\/script>/i.exec(html) || /var\s+players\s*=\s*(\[[\s\S]*?\])\s*;/i.exec(html);
    if (scriptMatch) {
      try {
        const parsed = JSON.parse(scriptMatch[1]);
        for (const p of parsed) {
          const embedUrl = extractIframeSrc(String(p.embed || ""));
          if (embedUrl) players.push({ server: String(p.servidor || "Server"), embedUrl });
        }
      } catch (e) {
        // continue to fallback extraction
      }
    }
    const iframeRe = /<iframe\b[^>]*src\s*=\s*['"]([^'"]+)['"][^>]*>/gi;
    let m;
    while ((m = iframeRe.exec(html)) !== null) {
      const embedUrl = absoluteUrl(m[1], baseUrl() + "/");
      if (embedUrl && !players.some((p) => p.embedUrl === embedUrl)) {
        players.push({ server: hostLabel(embedUrl), embedUrl });
      }
    }
    return players;
  }

  function extractIframeSrc(embedHtml) {
    const m = /src\s*=\s*["']([^"']+)/i.exec(String(embedHtml).replace(/\\\//g, "/"));
    return m ? absoluteUrl(m[1], baseUrl() + "/") : "";
  }

  function hostLabel(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (_) {
      return "Server";
    }
  }

  function qualityFromUrl(url) {
    const m = /(2160|1080|720|480|360|240)p?/i.exec(url);
    return m ? m[1] + "p" : undefined;
  }

  function isPlayableUrl(url) {
    if (!/^https?:\/\//i.test(url)) return false;
    return /(\\.m3u8(?:\\?|$)|\\.mp4(?:\\?|$)|\\.mkv(?:\\?|$)|\\.webm(?:\\?|$)|\/hls\/|\/manifest\/|\/video\/|\/file\/|\/media\/|get_video\\?|videoplayback|\/stream\/|\/dl\\?)/i.test(url);
  }

  function streamOrigin(url) {
    try {
      const u = new URL(url);
      return u.protocol + "//" + u.host;
    } catch (_) {
      return baseUrl();
    }
  }

  function headerValue(headers, name) {
    if (!headers) return "";
    const wanted = String(name || "").toLowerCase();
    for (const k in headers) {
      if (String(k).toLowerCase() === wanted) return String(headers[k] || "");
    }
    return "";
  }

  function isProbablyMediaResponse(res, url) {
    const status = Number((res && (res.status || res.statusCode)) || 0);
    if (status >= 400 || status === 0) return false;
    const finalUrl = String((res && res.finalUrl) || url || "");
    const ct = headerValue(res && res.headers, "content-type").toLowerCase();
    const bodyStart = String((res && res.body) || "").slice(0, 200).toLowerCase();

    // Explicitly reject HTML responses regardless of status — Streamtape returns
    // 200 + text/html for invalid/obfuscated get_video URLs.
    if (/text\/html|application\/xhtml|text\/plain/.test(ct)) return false;
    if (/^\s*<!doctype html|^\s*<html|<title>|<body/i.test(bodyStart)) return false;

    if (/video\/.+|application\/(?:octet-stream|vnd\.apple\.mpegurl|x-mpegurl|mpegurl)|audio\/.+/.test(ct)) return true;
    if (/\.m3u8(?:\?|$)|\.mp4(?:\?|$)|\.mkv(?:\?|$)|\.webm(?:\?|$)|videoplayback|\/hls\/|\/stream\/|\/media\//i.test(finalUrl)) return true;
    return false;
  }

  async function verifiedMediaUrl(url, referer, source) {
    const target = absoluteUrl(url, referer || baseUrl() + "/");
    if (!isPlayableUrl(target)) return "";
    try {
      const probeHeaders = streamHeadersFor(referer || target, target, {
        "Accept": "*/*",
        "Referer": referer || streamOrigin(target) + "/"
      });
      if (!/\.m3u8(?:\?|$)/i.test(target)) probeHeaders["Range"] = "bytes=0-1";
      const res = await http_get(target, probeHeaders);
      if (isProbablyMediaResponse(res, target)) {
        const finalUrl = String((res && res.finalUrl) || target);
        console.log("ConteudoG verified " + (source || hostLabel(target)) + " -> " + finalUrl);
        return finalUrl;
      }
      const ct = headerValue(res && res.headers, "content-type");
      console.log("ConteudoG rejected non-media " + (source || hostLabel(target)) + " status=" + (res && (res.status || res.statusCode)) + " ct=" + ct + " url=" + target);
    } catch (e) {
      console.log("ConteudoG probe failed " + (source || hostLabel(target)) + " -> " + target + " :: " + String(e && e.message || e));
    }
    return "";
  }

  async function candidatesToStreams(candidates, source, referer, extraHeaders) {
    const out = [];
    const seen = {};
    for (const raw of candidates || []) {
      const u = absoluteUrl(raw, referer || baseUrl() + "/");
      if (!u || seen[u]) continue;
      seen[u] = true;
      const checked = await verifiedMediaUrl(u, referer, source);
      if (checked) out.push(toStream(checked, source || hostLabel(checked), referer || u, extraHeaders));
    }
    return dedupeStreams(out);
  }

  function streamHeadersFor(referer, url, extraHeaders) {
    const ref = referer || streamOrigin(url) + "/";
    const headers = {
      "User-Agent": UA,
      "Accept": "*/*",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Referer": ref
    };
    if (extraHeaders && extraHeaders.Origin) headers.Origin = extraHeaders.Origin;
    return Object.assign(headers, extraHeaders || {});
  }

  function proxied(url) {
    return "MAGIC_PROXY_v1" + btoa(url);
  }

  function toStream(url, source, referer, extraHeaders) {
    const headers = streamHeadersFor(referer || url, url, extraHeaders);
    const finalUrl = proxied(url);
    return new StreamResult({
      url: finalUrl,
      source: source + (qualityFromUrl(url) ? " " + qualityFromUrl(url) : ""),
      quality: qualityFromUrl(url) || "Auto",
      headers
    });
  }

  async function unpackMaybe(body) {
    try {
      if (typeof getAndUnpack === "function") {
        const out = await getAndUnpack(body);
        if (out && typeof out === "string") return out;
      }
    } catch (_) {}
    return body;
  }

  // ── MxDrop ───────────────────────────────────────────────────────────────
  async function resolveMixDrop(embedUrl, source) {
    const body = await fetchText(embedUrl, baseUrl() + "/");
    const unpacked = await unpackMaybe(body);
    const candidates = [];
    const patterns = [
      // FIX: wurl can appear with or without MDCore prefix, and may have // prefix
      /(?:MDCore\.)?wurl\s*=\s*["']([^"']+)["']/i,
      /(?:file|src)\s*:\s*["']([^"']+(?:\.mp4|\.m3u8)[^"']*?)["']/i,
      /["'](https?:\/\/[^"']+(?:\.mp4|\.m3u8)[^"']*?)["']/i,
      /["'](\/[^"']+(?:\.mp4|\.m3u8)[^"']*?)["']/i
    ];
    for (const p of patterns) {
      const m = p.exec(unpacked) || p.exec(body);
      if (m && m[1]) {
        // wurl often starts with // — normalize it
        let raw = m[1].trim();
        if (raw.startsWith("//")) raw = "https:" + raw;
        candidates.push(absoluteUrl(raw, embedUrl));
      }
    }
    return candidatesToStreams(candidates.filter(isPlayableUrl), source || "MixDrop", embedUrl, { Referer: embedUrl });
  }

  // ── Voe ──────────────────────────────────────────────────────────────────
  async function resolveVoe(embedUrl, source) {
    let body;
    try {
      body = await fetchText(embedUrl, baseUrl() + "/");
    } catch (e) {
      console.log("ConteudoG Voe fetch failed: " + String(e && e.message || e));
      return [];
    }
    const unpacked = await unpackMaybe(body);
    const text = body + "\n" + unpacked;
    const candidates = [];

    // JSON application/json block (Voe Method 7/8 — may be plain or encoded)
    const jsonBlock = /<script[^>]*type\s*=\s*["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i.exec(text);
    if (jsonBlock) {
      try {
        const data = JSON.parse(jsonBlock[1]);
        const srcs = data && (data.sources || data.source);
        if (srcs) {
          if (typeof srcs === "string") {
            // Try plain URL first
            if (/^https?:\/\//i.test(srcs)) candidates.push(srcs);
          } else if (typeof srcs === "object") {
            const hls = srcs.hls || srcs.mp4 || srcs[Object.keys(srcs)[0]];
            if (hls && /^https?:\/\//i.test(hls)) candidates.push(hls);
          }
        }
      } catch (_) {}
    }

    // Standard JS patterns
    const patterns = [
      /["']hls["']\s*:\s*["']([^"']+)["']/i,
      /hls\s*[=:]\s*["']([^"']+)["']/i,
      /file\s*[=:]\s*["']([^"']+(?:\.m3u8|\.mp4)[^"']*?)["']/i,
      /source\s*[=:]\s*["']([^"']+(?:\.m3u8|\.mp4)[^"']*?)["']/i,
      /["'](https?:\/\/[^"']+\.m3u8[^"']*?)["']/i,
      /["'](https?:\/\/[^"']+\.mp4[^"']*?)["']/i
    ];
    for (const p of patterns) {
      const m = p.exec(text);
      if (m && m[1]) candidates.push(absoluteUrl(m[1], embedUrl));
    }
    return candidatesToStreams(candidates.filter(isPlayableUrl), source || "Voe", embedUrl, { Referer: embedUrl });
  }

  // ── Streamtape ───────────────────────────────────────────────────────────
  // BUG FIX: Strip hostname junk AND path junk before building the clean URL.
  function cleanStreamTapeUrl(raw, embedUrl) {
    if (!raw) return "";
    let u = decodeEntities(String(raw)).replace(/\\/g, "/").replace(/&amp;/g, "&").trim();
    if (!u) return "";
    if (u.startsWith("//")) u = "https:" + u;
    if (u.startsWith("/")) {
      try { u = new URL(u, embedUrl).toString(); } catch (_) { return ""; }
    }
    if (!/^https?:\/\//i.test(u)) u = absoluteUrl(u, embedUrl);

    // FIX 1 — Strip junk from hostname: streamtape.comxyza → streamtape.com
    // Do this as string manipulation BEFORE parsing with URL() because
    // "streamtape.comxyza" is a valid (but non-existent) TLD and URL() accepts it.
    u = u.replace(/(https?:\/\/streamtape\.com)[a-z0-9_\-]{1,30}(\/)/i, "$1$2");

    // FIX 2 — Strip junk from path: get_vixyzadeo → get_video
    u = u.replace(/\/get_vi[\w\-]*?deo(?=\?)/i, "/get_video");

    // FIX 3 — Strip junk from parameter names: xyzaid= → id=, xyzaexpires= → expires=
    u = u.replace(/([?&])[a-z0-9_\-]{1,16}?(id|expires|ip|token)=/gi, "$1$2=");

    // Remove the &stream=1 parameter that can confuse the CDN
    u = u.replace(/([?&])stream=1(&|$)/i, "$1").replace(/[?&]$/, "");

    // Validate — must still be a streamtape.com URL after cleaning
    try {
      const parsed = new URL(u);
      if (!/^streamtape\.com$/i.test(parsed.hostname)) return "";
      return parsed.toString();
    } catch (_) {
      return "";
    }
  }

  function collectStreamTapeUrls(body, embedUrl) {
    const text = decodeEntities(String(body || "")).replace(/\\\//g, "/");
    const out = [];

    // Pattern A — full URL match (hostname may have junk, path may have junk — cleanStreamTapeUrl fixes both)
    const fullRe = /(?:https?:)?\/\/streamtape\.com[\w\-]{0,20}\/get_vi[\w\-]{0,24}deo\?[^"'<>\s]+/ig;
    let m;
    while ((m = fullRe.exec(text)) !== null) {
      const cleaned = cleanStreamTapeUrl(m[0], embedUrl);
      if (cleaned) out.push(cleaned);
    }

    // Pattern B — reconstruct from id/expires/ip/token params (after stripping junk param prefixes)
    const clean = text.replace(/([?&])[a-z0-9_\-]{1,16}?(id|expires|ip|token)=/gi, "$1$2=");
    const paramRe = /id=([a-zA-Z0-9]+)&expires=([0-9]+)&ip=([A-Za-z0-9_\-]+)&token=([A-Za-z0-9_\-]+)/ig;
    while ((m = paramRe.exec(clean)) !== null) {
      out.push(`https://streamtape.com/get_video?id=${m[1]}&expires=${m[2]}&ip=${m[3]}&token=${m[4]}`);
    }

    // Pattern C — innerHTML concatenation: 'part1' + ('part2')
    const concatRe = [
      /innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*\(?['"]([^'"]+)['"]/ig,
      /document\.getElementById\(['"](?:norobotlink|robotlink|videolink)['"]\)\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*\(?['"]([^'"]+)['"]/ig
    ];
    for (const re of concatRe) {
      let concat;
      while ((concat = re.exec(body)) !== null) {
        let candidate = String(concat[1] || "") + String(concat[2] || "");
        const cleaned = cleanStreamTapeUrl(candidate, embedUrl);
        if (cleaned) out.push(cleaned);
      }
    }

    return [...new Set(out.filter(Boolean))];
  }

  async function resolveStreamTape(embedUrl, source) {
    let body;
    try {
      body = await fetchText(embedUrl, baseUrl() + "/");
    } catch (e) {
      console.log("ConteudoG StreamTape fetch failed: " + String(e && e.message || e));
      return [];
    }
    const candidates = collectStreamTapeUrls(body, embedUrl);
    const streams = await candidatesToStreams(candidates, source || "StreamTape", embedUrl, { Referer: embedUrl });
    console.log("ConteudoG StreamTape verified streams: " + streams.length);
    return streams;
  }

  // ── Vinovo (dedicated extractor) ─────────────────────────────────────────
  // Vinovo uses JWPlayer with the HLS URL set via jwplayer().setup({sources:[{file:"..."}]})
  // or via a playlist config. The XFileSharing fallback never found anything because
  // Vinovo's CDN URLs don't match .mp4/.m3u8 in the path — they're query-param based.
  async function resolveVinovo(embedUrl, source) {
    let body;
    try {
      body = await fetchText(embedUrl, baseUrl() + "/");
    } catch (e) {
      console.log("ConteudoG Vinovo fetch failed: " + String(e && e.message || e));
      return [];
    }
    const unpacked = await unpackMaybe(body);
    const text = body + "\n" + unpacked;
    const candidates = [];

    // JWPlayer setup patterns
    const jwPatterns = [
      /(?:file|src)\s*:\s*["']([^"']+)["']/ig,
      /sources\s*:\s*\[[\s\S]{0,500}?["']?file["']?\s*:\s*["']([^"']+)["']/i,
      /"hls"\s*:\s*"([^"]+)"/i,
      /playlist\s*:\s*\[[\s\S]{0,500}?(?:file|src)\s*:\s*["']([^"']+)["']/i,
      // Generic: any CDN URL with video extension or streaming path
      /["'](https?:\/\/[^"']+\.m3u8[^"']*?)["']/ig,
      /["'](https?:\/\/[^"']+\.mp4[^"']*?)["']/ig,
      // Vinovo CDN may serve URLs without extension but with streaming path keywords
      /["'](https?:\/\/[^"']*(?:\/hls\/|\/stream\/|\/play\/|\/video\/)[^"']+)["']/ig
    ];

    for (const p of jwPatterns) {
      // Reset lastIndex for global regexes
      if (p.global) p.lastIndex = 0;
      let m;
      while ((m = p.exec(text)) !== null) {
        if (m && m[1] && /^https?:\/\//i.test(m[1])) candidates.push(m[1]);
        if (!p.global) break;
      }
    }

    // Also look for the encoded/obfuscated source in a data attribute or atob call
    const atobM = /atob\(['"]([A-Za-z0-9+/=]+)['"]\)/.exec(text);
    if (atobM) {
      try {
        const decoded = atob(atobM[1]);
        if (/^https?:\/\//i.test(decoded)) candidates.push(decoded);
        // decoded may itself contain patterns
        const innerM = /["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*?)["']/i.exec(decoded);
        if (innerM) candidates.push(innerM[1]);
      } catch (_) {}
    }

    const filtered = [...new Set(candidates)].filter(isPlayableUrl);
    console.log("ConteudoG Vinovo candidates: " + filtered.length + " from " + embedUrl);
    return candidatesToStreams(filtered, source || "Vinovo", embedUrl, { Referer: embedUrl });
  }

  // ── Generic XFileSharing ──────────────────────────────────────────────────
  function collectPlayableCandidates(text, embedUrl) {
    const candidates = [];
    const regexes = [
      /(?:file|src|source|video|url|hls)\s*[=:]\s*["']([^"']+(?:\.m3u8|\.mp4|\.mkv|\.webm)[^"']*?)["']/ig,
      /sources\s*[=:]\s*\[[\s\S]{0,800}?file\s*[=:]\s*["']([^"']+)["']/ig,
      /<source\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/ig,
      /["'](https?:\/\/[^"']+(?:\.m3u8|\.mp4|\.mkv|\.webm|get_video|videoplayback|\/hls\/|\/stream\/)[^"']*?)["']/ig,
      /["'](\/[^"']+(?:\.m3u8|\.mp4|\.mkv|\.webm|get_video|videoplayback|\/hls\/|\/stream\/)[^"']*?)["']/ig
    ];
    for (const re of regexes) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m && m[1]) candidates.push(absoluteUrl(m[1], embedUrl));
      }
    }
    return candidates.filter(isPlayableUrl);
  }

  async function resolveXFileSharing(embedUrl, source) {
    let body;
    try {
      body = await fetchText(embedUrl, baseUrl() + "/");
    } catch (e) {
      console.log("ConteudoG XFS fetch failed for " + embedUrl + ": " + String(e && e.message || e));
      return [];
    }
    const unpacked = await unpackMaybe(body);
    const text = body + "\n" + unpacked;
    let candidates = collectPlayableCandidates(text, embedUrl);

    const codeMatch = /\/(?:embed|e|v|d)\/([a-z0-9]+)(?:[/?#]|$)/i.exec(embedUrl) || /\/([a-z0-9]{8,})(?:[/?#]|$)/i.exec(embedUrl);
    if (codeMatch && codeMatch[1]) {
      const origin = streamOrigin(embedUrl);
      // NOTE: minochinos.com removed — dead DNS (confirmed from logs)
      const alternates = [
        origin + "/d/" + codeMatch[1],
        origin + "/download/" + codeMatch[1],
        origin + "/" + codeMatch[1]
      ];
      for (const alt of alternates) {
        try {
          const altBody = await fetchText(alt, embedUrl);
          const altUnpacked = await unpackMaybe(altBody);
          candidates.push(...collectPlayableCandidates(altBody + "\n" + altUnpacked, alt));
        } catch (_) {}
      }
    }

    return candidatesToStreams(candidates, source || hostLabel(embedUrl), embedUrl, { Referer: embedUrl });
  }

  async function resolveGeneric(embedUrl, source) {
    let body;
    try {
      body = await fetchText(embedUrl, baseUrl() + "/");
    } catch (e) {
      console.log("ConteudoG generic fetch failed for " + embedUrl + ": " + String(e && e.message || e));
      return [];
    }
    const unpacked = await unpackMaybe(body);
    const candidates = collectPlayableCandidates(body + "\n" + unpacked, embedUrl);
    return candidatesToStreams(candidates, source || hostLabel(embedUrl), embedUrl, { Referer: embedUrl });
  }

  // ── Dispatcher ────────────────────────────────────────────────────────────
  async function resolveEmbed(embedUrl, server) {
    const h = hostLabel(embedUrl).toLowerCase();
    if (/mxdrop|mixdrop/.test(h)) return resolveMixDrop(embedUrl, server || "MixDrop");
    if (/\bvoe\b/.test(h)) return resolveVoe(embedUrl, server || "Voe");
    if (/streamtape/.test(h)) return resolveStreamTape(embedUrl, server || "StreamTape");
    // FIX: vinovo now has a dedicated extractor; playmogo added as XFS variant
    if (/vinovo/.test(h)) return resolveVinovo(embedUrl, server || "Vinovo");
    if (/playmogo|earnvids|filemoon|streamwish|vidhide|uqload|dood|lulustream|wolfstream/.test(h)) {
      return resolveXFileSharing(embedUrl, server || hostLabel(embedUrl));
    }
    return resolveGeneric(embedUrl, server || hostLabel(embedUrl));
  }

  function dedupeStreams(streams) {
    const seen = {};
    const out = [];
    for (const s of streams || []) {
      if (!s || !s.url) continue;
      const k = s.source + "|" + s.url;
      if (seen[k]) continue;
      seen[k] = true;
      out.push(s);
    }
    return out;
  }

  async function loadStreams(url, cb) {
    try {
      const input = absoluteUrl(url, baseUrl() + "/");
      let players = [];
      if (/conteudog\.com\.br/i.test(input)) {
        const html = await fetchText(input, baseUrl() + "/");
        players = extractPlayers(html);
      } else {
        players = [{ server: hostLabel(input), embedUrl: input }];
      }

      const streams = [];
      for (const p of players) {
        try {
          const resolved = await resolveEmbed(p.embedUrl, p.server);
          console.log("ConteudoG resolved " + resolved.length + " stream(s) from " + p.server + " -> " + p.embedUrl);
          streams.push(...resolved);
        } catch (e) {
          console.error("Resolver failed for " + p.server + ": " + String(e && e.message || e));
        }
      }

      cb({ success: true, data: dedupeStreams(streams).slice(0, 20) });
    } catch (e) {
      cb({ success: false, errorCode: "STREAM_ERROR", message: String(e && (e.stack || e.message) || e) });
    }
  }

  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();
