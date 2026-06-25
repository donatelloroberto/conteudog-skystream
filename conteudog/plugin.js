(function () {
  "use strict";

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
    return /^https?:\/\//i.test(url) && /(\.m3u8|\.mp4|\.mkv|\.webm|\/hls\/|\/manifest\/|\/video\/|stream|download|cdn)/i.test(url);
  }

  function proxied(url, headers) {
    const config = { url, headers: headers || headersFor(url), options: { referer: (headers && headers.Referer) || baseUrl() + "/" } };
    return "MAGIC_PROXY_v2" + btoa(JSON.stringify(config));
  }

  function toStream(url, source, referer, extraHeaders) {
    const headers = Object.assign({}, headersFor(referer || url), extraHeaders || {});
    const finalUrl = proxied(url, headers);
    return new StreamResult({
      url: finalUrl,
      source: source + (qualityFromUrl(url) ? " " + qualityFromUrl(url) : ""),
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

  async function resolveMixDrop(embedUrl, source) {
    const body = await fetchText(embedUrl, baseUrl() + "/");
    const unpacked = await unpackMaybe(body);
    const candidates = [];
    const patterns = [
      /wurl\s*=\s*["']([^"']+)["']/i,
      /MDCore\.wurl\s*=\s*["']([^"']+)["']/i,
      /(?:file|src)\s*:\s*["']([^"']+(?:\.mp4|\.m3u8)[^"']*)["']/i,
      /["'](https?:\/\/[^"']+(?:\.mp4|\.m3u8)[^"']*)["']/i,
      /["'](\/[^"']+(?:\.mp4|\.m3u8)[^"']*)["']/i
    ];
    for (const p of patterns) {
      const m = p.exec(unpacked) || p.exec(body);
      if (m && m[1]) candidates.push(absoluteUrl(m[1], embedUrl));
    }
    return dedupeStreams(candidates.filter(isPlayableUrl).map((u) => toStream(u, source || "MixDrop", embedUrl, { Referer: embedUrl })));
  }

  async function resolveVoe(embedUrl, source) {
    const body = await fetchText(embedUrl, baseUrl() + "/");
    const unpacked = await unpackMaybe(body);
    const text = body + "\n" + unpacked;
    const candidates = [];
    const patterns = [
      /["']hls["']\s*:\s*["']([^"']+)["']/i,
      /hls\s*:\s*["']([^"']+)["']/i,
      /sources\s*=\s*\{[\s\S]*?["']file["']\s*:\s*["']([^"']+)["']/i,
      /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
      /["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i
    ];
    for (const p of patterns) {
      const m = p.exec(text);
      if (m && m[1]) candidates.push(absoluteUrl(m[1], embedUrl));
    }
    return dedupeStreams(candidates.filter(isPlayableUrl).map((u) => toStream(u, source || "Voe", embedUrl, { Referer: embedUrl })));
  }

  async function resolveStreamTape(embedUrl, source) {
    const body = await fetchText(embedUrl, baseUrl() + "/");
    const candidates = [];
    const direct = /["'](https?:\/\/[^"']+(?:\.mp4|\.m3u8)[^"']*)["']/i.exec(body);
    if (direct && direct[1]) candidates.push(direct[1]);

    const concat = /innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*\(?['"]([^'"]+)['"]/i.exec(body);
    if (concat && concat[1]) candidates.push("https:" + concat[1] + (concat[2] || ""));

    const robot = /id\s*=\s*["']norobotlink["'][^>]*>([\s\S]*?)<\/[^>]+>/i.exec(body);
    if (robot && robot[1]) {
      const part = cleanText(robot[1]);
      if (part.startsWith("//")) candidates.push("https:" + part);
      else if (part.startsWith("/")) candidates.push("https:" + part);
    }

    return dedupeStreams(candidates.map((u) => absoluteUrl(u.replace(/&amp;/g, "&"), embedUrl)).filter(isPlayableUrl).map((u) => toStream(u, source || "StreamTape", embedUrl, { Referer: embedUrl })));
  }

  async function resolveGeneric(embedUrl, source) {
    const body = await fetchText(embedUrl, baseUrl() + "/");
    const unpacked = await unpackMaybe(body);
    const text = body + "\n" + unpacked;
    const candidates = [];
    const regexes = [
      /(?:file|src|source|video|url)\s*[:=]\s*["']([^"']+(?:\.m3u8|\.mp4|\.mkv|\.webm)[^"']*)["']/ig,
      /["'](https?:\/\/[^"']+(?:\.m3u8|\.mp4|\.mkv|\.webm)[^"']*)["']/ig,
      /["'](\/[^"']+(?:\.m3u8|\.mp4|\.mkv|\.webm)[^"']*)["']/ig
    ];
    for (const re of regexes) {
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m && m[1]) candidates.push(absoluteUrl(m[1], embedUrl));
      }
    }
    return dedupeStreams(candidates.filter(isPlayableUrl).map((u) => toStream(u, source || hostLabel(embedUrl), embedUrl, { Referer: embedUrl })));
  }

  async function resolveEmbed(embedUrl, server) {
    const h = hostLabel(embedUrl).toLowerCase();
    if (/mxdrop|mixdrop/.test(h)) return resolveMixDrop(embedUrl, server || "MixDrop");
    if (/voe/.test(h)) return resolveVoe(embedUrl, server || "Voe");
    if (/streamtape/.test(h)) return resolveStreamTape(embedUrl, server || "StreamTape");
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
