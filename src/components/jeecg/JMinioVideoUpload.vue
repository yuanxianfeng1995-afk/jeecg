<template>
  <div>
    <a-upload
      ref="upload"
      name="file"
      :fileList="fileList"
      :multiple="false"
      :accept="accept"
      :showUploadList="true"
      :customRequest="customRequest"
      :beforeUpload="doBeforeUpload"
      @change="handleChange"
      :disabled="disabled"
    >
      <a-button :disabled="disabled">
        <a-icon type="upload" />{{ text }}
      </a-button>
    </a-upload>
  </div>
</template>

<script>
import { createMinioClient, uploadVideoChunks } from '@/utils/minioVideoUpload'

export default {
  name: 'JMinioVideoUpload',
  props: {
    text: {
      type: String,
      default: '上传视频（MinIO 分片）',
    },
    accept: {
      type: String,
      default: 'video/*',
    },
    bucket: {
      type: String,
      required: true,
    },
    objectPrefix: {
      type: String,
      default: 'video/',
    },
    minioConfig: {
      type: Object,
      required: true,
    },
    chunkSize: {
      type: Number,
      default: 5 * 1024 * 1024,
    },
    maxFileSize: {
      type: Number,
      default: 2 * 1024 * 1024 * 1024,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    beforeUpload: {
      type: Function,
    },
  },
  data() {
    return {
      fileList: [],
    }
  },
  methods: {
    async customRequest({ file, onProgress, onSuccess, onError }) {
      try {
        const videoFile = file
        if (!videoFile) {
          throw new Error('未找到上传文件')
        }

        const minioClient = createMinioClient(this.minioConfig)
        const objectName = `${this.objectPrefix}${videoFile.name}`

        const result = await uploadVideoChunks({
          client: minioClient,
          bucketName: this.bucket,
          objectName,
          file: videoFile,
          chunkSize: this.chunkSize,
          progressCb: (percent) => {
            onProgress({ percent })
          },
        })

        const response = {
          success: true,
          message: result.url,
          objectName: result.objectName,
          etag: result.etag,
        }
        onSuccess(response, videoFile)
        this.$emit('success', response)
      } catch (err) {
        onError(err)
        this.$emit('error', err)
      }
    },
    doBeforeUpload(file) {
      if (file.size > this.maxFileSize) {
        this.$message.warning(`视频大小不能超过 ${Math.round(this.maxFileSize / (1024 * 1024))}MB`)
        return false
      }
      if (file.type && !file.type.startsWith('video')) {
        this.$message.warning('请上传视频文件')
        return false
      }
      if (typeof this.beforeUpload === 'function') {
        return this.beforeUpload(file)
      }
      return true
    },
    handleChange(info) {
      this.fileList = info.fileList.slice(-1)
      this.$emit('change', info)
    },
  },
}
</script>

<style scoped>
</style>
