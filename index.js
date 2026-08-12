// ============ 3. STREAM HANDLER (BẢN FIX ĐƠ TRÌNH PHÁT) ============
builder.defineStreamHandler(async (args) => {
  if (args.id?.startsWith("phimapi:")) {
    const idParts = args.id.replace("phimapi:", "").split(":");
    const slug = idParts[0];
    const seasonNum = idParts[1] ? parseInt(idParts[1]) : 1;
    const episodeNum = idParts[2] ? parseInt(idParts[2]) : null;

    const cacheKey = `streams_agg_v462_${slug}_S${seasonNum}_E${episodeNum || 'full'}`;
    if (appCache.has(cacheKey)) return { streams: appCache.get(cacheKey) };

    const sourceEndpoints = [
      { name: "NguonC", url: `https://phim.nguonc.com/api/film/${slug}`, timeout: 3000 },
      { name: "VSMOV", url: `https://vsmov.com/api/film/${slug}`, timeout: 3000 },
      { name: "PhimAPI", url: `https://phimapi.com/phim/${slug}`, timeout: 2500 },
      { name: "KKPhim", url: `https://kkphim.vip/phim/${slug}`, timeout: 2500 },
      { name: "Ophim", url: `https://ophim1.com/phim/${slug}`, timeout: 3000 }
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
          const epList = server.server_data || server.items || [];

          epList.forEach((ep, index) => {
            const currentEpNum = index + 1;
            if (episodeNum && currentEpNum !== episodeNum) return;

            // 🚨 QUAN TRỌNG: Đã xóa ep.embed, chỉ lấy đúng m3u8 để Stremio không bị treo
            const m3u8Url = ep.link_m3u8 || ep.m3u8;

            // Bộ lọc an toàn: Chỉ cho phép link có chứa .m3u8 hoặc .mp4 đi qua
            if (m3u8Url && (m3u8Url.includes('.m3u8') || m3u8Url.includes('.mp4')) && !seenUrls.has(m3u8Url)) {
              seenUrls.add(m3u8Url);
              
              streams.push({
                name: `[${item.source}]`,
                title: `Vietsub #1 - ${ep.name || "Tập " + currentEpNum}\n▶ Xem Mượt`,
                url: m3u8Url
              });
            }
          });
        });
      }
    });

    if (streams.length > 0) appCache.set(cacheKey, streams, 7200); 
    return { streams: streams };
  }
  return { streams: [] };
});
