const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const NodeCache = require("node-cache");

const appCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const PHIM_IMG_BASE = "https://phimimg.com/";

const manifest = {
  id: "org.phimvietnam.fullarchive",
  version: "1.4.0",
  name: "Phim Việt Nam (Kho Phim Cũ & Mới)",
  description: "Tổng hợp 300+ Phim Chiếu Rạp & Phim Việt Nam (Cũ & Mới) - Phát HD Mượt Mà",
  resources: ["catalog", "stream"],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "phimviet_all",
      name: "Phim Việt Kho Tổng Hợp",
      extra: [
        {
          name: "search",
          isRequired: false
        }
      ]
    }
  ]
};

const builder = new addonBuilder(manifest);

function formatImageUrl(path) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${PHIM_IMG_BASE}${path}`;
}

// 1. Lấy danh sách phim Việt Nam (Quét 15 trang = ~360 phim mọi thời kỳ)
async function getVietnameseMoviesCatalog() {
  const cacheKey = "phim_viet_catalog_v140";
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  try {
    const pageNumbers = Array.from({ length: 15 }, (_, i) => i + 1);
    const requests = pageNumbers.map((page) =>
      axios.get("https://phimapi.com/v1/api/quoc-gia/viet-nam", {
        params: { page: page },
        timeout: 8000
      })
    );

    const responses = await Promise.allSettled(requests);
    let allItems = [];

    responses.forEach((res) => {
      if (res.status === "fulfilled" && res.value.data?.data?.items) {
        allItems = allItems.concat(res.value.data.data.items);
      }
    });

    const metas = allItems.map((item) => {
      const poster = formatImageUrl(item.poster_url || item.thumb_url);
      const background = formatImageUrl(item.thumb_url || item.poster_url);

      return {
        id: `phimapi:${item.slug}`,
        type: item.type === "hoathinh" || item.type === "series" ? "series" : "movie",
        name: item.name || item.origin_name,
        poster: poster,
        background: background,
        description: `Tên gốc: ${item.origin_name || item.name} | Năm: ${item.year || "N/A"}`,
        releaseInfo: item.year ? String(item.year) : ""
      };
    });

    appCache.set(cacheKey, metas, 21600);
    return metas;
  } catch (error) {
    return [];
  }
}

// 2. Tìm kiếm phim Việt Nam
async function searchVietnameseMovies(query) {
  const cacheKey = `search_phimapi_${query.toLowerCase().trim()}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  try {
    const res = await axios.get("https://phimapi.com/v1/api/tim-kiem", {
      params: { keyword: query, limit: 20 },
      timeout: 8000
    });

    const items = res.data?.data?.items || [];
    const metas = items.map((item) => {
      return {
        id: `phimapi:${item.slug}`,
        type: item.type === "series" ? "series" : "movie",
        name: item.name || item.origin_name,
        poster: formatImageUrl(item.poster_url || item.thumb_url),
        background: formatImageUrl(item.thumb_url || item.poster_url),
        description: `Năm: ${item.year || "N/A"}`,
        releaseInfo: item.year ? String(item.year) : ""
      };
    });

    appCache.set(cacheKey, metas, 3600);
    return metas;
  } catch (error) {
    return [];
  }
}

// 3. Lấy nguồn phát Stream M3U8 trực tiếp
async function getStreamsFromSlug(slug) {
  const cacheKey = `streams_${slug}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  try {
    const res = await axios.get(`https://phimapi.com/phim/${slug}`, { timeout: 8000 });
    const episodes = res.data?.episodes || [];
    const streams = [];

    episodes.forEach((server) => {
      const serverName = server.server_name || "Server Vietsub/HD";
      if (server.server_data) {
        server.server_data.forEach((ep) => {
          if (ep.link_m3u8) {
            streams.push({
              title: `[Phim Việt HD] - ${serverName} (${ep.name || "Full"})`,
              url: ep.link_m3u8
            });
          }
        });
      }
    });

    appCache.set(cacheKey, streams, 7200);
    return streams;
  } catch (error) {
    return [];
  }
}

// Catalog Handler
builder.defineCatalogHandler(async (args) => {
  if (args.id === "phimviet_all") {
    if (args.extra && args.extra.search) {
      const searchResults = await searchVietnameseMovies(args.extra.search);
      return { metas: searchResults };
    }
    const metas = await getVietnameseMoviesCatalog();
    return { metas: metas };
  }
  return { metas: [] };
});

// Stream Handler
builder.defineStreamHandler(async (args) => {
  if (args.id.startsWith("phimapi:")) {
    const slug = args.id.replace("phimapi:", "");
    const streams = await getStreamsFromSlug(slug);
    return { streams: streams };
  }
  return { streams: [] };
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT }).then(({ url }) => {
  console.log(`Addon đang chạy tại: ${url}manifest.json`);
});
