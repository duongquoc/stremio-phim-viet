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

const manifest = {
  id: "org.phimvietnam.v200",
  version: "2.0.0",
  name: "Phim Việt Nam HD",
  description: "Kho Phim Việt Nam (Cũ & Mới) - Hỗ trợ đầy đủ Meta & Phát HD",
  resources: ["catalog", "meta", "stream"], // Bổ sung resource "meta" bắt buộc
  types: ["movie", "series"],
  idPrefixes: ["phimapi:"],
  catalogs: [
    {
      type: "movie",
      id: "phimviet_all",
      name: "Phim Việt Kho Tổng Hợp",
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

// 1. Catalog Handler
async function getVietnameseMoviesCatalog() {
  const cacheKey = "phim_viet_catalog_v200";
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  try {
    const pageNumbers = Array.from({ length: 15 }, (_, i) => i + 1);
    const requests = pageNumbers.map((page) =>
      axios.get(`https://phimapi.com/v1/api/quoc-gia/viet-nam?page=${page}`, AXIOS_CONFIG)
    );

    const responses = await Promise.allSettled(requests);
    let allItems = [];

    responses.forEach((res) => {
      if (res.status === "fulfilled" && res.value.data?.data?.items) {
        allItems = allItems.concat(res.value.data.data.items);
      }
    });

    const metas = allItems.map((item) => ({
      id: `phimapi:${item.slug}`,
      type: "movie",
      name: item.name || item.origin_name,
      poster: formatImageUrl(item.poster_url || item.thumb_url),
      background: formatImageUrl(item.thumb_url || item.poster_url),
      description: `Tên gốc: ${item.origin_name || item.name} | Năm: ${item.year || "N/A"}`,
      releaseInfo: item.year ? String(item.year) : ""
    }));

    appCache.set(cacheKey, metas, 21600);
    return metas;
  } catch (error) {
    return [];
  }
}

// 2. Meta Handler (Xử lý tải chi tiết phim khi nhấp vào poster)
async function getMetaFromSlug(slug) {
  const cacheKey = `meta_detail_${slug}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  try {
    const res = await axios.get(`https://phimapi.com/phim/${slug}`, AXIOS_CONFIG);
    const movie = res.data?.movie;
    if (!movie) return null;

    const cleanDescription = movie.content 
      ? movie.content.replace(/<[^>]*>?/gm, "") 
      : `Tên gốc: ${movie.origin_name || movie.name} | Năm: ${movie.year || "N/A"}`;

    const meta = {
      id: `phimapi:${slug}`,
      type: "movie",
      name: movie.name || movie.origin_name,
      poster: formatImageUrl(movie.poster_url || movie.thumb_url),
      background: formatImageUrl(movie.thumb_url || movie.poster_url),
      description: cleanDescription,
      releaseInfo: movie.year ? String(movie.year) : "",
      genres: movie.category ? movie.category.map((c) => c.name) : ["Phim Việt"]
    };

    appCache.set(cacheKey, meta, 86400);
    return meta;
  } catch (e) {
    return null;
  }
}

// 3. Stream Handler (Tải link video)
async function getStreamsFromSlug(slug) {
  const cacheKey = `streams_v20_${slug}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  let episodes = [];

  try {
    const res = await axios.get(`https://phimapi.com/phim/${slug}`, AXIOS_CONFIG);
    if (res.data?.episodes && res.data.episodes.length > 0) {
      episodes = res.data.episodes;
    }
  } catch (e) {}

  if (episodes.length === 0) {
    try {
      const resFallback = await axios.get(`https://ophim1.com/phim/${slug}`, AXIOS_CONFIG);
      if (resFallback.data?.episodes) {
        episodes = resFallback.data.episodes;
      }
    } catch (e) {}
  }

  const streams = [];

  episodes.forEach((server) => {
    const serverName = server.server_name || "Server HD";
    if (server.server_data) {
      server.server_data.forEach((ep) => {
        if (ep.link_m3u8) {
          streams.push({
            name: "PHIM VIỆT HD",
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

// Register Handlers
builder.defineCatalogHandler(async (args) => {
  if (args.id === "phimviet_all") {
    const metas = await getVietnameseMoviesCatalog();
    return { metas: metas };
  }
  return { metas: [] };
});

builder.defineMetaHandler(async (args) => {
  if (args.id && args.id.includes("phimapi:")) {
    const cleanId = args.id.substring(args.id.indexOf("phimapi:") + 8);
    const slug = cleanId.split(":")[0];
    const meta = await getMetaFromSlug(slug);
    if (meta) return { meta: meta };
  }
  return { meta: {} };
});

builder.defineStreamHandler(async (args) => {
  if (args.id && args.id.includes("phimapi:")) {
    const cleanId = args.id.substring(args.id.indexOf("phimapi:") + 8);
    const slug = cleanId.split(":")[0];
    const streams = await getStreamsFromSlug(slug);
    return { streams: streams };
  }
  return { streams: [] };
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT }).then(({ url }) => {
  console.log(`Addon v2.0.0 đang chạy tại: ${url}manifest.json`);
});
