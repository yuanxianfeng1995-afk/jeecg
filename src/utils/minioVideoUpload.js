import { Buffer } from "buffer";
import { Readable as NodeReadable, PassThrough } from "readable-stream";
import { Minio } from "minio-js";

const Client = Minio.Client

export function createMinioClient(config) {
  if (!config || !config.endPoint || !config.accessKey || !config.secretKey) {
    throw new Error('请提供完整的 minioConfig 配置: endPoint, port, useSSL, accessKey, secretKey')
  }
  return new Client({
    endPoint: config.endPoint,
    port: config.port || 9000,
    useSSL: false,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    sessionToken: config.sessionToken,
  })
}

async function fileToNodeStream(file, chunkSize = 3 * 1024 * 1024) {
  const browserStream = file.stream();
  const reader = browserStream.getReader();

  return new NodeReadable({
    async read(size) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
          return;
        }

        // 将浏览器流的数据块拆分成更小的块
        for (let i = 0; i < value.length; i += chunkSize) {
          const smallChunk = value.subarray(i, i + chunkSize);
          if (!this.push(Buffer.from(smallChunk))) {
            // 缓冲区已满，暂停直到下次调用read()
            return;
          }
        }
      } catch (err) {
        this.destroy(err);
      }
    },
  });
}

function createProgressStream(sourceStream, totalSize, progressCb = () => {}) {
  if (!progressCb || typeof progressCb !== 'function') {
    return sourceStream;
  }

  let uploaded = 0;
  const progressStream = new PassThrough();

  progressCb(0);

  progressStream.on('data', (chunk) => {
    uploaded += chunk.length;
    if (totalSize > 0) {
      const percent = Math.min(100, Math.round((uploaded / totalSize) * 100));
      progressCb(percent);
    }
  });

  progressStream.on('end', () => {
    progressCb(100);
  });

  sourceStream.pipe(progressStream);
  return progressStream;
}

export async function uploadVideoChunks({ client, bucketName, objectName, file, chunkSize = 5 * 1024 * 1024, progressCb = () => { } }) {
  if (!client || !bucketName || !objectName || !file) {
    throw new Error('uploadVideoChunks 需要 client, bucketName, objectName 和 file 参数')
  }


  // // 预签名版直传方案
  // const url = await client.presignedPutObject(
  //   bucketName,
  //   objectName,
  //   3600,
  // );
  // fetch(url, {
  //   mode: "cors", // 解决跨域
  //   headers: {
  //     // Accept:
  //     "Content-Type": "multipart/form-data",
  //     "Content-Disposition": "form-data",
  //   },
  //   method: "PUT",
  //   body: file, //data就是文件对象
  // }).then((response) => {
  //   console.log(response, "response");
  //   if (response.ok) {
  //     // 处理成功的情况
  //     console.log(`${file.name} 上传成功`, response);
  //   } else {
  //     // 处理失败的情况
  //     console.log(`${file.name} "上传失败，请重新上传！"`, response);
  //   }
  // });
  // return

  const nodeStream = await fileToNodeStream(file)
  const uploadStream = createProgressStream(nodeStream, file.size, progressCb)
  console.log('开始上传分片...', uploadStream)
  try {
    const metaData = {
      "Content-Type": file.type,
      mode: "cors",
    };

    // 发送上传文件的请求
    let res = await client.putObject(
      bucketName, // 桶名称
      objectName,
      uploadStream,
      metaData, // 元数据
    );
    console.log(`${file.name} 上传成功`, res);
    return res;
  } catch (error) {
    console.error("上传失败:", error);
    throw error;
  }
}
