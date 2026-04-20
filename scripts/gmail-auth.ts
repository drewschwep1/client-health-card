#!/usr/bin/env tsx
// One-time OAuth consent flow for Gmail read-only. Spins up a local server
// on http://localhost:7325, opens the browser, captures the auth code, and
// writes the resulting refresh token to .env.local.

import http from 'node:http';
import { URL } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { google } from 'googleapis';

const REDIRECT = 'http://localhost:7325';
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

async function main(): Promise<void> {
  const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error(
      'Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in .env.local'
    );
    process.exit(1);
  }

  const oauth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT);
  const authUrl = oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // forces a refresh_token even if already granted
    scope: SCOPES,
  });

  console.log('\nOpening browser for Gmail read-only consent…');
  console.log('If it does not open, paste this URL into your browser:');
  console.log('\n' + authUrl + '\n');
  exec(`open "${authUrl}"`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url ?? '/', REDIRECT);
        const c = u.searchParams.get('code');
        const err = u.searchParams.get('error');
        if (err) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end(`Auth failed: ${err}`);
          server.close();
          reject(new Error(err));
          return;
        }
        if (c) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Success — you can close this tab and return to the terminal.');
          server.close();
          resolve(c);
        }
      } catch (e) {
        server.close();
        reject(e);
      }
    });
    server.listen(7325, () => console.log('Listening on http://localhost:7325 for the redirect…'));
  });

  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'No refresh_token returned. This usually means the app was previously authorized and Google skipped re-consent. Revoke access at https://myaccount.google.com/permissions and re-run.'
    );
  }

  const envPath = path.join(process.cwd(), '.env.local');
  let envContent = '';
  try {
    envContent = await fs.readFile(envPath, 'utf-8');
  } catch {
    // file will be created
  }
  const lines = envContent
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('GOOGLE_OAUTH_REFRESH_TOKEN='));
  lines.push(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
  await fs.writeFile(envPath, lines.join('\n') + '\n');
  console.log('\n✓ Refresh token written to .env.local');
  console.log('  You can now run `npm run gmail:sync`.\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
