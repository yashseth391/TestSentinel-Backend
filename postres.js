const Pool = require("pg").Pool;
const pool = new Pool({
  user: "hello",
  host: "localhost",
  database: "nodejs-pg-api",
  password: "12345",
  port: 5432,
});
