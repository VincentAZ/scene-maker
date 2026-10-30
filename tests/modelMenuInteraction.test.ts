// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantModelMenu } from "../src/AssistantModelMenu";
import {
  CharacterModelPicker,
  type CharacterMind,
} from "../src/CharacterModelPicker";
import type { ConnectionsData } from "../src/Connections";
import { forgetCatalog, forgetConnections } from "../src/connectionsStore";
import { providers } from "../shared/scene";

let container: HTMLDivElement;
let root: Root;
let data: ConnectionsData;
let saveError: string;
let frames: FrameRequestCallback[];
const writes = vi.fn();
const assigned = vi.fn();
const busy = vi.fn();
const manage = vi.fn();
const catalogs = {
  openai: ["gpt-5", "gpt-5-mini"],
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-6"],
};

beforeEach(() => {
  vi.clearAllMocks();
  forgetConnections();
  providers.forEach(forgetCatalog);
  data = {
    assistant: "openai",
    blender: "blender",
    providers: {
      openai: { connected: true, model: "gpt-5" },
      anthropic: { connected: true, model: "claude-sonnet-4-5" },
    },
  };
  saveError = "";
  frames = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit = {}) => {
      const body = options.body ? JSON.parse(String(options.body)) : {};
      if (url === "/api/connections/models") {
        const ids = catalogs[body.provider as keyof typeof catalogs] || [];
        return Response.json({ models: ids.map((id) => ({ id, name: id })) });
      }
      if (url !== "/api/connections") throw Error(`Unexpected request: ${url}`);
      if (options.method === "PUT") {
        writes(body);
        if (saveError)
          return Response.json({ error: saveError }, { status: 400 });
        if ("assistant" in body) data.assistant = body.assistant;
        if (body.provider)
          data.providers[body.provider] = {
            ...data.providers[body.provider],
            ...body,
          };
      }
      return Response.json(data);
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}
async function interact(action: () => void) {
  await act(async () => action());
  await act(async () => {
    frames.splice(0).forEach((frame) => frame(0));
  });
}
function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = container.querySelector<T>(selector);
  if (!found) throw Error(`Missing element: ${selector}`);
  return found;
}
function button(text: string, selector = "button") {
  const found = [
    ...container.querySelectorAll<HTMLButtonElement>(selector),
  ].find((item) => item.textContent?.includes(text));
  if (!found) throw Error(`Missing button: ${text}`);
  return found;
}
const click = (target: HTMLElement) => interact(() => target.click());
const trigger = () => element<HTMLButtonElement>("button[aria-expanded]");
const popover = () => container.querySelector(".assistant-model-popover");
async function search(value: string) {
  const input = element<HTMLInputElement>('input[type="search"]');
  await interact(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function changeThinking(selector: string) {
  await interact(() => {
    const select = element<HTMLSelectElement>(selector);
    select.value = "high";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function renderAssistant() {
  await render(
    h(AssistantModelMenu, {
      disabled: false,
      revision: 0,
      onBusyChange: busy,
      onConnections: manage,
    }),
  );
}
function CharacterHarness({ disabled = false }: { disabled?: boolean }) {
  const [entity, setEntity] = useState<CharacterMind>({
    id: "mila",
    name: "Mila",
    provider: "openai",
    model: "gpt-5",
  });
  return h(CharacterModelPicker, {
    entity,
    revision: 0,
    disabled,
    onConnections: manage,
    onChange: (changes) => {
      assigned(changes);
      setEntity((previous) => ({ ...previous, ...changes }));
    },
  });
}

describe("assistant provider and model menu", () => {
  it("keeps provider selection open, clears the old search, then closes after a model saves", async () => {
    await renderAssistant();
    await click(trigger());
    await search("gpt");
    await click(button("Anthropic", ".quick-provider-list button"));
    expect(writes).toHaveBeenLastCalledWith({ assistant: "anthropic" });
    expect(popover()).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(element<HTMLInputElement>('input[type="search"]').value).toBe("");
    expect(element('[aria-label="Anthropic models"]').textContent).toContain(
      "claude-opus-4-6",
    );
    await click(button("claude-opus-4-6", ".quick-model-list button"));
    expect(writes).toHaveBeenLastCalledWith({
      assistant: "anthropic",
      provider: "anthropic",
      model: "claude-opus-4-6",
    });
    expect(popover()).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger());
    expect(busy.mock.calls.map(([value]) => value)).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it("keeps the menu open and shows the error if saving a model fails", async () => {
    await renderAssistant();
    await click(trigger());
    saveError = "The provider is unavailable.";
    await click(button("gpt-5-mini", ".quick-model-list button"));
    expect(popover()).not.toBeNull();
    expect(element('[role="alert"]').textContent).toBe(saveError);
    expect(document.activeElement).toBe(element('input[type="search"]'));
    expect(busy).toHaveBeenLastCalledWith(false);
  });

  it("keeps thinking settings open, but closes a completed offline-helper choice", async () => {
    await renderAssistant();
    await click(trigger());
    await changeThinking('select[aria-label="Thinking effort"]');
    expect(writes).toHaveBeenLastCalledWith({
      provider: "openai",
      thinking: "high",
    });
    expect(popover()).not.toBeNull();
    await click(button("Offline helper"));
    expect(writes).toHaveBeenLastCalledWith({ assistant: null });
    expect(popover()).toBeNull();
  });
});

describe("character provider and model menu", () => {
  it("keeps a provider choice open, then closes after selecting the character's model", async () => {
    await render(h(CharacterHarness));
    await click(trigger());
    await search("gpt");
    await click(button("Anthropic", ".quick-provider-list button"));
    expect(assigned).toHaveBeenLastCalledWith({
      provider: "anthropic",
      model: "",
      thinking: undefined,
    });
    expect(popover()).not.toBeNull();
    expect(element<HTMLInputElement>('input[type="search"]').value).toBe("");
    await click(button("claude-opus-4-6", ".quick-model-list button"));
    expect(assigned).toHaveBeenLastCalledWith({
      provider: "anthropic",
      model: "claude-opus-4-6",
    });
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    await click(trigger());
    expect(
      button("claude-opus-4-6", ".quick-model-list button").getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
  });

  it.each([
    "provider default",
    "exact ID button",
    "exact ID Enter",
    "studio assistant",
  ])("closes after choosing %s", async (choice) => {
    await render(h(CharacterHarness));
    await click(trigger());
    if (choice.startsWith("exact ID")) {
      await search("custom/model-v1");
      if (choice.endsWith("Enter"))
        await interact(() =>
          element('input[type="search"]').dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
          ),
        );
      else await click(button("Use this exact identifier"));
      expect(assigned).toHaveBeenLastCalledWith({
        provider: "openai",
        model: "custom/model-v1",
      });
    } else if (choice === "provider default") {
      await click(button("Provider default"));
      expect(assigned).toHaveBeenLastCalledWith({
        provider: "openai",
        model: "",
      });
    } else {
      await click(button("Studio assistant", ".quick-provider-list button"));
      expect(assigned).toHaveBeenLastCalledWith({
        provider: null,
        model: "",
        thinking: undefined,
      });
    }
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("keeps thinking settings open and does not assign or dismiss while disabled", async () => {
    await render(h(CharacterHarness));
    await click(trigger());
    await changeThinking('select[aria-label="Mila’s thinking effort"]');
    expect(assigned).toHaveBeenLastCalledWith({ thinking: "high" });
    expect(popover()).not.toBeNull();
    await render(h(CharacterHarness, { disabled: true }));
    assigned.mockClear();
    await click(button("gpt-5-mini", ".quick-model-list button"));
    await search("custom/model-v1");
    await interact(() =>
      element('input[type="search"]').dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(assigned).not.toHaveBeenCalled();
    expect(popover()).not.toBeNull();
  });
});

it.each(["assistant", "character"])(
  "dismisses the %s picker with Escape or an outside click",
  async (picker) => {
    if (picker === "assistant") await renderAssistant();
    else await render(h(CharacterHarness));
    await click(trigger());
    await interact(() =>
      element('input[type="search"]').dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    await click(trigger());
    await interact(() =>
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(popover()).toBeNull();
  },
);
