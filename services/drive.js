const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { google } = require('googleapis');
const mime = require('mime');
const axios = require('axios');
const querystring = require('querystring');
const https = require('https');
const PProgress = require('p-progress');
const pLimit = require('p-limit');
const {ThrottleGroup} = require('stream-throttle');

module.exports = {
  init(account) {
    if (['string', 'number'].includes(typeof account)) {
      this.accountId = account;
    } else if (account?.id) {
      this.account = account;
      this.getClient(this.account);
    } else {
      throw new Error('No account');
    }
    this.logger = strapi.log;
    this.axios = axios.create({
      withCredentials: true,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36'
      }
    });
    return this;
  },

  getClient(account) {
    const { token, client } = account;

    this.oAuth2Client = new google.auth.OAuth2(
      client.client_id,
      client.client_secret,
      client.redirect_uri || 'urn:ietf:wg:oauth:2.0:oob'
    );
    this.oAuth2Client.setCredentials(token);
    this.drive = google.drive({
      version: 'v3',
      auth: this.oAuth2Client
    });
    return this.oAuth2Client;
  },

  getDrive() {
    return this.drive;
  },

  getAccount() {
    return this.account;
  },

  async autoSetAccount(type = 'download') {
    if (!this.account) {
      const query = {};
      if (this.accountId) {
        query.id = this.accountId;
      } else {
        query.type = type;
      }
      const account = await strapi.plugins['google-drive'].services.account.findOne(query);
      if (account) {
        this.init(account);
      }
    }
  },

  async getTokens(type = 'download') {
    await this.autoSetAccount(type);
    const credentials = await this.oAuth2Client.credentials;
    return credentials;
  },

  async getAccessToken(type = 'download') {
    await this.autoSetAccount(type);
    const { res, token } = await this.oAuth2Client.getAccessToken();
    return token;
  },

  async getFileInfo(fileUrl) {
    await this.autoSetAccount();
    const fileId = this.getFileIdFromUrl(fileUrl);

    const data = await this.drive.files.get({ fileId, fields: '*' });
    return data ? data.data : null;
  },

  async getFileContent(fileUrl) {
    await this.autoSetAccount();
    const fileId = this.getFileIdFromUrl(fileUrl);

    const { data } = await this.drive.files.get({ fileId, alt: 'media' });
    return data;
  },

  async list(driveId, listParams = {}) {
    await this.autoSetAccount();
    const res = await drive.files.list({
      driveId,
      ...listParams
    });
    return res;
  },

  async export(fileUrl, mimeType ='application/pdf') {
    await this.autoSetAccount();
    const fileId = this.getFileIdFromUrl(fileUrl);

    const data = await this.drive.files.export({ fileId, mimeType });
    return data;
  },

  async getFileInfoV2(fileUrl) {
    await this.autoSetAccount();
    const fileId = this.getFileIdFromUrl(fileUrl);
    try {
      const { data } = await this.oAuth2Client.request({ url: `https://www.googleapis.com/drive/v2/files/${fileId}` });
      return data;
    } catch (err) {
      throw err;
    }
  },

  async getVideoInfo(fileUrl) {
    const fileId = this.getFileIdFromUrl(fileUrl);
    const url = `https://docs.google.com/get_video_info?docid=${fileId}`;
    /* if (fs.existsSync(this.cookieFilePath)) {
      this.logger.info(`Use cookie file ${this.cookieFilePath}`);
      const cookie = fs.readFileSync(this.cookieFilePath, { encoding: 'utf8' });
      if (cookie) {
        this.cookieJar.setCookieSync(cookie, url);
      }
    } */

    // const proxy = this.configService.get('proxy');

    const { headers, data } = await this.axios.get(url, {
      // httpsAgent: proxy ? tunnel.httpsOverHttp({ proxy: proxy }) : undefined,
      proxy: false,
      // jar: this.cookieJar,
    }).catch((err) => {
      this.logger.error(`Get video info fail: ${JSON.stringify(err)}`);
      throw err;
    });
    // const cookieStringSync = this.cookieJar.getCookieStringSync(url);
    // cookieStringSync && fs.writeFileSync(this.cookieFilePath, this.cookieJar.getCookieStringSync(url));

    const cookies = headers['set-cookie'];// || this.cookieJar.getCookiesSync(url) || [];

    if (!cookies || !cookies.length) {
      throw new Error(`Missing cookie when get_video_info`);
    }

    const query = querystring.parse(data);
    if (!query || query.status !== 'ok') throw new Error(query ? query.reason : data);
    query.videos = (query.fmt_stream_map)
      .split(',').map(itagAndUrl => {
        const [itag, url] = itagAndUrl.split('|')
        return {
          itag,
          res: this.getVideoResolution(itag),
          label: this.getVideoResolution(itag) + 'p',
          type: 'video/mp4',
          src: url,
        }
      }).filter(video => video.res !== 0);
    return { ...query, cookies };
  },

  downloadVideo(input) {
    let fileUrl, location, videoInfo;
    if (typeof input.videos !== 'undefined') {
      videoInfo = input;
    } else if (typeof input === 'string') {
      fileUrl = input;
    } else {
      ({ fileUrl, location, videoInfo } = input);
    }

    return new PProgress(async (resolve, reject, progress) => {
      const fileInfo = fileUrl ? await this.getFileInfo(fileUrl) : null;

      const { videos, cookies } = videoInfo || (fileUrl ? await this.getVideoInfo(fileUrl) : {});

      if (!cookies || !cookies.length) {
        throw new Error(`Missing cookie when get_video_info`);
      }

      const video = videos.sort((a, b) => b.res - a.res)[0];

      const fileName = `${fileInfo ? fileInfo.id : new Date().getTime()}-${video.res || ''}-${video.itag || ''}.${fileInfo ? fileInfo.fileExtension : 'mp4'}`;

      const filePath = location ? path.join(location, fileName) : path.join(os.tmpdir(), fileName);

      let downloadUrl = video.src;

      const progressPromise = this.download(downloadUrl, filePath, {
        'Cookie': cookies,
      });
      progressPromise.onProgress(progress);
      progressPromise.then(resolve).catch(reject);
    });
  },

  async createFolder(input) {
    await this.autoSetAccount('upload');
    let name, parentId;
    if (typeof input === 'string') {
      name = input;
    } else {
      ({ name, parentId } = input);
    }

    const fileMetadata = {
      'name': name,
      'mimeType': 'application/vnd.google-apps.folder'
    };

    if (parentId) {
      fileMetadata.parents = [parentId];
    }

    return new Promise((resolve, reject) => {
      this.drive.files.create({
        requestBody: fileMetadata,
        fields: 'id'
      }, function (err, file) {
        if (err) {
          reject(err);
        } else {
          resolve(file.data.id);
        }
      });
    });
  },

  async share(fileUrl, permission = { type: 'anyone', role: 'reader' }) {
    await this.autoSetAccount('upload');
    const fileId = this.getFileIdFromUrl(fileUrl);

    return new Promise((resolve, reject) => {
      this.drive.permissions.create(
        {
          requestBody: permission,
          fileId: fileId,
          fields: 'id'
        },
        function (err, res) {
          if (err) {
            reject(err);
          } else {
            resolve(res);
          }
        }
      );
    });
  },

  async copy(fileUrl) {
    await this.autoSetAccount('upload');
    const fileId = this.getFileIdFromUrl(fileUrl);
    const { data } = await this.drive.files.copy({
      fileId,
      requestBody: {/*  */ }
    });
    return data;
  },

  async delete(fileUrl) {
    await this.autoSetAccount('upload');
    const fileId = this.getFileIdFromUrl(fileUrl);
    const { data } = await this.drive.files.delete({ fileId });
    return data;
  },

  setThrottle(bytes = 0) {
    if (bytes) {
      this.tg = new ThrottleGroup({rate: bytes});
    } else {
      this.tg = null;
    }

    return this;
  },

  /**
   * 
   * @param {*} fileUrl 
   * @param {*} location set null to return buffer
   * @returns Buffer | string file path
   */
  downloadFile(fileUrl, location=null) {
    const fileId = this.getFileIdFromUrl(fileUrl);

    return new PProgress(async (resolve, reject, progress) => {
      await this.autoSetAccount('download');
      this.getFileInfo(fileUrl).then((fileInfo) => {
        const fileName = `${fileInfo.id}.${fileInfo.fileExtension}`;
        const filePath = location ? path.join(location, fileName) : null;

        const fileSize = parseInt(fileInfo.size);

        let parameters = { responseType: 'stream' };
        let stats = { size: 0 };
        if (filePath && fs.existsSync(filePath)) {
          stats = fs.statSync(filePath);
          if (stats.size === fileSize) {
            this.logger.info('File ' + filePath + ' exists!' + "\n");
            return resolve(filePath);
          }

          parameters.headers = {
            Range: 'bytes=' + stats.size + '-' + fileSize
          };
          this.logger.info('Resume at bytes ' + stats.size + '');
        }

        let loaded = 0;
        const bufs = [];
        this.drive.files.get(
          { fileId, alt: 'media' },
          parameters ? parameters : { responseType: 'stream' }
        ).then(({ data }) => {
          data.on('end', () => {
            const buffer = Buffer.concat(bufs);
            resolve(filePath ? filePath : buffer);
          })
            .on('error', err => {
              reject(err);
            })
            .on('data', data => {
              bufs.push(data);
              loaded += data.length;
              progress(loaded / fileSize);
            });
          if (filePath) {
            if (this.tg) {
              // TEST, not working
              data.pipe(this.tg.throttle()).pipe(fs.createWriteStream(filePath));
            } else {
              data.pipe(fs.createWriteStream(filePath));
            }
          }
        }).catch(async (err) => {
          const { message, response } = err;
          // const stream = response && response.data ? response.data : message; // same
          const stream = message;
          const chunks = [];
          const data = await new Promise((resolve, reject) => {
            stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            stream.on('error', (err) => reject(err));
            stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          });
          try {
            const {error : {message}} = JSON.parse(data);
            return reject(new Error(message));
          } catch (error) {
            
          }
          return reject(err);
        });
      }).catch((err) => reject(err));
    });
  },

  async downloadFileSteam(fileUrl) {
    await this.autoSetAccount('download');
    const fileId = this.getFileIdFromUrl(fileUrl);

    const { data, headers } = await this.drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    return { data, headers };
  },

  uploadFile(input) {
    let filePath, _fileName, mimeType, folderId;
    if (typeof input === 'string') {
      filePath = input;
    } else {
      ({ filePath, fileName: _fileName, mimeType, folderId } = input);
    }
    const fileName = _fileName || path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;
    const fileMime = mimeType || mime.getType(filePath);

    const fileMetadata = {
      name: fileName,
      mimeType: fileMime,
    };
    if (folderId) {
      fileMetadata.parents = [folderId];
    }

    return new PProgress(async (resolve, reject, progress) => {
      await this.autoSetAccount('upload');
      this.drive.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType: fileMime,
          body: fs.createReadStream(filePath)
        }
      }, {
        onUploadProgress: (evt) => {
          progress(evt.bytesRead / fileSize);
        }
      }, (err, data) => {
        if (err) {
          /**
           * "User Rate Limit Exceeded. 
           * Rate of requests for user exceed configured project quota. 
           * You may consider re-evaluating expected per-user traffic to the API and adjust project quota limits accordingly. 
           * You may monitor aggregate quota usage and adjust limits in the API Console: 
           * https://console.developers.google.com/apis/api/drive.googleapis.com/quotas?project=538656488600"
           */
          reject(err);
        } else {
          resolve(data.data);
        }
      });
    });
  },

  bufferToStream(binary) {
    const readableInstanceStream = new Readable({
      read() {
        this.push(binary);
        this.push(null);
      }
    });

    return readableInstanceStream;
  },

  uploadBuffer(file) {
    const { name, ext, mime, buffer, folderId } = file;

    const fileMetadata = {
      name: name,
      mimeType: mime,
    };
    if (folderId) {
      fileMetadata.parents = [folderId];
    }

    const body = Buffer.from(buffer);
    const size = Buffer.byteLength(body);

    return new PProgress(async (resolve, reject, progress) => {
      await this.autoSetAccount('upload');
      this.drive.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType: fileMetadata.mimeType,
          body: this.bufferToStream(buffer)
        }
      }, {
        onUploadProgress: (evt) => {
          progress(evt.bytesRead / size);
        }
      }, (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data.data);
        }
      });
    });
  },

  uploadFiles(files, folderId, concurrency = 5, maxRetries = 5) {
    return new PProgress(async (resolve, reject, progress) => {
      const limit = pLimit(concurrency);
      let loaded = 0;
      const filesUploadFail = [];
      const chunkFilesUploaded = await Promise.all(files.map((filePath) => limit(() => {
        const fileName = path.basename(filePath);
        return this.uploadFile({
          filePath: filePath,
          folderId,
          fileName: fileName,
        }).then((fileId) => {
          loaded += 1;
          progress(loaded / files.length);
          return {
            fileId,
            fileName: fileName,
            filePath: filePath,
          };
        }).catch((err) => {
          // handle upload file error
          strapi.log.error(`Upload file ${fileName} fail, add to queue to re-upload.`);
          filesUploadFail.push(fileName);
        });
      })));
      if (filesUploadFail.length) {
        if (maxRetries) {
          strapi.log.warn(`Found ${filesUploadFail.length} upload fail, start re-upload...`);
          await new Promise((r) => setTimeout(() => r(true), 1000));
          const progressPromise = this.uploadFiles(filesUploadFail, --maxRetries);
          progressPromise.onProgress(_progress => {
            strapi.log.info(`Retried upload ${_progress} / ${filesUploadFail.length} files.`);
          });
          const filesReUploaded = await progressPromise;
          if (filesReUploaded && filesReUploaded.length === filesUploadFail.length) {
            progress(1);
          }
          chunkFilesUploaded.concat(filesReUploaded);
        } else {
          strapi.log.error(`Reached maxRetries, skip re-upload.`);
        }
      }
      resolve(chunkFilesUploaded);
    });
  },

  async getDownloadUrl(fileUrl) {
    await this.autoSetAccount('download');
    const fileId = this.getFileIdFromUrl(fileUrl);
    try {
      const { access_token } = this.oAuth2Client.credentials;
      const { data, headers, config } = await this.oAuth2Client.request({ url: `https://www.googleapis.com/drive/v2/files/${fileId}` });
      const downloadUrl = `${data.downloadUrl}`;
      const _data = await axios.get(downloadUrl, {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
        maxRedirects: 0,
      }).catch(async (err) => {
        if (err.response && err.response.status === 302) {
          const url = err.response.headers.location;
          const data = await axios.get(url, {
            headers: {
              Authorization: `Bearer ${access_token}`,
            },
            maxRedirects: 0,
          }).catch(async (err) => {
            return err.message;
          });
          return data;
        }
        return err.message;
      });
      return downloadUrl;
    } catch (err) {
      throw err;
    }
  },

  download(url, filePath, headers) {
    this.logger.info(`[download] url ${url}`);
    const file = fs.createWriteStream(filePath);

    return new PProgress((resolve, reject, progress) => {
      https.get(url, {
        headers: headers
      }).on('response', (res) => {
        if (res.statusCode >= 400) {
          return reject(new Error(`${res.statusCode}: ${res.statusMessage}`));
        }
        const location = res.headers.location;
        if (location) {
          this.logger.info(`[download] Redirect to ${location}`);
          // return resolve(this.download(location, filePath, headers));
          const progressPromise = this.download(location, filePath, headers);
          progressPromise.onProgress(progress);
          return progressPromise.then(resolve).catch(reject);
        }
        const len = parseInt(res.headers['content-length'], 10);
        let loaded = 0;
        res.on('data', (chunk) => {
          loaded += chunk.length;
          file.write(chunk);
          progress(loaded / len);
        })
          .on('end', () => {
            file.end();
            const { size } = fs.statSync(filePath);
            if (size) {
              resolve(filePath);
            } else {
              reject(new Error(`File size empty: ${filePath}`));
            }
          })
          .on('error', (err) => {
            reject(err);
          })
      });
    });
  },

  async getResumableUploadUri({ name, mimeType, size }) {
    mimeType = mimeType || mime.getType(name);
    if (!size && fs.existsSync(name)) {
      size = fs.statSync(name).size;
    }
    const body = JSON.stringify({
      name: path.basename(name),
      mimeType: mimeType,
    });
    await this.autoSetAccount('upload');
    const { headers } = await this.oAuth2Client.request({
      method: 'POST',
      url: `https://www.googleapis.com/upload/drive/v3/files/?uploadType=resumable`,
      headers: {
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': size,
        'Content-Type': 'application/json; charset=UTF-8',
        'Content-Length': body.length,
      },
      body: body,
    }).catch((err) => {
      this.logger.error(err.message || err);
      return {};
    });
    return headers.location;
  },

  getFileIdFromUrl(fileUrl) {
    const match = (fileUrl || '').match(/^(?:https?:\/\/)?(?:www\.)?(?:(?:drive\.google|googledrive)\.com\/)(?:file\/d\/|a\/[^\/]+\/file\/d\/|host\/|open\?id=)([\w-]{10,40})(?:\?|\/)?/);
    return match ? match[1] : fileUrl;
  },

  getVideoResolution(itag) {
    const videoCode = {
      '18': 360,
      '59': 480,
      '22': 720,
      '37': 1080
    }
    return videoCode[itag] || 0
  },
};
