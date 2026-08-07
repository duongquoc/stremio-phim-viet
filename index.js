const express = require("express");
const cors = require("cors");
const axios = require("axios");
const NodeCache = require("node-cache");

const app = express();
app.use(cors());

// Bộ đệm (Cache): Lưu dữ liệu 2 tiếng
const appCache = new NodeCache({ stdTTL: 7200, checkperiod: 600 });
const AXIOS_CONFIG = { timeout: 15000 }; 

// ==========================================
// 1. CẤU HÌNH MANIFEST
// ==========================================
const manifest = {
  id: "com.stremio.phimviet.pro",
  version: "4.1.0", // Đã vá lỗi Phim Bộ và tự động lấy động CDN ảnh
  name: "Phim Việt HD (Bản Chuẩn)",
  description: "Kho phim Việt Nam và phim bộ Thuyết minh. Tự động chuyển nguồn dự phòng và sửa lỗi chọn tập phim.",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  idPrefixes: ["phimviet_"], 
  catalogs: [
    { type: "movie", id: "phim-le", name: "Phim Lẻ Mới" },
    { type: "series", id: "phim-bo", name: "Phim Bộ Mới" },
    { type: "series", id: "hoat-hinh", name: "Hoạt Hình" },
    { type: "series", id: "tv-shows", name: "TV Shows" }
  ]
};

// ==========================================
// 2. CÁC HÀM XỬ LÝ (ĐÃ VÁ LỖI)
// ==========================================

// Hàm lấy danh sách phim (Vá lỗi CDN ảnh động)
async function getCatalog(type, id) {
  const cacheKey = `catalog_${id}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  try {
    const res = await axios.get(`https://phimapi.com/v1/api/danh-sach/${id}?limit=30`, AXIOS_CONFIG);
    
    // Tự động lấy tên miền ảnh từ API thay vì gắn cứng để chống lỗi mất ảnh
    const domainImage = res.data.data?.APP_DOMAIN_CDN_IMAGE || "https://phimimg.com";
    
    const metas = res.data.data.items.map((item) => {
      let posterUrl = item.thumb_url;
      if (!posterUrl.startsWith("http")) {
        posterUrl = `${domainImage}/${item.thumb_url}`.replace(/([^:])(\/\/+)/g, '$1/');
      }
      return {
        id: `phimviet_${item.slug}`,
        type: type,
        name: item.name,
        poster: posterUrl,
        description: item.origin_name || item.name
      };
    });

    if (metas.length > 0) appCache.set(cacheKey, metas);
    return metas;
  } catch (error) {
    console.error("Lỗi lấy danh mục:", error.message);
    return [];
  }
}

// Hàm lấy thông tin chi tiết (Vá lỗi mất nút chọn Tập Phim trên Stremio)
async function getMeta(slug, type) {
  const cacheKey = `meta_${slug}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  try {
    const res = await axios.get(`https://phimapi.com/phim/${slug}`, AXIOS_CONFIG);
    const data = res.data.movie;
    const episodesData = res.data.episodes; 

    const meta = {
      id: `phimviet_${slug}`,
      type: type,
      name: data.name,
      poster: data.thumb_url,
      background: data.poster_url,
      description: data.content ? data.content.replace(/(<([^>]+)>)/ig, "") : "",
      releaseInfo: data.year ? data.year.toString() : "",
      genres: data.category ? data.category.map(c => c.name) : []
    };

    // Bắt buộc khai báo cấu trúc tập phim (videos) cho hệ thống Stremio
    if (type === "series" && episodesData && episodesData.length > 0) {
      const serverData = episodesData[0].server_data;
      meta.videos = serverData.map((ep, index) => {
         const epNumMatch = ep.name.match(/\d+/);
         const epNum = epNumMatch ? parseInt(epNumMatch[0]) : (index + 1);
         return {
            id: `phimviet_${slug}:1:${epNum}`,
            title: ep.name,
            season: 1,
            episode: epNum
         };
      });
    }

    appCache.set(cacheKey, meta);
    return meta;
  } catch (error) {
    console.error(`Lỗi lấy meta ${slug}:`, error.message);
    return null;
  }
}

// Hàm lấy link xem phim (Vá lỗi lọc đúng số tập và duy trì Nguồn dự phòng)
async function getStreamsFromSlug(slug, targetEpisode) {
  const cacheKey = `stream_${slug}_${targetEpisode || 'full'}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  let episodes = [];
  const sourceEndpoints = [
    `https://phimapi.com/phim/${slug}`,
    `https://ophim1.com/phim/${slug}`,
    `https://kkphim.vip/phim/${slug}`
  ];

  for (const url of sourceEndpoints) {
    try {
      const res = await axios.get(url, AXIOS_CONFIG);
      if (res.data && res.data.episodes && res.data.episodes.length > 0) {
        episodes = res.data.episodes;
        break; 
      }
    } catch (error) {
      continue; 
    }
  }

  const streams = [];
  episodes.forEach((server) => {
    const serverName = server.server_name || "Server HD";
    if (server.server_data) {
      server.server_data.forEach((ep, index) => {
        let isMatch = false;
        
        // Lọc xem người dùng bấm vào phim lẻ hay tập phim bộ cụ thể
        if (!targetEpisode) {
          isMatch = true; 
        } else {
          const epNumMatch = ep.name.match(/\d+/);
          const epNum = epNumMatch ? epNumMatch[0] : (index + 1).toString();
          if (epNum === targetEpisode || ep.slug === `tap-${targetEpisode}`) {
            isMatch = true;
          }
        }

        if (isMatch && ep.link_m3u8) {
          streams.push({
            name: "PHIM HD",
            title: `${serverName} - ${ep.name || "Full"}\n▶ Bấm để xem`,
            url: ep.link_m3u8
          });
        }
      });
    }
  });

  if (streams.length > 0) appCache.set(cacheKey, streams);
  return streams;
}

// ==========================================
// 3. API ĐẦU RA CHO STREMIO
// ==========================================

app.get("/manifest.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json(manifest);
});

app.get("/catalog/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  const metas = await getCatalog(type, id);
  res.setHeader("Content-Type", "application/json");
  res.json({ metas });
});

app.get("/meta/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  const slug = id.replace("phimviet_", ""); 
  const meta = await getMeta(slug, type);
  res.setHeader("Content-Type", "application/json");
  res.json({ meta: meta || {} });
});

app.get("/stream/:type/:id.json", async (req, res) => {
  const id = req.params.id;
  const idParts = id.split(":");
  
  const slug = idParts[0].replace("phimviet_", "");
  // Tách lấy đúng số tập mà máy chiếu (Stremio) gửi lên để lọc video
  const targetEpisode = idParts.length > 2 ? idParts[2] : null; 
  
  const streams = await getStreamsFromSlug(slug, targetEpisode);
  res.setHeader("Content-Type", "application/json");
  res.json({ streams });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Add-on Phim Việt v4.1.0 đang chạy trên cổng ${PORT}`);
});
