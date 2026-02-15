import { describe, it, expect, vi } from "vitest";

describe("Plugin Registration", () => {
  it("registers service, tool, cli, and command", async () => {
    // Dynamic import to avoid issues before file exists
    const pluginModule = await import("../../src/index.js");
    const plugin = pluginModule.default;

    expect(plugin.id).toBe("doc-engine");
    expect(plugin.name).toBe("Semantic Documentation Engine");
    expect(plugin.version).toBe("1.0.0");
    expect(plugin.configSchema).toBeDefined();

    const registrations = {
      services: [] as any[],
      tools: [] as any[],
      clis: [] as any[],
      commands: [] as any[],
    };

    const mockApi = {
      pluginConfig: { repositories: [] },
      resolvePath: (p: string) => `/tmp/test-storage${p.startsWith(".") ? p.slice(1) : "/" + p}`,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      registerService(svc: any) {
        registrations.services.push(svc);
      },
      registerTool(toolFn: any, opts: any) {
        registrations.tools.push({ toolFn, opts });
      },
      registerCli(cliFn: any, opts: any) {
        registrations.clis.push({ cliFn, opts });
      },
      registerCommand(cmd: any) {
        registrations.commands.push(cmd);
      },
    };

    plugin.register(mockApi);

    // Verify service registration
    expect(registrations.services).toHaveLength(1);
    expect(registrations.services[0].id).toBe("doc-indexer");
    expect(typeof registrations.services[0].start).toBe("function");
    expect(typeof registrations.services[0].stop).toBe("function");

    // Verify tool registration
    expect(registrations.tools).toHaveLength(1);
    const toolDef = registrations.tools[0].toolFn();
    expect(toolDef.name).toBe("semantic_doc_search");
    expect(toolDef.inputSchema.required).toContain("query");
    expect(typeof toolDef.handler).toBe("function");
    expect(registrations.tools[0].opts.names).toContain("semantic_doc_search");

    // Verify CLI registration
    expect(registrations.clis).toHaveLength(1);
    expect(registrations.clis[0].opts.commands).toContain("docsearch");

    // Verify command registration
    expect(registrations.commands).toHaveLength(1);
    expect(registrations.commands[0].name).toBe("docsearch");
    expect(registrations.commands[0].acceptsArgs).toBe(true);
    expect(typeof registrations.commands[0].handler).toBe("function");
  });

  it("tool handler returns not-initialized message when engine not started", async () => {
    const pluginModule = await import("../../src/index.js");
    const plugin = pluginModule.default;

    let toolFn: any;
    const mockApi = {
      pluginConfig: {},
      resolvePath: (p: string) => `/tmp/test${p}`,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerService: vi.fn(),
      registerTool(fn: any, _opts: any) { toolFn = fn; },
      registerCli: vi.fn(),
      registerCommand: vi.fn(),
    };

    plugin.register(mockApi);
    const tool = toolFn();
    const result = await tool.handler({ query: "test" });
    expect(result.result).toContain("not initialized");
  });

  it("command handler returns not-ready message when engine not started", async () => {
    const pluginModule = await import("../../src/index.js");
    const plugin = pluginModule.default;

    let command: any;
    const mockApi = {
      pluginConfig: {},
      resolvePath: (p: string) => `/tmp/test${p}`,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerService: vi.fn(),
      registerTool: vi.fn(),
      registerCli: vi.fn(),
      registerCommand(cmd: any) { command = cmd; },
    };

    plugin.register(mockApi);
    const result = await command.handler({ args: "test query" });
    expect(result.text).toContain("not ready");
  });
});
