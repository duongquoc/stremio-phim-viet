const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const NodeCache = require("node-cache");

const appCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });

// API Key TMDB của bạn đã gắn sẵn
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
  id: "org.phimvietnam.cinema.full",
  version: "1.2.0",
  name: "Phim Chiếu Rạp VN",
  description: "Cập nhật phim chiếu rạp Việt Nam từ TMDB",
  resources: ["catalog"],
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

async function getImdbIdFromTmdbId(tmdbId) {
  const cacheKey = `imdb_id_${tmdbId}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  try {
    const response = await axios.get(`${TMDB_BASE_URL}/movie/${tmdbId}/external_ids`, {
      params: { api_key: TMDB_API_KEY }
    });
    const imdbId = response.data.imdb_id || null;
    appCache.set(cacheKey, imdbId, 604800);
    return imdbId;
  } catch (error) {
    return null;
  }
}

async function searchVietnameseMovies(query) {
  const cacheKey = `search_vn_${query.toLowerCase().trim()}`;
  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  try {
    const response = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
      params: {
        api_key: TMDB_API_KEY,
        query: query,
        language: "vi-VN",
        page: 1
      }
    });

    const rawMovies = response.data.results.filter((movie) => {
      const isViLang = movie.original_language === "vi";
      const isVnCountry = movie.origin_country && movie.origin_country.includes("VN");
      return isViLang || isVnCountry;
    });

    const metasPromises = rawMovies.map(async (movie) => {
      const imdbId = await getImdbIdFromTmdbId(movie.id);
      return {
        id: imdbId || `tmdb:${movie.id}`,
        type: "movie",
        name: movie.title || movie.original_title,
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

async function getVietnameseMovies(genreName) {
  const genreKey = genreName || "all";
  const cacheKey = `catalog_vn_${genreKey}`;

  if (appCache.has(cacheKey)) return appCache.get(cacheKey);

  const apiParams = {
    api_key: TMDB_API_KEY,
    with_origin_country: "VN",
    language: "vi-VN",
    sort_by: "primary_release_date.desc",
    page: 1
  };

  if (genreName && GENRE_MAP[genreName]) {
    apiParams.with_genres = GENRE_MAP[genreName];
  }

  try {
    const response = await axios.get(`${TMDB_BASE_URL}/discover/movie`, { params: apiParams });
    const rawMovies = response.data.results;

    const metasPromises = rawMovies.map(async (movie) => {
      const imdbId = await getImdbIdFromTmdbId(movie.id);
      return {
        id: imdbId || `tmdb:${movie.id}`,
        type: "movie",
        name: movie.title || movie.original_title,
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

builder.defineCatalogHandler(async (args) => {
  if (args.type === "movie" && args.id === "phimviet_imdb") {
    if (args.extra && args.extra.search) {
      const searchResults = await searchVietnameseMovies(args.extra.search);
      return { metas: searchResults, cacheMaxAge: 1800 };
    }

    const selectedGenre = args.extra ? args.extra.genre : null;
    const movies = await getVietnameseMovies(selectedGenre);

    return {
      metas: movies,
      cacheMaxAge: 3600
    };
  }
  return { metas: [] };
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT }).then(({ url }) => {
  console.log(`Addon dang chay tai: ${url}manifest.json`);
});