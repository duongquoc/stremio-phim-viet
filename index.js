const express = require("express");
const cors = require("cors");
const axios = require("axios");
const NodeCache = require("node-cache");

const app = express();
app.use(cors());

// Bộ đệm (Cache): Lưu dữ liệu 2 tiếng (7200s) giúp giảm tải cho Server và tải phim siêu nhanh
const appCache = new NodeCache({ stdTTL: 7200, checkperiod: 600 });
// Tăng thời gian chờ (Timeout) lên 15 giây để Add-on có đủ thời gian thử các nguồn dự phòng
const AXIOS_CONFIG = { timeout: 15000 }; 

// ==========================================
// 1. CẤU HÌNH MANIFEST (GIAO DIỆN ADD-ON)
// ==========================================
const manifest = {
  id: "com.stremio.phimviet.pro",
  version: "4.0.0", // Version 4.0.0 - Nâng cấp hệ thống tự động tìm nguồn dự phòng
  name: "Phim Việt HD (Tự Động Đổi Nguồn)",
  description: "Xem phim Việt Nam và Thuyết minh. Tự động chuyển máy chủ nếu nguồn chính bị sập. Luôn luôn ổn định.",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  idPrefixes: ["phimviet_"], // Định danh riêng của Add-on
  catalogs: [
    { type: "movie", id: "phim-le", name: "Phim Lẻ Mới" },
    { type: "series", id: "phim-bo", name: "Phim Bộ Mới" },
    { type: "series", id: "hoat-hinh", name: "Hoạt Hình" },
    { type: "series", id: "tv-shows", name: "TV Shows" }
  ]
};

// ==========================================
// 2. CÁC HÀM XỬ LÝ LẤY DỮ LIỆU
// ==========================================

// Hàm lấy danh sách phim (Catalog)
async function getCatalog(type, id) {
  const cacheKey = `catalog_${id}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  try {
    const res = await axios.get(`https://phimapi.com/v1/api/danh-sach/${id}?limit=30`, AXIOS_CONFIG);
    const metas = res.data.data.items.map((item) => ({
      id: `phimviet_${item.slug}`,
      type: type,
      name: item.name,
      poster: `https://phimimg.com/${item.thumb_url}`,
      description: item.origin_name || item.name
    }));

    if (metas.length > 0) appCache.set(cacheKey, metas);
    return metas;
  } catch (error) {
    console.error("Lỗi lấy danh mục:", error.message);
    return [];
  }
}

// Hàm lấy thông tin chi tiết phim (Meta)
async function getMeta(slug, type) {
  const cacheKey = `meta_${slug}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  try {
    const res = await axios.get(`https://phimapi.com/phim/${slug}`, AXIOS_CONFIG);
    const data = res.data.movie;
    
    const meta = {
      id: `phimviet_${slug}`,
      type: type,
      name: data.name,
      poster: data.thumb_url,
      background: data.poster_url,
      description: data.content.replace(/(<([^>]+)>)/ig, ""), // Lọc bỏ thẻ HTML
      releaseInfo: data.year.toString(),
      genres: data.category.map(c => c.name)
    };

    appCache.set(cacheKey, meta);
    return meta;
  } catch (error) {
    console.error(`Lỗi lấy thông tin phim ${slug}:`, error.message);
    return null;
  }
}

// Hàm lấy Link xem phim (Stream) - TÍCH HỢP NGUỒN DỰ PHÒNG CHỐNG SẬP
async function getStreamsFromSlug(slug) {
  const cacheKey = `stream_${slug}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  let episodes = [];
  
  // DANH SÁCH CÁC NGUỒN PHIM TỰ ĐỘNG CHUYỂN TIẾP (FALLBACK)
  const sourceEndpoints = [
    `https://phimapi.com/phim/${slug}`,
    `https://ophim1.com/phim/${slug}`,
    `https://kkphim.vip/phim/${slug}`
  ];

  // Vòng lặp thông minh: Thử từng nguồn một, có link m3u8 là dừng ngay
  for (const url of sourceEndpoints) {
    try {
      console.log(`[Đang thử kết nối] -> ${url}`);
      const res = await axios.get(url, AXIOS_CONFIG);
      
      // Kiểm tra nếu API trả về danh sách tập phim hợp lệ
      if (res.data && res.data.episodes && res.data.episodes.length > 0) {
        episodes = res.data.episodes;
        console.log(`[Thành công] Đã lấy được link video từ: ${url}`);
        break; // Dừng vòng lặp vì đã lấy được link
      }
    } catch (error) {
      console.log(`[Sập/Lỗi mạng] Không lấy được từ ${url}. Đang chuyển sang nguồn tiếp theo...`);
      continue; // Bỏ qua và tự động nhảy xuống dòng link nguồn dự phòng
    }
  }

  const streams = [];
  // Xử lý dữ liệu để đẩy vào Stremio
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
    appCache.set(cacheKey, streams);
  }
  
  return streams;
}

// ==========================================
// 3. CÁC ĐƯỜNG DẪN API CHO STREMIO
// ==========================================

// Trả về Manifest
app.get("/manifest.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json(manifest);
});

// Trả về danh sách phim
app.get("/catalog/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  const metas = await getCatalog(type, id);
  res.setHeader("Content-Type", "application/json");
  res.json({ metas });
});

// Trả về chi tiết 1 bộ phim
app.get("/meta/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  const slug = id.replace("phimviet_", ""); // Tách lấy slug
  const meta = await getMeta(slug, type);
  res.setHeader("Content-Type", "application/json");
  res.json({ meta: meta || {} });
});

// Trả về link video (Streams) khi người dùng bấm nút Play
app.get("/stream/:type/:id.json", async (req, res) => {
  const id = req.params.id;
  
  // Lọc lấy id tập phim nếu là phim bộ (VD: phimviet_slug:1:1)
  const idParts = id.split(":");
  const slug = idParts[0].replace("phimviet_", "");
  
  const streams = await getStreamsFromSlug(slug);
  res.setHeader("Content-Type", "application/json");
  res.json({ streams });
});

// ==========================================
// 4. KHỞI CHẠY MÁY CHỦ (SERVER)
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Add-on Phim Việt (Bản Nâng Cấp Tự Động) đang chạy trên cổng ${PORT}`);
});
