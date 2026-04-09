const CloudStore = require("@xgenia/runtime/src/api/cloudstore");
const CloudFile = require("@xgenia/runtime/src/api/cloudfile");

const files = {
  async upload(file, options) {
    return new Promise((resolve, reject) => {
      CloudStore.instance.uploadFile({
        file,
        onUploadProgress: (p) => {
          options && options.onProgress && options.onProgress(p);
        },
        success: (response) => {
          resolve(new CloudFile(response));
        },
        error: (e) => {
          reject(e);
        },
      });
    });
  },
};

module.exports = files;
