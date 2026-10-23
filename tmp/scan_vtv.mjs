async function run() {
  const res = await fetch("https://vtvgo.vn/channel/13");
  const html = await res.text();
  const chunkMatches = html.match(/\/_next\/static\/chunks\/[a-zA-Z0-9_\-\.]+\.js/g) || [];
  const uniqueChunks = [...new Set(chunkMatches)];
  console.log("Found chunks:", uniqueChunks.length);
  for (const chunk of uniqueChunks) {
    try {
      const js = await (await fetch("https://vtvgo.vn" + chunk)).text();
      if (js.includes("m3u8")) {
        console.log("Chunk with m3u8:", chunk);
        const m = js.match(/https?:\/\/[^\s"'`]+\.m3u8[^\s"'`]*/g);
        console.log("Direct matches:", m);
      }
      if (js.includes("channel/13") || js.includes("/channel/")) {
        console.log("Chunk with channel:", chunk);
      }
      const apis = js.match(/\/api\/[a-zA-Z0-9_\-\/]+/g) || [];
      if (apis.length > 0) {
        console.log("Chunk apis:", chunk, apis.slice(0, 5));
      }
    } catch (e) {
      //
    }
  }
}
run();
