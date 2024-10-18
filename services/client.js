
module.exports = {
  async find(type = 'download') {
    const entities = await strapi.query('client', 'google-drive').find({
      status: true,
    });
    return entities;
  },

  async findOne(query) {
    const entry = await strapi.query('client', 'google-drive').findOne(query);
    return entry;
  },
}