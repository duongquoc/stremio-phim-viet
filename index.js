const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const NodeCache = require("node-cache");

const appCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const PHIM_IMG_BASE = "https://phimimg.com/";

const AXIOS_CONFIG = {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://google.com"
  },
  timeout: 4000 
};

// Map chuẩn danh mục
const GENRE_SLUGS = {
  "Hành động": "hanh-dong", "Hài hước": "hai-huoc", "Tình cảm": "tinh-cam", 
  "Kinh dị": "kinh-di", "Viễn tưởng": "vien-tuong", "Võ thuật": "vo-thuat", 
  "Tâm lý": "tam-ly", "Cổ trang": "co-trang", "Hình sự": "hinh-su"
};

const COUNTRY_SLUGS = {
  "Âu Mỹ": "au-my", "Hàn Quốc": "han-quoc", "Trung Quốc": "trung-quoc", 
  "Nhật Bản": "nhat-ban", "Thái Lan": "thai-lan"
};

const manifest = {
  id: "org.phimtonghop.hd",
  version: "5.0.0",
  name: "Kho Phim Tổng Hợp HD",
  description: "Tổng hợp nguồn phim chất lượng cao từ PhimAPI, NguonC, VSMOV, Ophim.",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"], 
  idPrefixes: ["phimapi:"],
  catalogs: [
    {
      type: "movie",
      id: "phim_moi_viet",
      name: "🇻🇳 Phim Mới (Việt Nam)",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "phim_viet_top",
      name: "🇻🇳 Top Điểm (Việt Nam)",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "phim_le_viet",
      name: "🇻🇳 Phim Lẻ (Việt Nam)",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "series",
      id: "phim_bo_viet",
      name: "🇻🇳 Phim Bộ (Việt Nam)",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "phim_moi_quoc_te",
      name: "🌍 Phim Mới (Quốc Tế)",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "phim_top_quoc_te",
      name: "🌍 Top Điểm (Quốc Tế)",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "phim_le",
      name: "🎬 Phim Lẻ Quốc Tế",
      extra: [{ name: "genre", options: ["Hành động", "Kinh dị", "Hài hước", "Viễn tưởng", "Tâm lý", "Cổ trang", "Võ thuật", "Hình sự", "Âu Mỹ", "Hàn Quốc"], isRequired: false }, { name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "series",
      id: "phim_bo",
      name: "📺 Phim Bộ Quốc Tế",
      extra: [{ name: "genre", options: ["Hàn Quốc", "Trung Quốc", "Âu Mỹ", "Thái Lan", "Tình cảm", "Cổ trang", "Hình sự"], isRequired: false }, { name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "hoat_hinh",
      name: "🦄 Hoạt Hình & Anime",
      extra: [{ name: "genre", options: ["Nhật Bản", "Trung Quốc", "Âu Mỹ"], isRequired: false }, { name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    }
  ]
};

const builder = new addonBuilder(manifest);

function formatImageUrl(path) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${PHIM_IMG_BASE}${path}`;
}

async function fetchItemsFromUrl(baseUrl, numPages = 5) {
  const allItems = [];
  const separator = baseUrl.includes("?") ? "&" : "?";
  const requests = [];

  for (let i = 1; i <= numPages; i++) {
    requests.push(axios.get(`${baseUrl}${separator}page=${i}&limit=32`, AXIOS_CONFIG).catch(() => null));
  }

  const responses = await Promise.all(requests);
  responses.forEach((res) => {
    if (res && res.data?.data?.items) {
      allItems.push(...res.data.data.items);
    }
  });
  return allItems;
}

function convertItemsToMetas(items) {
  return items.map((item) => {
    let rating = "N/A";
    if (item.tmdb?.vote_average) rating = item.tmdb.vote_average;
    else if (item.imdb?.rating) rating = item.imdb.rating;

    const baseName = item.name || item.origin_name;
    const isSeries = item.type === "series";

    return {
      id: `phimapi:${item.slug}`,
      type: isSeries ? "series" : "movie", 
      name: rating !== "N/A" ? `${baseName} [⭐ ${rating}]` : baseName,
      poster: formatImageUrl(item.poster_url || item.thumb_url),
      background: formatImageUrl(item.thumb_url || item.poster_url),
      description: `⭐ Điểm: ${rating}/10\nTên gốc: ${item.origin_name || item.name}\nNăm: ${item.year || "N/A"}`,
      releaseInfo: item.year ? String(item.year) : "",
      imdbRating: rating !== "N/A" ? String(rating) : undefined
    };
  });
}

// ============ 1. CATALOG HANDLER ============
builder.defineCatalogHandler(async (args) => {
  const skip = args.extra?.skip || 0; 
  
  if (args.extra?.search) {
    const cacheKey = `search_${args.extra.search.toLowerCase().trim()}`;
    let metas = appCache.get(cacheKey);
    if (!metas) {
      try {
        const res = await axios.get(`https://phimapi.com/v1/api/tim-kiem?keyword=${encodeURIComponent(args.extra.search)}&limit=40`, AXIOS_CONFIG);
        metas = convertItemsToMetas(res.data?.data?.items || []);
        appCache.set(cacheKey, metas, 3600);
      } catch (error) { metas = []; }
    }
    return { metas: metas.slice(skip, skip + 100) };
  }

  const selectedGenre = args.extra?.genre || null;
  const cacheKey = `cat_${args.id}_${selectedGenre || "all"}`;
  let metas = appCache.get(cacheKey);

  if (!metas) {
    let isTopRating = args.id === "phim_viet_top" || args.id === "phim_top_quoc_te";
    let items = [];

    if (args.id === "phim_top_quoc_te" || args.id === "phim_moi_quoc_te") {
      const pages = args.id === "phim_top_quoc_te" ? 15 : 6;
      const le = await fetchItemsFromUrl("https://phimapi.com/v1/api/danh-sach/phim-le", pages);
      const bo = await fetchItemsFromUrl("https://phimapi.com/v1/api/danh-sach/phim-bo", pages);
      
      if (args.id === "phim_moi_quoc_te") {
        const maxLen = Math.max(le.length, bo.length);
        for (let i = 0; i < maxLen; i++) {
          if (le[i]) items.push(le[i]);
          if (bo[i]) items.push(bo[i]);
        }
      } else {
        items = [...le, ...bo];
      }
    } else {
      let targetUrl = "";
      if (args.id === "phim_le") targetUrl = "https://phimapi.com/v1/api/danh-sach/phim-le";
      else if (args.id === "phim_bo") targetUrl = "https://phimapi.com/v1/api/danh-sach/phim-bo";
      else if (args.id === "hoat_hinh") targetUrl = "https://phimapi.com/v1/api/danh-sach/hoat-hinh";
      else if (args.id.includes("viet")) targetUrl = "https://phimapi.com/v1/api/quoc-gia/viet-nam";

      if (selectedGenre) {
        if (COUNTRY_SLUGS[selectedGenre]) {
          targetUrl = `https://phimapi.com/v1/api/quoc-gia/${COUNTRY_SLUGS[selectedGenre]}`;
        } else if (GENRE_SLUGS[selectedGenre]) {
          targetUrl = `https://phimapi.com/v1/api/the-loai/${GENRE_SLUGS[selectedGenre]}`;
        }
      }

      let numPagesFetch = (isTopRating || args.id.includes("viet")) ? 10 : 5;
      items = await fetchItemsFromUrl(targetUrl, numPagesFetch);
    }

    if (args.id === "phim_le" || args.id === "phim_le_viet") items = items.filter(i => i.type === "single" || !i.type);
    if (args.id === "phim_bo" || args.id === "phim_bo_viet") items = items.filter(i => i.type === "series");

    if (isTopRating) {
      items = items.filter(a => parseFloat(a.tmdb?.vote_average || a.imdb?.rating || 0) > 0);
      items.sort((a, b) => {
        const scoreA = parseFloat(a.tmdb?.vote_average || a.imdb?.rating || 0);
        const scoreB = parseFloat(b.tmdb?.vote_average || b.imdb?.rating || 0);
        return scoreB - scoreA; 
      });
    }

    metas = convertItemsToMetas(items);
    appCache.set(cacheKey, metas, 21600); 
  }

  return { metas: metas.slice(skip, skip + 100) };
});

// ============ 2. META HANDLER ============
builder.defineMetaHandler(async (args) => {
  if (args.id?.startsWith("phimapi:")) {
    const slug = args.id.replace("phimapi:", "").split(":")[0]; 
    const cacheKey = `meta_detail_${slug}`;
    if (appCache.has(cacheKey)) return { meta: appCache.get(cacheKey) };

    try {
      const res = await axios.get(`https://phimapi.com/phim/${slug}`, AXIOS_CONFIG);
      const movie = res.data?.movie;
      if (!movie) return { meta: {} };

      let rating = "N/A";
      if (movie.tmdb?.vote_average) rating = movie.tmdb.vote_average;

      const cleanDescription = movie.content ? movie.content.replace(/<[^>]*>?/gm, "") : `Năm: ${movie.year || "N/A"}`;
      const isSeries = movie.type === "series";

      const meta = {
        id: `phimapi:${slug}`,
        type: isSeries ? "series" : "movie",
        name: movie.name || movie.origin_name,
        poster: formatImageUrl(movie.poster_url || movie.thumb_url),
        background: formatImageUrl(movie.thumb_url || movie.poster_url),
        description: `⭐ ĐIỂM: ${rating}/10\n\n${cleanDescription}`,
        releaseInfo: movie.year ? String(movie.year) : "",
        genres: movie.category ? movie.category.map((c) => c.name) : ["Phim"],
        imdbRating: rating !== "N/A" ? String(rating) : undefined
      };

      appCache.set(cacheKey, meta, 86400); 
      return { meta: meta };
    } catch (e) { return { meta: {} }; }
  }
  return { meta: {} };
});

// ============ BỘ GIẢI MÃ LINK EMBED TỪ NGUONC ============
async function resolveNguonCEmbed(embedUrl) {
  if (!embedUrl) return null;
  const cacheKey = `embed_res_${embedUrl}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  try {
    const res = await axios.get(embedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://phim.nguonc.com/"
      },
      timeout: 3000
    });
    const match = String(res.data).match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
    if (match && match[1]) {
      const directM3u8 = match[1].replace(/\\/g, "");
      appCache.set(cacheKey, directM3u8, 86400);
      return directM3u8;
    }
  } catch (err) {}
  return null;
}

// ============ 3. STREAM HANDLER (BÓC TÁCH NGUỒN TỰ ĐỘNG) ============
builder.defineStreamHandler(async (args) => {
  if (args.id?.startsWith("phimapi:")) {
    const idParts = args.id.replace("phimapi:", "").split(":");
    const slug = idParts[0];
    const episodeNum = idParts[2] ? parseInt(idParts[2]) : null;

    const cacheKey = `streams_agg_${slug}_E${episodeNum || 'full'}`;
    if (appCache.has(cacheKey)) return { streams: appCache.get(cacheKey) };

    const streams = [];
    const seenUrls = new Set();

    // 1. PhimAPI (KKPhim)
    const p1 = (async () => {
      try {
        const res = await axios.get(`https://phimapi.com/phim/${slug}`, AXIOS_CONFIG);
        const epServers = res.data?.episodes || [];
        epServers.forEach(server => {
          const sName = server.server_name || "Vietsub";
          (server.server_data || []).forEach((ep, idx) => {
            const curEp = idx + 1;
            if (episodeNum && curEp !== episodeNum) return;
            const url = ep.link_m3u8 || ep.m3u8;
            if (url && (url.includes('.m3u8') || url.includes('.mp4')) && !seenUrls.has(url)) {
              seenUrls.add(url);
              streams.push({
                name: "[PhimAPI]",
                title: `${sName} - ${ep.name || "Full"}\n⚡ Direct CDN • Vietsub/TM`,
                url: url
              });
            }
          });
        });
      } catch (e) {}
    })();

    // 2. VSMOV
    const p2 = (async () => {
      try {
        const res = await axios.get(`https://vsmov.com/api/films/${slug}`, AXIOS_CONFIG);
        const epServers = res.data?.episodes || res.data?.movie?.episodes || [];
        epServers.forEach(server => {
          const sName = server.server_name || "Vietsub";
          (server.server_data || server.items || []).forEach((ep, idx) => {
            const curEp = idx + 1;
            if (episodeNum && curEp !== episodeNum) return;
            const url = ep.link_m3u8 || ep.m3u8;
            if (url && (url.includes('.m3u8') || url.includes('.mp4')) && !seenUrls.has(url)) {
              seenUrls.add(url);
              streams.push({
                name: "[VSMOV]",
                title: `${sName} - ${ep.name || "Full"}\n⚡ Fast CDN • Vietsub/TM`,
                url: url
              });
            }
          });
        });
      } catch (e) {}
    })();

    // 3. Ophim
    const p3 = (async () => {
      try {
        const res = await axios.get(`https://ophim1.cc/v1/api/phim/${slug}`, AXIOS_CONFIG);
        const epServers = res.data?.data?.item?.episodes || res.data?.episodes || [];
        epServers.forEach(server => {
          const sName = server.server_name || "Vietsub";
          (server.server_data || server.items || []).forEach((ep, idx) => {
            const curEp = idx + 1;
            if (episodeNum && curEp !== episodeNum) return;
            const url = ep.link_m3u8 || ep.m3u8;
            if (url && (url.includes('.m3u8') || url.includes('.mp4')) && !seenUrls.has(url)) {
              seenUrls.add(url);
              streams.push({
                name: "[Ophim]",
                title: `${sName} - ${ep.name || "Full"}\n⚡ Direct CDN • Vietsub/TM`,
                url: url
              });
            }
          });
        });
      } catch (e) {}
    })();

    // 4. NguonC
    const p4 = (async () => {
      try {
        const res = await axios.get(`https://phim.nguonc.com/api/film/${slug}`, AXIOS_CONFIG);
        const epServers = res.data?.movie?.episodes || [];
        for (const server of epServers) {
          const sName = server.server_name || "Vietsub";
          const items = server.items || [];
          for (let idx = 0; idx < items.length; idx++) {
            const curEp = idx + 1;
            if (episodeNum && curEp !== episodeNum) continue;

            let finalUrl = items[idx].m3u8 || items[idx].link_m3u8;
            if (!finalUrl && items[idx].embed) {
              finalUrl = await resolveNguonCEmbed(items[idx].embed);
            }

            if (finalUrl && (finalUrl.includes('.m3u8') || finalUrl.includes('.mp4')) && !seenUrls.has(finalUrl)) {
              seenUrls.add(finalUrl);
              streams.push({
                name: "[NguonC]",
                title: `${sName} - ${items[idx].name || "Full"}\n⚡ Direct CDN • Vietsub/TM`,
                url: finalUrl
              });
            }
          }
        }
      } catch (e) {}
    })();

    await Promise.allSettled([p1, p2, p3, p4]);

    if (streams.length > 0) appCache.set(cacheKey, streams, 7200); 
    return { streams: streams };
  }
  return { streams: [] };
});

// ============ SERVER KEEP ALIVE ============
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(() => {
    axios.get(`${RENDER_URL}/manifest.json`)
      .then(() => console.log("[Keep-Alive] Ping thành công!"))
      .catch((err) => console.log("[Keep-Alive] Lỗi ping:", err.message));
  }, 10 * 60 * 1000);
}

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT }).then(({ url }) => {
  console.log(`Addon đang chạy tại: ${url}manifest.json`);
});
