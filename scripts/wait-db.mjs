import mysql from "mysql2/promise";
let ready = false;
for (let i = 0; i < 60; i++) {
  try {
    const db = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectTimeout: 1000,
    });
    await db.query("SELECT 1");
    await db.end();
    ready = true;
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
if (!ready) throw new Error("Test database did not become ready");
console.log("Test database ready");
