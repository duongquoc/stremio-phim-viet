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
  timeout: 10000 // Tối đa 10s cho các API data
};

const STREAM_AXIOS_CONFIG = {
  ...AXIOS_CONFIG,
  timeout: 6000 // Ép thời gian lấy link Stream xuống 6s để Stremio không bị quay đều
};

const GENRE_SLUGS = {
  "Hành động": "hanh-dong",
  "Hài hước": "hai-huoc",
  "Tình cảm": "tinh-cam",
  "Kinh dị": "kinh-di",
  "Viễn tưởng": "vien-tuong",
  "Võ thuật": "vo-thuat",
  "Tâm lý": "tam-ly",
  "Cổ trang": "co-trang",
  "Hoạt hình": "hoat-hinh"
};

const COUNTRY_SLUGS = {
  "Việt Nam": "viet-nam",
  "Âu Mỹ": "au-my",
  "Hàn Quốc": "han-quoc",
  "Trung Quốc": "trung-quoc",
  "Nhật Bản": "nhat-ban"
};

const manifest = {
  id: "org.phimtonghop.v320",
  version: "3.2.0",
  name: "Kho Phim Tổng Hợp HD",
  description: "Bổ sung Rating & Tối ưu luồng xử lý cực nhanh (Final)",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  idPrefixes: ["phimapi:"],
  catalogs: [
    {
      type: "movie",
      id: "phim_vietnam",
      name: "Phim Việt Nam",
      extra: [
        {
          name: "genre",
          options: [
            "Tất cả", "2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "2015", "2010",
            "Hành động", "Hài hước", "Tình cảm", "Kinh dị", "Tâm lý"
          ],
          isRequired: false
        },
        { name: "search", isRequired: false }
      ]
    },
    {
      type: "movie",
      id: "phim_nuocngoai",
      name: "Phim Nước Ngoài HD",
      extra: [
        {
          name: "genre",
          options: [
            "Âu Mỹ", "Hàn Quốc", "Trung Quốc", "Nhật Bản",
            "Hành động", "Kinh dị", "Viễn tưởng", "Hài hước", "Tình cảm", "Võ thuật", "Cổ trang",
            "2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "2015", "2010"
          ],
          isRequired: false
        },
        { name: "search", isRequired: false }
      ]
    }
  ]
};

const builder = new addonBuilder(manifest);

function formatImageUrl(path) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${PHIM_IMG_BASE}${path}`;
}

// Cơ chế Chunking: Chia nhỏ request tải danh sách phim để chống nghẽn / chống Ban IP
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

function convertItemsToMetas(items) {
  return items.map((item) => {
    let rating = "N/A";
    if (item.tmdb?.vote_average) rating = item.tmdb.vote_average;
    else if (item.imdb?.rating) rating = item.imdb.rating;

    return {
      id: `phimapi:${item.slug}`,
      type: "movie",
      name: item.name || item.origin_name,
      poster: formatImageUrl(item.poster_url || item.thumb_url),
      background: formatImageUrl(item.thumb_url || item.poster_url),
      description: rating !== "N/A" 
        ? `⭐ Điểm: ${rating}/10 | Tên gốc: ${item.origin_name || item.name}` 
        : `Tên gốc: ${item.origin_name || item.name} | Năm: ${item.year || "N/A"}`,
      releaseInfo: item.year ? String(item.year) : "",
      imdbRating: rating !== "N/A" ? String(rating) : undefined
    };
  });
}

// 1. Catalog Handler
async function getCatalog(catalogId, selectedGenre) {
  const cacheKey = `cat_${catalogId}_${selectedGenre || "all"}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  let targetUrl = "";
  let isYearFilter = false;
  let targetYear = null;

  if (catalogId === "phim_vietnam") {
    if (selectedGenre && !isNaN(selectedGenre)) {
      isYearFilter = true;
      targetYear = parseInt(selectedGenre);
      targetUrl = "https://phimapi.com/v1/api/quoc-gia/viet-nam";
    } else if (selectedGenre && GENRE_SLUGS[selectedGenre]) {
      targetUrl = `https://phimapi.com/v1/api/the-loai/${GENRE_SLUGS[selectedGenre]}`;
    } else {
      targetUrl = "https://phimapi.com/v1/api/quoc-gia/viet-nam";
    }
  } else if (catalogId === "phim_nuocngoai") {
    if (selectedGenre && COUNTRY_SLUGS[selectedGenre]) {
      targetUrl = `https://phimapi.com/v1/api/quoc-gia/${COUNTRY_SLUGS[selectedGenre]}`;
    } else if (selectedGenre && GENRE_SLUGS[selectedGenre]) {
      targetUrl = `https://phimapi.com/v1/api/the-loai/${GENRE_SLUGS[selectedGenre]}`;
    } else if (selectedGenre && !isNaN(selectedGenre)) {
      isYearFilter = true;
      targetYear = parseInt(selectedGenre);
      targetUrl = "https://phimapi.com/v1/api/danh-sach/phim-le";
    } else {
      targetUrl = "https://phimapi.com/v1/api/danh-sach/phim-le";
    }
  }

  let items = await fetchItemsFromUrl(targetUrl, 25);

  if (catalogId === "phim_vietnam" && selectedGenre && GENRE_SLUGS[selectedGenre]) {
    items = items.filter((item) =>
      item.country?.some((c) => c.name === "Việt Nam" || c.slug === "viet-nam")
    );
  }

  if (isYearFilter && targetYear) {
    items = items.filter((item) => item.year === targetYear);
  }

  const metas = convertItemsToMetas(items);
  appCache.set(cacheKey, metas, 14400); // Lưu 4 tiếng
  return metas;
}

// 2. Search Handler
async function searchMovies(query) {
  const cacheKey = `search_phimapi_${query.toLowerCase().trim()}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  try {
    const res = await axios.get(`https://phimapi.com/v1/api/tim-kiem?keyword=${encodeURIComponent(query)}&limit=40`, AXIOS_CONFIG);
    const items = res.data?.data?.items || [];
    const metas = convertItemsToMetas(items);

    appCache.set(cacheKey, metas, 3600);
    return metas;
  } catch (error) {
    console.error(`[Lỗi Tìm Kiếm] ${query}:`, error.message);
    return [];
  }
}

// 3. Meta Handler
async function getMetaFromSlug(slug) {
  const cacheKey = `meta_detail_${slug}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  try {
    const res = await axios.get(`https://phimapi.com/phim/${slug}`, AXIOS_CONFIG);
    const movie = res.data?.movie;
    if (!movie) return null;

    let rating = "N/A";
    if (movie.tmdb?.vote_average) rating = movie.tmdb.vote_average;
    else if (movie.imdb?.rating) rating = movie.imdb.rating;

    const ratingText = rating !== "N/A" ? `⭐ ĐIỂM ĐÁNH GIÁ: ${rating}/10\n\n` : "";
    const cleanDescription = movie.content
      ? movie.content.replace(/<[^>]*>?/gm, "")
      : `Tên gốc: ${movie.origin_name || movie.name} | Năm: ${movie.year || "N/A"}`;

    const meta = {
      id: `phimapi:${slug}`,
      type: "movie", // Cố định là movie để list các tập dạng streams thay vì videos
      name: movie.name || movie.origin_name,
      poster: formatImageUrl(movie.poster_url || movie.thumb_url),
      background: formatImageUrl(movie.thumb_url || movie.poster_url),
      description: `${ratingText}${cleanDescription}`,
      releaseInfo: movie.year ? String(movie.year) : "",
      genres: movie.category ? movie.category.map((c) => c.name) : ["Phim"],
      imdbRating: rating !== "N/A" ? String(rating) : undefined
    };

    appCache.set(cacheKey, meta, 86400); // Cập nhật cache meta lâu hơn, 1 ngày
    return meta;
  } catch (e) {
    return null;
  }
}

// 4. Stream Handler (Quét đồng thời nhiều API để lấy link nhanh nhất)
async function getStreamsFromSlug(slug) {
  const cacheKey = `streams_v32_fallback_${slug}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  let episodes = [];
  const sourceEndpoints = [
    `https://phimapi.com/phim/${slug}`,
    `https://ophim1.com/phim/${slug}`,
    `https://kkphim.vip/phim/${slug}`
  ];

  const requests = sourceEndpoints.map(url => 
    axios.get(url, STREAM_AXIOS_CONFIG).catch(() => null)
  );
  
  const responses = await Promise.all(requests);

  for (let i = 0; i < responses.length; i++) {
    const res = responses[i];
    if (res?.data?.episodes?.length > 0) {
      episodes = res.data.episodes;
      console.log(`[Thành công] Lấy link tại nguồn số ${i + 1}: ${sourceEndpoints[i]}`);
      break; 
    }
  }

  const streams = [];
  episodes.forEach((server) => {
    const serverName = server.server_name || "Server HD";
    if (server.server_data) {
      server.server_data.forEach((ep) => {
        if (ep.link_m3u8) {
          streams.push({
            name: "PHIM HD",
            title: `${serverName} - ${ep.name || "Full"}\n▶ Bấm để xem ngay`,
            url: ep.link_m3u8
          });
        }
      });
    }
  });

  if (streams.length > 0) {
    appCache.set(cacheKey, streams, 7200); 
  }
  
  return streams;
}

// ============ ĐĂNG KÝ HANDLERS ============

builder.defineCatalogHandler(async (args) => {
  if (args.extra?.search) {
    const searchResults = await searchMovies(args.extra.search);
    return { metas: searchResults };
  }
  const selectedGenre = args.extra?.genre || null;
  const metas = await getCatalog(args.id, selectedGenre);
  return { metas: metas };
});

builder.defineMetaHandler(async (args) => {
  if (args.id?.startsWith("phimapi:")) {
    // Sửa lỗi cực kỳ quan trọng: Loại bỏ các hậu tố :1:1 (Mùa:Tập) do Stremio tự sinh ra
    const cleanId = args.id.replace("phimapi:", "");
    const slug = cleanId.split(":")[0]; 
    
    const meta = await getMetaFromSlug(slug);
    if (meta) return { meta: meta };
  }
  return { meta: {} };
});

builder.defineStreamHandler(async (args) => {
  if (args.id?.startsWith("phimapi:")) {
    // Sửa lỗi: Đảm bảo chỉ dùng đúng slug gốc để tìm link m3u8
    const cleanId = args.id.replace("phimapi:", "");
    const slug = cleanId.split(":")[0];

    const streams = await getStreamsFromSlug(slug);
    return { streams: streams };
  }
  return { streams: [] };
});

// ============ KHỞI CHẠY ============
const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT }).then(({ url }) => {
  console.log(`Addon v3.2.1 (Bản Tối Ưu) đang chạy tại: ${url}manifest.json`);
});
