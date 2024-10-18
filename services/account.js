
module.exports = {
  async findOne(query) {
    const entry = await strapi.query('account', 'google-drive').findOne({
      status: true,
      'client.project_id_null': false,
      _sort: 'created_at:DESC',
      ...query,
    });
    return entry;
  },

  async findOneAccountDownload(query={}) {
    query.type = 'download';
    return await this.findOne(query);
  },

  async findOneAccountUpload(query={}) {
    query.type = 'upload';
    const entry = await this.findOne(query);
    return entry;
  },

  async create(data) {
    const account = await strapi.query('account', 'google-drive').create(data);

    return account;
  }
}