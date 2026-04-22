/**
 * One-time YouTube OAuth 2.0 authorization helper.
 *
 * Run this locally to obtain a refresh token:
 *   node scripts/auth-youtube.mjs
 *
 * Prerequisites:
 *   1. Create a Google Cloud project with YouTube Data API v3 enabled
 *   2. Create OAuth 2.0 credentials (Desktop application type)
 *   3. Set environment variables:
 *      export YOUTUBE_CLIENT_ID=your-client-id
 *      export YOUTUBE_CLIENT_SECRET=your-client-secret
 *
 * This script will:
 *   1. Open a browser for Google sign-in
 *   2. Ask you to paste the authorization code
 *   3. Exchange it for tokens and print the refresh token
 *   4. Save the refresh token to output/youtube-refresh-token.txt
 *
 * Then add YOUTUBE_REFRESH_TOKEN to your GitHub Secrets.
 */

import { google } from "googleapis";
import { writeFileSync, mkdirSync } from "fs";
import { createServer } from "http";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "..", "output");

const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/oauth2callback`;

function waitForCode() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404); res.end("Not found");
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (error) {
        res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
        server.close();
        reject(new Error(error));
        return;
      }
      res.end(`<h1>Success</h1><p>You can close this tab. Return to your terminal.</p>`);
      server.close();
      resolve(code);
    });
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1");
  });
}

async function main() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Error: Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET environment variables first.");
    console.error("");
    console.error("  export YOUTUBE_CLIENT_ID=your-client-id");
    console.error("  export YOUTUBE_CLIENT_SECRET=your-client-secret");
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
    prompt: "consent",
  });

  console.log("=== YouTube OAuth 2.0 Authorization (loopback flow) ===\n");
  console.log(`Listening for callback on ${REDIRECT_URI}\n`);
  console.log("Open this URL in your browser:\n");
  console.log(`   ${authUrl}\n`);
  console.log("Sign in and click Allow. The browser will redirect back automatically.");

  const code = await waitForCode();

  console.log("\nExchanging code for tokens...");
  const { tokens } = await oauth2.getToken(code);

  if (!tokens.refresh_token) {
    console.error("Error: No refresh token received.");
    console.error("Make sure you haven't already authorized this app.");
    console.error("Try revoking access at https://myaccount.google.com/permissions");
    process.exit(1);
  }

  console.log("\n=== Success! ===\n");
  console.log(`Refresh Token: ${tokens.refresh_token}\n`);

  // Save to file
  mkdirSync(outputDir, { recursive: true });
  const tokenPath = join(outputDir, "youtube-refresh-token.txt");
  writeFileSync(tokenPath, tokens.refresh_token);
  console.log(`Saved to: ${tokenPath}`);
  console.log("(This file is gitignored - do not commit it)\n");

  console.log("Next steps:");
  console.log("  1. Add this refresh token as a GitHub Secret:");
  console.log("     gh secret set YOUTUBE_REFRESH_TOKEN");
  console.log("  2. Also add your client credentials:");
  console.log("     gh secret set YOUTUBE_CLIENT_ID");
  console.log("     gh secret set YOUTUBE_CLIENT_SECRET");
}

main().catch((err) => {
  console.error("Authorization failed:", err.message);
  process.exit(1);
});
