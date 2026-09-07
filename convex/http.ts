import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import * as invoiceFiles from './invoiceFileHttp';

const http = httpRouter();
http.route({ path: '/invoice-files', method: 'POST', handler: invoiceFiles.upload });
http.route({ path: '/invoice-files', method: 'GET', handler: invoiceFiles.download });
http.route({ path: '/invoice-files', method: 'DELETE', handler: invoiceFiles.discard });
http.route({ path: '/invoice-files', method: 'OPTIONS', handler: invoiceFiles.options });
http.route({
  path: "/webhooks/email",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (Number(request.headers.get("content-length") ?? 0) > 64 * 1024)
      return new Response("Payload too large", { status: 413 });
    const payload = await request.text();
    if (new TextEncoder().encode(payload).length > 64 * 1024)
      return new Response("Payload too large", { status: 413 });
    const status = await ctx.runAction(internal.emailDelivery.webhook, {
      payload,
      id: request.headers.get("svix-id") ?? "",
      timestamp: request.headers.get("svix-timestamp") ?? "",
      signature: request.headers.get("svix-signature") ?? "",
    });
    return new Response(
      status === 200
        ? "Received"
        : status === 400
          ? "Invalid signature or event"
          : "Try again later",
      { status },
    );
  }),
});
export default http;
