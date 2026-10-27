import { describe, expect, it } from "vitest";
import { readLimitedBody } from "@/lib/payments/read-limited-body";

describe("readLimitedBody", () => {
  it("decodes a request body within the byte limit", async () => {
    const body = new TextEncoder().encode("webhook payload");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    });

    await expect(readLimitedBody(stream, body.byteLength)).resolves.toBe("webhook payload");
  });

  it("cancels an oversized stream and rejects it without reading further chunks", async () => {
    let cancelled = false;
    let pullCount = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue(new Uint8Array(8));
        } else {
          controller.enqueue(new Uint8Array(1));
        }
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(readLimitedBody(stream, 4)).resolves.toBeNull();
    expect(cancelled).toBe(true);
    expect(pullCount).toBe(1);
  });
});
