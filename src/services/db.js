const { Client } = require('pg');
const { DATABASE_URL } = require('../config');

const client = new Client({
  connectionString: DATABASE_URL
});

client.connect()
  .then(() => console.log('✅ Connected to PostgreSQL'))
  .catch(err => console.error('DB connection error', err));

module.exports = client;
