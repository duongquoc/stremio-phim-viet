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
  timeout: 8000 
};

// Map chuẩn danh mục của API
const GENRE_SLUGS = {
  "Hành động": "hanh-dong", "Hài hước": "hai-huoc", "Tình cảm": "tinh-cam", 
  "Kinh dị": "kinh-di", "Viễn tưởng": "vien-tuong", "Võ thuật": "vo-thuat", 
  "Tâm lý": "tam-ly", "Cổ trang": "co-trang"
};

const COUNTRY_SLUGS = {
  "Việt Nam": "viet-nam", "Âu Mỹ": "au-my", "Hàn Quốc": "han-quoc", 
  "Trung Quốc": "trung-quoc", "Nhật Bản": "nhat-ban", "Thái Lan": "thai-lan"
};

const manifest = {
  id: "org.phimtonghop.v400",
  version: "4.0.0",
  name: "Kho Phim Tổng Hợp HD",
  description: "Tối ưu Phân mục Lẻ/Bộ/Hoạt hình & Tích hợp API dự phòng chống chặn.",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"], // Khai báo hỗ trợ cả phim lẻ và phim bộ
  idPrefixes: ["phimapi:"],
  catalogs: [
    {
      type: "movie",
      id: "phim_le",
      name: "🎬 Phim Lẻ Mới",
      extra: [
        { name: "genre", options: ["Hành động", "Kinh dị", "Hài hước", "Viễn tưởng", "Tâm lý", "Cổ trang", "Việt Nam", "Âu Mỹ", "Hàn Quốc"], isRequired: false },
        { name: "search", isRequired: false }
      ]
    },
    {
      type: "series",
      id: "phim_bo",
      name: "📺 Phim Bộ Đang Hot",
      extra: [
        { name: "genre", options: ["Hàn Quốc", "Trung Quốc", "Âu Mỹ", "Việt Nam", "Thái Lan", "Tình cảm", "Cổ trang"], isRequired: false },
        { name: "search", isRequired: false }
      ]
    },
    {
      type: "movie",
      id: "hoat_hinh",
      name: "🦄 Hoạt Hình & Anime",
      extra: [{ name: "search", isRequired: false }]
    }
  ]
};

const builder = new addonBuilder(manifest);

function formatImageUrl(path) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${PHIM_IMG_BASE}${path}`;
}

// Hàm tải lô 25 trang siêu tốc
async function fetchItemsFromUrl(baseUrl, numPages = 25) {
  const allItems = [];
  const chunkSize = 5; 
  const separator = baseUrl.includes("?") ? "&" : "?";

  for (let i = 1; i <= numPages; i += chunkSize) {
    const requests = [];
    for (let j = i; j < i + chunkSize && j <= numPages; j++) {
      requests.push(axios.get(`${baseUrl}${separator}page=${j}`, AXIOS_CONFIG).catch(() => null));
    }

    const responses = await Promise.all(requests);
    responses.forEach((res) => {
      if (res && res.data?.data?.items) {
        allItems.push(...res.data.data.items);
      }
    });
  }
  return allItems;
}

// Hàm format Meta hiển thị đẹp
function convertItemsToMetas(items) {
  return items.map((item) => {
    let rating = "N/A";
    if (item.tmdb?.vote_average) rating = item.tmdb.vote_average;
    else if (item.imdb?.rating) rating = item.imdb.rating;

    const baseName = item.name || item.origin_name;
    const isSeries = item.type === "series";

    return {
      id: `phimapi:${item.slug}`,
      type: isSeries ? "series" : "movie", // Tự động nhận diện Phim Bộ hay Lẻ
      name: rating !== "N/A" ? `${baseName} [⭐ ${rating}]` : baseName,
      poster: formatImageUrl(item.poster_url || item.thumb_url),
      background: formatImageUrl(item.thumb_url || item.poster_url),
      description: `Tên gốc: ${item.origin_name || item.name}\nNăm phát hành: ${item.year || "N/A"}`,
      releaseInfo: item.year ? String(item.year) : "",
      imdbRating: rating !== "N/A" ? String(rating) : undefined
    };
  });
}

// ============ 1. CATALOG HANDLER ============
builder.defineCatalogHandler(async (args) => {
  // Tìm kiếm chung (Hỗ trợ cả phim lẻ và bộ)
  if (args.extra?.search) {
    const cacheKey = `search_v4_${args.extra.search.toLowerCase().trim()}`;
    if (appCache.has(cacheKey)) return { metas: appCache.get(cacheKey) };

    try {
      const res = await axios.get(`https://phimapi.com/v1/api/tim-kiem?keyword=${encodeURIComponent(args.extra.search)}&limit=40`, AXIOS_CONFIG);
      const items = res.data?.data?.items || [];
      const metas = convertItemsToMetas(items);
      appCache.set(cacheKey, metas, 3600);
      return { metas: metas };
    } catch (error) { return { metas: [] }; }
  }

  const selectedGenre = args.extra?.genre || null;
  const cacheKey = `cat_${args.id}_${selectedGenre || "all"}`;
  if (appCache.has(cacheKey)) return { metas: appCache.get(cacheKey) };

  let targetUrl = "";
  
  // Logic điều hướng Menu thông minh
  if (args.id === "phim_le") {
    targetUrl = "https://phimapi.com/v1/api/danh-sach/phim-le";
  } else if (args.id === "phim_bo") {
    targetUrl = "https://phimapi.com/v1/api/danh-sach/phim-bo";
  } else if (args.id === "hoat_hinh") {
    targetUrl = "https://phimapi.com/v1/api/danh-sach/hoat-hinh";
  }

  // Nếu User chọn Thể loại / Quốc gia trong Sub-menu
  if (selectedGenre) {
    if (COUNTRY_SLUGS[selectedGenre]) {
      targetUrl = `https://phimapi.com/v1/api/quoc-gia/${COUNTRY_SLUGS[selectedGenre]}`;
    } else if (GENRE_SLUGS[selectedGenre]) {
      targetUrl = `https://phimapi.com/v1/api/the-loai/${GENRE_SLUGS[selectedGenre]}`;
    }
  }

  let items = await fetchItemsFromUrl(targetUrl, 25);

  // Ép kiểu hiển thị chính xác khi lọc chéo (Quốc gia/Thể loại)
  if (selectedGenre) {
    if (args.id === "phim_le") items = items.filter(i => i.type === "single" || !i.type);
    if (args.id === "phim_bo") items = items.filter(i => i.type === "series");
  }

  const metas = convertItemsToMetas(items);
  appCache.set(cacheKey, metas, 14400); 
  return { metas: metas };
});

// ============ 2. META HANDLER ============
builder.defineMetaHandler(async (args) => {
  if (args.id?.startsWith("phimapi:")) {
    const slug = args.id.replace("phimapi:", "").split(":")[0]; 
    const cacheKey = `meta_detail_v4_${slug}`;
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

// ============ 3. STREAM HANDLER (Tối ưu 7 Nguồn) ============
builder.defineStreamHandler(async (args) => {
  if (args.id?.startsWith("phimapi:")) {
    // Trích xuất Slug phim và lấy chính xác ID tập (dành riêng cho phim bộ)
    const idParts = args.id.replace("phimapi:", "").split(":");
    const slug = idParts[0];
    const seasonNum = idParts[1] ? parseInt(idParts[1]) : 1;
    const episodeNum = idParts[2] ? parseInt(idParts[2]) : null;

    const cacheKey = `streams_agg_v4_${slug}_S${seasonNum}_E${episodeNum || 'full'}`;
    if (appCache.has(cacheKey)) return { streams: appCache.get(cacheKey) };

    // Tích hợp 4 API gốc và 3 Proxy Dự Phòng (Vượt rào khi bị nhà mạng chặn)
    const sourceEndpoints = [
      { name: "PhimAPI", url: `https://phimapi.com/phim/${slug}`, timeout: 2500 },
      { name: "KKPhim", url: `https://kkphim.vip/phim/${slug}`, timeout: 2500 },
      { name: "Nguồn C", url: `https://phim.nguonc.com/api/film/${slug}`, timeout: 2500 },
      { name: "Ophim", url: `https://ophim1.com/phim/${slug}`, timeout: 3000 },
      // API Proxy Dự Phòng:
      { name: "Backup KK", url: `https://media.hth4nh.eu.org/kkphim/${slug}`, timeout: 3500 },
      { name: "Backup NguồnC", url: `https://media.hth4nh.eu.org/nguonc/${slug}`, timeout: 3500 },
      { name: "Backup Ophim", url: `https://media.hth4nh.eu.org/ophim/${slug}`, timeout: 3500 }
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
              // Logic lọc tập cho Phim Bộ (Series)
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

// ============ TỰ ĐỘNG KEEP-ALIVE ============
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
  console.log(`Addon Phim Tối Ưu v4.0.0 đang chạy tại: ${url}manifest.json`);
});
