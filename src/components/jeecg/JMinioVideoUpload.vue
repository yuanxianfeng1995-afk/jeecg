<template>
  <div class="container">
    <div class="logo"><img src="@/assets/logo.png" /></div>
    <uploader
      ref="uploader"
      :options="options"
      :autoStart="false"
      :file-status-text="fileStatusText"
      @file-added="onFileAdded"
      @file-success="onFileSuccess"
      @file-error="onFileError"
      @file-progress="onFileProgress"
      class="uploader-example"
    >
      <uploader-unsupport></uploader-unsupport>
      <uploader-drop>
        <p>拖动文件到这里上传</p>
        <uploader-btn>选择文件</uploader-btn>
        <uploader-btn :directory="true">选择文件夹</uploader-btn>
      </uploader-drop>
      <!-- uploader-list可自定义样式 -->
      <!-- <uploader-list></uploader-list> -->
      <uploader-list>
        <div class="file-panel" :class="{ collapse: collapse }">
          <div class="file-title">
            <p class="file-list-title">文件列表</p>
            <div class="operate">
              <el-button
                type="text"
                @click="operate"
                :title="collapse ? '折叠' : '展开'"
              >
                <i
                  class="icon"
                  :class="
                    collapse ? 'el-icon-caret-bottom' : 'el-icon-caret-top'
                  "
                ></i>
              </el-button>
              <el-button type="text" @click="close" title="关闭">
                <i class="icon el-icon-close"></i>
              </el-button>
            </div>
          </div>

          <ul
            class="file-list"
            :class="
              collapse ? 'uploader-list-ul-show' : 'uploader-list-ul-hidden'
            "
          >
            <li v-for="file in uploadFileList" :key="file.id">
              <uploader-file
                :class="'file_' + file.id"
                ref="files"
                :file="file"
                :list="true"
              ></uploader-file>
            </li>
            <div class="no-file" v-if="!uploadFileList.length">
              <i class="icon icon-empty-file"></i> 暂无待上传文件
            </div>
          </ul>
        </div>
      </uploader-list>
      <span>下载</span>
    </uploader>
  </div>
</template>

<script>
import SparkMD5 from "spark-md5";
import { createMinioClient, uploadVideoChunks } from '@/utils/minioVideoUpload'
const FILE_UPLOAD_ID_KEY = "file_upload_id";
// 分片大小，20MB
const CHUNK_SIZE = 20 * 1024 * 1024;
export default {
  props: {
    minioConfig: {
      type: Object,
      default: () => ({})
    },
    bucket: {
      type: String,
      default: ''
    },
    objectPrefix: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      options: {
        // 本组件仅用于文件选择和列表展示，实际上传由纯前端 MinIO 直连实现
        target: "",
        testChunks: false,
        uploadMethod: "post",
        chunkSize: CHUNK_SIZE,
        simultaneousUploads: 1,
        parseTimeRemaining: function (timeRemaining, parsedTimeRemaining) {
          //格式化时间
          return parsedTimeRemaining
            .replace(/\syears?/, "年")
            .replace(/\days?/, "天")
            .replace(/\shours?/, "小时")
            .replace(/\sminutes?/, "分钟")
            .replace(/\sseconds?/, "秒");
        },
      },
      // 修改上传状态
      fileStatusTextObj: {
        success: "上传成功",
        error: "上传错误",
        uploading: "正在上传",
        paused: "停止上传",
        waiting: "等待中",
      },
      uploadIdInfo: null,
      uploadFileList: [],
      fileChunkList: [],
      collapse: true,
    };
  },
  methods: {
    onFileAdded(file, event) {
      this.uploadFileList.push(file);
      // 有时 fileType为空，需截取字符
      console.log("文件类型：" + file.fileType);
      // 文件大小
      console.log("文件大小：" + file.size + "B");
      if (!this.isMinioConfigValid()) {
        this.$message.error('请配置完整的 MinIO 参数：bucket 及 minioConfig')
        return
      }
      console.log("校验MD5");
      this.uploadFileDirectToMinio(file);
      // this.getFileMD5(file, async (md5) => {
      //   if (md5 != "") {
      //     file.uniqueIdentifier = md5;
      //     // 纯前端直连上传 MinIO
      //     await this.uploadFileDirectToMinio(file);
      //   }
      // });
    },
    onFileSuccess(rootFile, file, response, chunk) {
      console.log("上传成功");
    },
    onFileError(rootFile, file, message, chunk) {
      console.log("上传出错：" + message);
    },
    onFileProgress(rootFile, file, chunk) {
      console.log(`当前进度：${Math.ceil(file._prevProgress * 100)}%`);
    },

    // 计算文件的MD5值
    getFileMD5(file, callback) {
      let spark = new SparkMD5.ArrayBuffer();
      let fileReader = new FileReader();
      //获取文件分片对象（注意它的兼容性，在不同浏览器的写法不同）
      let blobSlice =
        File.prototype.slice ||
        File.prototype.mozSlice ||
        File.prototype.webkitSlice;
      // 当前分片下标
      let currentChunk = 0;
      // 分片总数(向下取整)
      let chunks = Math.ceil(file.size / CHUNK_SIZE);
      // MD5加密开始时间
      let startTime = new Date().getTime();
      // 暂停上传
      file.pause();
      loadNext();
      // fileReader.readAsArrayBuffer操作会触发onload事件
      fileReader.onload = function (e) {
        // console.log("currentChunk :>> ", currentChunk);
        spark.append(e.target.result);
        if (currentChunk < chunks) {
          currentChunk++;
          loadNext();
        } else {
          // 该文件的md5值
          let md5 = spark.end();
          console.log(
            `MD5计算完毕：${md5}，耗时：${new Date().getTime() - startTime} ms.`
          );
          // 回调传值md5
          callback(md5);
        }
      };
      fileReader.onerror = function () {
        this.$message.error("文件读取错误");
        file.cancel();
      };
      // 加载下一个分片
      function loadNext() {
        const start = currentChunk * CHUNK_SIZE;
        const end =
          start + CHUNK_SIZE >= file.size ? file.size : start + CHUNK_SIZE;
        // 文件分片操作，读取下一分片(fileReader.readAsArrayBuffer操作会触发onload事件)
        fileReader.readAsArrayBuffer(blobSlice.call(file.file, start, end));
      }
    },
    fileStatusText(status, response) {
      if (status === "md5") {
        return "校验MD5";
      } else {
        return this.fileStatusTextObj[status];
      }
    },
    isMinioConfigValid() {
      return (
        this.bucket &&
        this.minioConfig &&
        this.minioConfig.endPoint &&
        this.minioConfig.accessKey &&
        this.minioConfig.secretKey
      )
    },
    async uploadFileDirectToMinio(wrappedFile) {
      const rawFile = wrappedFile.file || wrappedFile
      if (!rawFile || typeof rawFile.slice !== 'function') {
        this.triggerFileError(wrappedFile, '无法读取文件对象')
        return
      }
      const client = createMinioClient(this.minioConfig)
      console.log('开始上传到 MinIO，文件名：',client, rawFile.name)
      const objectName = `${this.objectPrefix || ''}${rawFile.name}`
      try {
        const result = await uploadVideoChunks({
          client,
          bucketName: this.bucket,
          objectName,
          file: rawFile,
          chunkSize: this.options.chunkSize,
          progressCb: (percent) => {
            this.triggerFileProgress(wrappedFile, percent)
          }
        })
        this.triggerFileSuccess(wrappedFile, result)
      } catch (error) {
        const message = (error && error.message) || String(error)
        this.triggerFileError(wrappedFile, message)
      }
    },
    triggerFileProgress(file, percent) {
      file._prevProgress = percent / 100
      if (file.uploader && typeof file.uploader._trigger === 'function') {
        file.uploader._trigger('fileProgress', file, file, null)
      }
    },
    triggerFileSuccess(file, result) {
      file.completed = true
      file.error = false
      file.paused = false
      file._prevProgress = 1
      if (file.uploader && typeof file.uploader._trigger === 'function') {
        file.uploader._trigger('fileSuccess', file, file, JSON.stringify(result), null)
        file.uploader._trigger('fileComplete', file, file)
      }
    },
    triggerFileError(file, message) {
      file.error = true
      file.paused = false
      if (file.uploader && typeof file.uploader._trigger === 'function') {
        file.uploader._trigger('fileError', file, file, message, null)
      }
    },
    /**
     * 折叠、展开面板动态切换
     */
    operate() {
      if (this.collapse === false) {
        this.collapse = true;
      } else {
        this.collapse = false;
      }
    },

    /**
     * 关闭折叠面板
     */
    close() {
      this.uploaderPanelShow = false;
    },
  },
};
</script>

<style lang="less" scoped>
.logo {
  font-family: "Avenir", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
.uploader-example {
  width: 880px;
  padding: 15px;
  margin: 40px auto 0;
  font-size: 12px;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.4);
}
.uploader-example .uploader-btn {
  margin-right: 4px;
}
.uploader-example .uploader-list {
  max-height: 440px;
  overflow: auto;
  overflow-x: hidden;
  overflow-y: auto;
}

#global-uploader {
  position: fixed;
  z-index: 20;
  right: 15px;
  bottom: 15px;
  width: 550px;
}

.file-panel {
  background-color: #fff;
  border: 1px solid #e2e2e2;
  border-radius: 7px 7px 0 0;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);
}

.file-title {
  display: flex;
  height: 60px;
  line-height: 30px;
  padding: 0 15px;
  border-bottom: 1px solid #ddd;
}

.file-title {
  background-color: #e7ecf2;
}

.uploader-file-meta {
  display: none !important;
}

.operate {
  flex: 1;
  text-align: right;
}

.file-list {
  position: relative;
  height: 240px;
  overflow-x: hidden;
  overflow-y: auto;
  background-color: #fff;
  padding: 0px;
  margin: 0 auto;
  transition: all 0.5s;
}

.uploader-file-size {
  width: 15% !important;
}

.uploader-file-status {
  width: 32.5% !important;
  text-align: center !important;
}

li {
  background-color: #fff;
  list-style-type: none;
}

.no-file {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 16px;
}

/* 隐藏上传按钮 */
.global-uploader-btn {
  display: none !important;
  clip: rect(0, 0, 0, 0);
  /* width: 100px;
  height: 50px; */
}

.file-list-title {
  /*line-height: 10px;*/
  font-size: 16px;
}

.uploader-file-name {
  width: 36% !important;
}

.uploader-file-actions {
  float: right !important;
}

.uploader-list-ul-hidden {
  height: 0px;
  
}
</style>