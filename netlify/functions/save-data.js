import { getStore } from "@netlify/blobs";

export default async (req) => {
  try {
    // 只接受 POST 请求
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const dataStore = getStore("aiChatDataStore");
    const requestBody = await req.json();

    // 检测是否为 ZIP 格式上传
    if (requestBody.isZipUpload === true) {
      // === ZIP 格式上传模式 ===
      const { isChunked, batchId, data, chunkIndex, totalChunks, chunkSize, isFinal, totalSize } = requestBody;

      // 验证必要字段
      if (!batchId) {
        return new Response(JSON.stringify({
          success: false,
          message: "Missing required field: batchId"
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (isChunked === true) {
        // === ZIP 分块上传模式 ===
        if (typeof chunkIndex !== 'number' || typeof totalChunks !== 'number') {
          return new Response(JSON.stringify({
            success: false,
            message: "Missing required chunked upload fields: chunkIndex, totalChunks"
          }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        // 存储当前 ZIP 分块（Base64 字符串）
        await dataStore.set(`zip_chunk_${batchId}_${chunkIndex}`, data);

        // 如果是最后一块，存储元数据并清理旧分块
        if (isFinal === true) {
          // 先获取旧的元数据用于后续清理
          let oldMeta = null;
          try {
            oldMeta = await dataStore.get("upload_meta", { type: "json" });
          } catch (e) {
            // 忽略获取旧元数据失败
          }

          // 存储新的上传元数据
          const uploadMeta = {
            batchId,
            totalChunks,
            timestamp: Date.now(),
            completed: true,
            isZipFormat: true,
            chunked: true
          };
          await dataStore.setJSON("upload_meta", uploadMeta);

          // 清理之前批次的旧分块（防止存储膨胀）
          if (oldMeta && oldMeta.batchId && oldMeta.batchId !== batchId) {
            const oldChunkCount = oldMeta.totalChunks || 0;
            for (let i = 0; i < oldChunkCount; i++) {
              try {
                if (oldMeta.isZipFormat) {
                  await dataStore.delete(`zip_chunk_${oldMeta.batchId}_${i}`);
                } else {
                  await dataStore.delete(`chunk_${oldMeta.batchId}_${i}`);
                }
              } catch (e) {
                // 忽略删除失败
              }
            }
          }

          return new Response(JSON.stringify({
            success: true,
            complete: true,
            batchId,
            totalChunks,
            message: "All ZIP chunks uploaded successfully."
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        // 非最后一块，返回确认响应
        return new Response(JSON.stringify({
          success: true,
          chunkIndex,
          received: true,
          message: `ZIP chunk ${chunkIndex + 1}/${totalChunks} received.`
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });

      } else {
        // === ZIP 单次上传模式（小于 5MB）===
        // 先获取旧的元数据用于后续清理
        let oldMeta = null;
        try {
          oldMeta = await dataStore.get("upload_meta", { type: "json" });
        } catch (e) {
          // 忽略获取旧元数据失败
        }

        // 存储 ZIP 数据（Base64 字符串）
        await dataStore.set(`zip_chunk_${batchId}_0`, data);

        // 存储元数据
        const uploadMeta = {
          batchId,
          totalChunks: 1,
          totalSize: totalSize || 0,
          timestamp: Date.now(),
          completed: true,
          isZipFormat: true,
          chunked: false
        };
        await dataStore.setJSON("upload_meta", uploadMeta);

        // 清理之前批次的旧分块
        if (oldMeta && oldMeta.batchId && oldMeta.batchId !== batchId) {
          const oldChunkCount = oldMeta.totalChunks || 0;
          for (let i = 0; i < oldChunkCount; i++) {
            try {
              if (oldMeta.isZipFormat) {
                await dataStore.delete(`zip_chunk_${oldMeta.batchId}_${i}`);
              } else {
                await dataStore.delete(`chunk_${oldMeta.batchId}_${i}`);
              }
            } catch (e) {
              // 忽略删除失败
            }
          }
        }

        return new Response(JSON.stringify({
          success: true,
          message: "ZIP data saved successfully."
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

    } else if (requestBody.isChunked === true) {
      // === 旧版：JSON 分块上传模式（保持向后兼容）===
      const { chunkIndex, totalChunks, isFinal, data, batchId } = requestBody;

      if (typeof chunkIndex !== 'number' || typeof totalChunks !== 'number' || !batchId) {
        return new Response(JSON.stringify({
          success: false,
          message: "Missing required chunked upload fields: chunkIndex, totalChunks, batchId"
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      await dataStore.setJSON(`chunk_${batchId}_${chunkIndex}`, data);

      if (isFinal === true) {
        let oldMeta = null;
        try {
          oldMeta = await dataStore.get("upload_meta", { type: "json" });
        } catch (e) {}

        const uploadMeta = {
          batchId,
          totalChunks,
          timestamp: Date.now(),
          completed: true,
          isZipFormat: false,
          chunked: true
        };
        await dataStore.setJSON("upload_meta", uploadMeta);

        if (oldMeta && oldMeta.batchId && oldMeta.batchId !== batchId && oldMeta.chunked === true) {
          for (let i = 0; i < oldMeta.totalChunks; i++) {
            try {
              await dataStore.delete(`chunk_${oldMeta.batchId}_${i}`);
            } catch (e) {}
          }
        }

        return new Response(JSON.stringify({
          success: true,
          complete: true,
          batchId,
          totalChunks,
          message: "All chunks uploaded successfully."
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        chunkIndex,
        received: true,
        message: `Chunk ${chunkIndex + 1}/${totalChunks} received.`
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    } else {
      // === 旧版：JSON 单次上传模式（保持向后兼容）===
      await dataStore.setJSON("alldata", requestBody);

      await dataStore.setJSON("upload_meta", {
        batchId: null,
        totalChunks: 0,
        timestamp: Date.now(),
        completed: true,
        isZipFormat: false,
        chunked: false
      });

      return new Response(JSON.stringify({ success: true, message: "Data saved successfully." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    console.error("Error in save-data function:", error);
    return new Response(JSON.stringify({ success: false, message: "Internal Server Error", error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
