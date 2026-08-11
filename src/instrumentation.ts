// Next.js calls register() once when a server instance starts (both the Node.js
// and Edge runtimes). We validate the environment here so a misconfigured
// deploy fails at boot with a single clear message rather than midway through a
// request. Only the Node.js runtime carries the full secret set and the Buffer
// API the validator uses; the Edge runtime (proxy.ts) is skipped.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateEnv } = await import("@/lib/env");
  validateEnv();
}
