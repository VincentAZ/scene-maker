import {
  conversationEventSchema,
  type ConversationEvent,
} from "../shared/conversation";
import { type Scene, validateScene } from "../shared/scene";

export function mergeConversationTurn(
  current: Scene,
  expected: Scene,
  incoming: Scene,
) {
  const content = (scene: Scene) => JSON.stringify({ ...scene, revision: 0 });
  if (current.id !== incoming.id || content(current) !== content(expected))
    throw Error(
      "The scene changed during the conversation. Completed turns and your edits are kept. Continue from the updated scene.",
    );
  return validateScene({ ...incoming, revision: current.revision });
}

export async function readConversationStream(
  response: Response,
  onEvent: (event: ConversationEvent) => void | Promise<void>,
) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Error(body.error || "The cast could not start the conversation.");
  }
  if (
    !response.headers.get("content-type")?.includes("application/x-ndjson") ||
    !response.body
  )
    throw Error(
      "The studio returned an unreadable conversation. Completed turns are kept.",
    );
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let pending = "",
    terminal = false,
    completed = 0,
    total: number | undefined;
  const consume = async (line: string) => {
    if (!line.trim()) return;
    if (terminal) throw Error("The conversation continued after it had ended.");
    const event = conversationEventSchema.parse(JSON.parse(line));
    if ("total" in event) {
      if (total !== undefined && event.total !== total)
        throw Error("The conversation turn count changed unexpectedly.");
      total = event.total;
    }
    if (event.type === "turn") {
      if (event.completed !== completed + 1 || event.completed > event.total)
        throw Error(
          "A conversation turn is missing. Completed turns are kept.",
        );
      completed = event.completed;
    }
    if (
      event.type === "complete" &&
      (event.completed !== completed || completed !== total)
    )
      throw Error(
        "The conversation ended before every turn arrived. Completed turns are kept.",
      );
    if (event.type === "error" && event.completed !== completed)
      throw Error(
        "The conversation connection lost a turn. Earlier completed turns are kept.",
      );
    await onEvent(event);
    if (event.type === "complete" || event.type === "error") terminal = true;
    if (event.type === "error") throw Error(event.message);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      pending += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      if (pending.length > 16 * 1024 * 1024)
        throw Error("The conversation response is too large.");
      let end: number;
      while ((end = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        await consume(line);
      }
      if (done) break;
    }
    if (pending.trim()) await consume(pending);
    if (!terminal)
      throw Error(
        "The conversation connection ended early. Completed turns are kept. Try continuing the conversation.",
      );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
