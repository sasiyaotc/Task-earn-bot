
require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { Bot } = require("grammy");

const app = express();
app.use(express.json({ limit: "20kb" }));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const WEBAPP_URL = process.env.WEBAPP_URL;
const AD_REWARD_USD = Number(process.env.AD_REWARD_USD || 0.005);
const MONETAG_POSTBACK_SECRET = process.env.MONETAG_POSTBACK_SECRET;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is missing from environment variables.");
}

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is missing from environment variables.");
}

if (!Number.isFinite(AD_REWARD_USD) || AD_REWARD_USD <= 0) {
  throw new Error("AD_REWARD_USD must be a positive number.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const bot = new Bot(BOT_TOKEN);

/* ---------------- DATABASE ---------------- */

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      balance NUMERIC(18, 6) NOT NULL DEFAULT 0,
      total_earned NUMERIC(18, 6) NOT NULL DEFAULT 0,
      referred_by BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ad_sessions (
      id BIGSERIAL PRIMARY KEY,
      ymid TEXT NOT NULL UNIQUE,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'rewarded', 'rejected')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      rewarded_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS ad_sessions_user_date_idx
      ON ad_sessions (telegram_id, created_at);
  `);

  console.log("Database tables are ready.");
}

/* ---------------- TELEGRAM WEB APP AUTH ---------------- */

function verifyTelegramInitData(initData) {
  if (!initData || typeof initData !== "string" || !BOT_TOKEN) {
    return null;
  }

  try {
    const params = new URLSearchParams(initData);
    const receivedHash = params.get("hash");

    if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
      return null;
    }

    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    const received = Buffer.from(receivedHash, "hex");
    const calculated = Buffer.from(calculatedHash, "hex");

    if (
      received.length !== calculated.length ||
      !crypto.timingSafeEqual(received, calculated)
    ) {
      return null;
    }

    const authDate = Number(params.get("auth_date"));
    const now = Math.floor(Date.now() / 1000);

    // Reject invalid, future-dated, or old authentication data.
    if (
      !Number.isFinite(authDate) ||
      authDate > now + 30 ||
      now - authDate > 3600
    ) {
      return null;
    }

    const userString = params.get("user");
    if (!userString) return null;

    const user = JSON.parse(userString);

    if (!user.id || !Number.isSafeInteger(Number(user.id))) {
      return null;
    }

    return user;
  } catch (error) {
    console.error("Telegram authentication failed.");
    return null;
  }
}

/* ---------------- USER HELPERS ---------------- */

async function upsertTelegramUser(user) {
  await pool.query(
    `INSERT INTO users (telegram_id, username, first_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (telegram_id)
     DO UPDATE SET username = EXCLUDED.username,
                   first_name = EXCLUDED.first_name`,
    [
      String(user.id),
      user.username || null,
      user.first_name || null
    ]
  );
}

/* ---------------- TELEGRAM BOT ---------------- */

bot.command("start", async (ctx) => {
  const user = ctx.from;
  const startParameter = ctx.match ? String(ctx.match).trim() : "";

  try {
    await upsertTelegramUser(user);

    // Record an eligible referral only on the first registration.
    if (/^ref_[0-9]+$/.test(startParameter)) {
      const referrerId = startParameter.slice(4);

      if (referrerId !== String(user.id)) {
        await pool.query(
          `UPDATE users
           SET referred_by = $1
           WHERE telegram_id = $2
             AND referred_by IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM users
               WHERE telegram_id = $1
             )`,
          [referrerId, String(user.id)]
        );
      }
    }

    const keyboard = {
      inline_keyboard: []
    };

    if (WEBAPP_URL && WEBAPP_URL.startsWith("https://")) {
      keyboard.inline_keyboard.push([
        {
          text: "🚀 Open TASK AND EARN",
          web_app: { url: WEBAPP_URL }
        }
      ]);
    }

    keyboard.inline_keyboard.push([
      {
        text: "📢 Open our bot",
        url: "https://t.me/task_earn_20_bot"
      }
    ]);

    await ctx.reply(
      `✨ Welcome to TASK AND EARN!\n\n` +
      `💎 Watch ads and explore tasks.\n` +
      `👥 Invite friends.\n` +
      `💳 Manage your account.\n\n` +
      `Open the Mini App below to get started.`,
      { reply_markup: keyboard }
    );
  } catch (error) {
    console.error("Start command failed:", error.message);
    await ctx.reply("Sorry, something went wrong. Please try again later.");
  }
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "TASK AND EARN Help\n\n" +
    "/start - Open the bot\n" +
    "/balance - Check your balance\n" +
    "/help - Show help"
  );
});

bot.command("balance", async (ctx) => {
  try {
    const result = await pool.query(
      "SELECT balance FROM users WHERE telegram_id = $1",
      [String(ctx.from.id)]
    );

    if (result.rowCount === 0) {
      return ctx.reply("Please send /start first.");
    }

    await ctx.reply(
      `Your current balance: $${Number(result.rows[0].balance).toFixed(4)}`
    );
  } catch (error) {
    console.error("Balance command failed:", error.message);
    await ctx.reply("Unable to retrieve your balance right now.");
  }
});

/* ---------------- MINI APP API ---------------- */

app.get("/api/health", (req, res) => {
  res.json({ ok: true, app: "TASK AND EARN" });
});

app.post("/api/ad-session", async (req, res) => {
  const user = verifyTelegramInitData(req.body?.initData);

  if (!user) {
    return res.status(401).json({
      error: "Invalid or expired Telegram authentication."
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO users (telegram_id, username, first_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (telegram_id)
       DO UPDATE SET username = EXCLUDED.username,
                     first_name = EXCLUDED.first_name`,
      [String(user.id), user.username || null, user.first_name || null]
    );

    // Lock this account row so simultaneous requests cannot exceed the limit.
    await client.query(
      "SELECT telegram_id FROM users WHERE telegram_id = $1 FOR UPDATE",
      [String(user.id)]
    );

    const countResult = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM ad_sessions
       WHERE telegram_id = $1
         AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
                            AT TIME ZONE 'UTC'`,
      [String(user.id)]
    );

    const adsToday = countResult.rows[0].total;

    if (adsToday >= 30) {
      await client.query("ROLLBACK");
      return res.status(429).json({
        error: "You have reached today's ad limit."
      });
    }

    const ymid = crypto.randomUUID();

    await client.query(
      `INSERT INTO ad_sessions (ymid, telegram_id)
       VALUES ($1, $2)`,
      [ymid, String(user.id)]
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      sessionId: ymid,
      adsToday: adsToday + 1,
      dailyLimit: 30,
      message: "Session created. A valid provider integration is required."
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Ad session creation failed:", error.message);

    return res.status(500).json({
      error: "Unable to create an ad session."
    });
  } finally {
    client.release();
  }
});

/* ---------------- MONETAG POSTBACK ---------------- */

/*
  Configure your provider's postback to send:
  - ymid: the unique session ID
  - event_type: impression
  - reward_event_type: valued
  - secret: your shared secret

  Confirm the exact macro names and event semantics in your Monetag
  dashboard/docs before enabling payouts.

  A valued impression does NOT prove a complete video was watched.
*/

app.get("/postback", async (req, res) => {
  if (!MONETAG_POSTBACK_SECRET) {
    return res.status(503).send("Postback is not configured.");
  }

  const receivedSecret = String(req.query.secret || "");
  const expectedSecret = String(MONETAG_POSTBACK_SECRET);

  const receivedBuffer = Buffer.from(receivedSecret);
  const expectedBuffer = Buffer.from(expectedSecret);

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return res.status(403).send("Forbidden");
  }

  const ymid = String(req.query.ymid || "");
  const eventType = String(req.query.event_type || "");
  const rewardEventType = String(req.query.reward_event_type || "");

  if (!/^[0-9a-f-]{36}$/i.test(ymid)) {
    return res.status(400).send("Invalid session ID");
  }

  if (eventType !== "impression" || rewardEventType !== "valued") {
    return res.status(200).send("Event not eligible for reward");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const sessionResult = await client.query(
      `SELECT id, telegram_id, status
       FROM ad_sessions
       WHERE ymid = $1
       FOR UPDATE`,
      [ymid]
    );

    if (sessionResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).send("Session not found");
    }

    const session = sessionResult.rows[0];

    // Idempotency: the same session cannot be paid twice.
    if (session.status !== "pending") {
      await client.query("COMMIT");
      return res.status(200).send("Already processed");
    }

    await client.query(
      `UPDATE users
       SET balance = balance + $1,
           total_earned = total_earned + $1
       WHERE telegram_id = $2`,
      [AD_REWARD_USD, session.telegram_id]
    );

    await client.query(
      `UPDATE ad_sessions
       SET status = 'rewarded',
           rewarded_at = NOW()
       WHERE id = $1`,
      [session.id]
    );

    await client.query("COMMIT");
    return res.status(200).send("Reward credited");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Postback processing failed:", error.message);
    return res.status(500).send("Internal error");
  } finally {
    client.release();
  }
});

/* ---------------- DASHBOARD DATA ---------------- */

app.get("/api/dashboard", async (req, res) => {
  const user = verifyTelegramInitData(String(req.query.initData || ""));

  if (!user) {
    return res.status(401).json({ error: "Invalid Telegram authentication." });
  }

  try {
    const result = await pool.query(
      `SELECT
         u.balance,
         u.total_earned,
         (SELECT COUNT(*)::int
          FROM users referred
          WHERE referred.referred_by = u.telegram_id) AS referrals,
         (SELECT COUNT(*)::int
          FROM ad_sessions a
          WHERE a.telegram_id = u.telegram_id
            AND a.created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
                                   AT TIME ZONE 'UTC') AS ads_today
       FROM users u
       WHERE u.telegram_id = $1`,
      [String(user.id)]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "User not found. Send /start first." });
    }

    const row = result.rows[0];

    return res.json({
      balance: Number(row.balance),
      totalEarned: Number(row.total_earned),
      referrals: Number(row.referrals),
      adsToday: Number(row.ads_today)
    });
  } catch (error) {
    console.error("Dashboard API failed:", error.message);
    return res.status(500).json({ error: "Unable to load dashboard." });
  }
});

/* ---------------- STATIC FRONT END ---------------- */

// Save index.html inside the project's public/ directory.
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

/* ---------------- START SERVER ---------------- */

async function start() {
  await initializeDatabase();

  // Start the Telegram bot and web server.
  await bot.start({
    onStart: (botInfo) => {
      console.log(`Telegram bot started: @${botInfo.username}`);
    }
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Web server listening on port ${PORT}`);
  });
}

start().catch((error) => {
  console.error("Application startup failed:", error);
  process.exit(1);
});

async function shutdown() {
  console.log("Shutting down...");
  await bot.stop();
  await pool.end();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
