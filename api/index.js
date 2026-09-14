// Vercel serverless entry point. The app is a plain Node HTTP handler, so the
// same code runs locally (`npm start`) and on Vercel as a Node.js function.
import handleRequest from '../server.js';

export const config = {
  // The `/api/resolve` route reads the raw JSON body itself.
  api: { bodyParser: false },
  // Resolving a post fans out to up to four Instagram endpoints (each capped at
  // 18s upstream), so give the function enough headroom.
  maxDuration: 60
};

export default async function handler(request, response) {
  await handleRequest(request, response);
}
