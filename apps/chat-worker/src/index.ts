// --- Import Statements ---
// We import the 'Hono' class, which is the core of our "mini-server".
// Hono is a fast and lightweight web framework designed for edge runtimes
// like Cloudflare Workers. 
import { Hono } from 'hono';

// We import the 'cors' middleware from Hono's middleware library.
// This is not part of the Hono core but is an official, optional package. 
import { cors } from 'hono/cors';
import OpenAI from 'openai';

// --- Type Definitions ---
// This is a best practice in TypeScript for defining our environment.
// We are creating a TypeScript 'type' that describes the shape of the
// 'env' object (the 'Bindings') that Cloudflare will provide to our Worker.
export type Env = {
  AI: Ai;
  AI_GATEWAY_ID: string;
  AI_GATEWAY_TOKEN: string;
};

// This defines the expected shape of the JSON data our frontend
// will send in the body of its POST request. This prevents us
// from accidentally trying to access a property that doesn't exist.
type ChatRequest = {
  prompt: string;
};

// --- Hono Server Initialization ---
// We create a new instance of the Hono server.
// The `<{ Bindings: Env }>` is a TypeScript "Generic". We are "passing in"
// our 'Env' type to Hono. This tells Hono, "My context object (which
// we access as 'c') will have a property 'env' that looks like the 'Env'
// type." This is what enables type-safe access like `c.env.AI_GATEWAY`. 
const app = new Hono<{ Bindings: Env }>();

// --- Middleware Registration ---
// '.use()' is how we apply middleware to our Hono application.
// Middleware is code that runs *before* our final route handler.
app.use(
  // The first argument, '/api/*', is a "path pattern". This tells Hono
  // to *only* apply this CORS middleware to requests whose paths
  // start with '/api/'. This is a best practice. [cite: 2]
  '/api/*',
  // We call the 'cors' function we imported. This function *returns*
  // the middleware handler.
  cors({
    // 'origin': This is the most important CORS setting. It specifies
    // which frontend domains are allowed to make requests to this API.
    // For development, '*' allows anyone (e.g., 'localhost:3000').
    // For production, this MUST be changed to your frontend's specific
    // URL (e.g., 'https://your-frontend-domain.com') for security. [cite: 2]
    origin: '*',
    // 'allowMethods': This explicitly tells the browser which HTTP
    // methods are allowed for cross-origin requests. Since our chat
    // endpoint is a POST request, we must include 'POST'. [cite: 2]
    allowMethods: ['POST', 'GET', 'OPTIONS'],
  })
);

// --- API Route Definition ---
// '.post()' tells Hono to create a route that *only* responds to
// HTTP POST requests. [cite: 1]
// The first argument, '/api/chat', is the specific path for this endpoint.
// The second argument is an 'async' function (the "handler") that
// contains our main logic. Hono will call this function when a
// POST request hits '/api/chat'.
app.post('/api/chat', async (c) => {
  // 'c' is the "Context" object. It's Hono's most important object
  // and holds the request ('c.req'), the environment ('c.env'),
  // and methods for creating a response ('c.json()', 'c.text()'). [cite: 1]

  // We are "awaiting" the resolution of the 'c.req.json()' method.
  // This parses the incoming request's body as JSON.
  // We use '<ChatRequest>' to tell TypeScript to treat the parsed
  // JSON as our 'ChatRequest' type for better type safety.
  // We then "destructure" the 'prompt' property directly from the object.
  const { prompt } = await c.req.json<ChatRequest>();

  // --- Best Practice: Input Validation ---
  // This is a critical server-side check. If the 'prompt' property
  // is missing, empty, or 'null', we immediately stop execution.
  if (!prompt) {
    // We return a JSON response with a 400 "Bad Request" status code.
    // This tells the frontend that the request was malformed and
    // is a standard best practice for robust APIs.
    return c.json({ error: 'No prompt provided' }, 400);
  }

  // --- AI Gateway Compat (Unified API) via OpenAI SDK ---
  try {
    const baseUrl = `${await c.env.AI.gateway(c.env.AI_GATEWAY_ID).getUrl()}/compat`;
    const client = new OpenAI({
      apiKey: 'unused',
      baseURL: baseUrl,
      defaultHeaders: {
        'cf-aig-authorization': `Bearer ${c.env.AI_GATEWAY_TOKEN}`,
      },
    });

    const completion = await client.chat.completions.create({
      model: 'google-ai-studio/gemini-2.5',
      messages: [{ role: 'user', content: prompt }],
    });
    return c.json(completion);
  } catch (err: any) {
    // Attempt to forward provider error details if available
    try {
      const status = err?.status ?? err?.response?.status ?? 502;
      const isResponse = typeof err?.response?.text === 'function';
      if (isResponse) {
        const text = await err.response.text();
        return new Response(text, {
          status,
          headers: { 'content-type': 'application/json' },
        });
      }
    } catch {}
    console.error('Compat error', err);
    return c.json({ error: err?.message ?? 'Upstream error' }, 502);
  }
});

// --- Default Export ---
// This is the final line that "exports" our Hono app.
// The Cloudflare Workers runtime looks for this default export
// to know what code to run when a request comes in. [cite: 1]
export default app;