<template>
  <div class="home">
    <JMinioVideoUpload :minioConfig="{
      endPoint: 'localhost',
      port: 9000,
      useSSL: true,
      accessKey: 'minioadmin',
      secretKey: 'minioadmin'
    }" bucket="ccc" />
  </div>
</template>

<script>
export default {
  name: 'Home',
  methods: {
    handleUploadSuccess(payload) {
      console.log('Upload successful!', payload)
    }
  }
}
</script>

<style scoped></style>
