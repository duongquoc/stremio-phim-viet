const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const NodeCache = require("node-cache");

const appCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const PHIM_IMG_BASE = "https://phimimg.com/";

const AXIOS_CONFIG = {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*"
  },
  timeout: 4000 
};

// Map danh mục
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
  id: "org.phimtonghop.k20pro",
  version: "5.1.0",
  name: "K20 Phim Tổng Hợp",
  description: "Bản V5.1 Final: Bóc tách luồng siêu tốc. Sửa lỗi sai tập Phim Bộ/Anime. Tích hợp 5 API gốc.",
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
    const cacheKey = `search_k20_${args.extra.search.toLowerCase().trim()}`;
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
    const cacheKey = `meta_detail_k20_${slug}`;
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

// ============ 3. STREAM HANDLER (BỘ 5 CỔNG SIÊU TỐC V5.1) ============
builder.defineStreamHandler(async (args) => {
  if (args.id?.startsWith("phimapi:")) {
    const idParts = args.id.replace("phimapi:", "").split(":");
    const slug = idParts[0];
    const episodeNum = idParts[2] ? parseInt(idParts[2]) : 1;

    const cacheKey = `streams_k20_v51_${slug}_E${episodeNum}`;
    if (appCache.has(cacheKey)) return { streams: appCache.get(cacheKey) };

    const fetchers = [
      // 1. VSMOV
      (async () => {
        try {
          const res = await axios.get(`https://vsmov.com/api/film/${slug}`, AXIOS_CONFIG);
          const servers = res.data?.episodes || res.data?.movie?.episodes || [];
          return parseServerEpisodes(servers, "VSMOV", "🌐 HLS Proxy", episodeNum);
        } catch { return []; }
      })(),

      // 2. KKPHIM / PHIMAPI
      (async () => {
        try {
          const res = await axios.get(`https://phimapi.com/phim/${slug}`, AXIOS_CONFIG);
          const servers = res.data?.episodes || [];
          return parseServerEpisodes(servers, "KKPhim", "⚡ Direct CDN", episodeNum);
        } catch { return []; }
      })(),

      // 3. NGUONC
      (async () => {
        try {
          const res = await axios.get(`https://phim.nguonc.com/api/film/${slug}`, AXIOS_CONFIG);
          const servers = res.data?.movie?.episodes || [];
          return parseServerEpisodes(servers, "NguonC", "⚡ Direct CDN", episodeNum);
        } catch { return []; }
      })(),

      // 4. OPHIM (Đã Fix trỏ về Domain API vĩnh viễn)
      (async () => {
        try {
          const res = await axios.get(`https://ophim1.com/phim/${slug}`, AXIOS_CONFIG);
          const servers = res.data?.episodes || [];
          return parseServerEpisodes(servers, "Ophim", "⚡ Direct CDN", episodeNum);
        } catch { return []; }
      })(),

      // 5. VICDN
      (async () => {
        try {
          const res = await axios.get(`https://vicdn.cc/api/film/${slug}`, AXIOS_CONFIG);
          const servers = res.data?.episodes || res.data?.movie?.episodes || [];
          return parseServerEpisodes(servers, "ViCDN", "⚡ Fast CDN", episodeNum);
        } catch { return []; }
      })()
    ];

    const results = await Promise.allSettled(fetchers);
    const streams = [];
    const seenUrls = new Set();

    results.forEach(r => {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        r.value.forEach(st => {
          if (!seenUrls.has(st.url)) {
            seenUrls.add(st.url);
            streams.push(st);
          }
        });
      }
    });

    if (streams.length > 0) appCache.set(cacheKey, streams, 7200); 
    return { streams: streams };
  }
  return { streams: [] };
});

// Hàm bóc tách tập phim siêu chuẩn (Fix triệt để lỗi Regex)
function parseServerEpisodes(servers, sourceName, tag, targetEpNum) {
  const result = [];
  if (!Array.isArray(servers)) return result;

  servers.forEach(server => {
    const serverName = server.server_name || "Vietsub";
    const epList = server.server_data || server.items || [];

    epList.forEach((ep, idx) => {
      let epNum = idx + 1; // Mặc định thứ tự nếu không tìm thấy số
      
      if (ep.slug === "full" || ep.slug === "tap-full") {
          epNum = 1;
      } else {
          // Dùng Regex quét sạch chữ, chỉ giữ lại số (Khắc phục hoàn toàn lỗi parseInt "Tập 1" ra NaN)
          const matchStr = String(ep.name || ep.slug || "");
          const numberMatch = matchStr.match(/\d+/);
          if (numberMatch) {
              epNum = parseInt(numberMatch[0]);
          }
      }

      if (epNum === targetEpNum || epList.length === 1) {
        const link = ep.link_m3u8 || ep.m3u8;
        if (link && (link.includes(".m3u8") || link.includes(".mp4"))) {
          result.push({
            name: `K20 • ${sourceName}`,
            title: `[${sourceName}] ${serverName}\n${tag} • Vietsub/TM`,
            url: link
          });
        }
      }
    });
  });

  return result;
}

// ============ KEEP ALIVE ============
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(() => {
    axios.get(`${RENDER_URL}/manifest.json`)
      .then(() => console.log("[Keep-Alive] Ping K20 thành công!"))
      .catch((err) => console.log("[Keep-Alive] Lỗi ping:", err.message));
  }, 10 * 60 * 1000);
}

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT }).then(({ url }) => {
  console.log(`Addon K20 v5.1 đang chạy tại: ${url}manifest.json`);
});
