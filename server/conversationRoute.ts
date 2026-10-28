import type { RequestHandler } from "express";
import { once } from "node:events";
import { z } from "zod";
import { validateScene } from "../shared/scene";
import { conversation, ConversationInterrupted, type Config } from "./ai";
import type { ConversationEvent } from "../shared/conversation";

export function conversationRoute(
  getConfig: () => Config,
  run = conversation,
): RequestHandler {
  return async (req, res, next) => {
    const controller = new AbortController();
    const stop = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", stop);
    const streaming = req.headers.accept?.includes("application/x-ndjson");
    const emit = async (event: ConversationEvent) => {
      if (res.destroyed) return;
      if (!res.headersSent) {
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
      }
      if (!res.write(JSON.stringify(event) + "\n"))
        await once(res, "drain", { signal: controller.signal });
    };
    try {
      const scene = validateScene(req.body.scene);
      const rounds = z
        .number()
        .int()
        .min(1)
        .max(5)
        .parse(req.body.rounds ?? 1);
      const result = await run(getConfig(), scene, rounds, undefined, {
        signal: controller.signal,
        onEvent: streaming ? emit : undefined,
      });
      if (!res.destroyed) {
        if (streaming) res.end();
        else res.json(result);
      }
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) {
        const stopped = error instanceof ConversationInterrupted;
        await emit({
          type: "error",
          message: stopped
            ? error.message
            : "The conversation could not continue. Completed turns are kept.",
          completed: stopped ? error.completed : 0,
          cancelled: stopped && error.cancelled,
        });
        res.end();
      } else if (error instanceof ConversationInterrupted) {
        res.status(400).json({
          error: error.message,
          partial: error.scene,
          completed: error.completed,
        });
      } else next(error);
    } finally {
      res.off("close", stop);
    }
  };
}
