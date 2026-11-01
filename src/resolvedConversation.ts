import { type Scene } from "../shared/scene";
import { withAutomaticMovement } from "../shared/aiMovement";
import type { ConversationEvent } from "../shared/conversation";
import {
  mergeConversationTurn,
  readConversationStream,
} from "./conversationStream";

type Thinking = Extract<ConversationEvent, { type: "thinking" }>;
export type ResolvedConversationPorts = {
  getScene: () => Scene;
  request: (scene: Scene, signal: AbortSignal) => Promise<Response>;
  accept: (scene: Scene, completed: number) => void;
  prepare: (scene: Scene, signal: AbortSignal) => Promise<void>;
  save: () => Promise<void>;
  thinking: (event: Thinking, completed: number) => void;
  ready: (scene: Scene, completed: number) => void;
};

/** The next speaker must see the resolved scene, not a server-side draft with
 * the previous route's distance and timing. Each request generates one turn;
 * navigation and persistence finish before another model call is made. */
export async function runResolvedConversation(
  turns: number,
  ports: ResolvedConversationPorts,
  signal: AbortSignal,
) {
  if (!Number.isInteger(turns) || turns < 1 || turns > 500)
    throw Error("Choose a valid number of conversation turns.");
  if (ports.getScene().transcript.length + turns > 300)
    throw Error(
      "This conversation would exceed the scene’s dialogue limit. Choose fewer rounds or start a new scene.",
    );
  signal.throwIfAborted();
  await ports.prepare(ports.getScene(), signal);
  await ports.save();
  let completed = 0;
  while (completed < turns) {
    signal.throwIfAborted();
    const expected = structuredClone(ports.getScene());
    const response = await ports.request(expected, signal);
    await readConversationStream(response, async (event) => {
      signal.throwIfAborted();
      if ("total" in event && event.total !== 1)
        throw Error(
          "The conversation returned more than the requested turn. Completed turns are kept.",
        );
      if (event.type === "thinking") ports.thinking(event, completed);
      if (event.type !== "turn") return;
      const next = withAutomaticMovement(
        expected,
        mergeConversationTurn(ports.getScene(), expected, event.scene),
      );
      completed++;
      ports.accept(next, completed);
      await ports.prepare(next, signal);
      signal.throwIfAborted();
      await ports.save();
      signal.throwIfAborted();
      ports.ready(ports.getScene(), completed);
    });
  }
  return completed;
}
