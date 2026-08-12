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
  timeout: 5000 
};

const GENRE_SLUGS = {
  "Hành động": "hanh-dong", "Hài hước": "hai-huoc", "Tình cảm": "tinh-cam", 
  "Kinh dị": "kinh-di", "Viễn tưởng": "vien-tuong", "Võ thuật": "vo-thuat", 
  "Tâm lý": "tam-ly", "Cổ trang": "co-trang", "Hình sự": "hinh-su",
  "Thần thoại": "than-thoai", "Gia đình": "gia-dinh", "Chiến tranh": "chien-tranh"
};

const COUNTRY_SLUGS = {
  "Âu Mỹ": "au-my", "Hàn Quốc": "han-quoc", "Trung Quốc": "trung-quoc", 
  "Nhật Bản": "nhat-ban", "Thái Lan": "thai-lan", "Đài Loan": "dai-loan", "Hồng Kông": "hong-kong"
};

// Menu đã gỡ bỏ "Việt Nam" khỏi phần quốc tế vì đã có khu vực riêng
const MOVIE_GENRES = ["⭐ Top Điểm Cao", "2026", "2025", "2024", "2023", "2022", "2021", "2020", "Hành động", "Kinh dị", "Hài hước", "Viễn tưởng", "Tâm lý", "Cổ trang", "Võ thuật", "Hình sự", "Âu Mỹ", "Hàn Quốc"];
const SERIES_GENRES = ["⭐ Top Điểm Cao", "2026", "2025", "2024", "2023", "2022", "2021", "2020", "Hàn Quốc", "Trung Quốc", "Âu Mỹ", "Thái Lan", "Đài Loan", "Tình cảm", "Cổ trang", "Hình sự"];
const VN_GENRES = ["⭐ Top Điểm Cao", "2026", "2025", "2024", "2023", "2022", "2021", "2020"];

const manifest = {
  id: "org.phimtonghop.v440",
  version: "4.4.0",
  name: "Kho Phim Tổng Hợp HD",
  description: "Bản V4.4.0: Tách riêng Phim Lẻ Việt Nam và Phim Bộ Việt Nam.",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"], 
  idPrefixes: ["phimapi:"],
  catalogs: [
    {
      type: "movie",
      id: "phim_le",
      name: "🎬 Phim Lẻ Quốc Tế",
      extra: [{ name: "genre", options: MOVIE_GENRES, isRequired: false }, { name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "series",
      id: "phim_bo",
      name: "📺 Phim Bộ Quốc Tế",
      extra: [{ name: "genre", options: SERIES_GENRES, isRequired: false }, { name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "phim_le_viet",
      name: "🇻🇳 Phim Lẻ Việt Nam",
      extra: [{ name: "genre", options: VN_GENRES, isRequired: false }, { name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "series",
      id: "phim_bo_viet",
      name: "🇻🇳 Phim Bộ Việt Nam",
      extra: [{ name: "genre", options: VN_GENRES, isRequired: false }, { name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "hoat_hinh",
      name: "🦄 Hoạt Hình & Anime",
      extra: [{ name: "genre", options: ["⭐ Top Điểm Cao", "2026", "2025", "2024", "Nhật Bản", "Trung Quốc", "Âu Mỹ"], isRequired: false }, { name: "search", isRequired: false }, { name: "skip", isRequired: false }]
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
    const cacheKey = `search_v44_${args.extra.search.toLowerCase().trim()}`;
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
    let targetUrl = "";
    let isTopRating = selectedGenre === "⭐ Top Điểm Cao";
    let filterYear = null;

    if (selectedGenre && !isNaN(selectedGenre) && selectedGenre.length === 4) {
      filterYear = parseInt(selectedGenre);
    }

    // Điều hướng link API chuẩn cho từng Catalog
    if (args.id === "phim_le") targetUrl = "https://phimapi.com/v1/api/danh-sach/phim-le";
    else if (args.id === "phim_bo") targetUrl = "https://phimapi.com/v1/api/danh-sach/phim-bo";
    else if (args.id === "phim_le_viet") targetUrl = "https://phimapi.com/v1/api/quoc-gia/viet-nam";
    else if (args.id === "phim_bo_viet") targetUrl = "https://phimapi.com/v1/api/quoc-gia/viet-nam";
    else if (args.id === "hoat_hinh") targetUrl = "https://phimapi.com/v1/api/danh-sach/hoat-hinh";

    if (COUNTRY_SLUGS[selectedGenre]) {
      targetUrl = `https://phimapi.com/v1/api/quoc-gia/${COUNTRY_SLUGS[selectedGenre]}`;
    } else if (GENRE_SLUGS[selectedGenre]) {
      targetUrl = `https://phimapi.com/v1/api/the-loai/${GENRE_SLUGS[selectedGenre]}`;
    }

    // Nếu vào mục phim Việt hoặc Lọc nâng cao, tự động tải 10 trang (320 phim) để bóc tách cho đủ lượng
    let numPagesFetch = (isTopRating || filterYear || args.id.includes("viet")) ? 10 : 5;
    let items = await fetchItemsFromUrl(targetUrl, numPagesFetch);

    // Ép kiểu hiển thị đúng lẻ/bộ cho TẤT CẢ mục (Bao gồm cả mục Phim Việt mới)
    if (args.id === "phim_le" || args.id === "phim_le_viet") items = items.filter(i => i.type === "single" || !i.type);
    if (args.id === "phim_bo" || args.id === "phim_bo_viet") items = items.filter(i => i.type === "series");

    if (filterYear) {
      items = items.filter(i => parseInt(i.year) === filterYear);
    }

    if (isTopRating || filterYear) {
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
    const cacheKey = `meta_detail_v44_${slug}`;
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

// ============ 3. STREAM HANDLER ============
builder.defineStreamHandler(async (args) => {
  if (args.id?.startsWith("phimapi:")) {
    const idParts = args.id.replace("phimapi:", "").split(":");
    const slug = idParts[0];
    const seasonNum = idParts[1] ? parseInt(idParts[1]) : 1;
    const episodeNum = idParts[2] ? parseInt(idParts[2]) : null;

    const cacheKey = `streams_agg_v44_${slug}_S${seasonNum}_E${episodeNum || 'full'}`;
    if (appCache.has(cacheKey)) return { streams: appCache.get(cacheKey) };

    const sourceEndpoints = [
      { name: "Nguồn C", url: `https://phim.nguonc.com/api/film/${slug}`, timeout: 2500 },
      { name: "KKPhim", url: `https://kkphim.vip/phim/${slug}`, timeout: 2500 },
      { name: "PhimAPI", url: `https://phimapi.com/phim/${slug}`, timeout: 2500 },
      { name: "Ophim", url: `https://ophim1.com/phim/${slug}`, timeout: 3000 },
    ];

    const requests = sourceEndpoints.map(src => 
      axios.get(src.url, { ...AXIOS_CONFIG, timeout: src.timeout })
        .then(res => ({
          source: src.name,
          episodes: res.data?.episodes || res.data?.movie?.episodes || []
        }))
        .catch(() => ({ source: src.name, episodes: [] }))
    );

    const results = await Promise.all(requests);
    const streams = [];
    const seenUrls = new Set(); 

    results.forEach(item => {
      if (item.episodes && item.episodes.length > 0) {
        item.episodes.forEach(server => {
          const serverName = server.server_name || "Server HD";
          if (server.server_data) {
            server.server_data.forEach((ep, index) => {
              const currentEpNum = index + 1;
              if (episodeNum && currentEpNum !== episodeNum) return;

              if (ep.link_m3u8 && !seenUrls.has(ep.link_m3u8)) {
                seenUrls.add(ep.link_m3u8);
                streams.push({
                  name: `[${item.source}]`,
                  title: `${serverName} - ${ep.name || "Tập " + currentEpNum}\n▶ Xem Mượt`,
                  url: ep.link_m3u8
                });
              }
            });
          }
        });
      }
    });

    if (streams.length > 0) appCache.set(cacheKey, streams, 7200); 
    return { streams: streams };
  }
  return { streams: [] };
});

const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(() => {
    axios.get(`${RENDER_URL}/manifest.json`)
      .then(() => console.log("[Keep-Alive] Ping Phim thành công!"))
      .catch((err) => console.log("[Keep-Alive] Lỗi ping:", err.message));
  }, 10 * 60 * 1000);
}

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT }).then(({ url }) => {
  console.log(`Addon Phim Tối Ưu v4.4.0 đang chạy tại: ${url}manifest.json`);
});
