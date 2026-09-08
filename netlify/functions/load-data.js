import { getStore } from "@netlify/blobs";

export default async () => {
  try {
    const dataStore = getStore("aiChatDataStore");
    
    // === 第一步：尝试读取元数据 ===
    let uploadMeta = null;
    try {
      uploadMeta = await dataStore.get("upload_meta", { type: "json" });
    } catch (e) {
      // 元数据不存在，忽略错误
    }

    // === 第二步：根据元数据决定读取策略 ===
    
    // === 新格式：ZIP 分块数据 ===
    if (uploadMeta && uploadMeta.isZipFormat === true && uploadMeta.batchId) {
      const { batchId, totalChunks } = uploadMeta;
      const chunks = [];
      let successCount = 0;

      // 循环读取所有 ZIP 分块
      for (let i = 0; i < totalChunks; i++) {
        try {
          const chunkData = await dataStore.get(`zip_chunk_${batchId}_${i}`, { type: "text" });
          if (chunkData !== null && chunkData !== undefined) {
            chunks.push({
              index: i,
              data: chunkData
            });
            successCount++;
          } else {
            return new Response(JSON.stringify({
              success: false,
              message: `ZIP chunk ${i} not found`,
              loadedChunks: successCount,
              totalChunks: totalChunks
            }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
        } catch (chunkError) {
          return new Response(JSON.stringify({
            success: false,
            message: `Failed to read ZIP chunk ${i}: ${chunkError.message}`,
            loadedChunks: successCount,
            totalChunks: totalChunks
          }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      // 返回 ZIP 分块数据，由客户端合并和解压
      return new Response(JSON.stringify({
        isZipData: true,
        batchId,
        totalChunks,
        chunks,
        timestamp: uploadMeta.timestamp
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    // === 旧格式：JSON 分块数据（保持向后兼容）===
    if (uploadMeta && uploadMeta.chunked === true && uploadMeta.batchId && uploadMeta.totalChunks > 0 && !uploadMeta.isZipFormat) {
      const { batchId, totalChunks } = uploadMeta;
      const chunks = [];
      let successCount = 0;

      for (let i = 0; i < totalChunks; i++) {
        try {
          const chunkData = await dataStore.get(`chunk_${batchId}_${i}`, { type: "text" });
          if (chunkData !== null && chunkData !== undefined) {
            chunks.push(chunkData);
            successCount++;
          } else {
            return new Response(JSON.stringify({
              success: false,
              message: `Chunk ${i} not found`,
              loadedChunks: successCount,
              totalChunks: totalChunks
            }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
        } catch (chunkError) {
          return new Response(JSON.stringify({
            success: false,
            message: `Failed to read chunk ${i}: ${chunkError.message}`,
            loadedChunks: successCount,
            totalChunks: totalChunks
          }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      // 拼接所有分块
      const combinedJsonString = chunks.join('');

      // 解析拼接后的 JSON
      let loadedData;
      try {
        loadedData = JSON.parse(combinedJsonString);
      } catch (parseError) {
        return new Response(JSON.stringify({
          success: false,
          message: `Failed to parse combined chunks: ${parseError.message}`,
          totalChunks: totalChunks
        }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(loadedData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    // === 最旧格式：读取 alldata ===
    const loadedData = await dataStore.get("alldata", { type: "json" });

    if (!loadedData) {
      // 如果云端没有数据（首次使用），返回一个空对象
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(loadedData), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in load-data function:", error);
    return new Response(JSON.stringify({
      success: false,
      message: "Internal Server Error",
      error: error.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
