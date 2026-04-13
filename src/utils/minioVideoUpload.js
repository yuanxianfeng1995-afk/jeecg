import { Client } from 'minio'

export function createMinioClient(config) {
  if (!config || !config.endPoint || !config.accessKey || !config.secretKey) {
    throw new Error('请提供完整的 minioConfig 配置: endPoint, port, useSSL, accessKey, secretKey')
  }
  return new Client({
    endPoint: config.endPoint,
    port: config.port || 9000,
    useSSL: !!config.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    sessionToken: config.sessionToken,
  })
}

function toTypedArray(data) {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }
  if (ArrayBuffer.isView(data)) {
    return data
  }
  return new Uint8Array(data)
}

export async function uploadVideoChunks({ client, bucketName, objectName, file, chunkSize = 5 * 1024 * 1024, progressCb = () => {} }) {
  if (!client || !bucketName || !objectName || !file) {
    throw new Error('uploadVideoChunks 需要 client, bucketName, objectName 和 file 参数')
  }

  const metaData = {
    'Content-Type': file.type || 'application/octet-stream',
  }

  const uploadId = await client.initiateNewMultipartUpload(bucketName, objectName, metaData)
  const parts = []
  let uploaded = 0

  try {
    for (let partNumber = 1, start = 0; start < file.size; partNumber += 1, start += chunkSize) {
      const end = Math.min(start + chunkSize, file.size)
      const blob = file.slice(start, end)
      const arrayBuffer = await blob.arrayBuffer()
      const partData = toTypedArray(arrayBuffer)
      const etag = await client.uploadPart(bucketName, objectName, uploadId, partNumber, partData, partData.byteLength || partData.length)
      parts.push({ PartNumber: partNumber, ETag: etag })
      uploaded += end - start
      progressCb(Math.min(100, (uploaded / file.size) * 100))
    }

    const result = await client.completeMultipartUpload(bucketName, objectName, uploadId, parts)
    return {
      objectName,
      etag: result && (result.etag || result.ETag || ''),
      url: objectName,
      result,
    }
  } catch (error) {
    try {
      await client.abortMultipartUpload(bucketName, objectName, uploadId)
    } catch (abortError) {
      // ignore abort error
    }
    throw error
  }
}
