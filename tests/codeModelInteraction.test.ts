// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CodeModelPicker } from "../src/CodeModelPicker";
import { CodingAssistant } from "../src/CodingAssistant";
import type { ConnectionsData } from "../src/Connections";
import { forgetCatalog, forgetConnections } from "../src/connectionsStore";
import type {
  CodingInfo,
  CodingModelSelection,
  CodingStatus,
  CodingTask,
  CodingTaskSummary,
} from "../shared/coding";
import { providers } from "../shared/scene";

let container: HTMLDivElement;
let root: Root;
let connections: ConnectionsData;
let tasks: Map<string, CodingTask>;
let saveError: string;
let modelError: string;
let frames: FrameRequestCallback[];
const connectionWrites = vi.fn();
const taskWrites = vi.fn();
const change = vi.fn<(selection: CodingModelSelection) => Promise<void>>();
const busy = vi.fn();
const manage = vi.fn();
const catalogs = {
  openai: ["gpt-5", "gpt-5-mini"],
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-6"],
};

function makeTask(overrides: Partial<CodingTask> = {}): CodingTask {
  return {
    id: "task-1",
    prompt: "Explain the coding service",
    branch: "code/task-1",
    base: "base-sha",
    baseline: "baseline-sha",
    baseBranch: "main",
    status: "idle",
    created: Date.now(),
    provider: "openai",
    model: "gpt-5",
    summary: "",
    events: [],
    transcript: [],
    baselineFiles: [],
    files: [],
    diff: "",
    publishDiff: "",
    review: "",
    checks: [],
    ...overrides,
  };
}
function summarize(task: CodingTask): CodingTaskSummary {
  return {
    id: task.id,
    prompt: task.prompt,
    branch: task.branch,
    status: task.status,
    created: task.created,
    provider: task.provider,
    model: task.model,
    fileCount: task.files.length,
    searchText: task.prompt,
    lastMessage: task.summary,
  };
}
function codingInfo(): CodingInfo {
  return {
    repository: "/studio",
    remote: "https://github.com/example/studio.git",
    available: true,
    provider: "openai",
    model: "gpt-5",
    mcpServers: [],
    maxSteps: 0,
    timeoutMinutes: 0,
    tasks: [...tasks.values()].map(summarize),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  forgetConnections();
  providers.forEach(forgetCatalog);
  localStorage.clear();
  connections = {
    assistant: "openai",
    blender: "blender",
    providers: {
      openai: { connected: true, model: "gpt-5" },
      anthropic: { connected: true, model: "claude-sonnet-4-5" },
    },
  };
  tasks = new Map();
  saveError = "";
  modelError = "";
  frames = [];
  change.mockImplementation(async () => {
    if (saveError) throw Error(saveError);
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit = {}) => {
      const method = options.method || "GET";
      const body = options.body ? JSON.parse(String(options.body)) : {};
      if (url === "/api/connections/models" && method === "POST") {
        const ids = catalogs[body.provider as keyof typeof catalogs] || [];
        return Response.json({ models: ids.map((id) => ({ id, name: id })) });
      }
      if (url === "/api/connections") {
        if (method !== "GET") connectionWrites({ method, body });
        return Response.json(connections);
      }
      if (url === "/api/coding" && method === "GET")
        return Response.json(codingInfo());
      if (url === "/api/coding/tasks" && method === "POST") {
        taskWrites({ url, method, body });
        const task = makeTask({
          id: "new-task",
          prompt: body.prompt,
          provider: body.provider,
          model: body.model,
        });
        tasks.set(task.id, task);
        return Response.json(summarize(task));
      }
      const match = /^\/api\/coding\/tasks\/([^/]+)(\/model)?$/.exec(url);
      const task = match && tasks.get(match[1]);
      if (match && task) {
        if (match[2] === "/model" && method === "PUT") {
          taskWrites({ url, method, body });
          if (modelError)
            return Response.json({ error: modelError }, { status: 400 });
          const updated = { ...task, ...body };
          tasks.set(task.id, updated);
          return Response.json(summarize(updated));
        }
        if (!match[2] && method === "GET") return Response.json(task);
      }
      throw Error(`Unexpected request: ${method} ${url}`);
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  forgetConnections();
  providers.forEach(forgetCatalog);
  vi.useRealTimers();
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
const trigger = () =>
  element<HTMLButtonElement>('button[aria-label^="Task model:"]');
const popover = () =>
  container.querySelector(
    '[role="dialog"][aria-label="Choose task provider and model"]',
  );
async function inputValue(selector: string, value: string) {
  const input = element<HTMLInputElement | HTMLTextAreaElement>(selector);
  await interact(() => {
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const search = (value: string) =>
  inputValue('input[aria-label="Search task models"]', value);
const key = (key: string) =>
  interact(() =>
    element('input[aria-label="Search task models"]').dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true }),
    ),
  );

function PickerHarness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState<CodingModelSelection>({
    provider: "openai",
    model: "gpt-5",
  });
  return h(CodeModelPicker, {
    value,
    disabled,
    revision: 0,
    onBusyChange: busy,
    onConnections: manage,
    onChange: async (selection) => {
      await change(selection);
      setValue(selection);
    },
  });
}
const renderAssistant = () =>
  render(h(CodingAssistant, { revision: 0, onConnections: manage }));

async function browseAnthropic() {
  await click(trigger());
  await click(button("Anthropic", ".quick-provider-list button"));
}

describe("task provider and model picker", () => {
  it("only browses a provider, clearing the search without saving or changing the task", async () => {
    await render(h(PickerHarness));
    await click(trigger());
    await search("gpt");
    await click(button("Anthropic", ".quick-provider-list button"));
    expect(popover()).not.toBeNull();
    expect(element<HTMLInputElement>('input[type="search"]').value).toBe("");
    expect(element('[aria-label="Anthropic models"]').textContent).toContain(
      "claude-opus-4-6",
    );
    expect(
      button("Anthropic", ".quick-provider-list button").getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(trigger().textContent).toContain("OpenAI");
    expect(change).not.toHaveBeenCalled();
    expect(busy).not.toHaveBeenCalled();
    expect(connectionWrites).not.toHaveBeenCalled();
    expect(connections.assistant).toBe("openai");
  });

  it("saves an explicit provider/model pair, closes, and restores trigger focus", async () => {
    await render(h(PickerHarness));
    await browseAnthropic();
    await click(button("claude-opus-4-6", ".quick-model-list button"));
    expect(change).toHaveBeenCalledExactlyOnceWith({
      provider: "anthropic",
      model: "claude-opus-4-6",
    });
    expect(popover()).toBeNull();
    expect(trigger().textContent).toContain("Anthropic");
    expect(document.activeElement).toBe(trigger());
    expect(busy.mock.calls.map(([value]) => value)).toEqual([true, false]);
    expect(connectionWrites).not.toHaveBeenCalled();
    await click(trigger());
    expect(
      button("claude-opus-4-6", ".quick-model-list button").getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
  });

  it("keeps a rejected save visible without changing the current task model", async () => {
    await render(h(PickerHarness));
    await browseAnthropic();
    saveError = "The task model could not be saved.";
    await click(button("claude-opus-4-6", ".quick-model-list button"));
    expect(change).toHaveBeenLastCalledWith({
      provider: "anthropic",
      model: "claude-opus-4-6",
    });
    expect(popover()).not.toBeNull();
    expect(element('[role="alert"]').textContent).toBe(saveError);
    expect(trigger().textContent).toContain("OpenAI");
    expect(trigger().disabled).toBe(false);
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(connectionWrites).not.toHaveBeenCalled();
  });

  it.each(["Enter", "button"])(
    "selects an exact model ID with %s",
    async (method) => {
      await render(h(PickerHarness));
      await browseAnthropic();
      await search("custom/model-v1:latest");
      if (method === "Enter") await key("Enter");
      else await click(button("Use this exact identifier"));
      expect(change).toHaveBeenCalledExactlyOnceWith({
        provider: "anthropic",
        model: "custom/model-v1:latest",
      });
      expect(popover()).toBeNull();
      expect(document.activeElement).toBe(trigger());
      expect(connectionWrites).not.toHaveBeenCalled();
    },
  );

  it("does not open when disabled", async () => {
    await render(h(PickerHarness, { disabled: true }));
    expect(trigger().disabled).toBe(true);
    await click(trigger());
    expect(popover()).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });

  it("blocks model, provider, and exact-ID changes if disabled while open", async () => {
    await render(h(PickerHarness));
    await click(trigger());
    await search("custom/model-v1");
    await render(h(PickerHarness, { disabled: true }));
    expect(element<HTMLInputElement>('input[type="search"]').disabled).toBe(
      true,
    );
    await click(button("Anthropic", ".quick-provider-list button"));
    await click(button("Use this exact identifier"));
    await key("Enter");
    expect(change).not.toHaveBeenCalled();
    expect(busy).not.toHaveBeenCalled();
    expect(popover()).not.toBeNull();
    expect(element('[aria-label="OpenAI models"]')).toBeDefined();
    expect(connectionWrites).not.toHaveBeenCalled();
  });

  it("dismisses with Escape or an outside pointer event without saving", async () => {
    await render(h(PickerHarness));
    await click(trigger());
    await key("Escape");
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    await click(trigger());
    await interact(() =>
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(popover()).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(change).not.toHaveBeenCalled();
    expect(connectionWrites).not.toHaveBeenCalled();
  });
});

describe("coding assistant task-owned model integration", () => {
  it("sends a new task with the selected provider/model without updating assistant connections", async () => {
    await renderAssistant();
    await click(button("New task", ".code-new"));
    await browseAnthropic();
    expect(taskWrites).not.toHaveBeenCalled();
    await click(button("claude-opus-4-6", ".quick-model-list button"));
    expect(taskWrites).not.toHaveBeenCalled();
    await inputValue("textarea", "Build a task-specific model picker");
    await click(element('button[aria-label="Send"]'));
    expect(taskWrites).toHaveBeenCalledExactlyOnceWith({
      url: "/api/coding/tasks",
      method: "POST",
      body: {
        prompt: "Build a task-specific model picker",
        attachments: [],
        provider: "anthropic",
        model: "claude-opus-4-6",
      },
    });
    expect(trigger().textContent).toContain("Anthropic");
    expect(connectionWrites).not.toHaveBeenCalled();
    expect(connections.assistant).toBe("openai");
    expect(connections.providers.openai?.model).toBe("gpt-5");
  });

  it("sends the initial new-task default as an explicit provider/model pair", async () => {
    await renderAssistant();
    await click(button("New task", ".code-new"));
    await inputValue("textarea", "Explain the existing code");
    await click(element('button[aria-label="Send"]'));
    expect(taskWrites).toHaveBeenCalledExactlyOnceWith({
      url: "/api/coding/tasks",
      method: "POST",
      body: {
        prompt: "Explain the existing code",
        attachments: [],
        provider: "openai",
        model: "gpt-5",
      },
    });
    expect(connectionWrites).not.toHaveBeenCalled();
  });

  it("updates an idle task via its model endpoint and refreshes the thread and list summary", async () => {
    const task = makeTask();
    tasks.set(task.id, task);
    await renderAssistant();
    expect(element(".code-task-model").textContent).toBe("OpenAI · gpt-5");
    await click(button(task.prompt, ".code-task-open"));
    await browseAnthropic();
    expect(taskWrites).not.toHaveBeenCalled();
    await click(button("claude-opus-4-6", ".quick-model-list button"));
    expect(taskWrites).toHaveBeenCalledExactlyOnceWith({
      url: "/api/coding/tasks/task-1/model",
      method: "PUT",
      body: { provider: "anthropic", model: "claude-opus-4-6" },
    });
    expect(popover()).toBeNull();
    expect(trigger().textContent).toContain("Anthropic");
    await click(button("Tasks", ".code-back"));
    expect(element(".code-task-model").textContent).toBe(
      "Anthropic · claude-opus-4-6",
    );
    expect(connectionWrites).not.toHaveBeenCalled();
  });

  it("keeps an API model-save error in the open picker and preserves the summary", async () => {
    const task = makeTask();
    tasks.set(task.id, task);
    modelError = "Stop this task before changing its model.";
    await renderAssistant();
    await click(button(task.prompt, ".code-task-open"));
    await click(trigger());
    await click(button("gpt-5-mini", ".quick-model-list button"));
    expect(taskWrites).toHaveBeenCalledExactlyOnceWith({
      url: "/api/coding/tasks/task-1/model",
      method: "PUT",
      body: { provider: "openai", model: "gpt-5-mini" },
    });
    expect(popover()).not.toBeNull();
    expect(element('[role="alert"]').textContent).toBe(modelError);
    expect(trigger().textContent).not.toContain("Mini");
    expect(trigger().disabled).toBe(false);
    await key("Escape");
    await click(button("Tasks", ".code-back"));
    expect(element(".code-task-model").textContent).toBe("OpenAI · gpt-5");
    expect(connectionWrites).not.toHaveBeenCalled();
  });

  it.each<CodingStatus>(["preparing", "working", "checking", "publishing"])(
    "disables the model picker for a %s task",
    async (status) => {
      const task = makeTask({ status });
      tasks.set(task.id, task);
      await renderAssistant();
      await click(button(task.prompt, ".code-task-open"));
      expect(trigger().disabled).toBe(true);
      expect(element(".code-model-note").textContent).toContain(
        "Stop this task or wait for it to finish",
      );
      await click(trigger());
      expect(popover()).toBeNull();
      expect(taskWrites).not.toHaveBeenCalled();
      expect(connectionWrites).not.toHaveBeenCalled();
    },
  );
});

it("keeps the assistant model menu in assistant settings, not the topbar", () => {
  const source = readFileSync("src/App.tsx", "utf8");
  const topbar = source.match(
    /<header className="topbar">[\s\S]*?<\/header>/,
  )?.[0];
  expect(topbar).toBeDefined();
  expect(topbar).not.toContain("<AssistantModelMenu");
  expect(source).toMatch(
    /<div className="assistant-settings">\s*<AssistantModelMenu\b/,
  );
});
