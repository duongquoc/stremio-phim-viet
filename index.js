const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const NodeCache = require("node-cache");

const appCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });

const TMDB_API_KEY = process.env.TMDB_API_KEY || "4e341b1644f8880b1bc273501b96cedf";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

const GENRE_MAP = {
  "Hành động": 28,
  "Hài": 35,
  "Tình cảm": 10749,
  "Kinh dị": 27,
  "Tâm lý": 18
};

const manifest = {
  id: "org.phimvietnam.cinema.fullstream",
  version: "1.3.0",
  name: "Phim Chiếu Rạp VN",
  description: "Cập nhật 100+ Phim Việt Nam & Nguồn phát HD trực tiếp",
  resources: ["catalog", "stream"], // Bổ sung quyền phát stream video
  types: ["movie"],
  catalogs: [
    {
      type: "movie",
      id: "phimviet_imdb",
      name: "Phim Việt Chiếu Rạp",
      extra: [
        {
          name: "genre",
          options: ["Hành động", "Hài", "Tình cảm", "Kinh dị", "Tâm lý"],
          isRequired: false
        },
        {
          name: "search",
          isRequired: false
        }
      ]
    }
  ]
};

const builder = new addonBuilder(manifest);

// 1. Hàm lấy chi tiết phim từ TMDB
async function getMovieDetailsFromTmdb(tmdbId) {
  const cacheKey = `movie_detail_${tmdbId}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  try {
    const [extRes, detailRes] = await Promise.all([
      axios.get(`${TMDB_BASE_URL}/movie/${tmdbId}/external_ids`, { params: { api_key: TMDB_API_KEY } }),
      axios.get(`${TMDB_BASE_URL}/movie/${tmdbId}`, { params: { api_key: TMDB_API_KEY, language: "vi-VN" } })
    ]);

    const info = {
      imdbId: extRes.data.imdb_id || null,
      title: detailRes.data.title || detailRes.data.original_title
    };

    appCache.set(cacheKey, info, 604800);
    return info;
  } catch (error) {
    return null;
  }
}

// 2. Hàm lấy danh sách phim (Tải 5 trang = ~100 phim)
async function getVietnameseMovies(genreName) {
  const genreKey = genreName || "all";
  const cacheKey = `catalog_vn_v2_${genreKey}`;

  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  try {
    const pages = [1, 2, 3, 4, 5];
    const requests = pages.map((page) => {
      const apiParams = {
        api_key: TMDB_API_KEY,
        with_origin_country: "VN",
        language: "vi-VN",
        sort_by: "primary_release_date.desc",
        page: page
      };
      if (genreName && GENRE_MAP[genreName]) {
        apiParams.with_genres = GENRE_MAP[genreName];
      }
      return axios.get(`${TMDB_BASE_URL}/discover/movie`, { params: apiParams });
    });

    const responses = await Promise.all(requests);
    let rawMovies = [];
    responses.forEach((res) => {
      if (res.data && res.data.results) {
        rawMovies = rawMovies.concat(res.data.results);
      }
    });

    const uniqueMovies = Array.from(new Map(rawMovies.map((m) => [m.id, m])).values());

    const metasPromises = uniqueMovies.map(async (movie) => {
      const detail = await getMovieDetailsFromTmdb(movie.id);
      const itemId = (detail && detail.imdbId) ? detail.imdbId : `tmdb:${movie.id}`;
      const title = (detail && detail.title) ? detail.title : (movie.title || movie.original_title);

      // Lưu tên phim vào cache để Stream Handler sử dụng
      appCache.set(`title_of_${itemId}`, title, 604800);
      appCache.set(`title_of_tmdb:${movie.id}`, title, 604800);

      return {
        id: itemId,
        type: "movie",
        name: title,
        poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
        background: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : null,
        description: movie.overview || "Chưa có mô tả nội dung.",
        releaseInfo: movie.release_date ? movie.release_date.substring(0, 4) : "",
        genres: genreName ? [genreName] : ["Phim Việt"]
      };
    });

    const movies = await Promise.all(metasPromises);
    appCache.set(cacheKey, movies, 43200);
    return movies;
  } catch (error) {
    return [];
  }
}

// 3. Hàm tìm kiếm phim
async function searchVietnameseMovies(query) {
  const cacheKey = `search_vn_${query.toLowerCase().trim()}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  try {
    const response = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
      params: { api_key: TMDB_API_KEY, query: query, language: "vi-VN", page: 1 }
    });

    const rawMovies = response.data.results.filter((movie) => {
      const isViLang = movie.original_language === "vi";
      const isVnCountry = movie.origin_country && movie.origin_country.includes("VN");
      return isViLang || isVnCountry;
    });

    const metasPromises = rawMovies.map(async (movie) => {
      const detail = await getMovieDetailsFromTmdb(movie.id);
      const itemId = (detail && detail.imdbId) ? detail.imdbId : `tmdb:${movie.id}`;
      const title = movie.title || movie.original_title;

      appCache.set(`title_of_${itemId}`, title, 604800);

      return {
        id: itemId,
        type: "movie",
        name: title,
        poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
        background: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : null,
        description: movie.overview || "Chưa có mô tả nội dung.",
        releaseInfo: movie.release_date ? movie.release_date.substring(0, 4) : ""
      };
    });

    const movies = await Promise.all(metasPromises);
    appCache.set(cacheKey, movies, 3600);
    return movies;
  } catch (error) {
    return [];
  }
}

// 4. Stream Handler: Tự động tra cứu link video từ PhimAPI
async function getStreamsForMovie(id) {
  const cacheKey = `stream_for_${id}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  let movieTitle = appCache.get(`title_of_${id}`);

  if (!movieTitle) {
    if (id.startsWith("tmdb:")) {
      const tmdbId = id.replace("tmdb:", "");
      const detail = await getMovieDetailsFromTmdb(tmdbId);
      if (detail) movieTitle = detail.title;
    } else if (id.startsWith("tt")) {
      try {
        const findRes = await axios.get(`${TMDB_BASE_URL}/find/${id}`, {
          params: { api_key: TMDB_API_KEY, external_source: "imdb_id", language: "vi-VN" }
        });
        if (findRes.data.movie_results && findRes.data.movie_results.length > 0) {
          movieTitle = findRes.data.movie_results[0].title || findRes.data.movie_results[0].original_title;
        }
      } catch (e) {}
    }
  }

  if (!movieTitle) return [];

  try {
    const searchRes = await axios.get("https://phimapi.com/v1/api/tim-kiem", {
      params: { keyword: movieTitle, limit: 5 },
      timeout: 5000
    });

    const items = searchRes.data?.data?.items;
    if (!items || items.length === 0) return [];

    const slug = items[0].slug;
    const detailRes = await axios.get(`https://phimapi.com/phim/${slug}`, { timeout: 5000 });
    const episodes = detailRes.data?.episodes;

    if (!episodes || episodes.length === 0) return [];

    const streams = [];
    episodes.forEach((server) => {
      const serverName = server.server_name || "Server HD";
      if (server.server_data && server.server_data.length > 0) {
        server.server_data.forEach((ep) => {
          if (ep.link_m3u8) {
            streams.push({
              title: `[Phim Việt HD] - ${serverName}`,
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
  if (args.type === "movie" && args.id === "phimviet_imdb") {
    if (args.extra && args.extra.search) {
      const searchResults = await searchVietnameseMovies(args.extra.search);
      return { metas: searchResults, cacheMaxAge: 1800 };
    }

    const selectedGenre = args.extra ? args.extra.genre : null;
    const movies = await getVietnameseMovies(selectedGenre);
    return { metas: movies, cacheMaxAge: 3600 };
  }
  return { metas: [] };
});

// Stream Handler
builder.defineStreamHandler(async (args) => {
  if (args.type === "movie") {
    const streams = await getStreamsForMovie(args.id);
    return { streams: streams };
  }
  return { streams: [] };
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT }).then(({ url }) => {
  console.log(`Addon đang chạy tại: ${url}manifest.json`);
});
