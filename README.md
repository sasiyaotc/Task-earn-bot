# TASK AND EARN — Telegram Bot + Mini App starter

All bot-facing copy and Mini App UI are in English. The Mini App uses a clean light layout with white cards and a warm orange accent, with no mining section.

## Included
- Telegram bot with English menu: Referral, Tasks, Watch & Earn, Profile.
- Admin-only `Add Your Task` and `Free Task Add` menu buttons.
- Task prices: $4 up to 2,000 members; $6 for requests over 2,000 (treated as unlimited).
- USDT BEP20 payment address configured in `.env`.
- Task review message to the admin, manual payment verification, `/approve_task ID`, `/reject_task ID`, `/tasks_pending`.
- Withdrawal requests: minimum $1, at least 5 verified referrals, wallet saved with `/wallet`, admin Accept/Reject buttons, rejected amount returned to user.
- Required-channel gate for two channels.
- Channel membership verification for join tasks, one claim per Telegram user per task.
- Responsive HTML landing/Mini App shell with bottom nav and no mining.

## Important limitations before real-money launch
1. **This is a starter, not a fully audited money platform.** Test with a private bot and test users first.
2. **Ad provider integration is not included.** The bot deliberately does not credit $0.05 for a click. To pay only after a full ad view, integrate an ad provider that supports a server-side signed completion callback and validate its signature, event ID, user ID, and daily cap (30). Do not use a client-side timer as proof.
3. **Group/channel join rewards** are credited only when Telegram membership can be checked. Add the bot as admin to each task channel where required. This starter uses a $0.01 default task reward; set the advertiser/user split in the business rules before production if you want a true 70/30 split.
4. **Payment verification is manual.** A submitted transaction hash is not proof of payment. Verify BNB Smart Chain network, USDT token contract, exact amount, recipient address, and confirmations using a trusted block explorer before approving.
5. **Referral anti-fraud is not perfect.** Telegram IDs and required-channel membership are checked; this cannot guarantee that every fake account is detected. Add rate limits, account-age/behavior checks, duplicate payout review, and a dispute process before paying real funds.
6. **Taxes/Tax ID:** the field is collected as task metadata; confirm applicable tax/privacy obligations before storing personal or business tax details.
7. Keep your bot token and database credentials private. Never put secrets in frontend HTML or commit `.env`.

## Local setup
1. Install Node.js 20+.
2. Create a Telegram bot using `@BotFather`; copy its token.
3. Get your numeric Telegram user ID from a trusted ID bot.
4. Create a PostgreSQL database (Render PostgreSQL is fine).
5. Copy `.env.example` to `.env` and fill in every value. Set `CHANNEL_1` and `CHANNEL_2` to channel usernames like `@mychannel`; add the bot as an administrator in both channels so it can verify members.
6. Install and run:
   ```bash
   npm install
   npm start
   ```
7. Open the local web app at `http://localhost:10000`. For a local bot, leave `WEBHOOK_URL` blank to use polling.

## Deploy on Render
1. Push this folder to a private GitHub repository.
2. In Render, create a **Web Service** from the repo.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. Create a Render PostgreSQL database. Copy its **Internal Database URL** into `DATABASE_URL` if the web service and DB are in the same Render region; otherwise use the appropriate external URL.
5. Add environment variables from `.env.example` in Render's Environment tab. `WEBHOOK_URL` and `MINI_APP_URL` should be the deployed HTTPS URL, e.g. `https://your-service.onrender.com`.
6. Deploy. Check `https://your-service.onrender.com/health` returns `{"ok":true}`.
7. In `@BotFather`, use `/setdomain` and set the domain to your Render hostname. Configure the Mini App menu button if desired.
8. Set the two channel usernames and add the bot as admin in both channels. Restart/redeploy after changing environment variables.
9. Open the bot and send `/start`.

## Admin commands
- `/tasks_pending` — list pending task submissions.
- `/approve_task TASK_ID` — approve after independently verifying payment.
- `/reject_task TASK_ID` — reject a pending task.
- `/tx TASK_ID TRANSACTION_HASH` — users submit a transaction hash for admin review.
- `/wallet 0x...` — save BEP20 wallet.
- `/withdraw 1` — request a withdrawal.

## Pricing and reward settings
Edit environment variables to adjust values. The group-join reward default is `$0.01` per verified join. The requested 70%/30% split is not automatically charged/settled to separate parties in this starter; implement and test the exact accounting policy before launch. The requested $0.05 per ad is a configured target, not paid until a real ad provider's signed callback integration is implemented.


## Monetag rewarded ads (server-confirmed starter)

This starter includes a Monetag postback endpoint and Telegram `initData` verification:
- `POST /api/ad-session` verifies Telegram Web App init data, reserves one daily ad attempt (maximum 30), and creates a unique `ymid`.
- `GET /postback` checks `MONETAG_POSTBACK_SECRET`, accepts only `event_type=impression` and `reward_event_type=valued`, then credits `$0.05` once per unique session inside a database transaction.
- The browser never credits balance directly. Duplicate or unknown postbacks do not pay.

### Required setup before ads can work
1. Create/approve a publisher account and Telegram Mini App in Monetag.
2. Set `MONETAG_ZONE_ID` to your real SDK zone ID.
3. Set `MONETAG_POSTBACK_SECRET` to a long random secret in Render Environment.
4. In Monetag SSP, configure the main zone Postback URL as:
   `https://YOUR-RENDER-SERVICE.onrender.com/postback?secret=YOUR_SECRET&ymid={ymid}&event_type={event_type}&reward_event_type={reward_event_type}&zone_id={zone_id}&estimated_price={estimated_price}`
   Use the exact macros currently shown in Monetag's dashboard/docs.
5. Replace the sample SDK URL `https://domain.com/sdk.js` in `src/index.js` with the actual SDK URL provided for your Monetag zone/dashboard, if Monetag gives a custom URL. Their docs' script-tag format is `https://domain.com/sdk.js` with `data-zone` and `data-sdk` placeholders; do not deploy that placeholder as-is.
6. Set `MINI_APP_URL` to the deployed HTTPS app URL and test in Telegram with small/controlled traffic before public launch.

### Important reward semantics
Monetag's documented postbacks for Rewarded Interstitial include `impression`/`click`; an `impression` means the ad started rendering, not necessarily that the user watched the entire video. This code credits only a Monetag-confirmed **valued impression**. Do not describe it as proof of full video completion. If your publisher dashboard offers a completion-specific verified event, adapt the event filter to that exact documented event before promising rewards for complete watches. CPM revenue is variable and is not guaranteed to cover a fixed $0.05 user reward. Confirm your network terms and expected economics before launch.

The starter has not been security-audited or end-to-end tested. Review all payment, balance, privacy, fraud, and withdrawal logic before using real money.
