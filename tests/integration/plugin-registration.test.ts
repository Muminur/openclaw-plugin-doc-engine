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
    expect(toolDef.parameters.required).toContain("query");
    expect(typeof toolDef.execute).toBe("function");
    expect(toolDef.label).toBe("Semantic Doc Search");
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
    const result = await tool.execute("test-call-0", { query: "test" });
    expect(result.content[0].text).toContain("not initialized");
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

  it("service uses pluginConfig.storage over resolvePath fallback", async () => {
    const pluginModule = await import("../../src/index.js");
    const plugin = pluginModule.default;

    const customStorage = "/tmp/custom-doc-engine-storage";
    let capturedService: any;
    const mockApi = {
      pluginConfig: {
        repositories: [],
        storage: customStorage,
      },
      resolvePath: (p: string) => `/tmp/fallback-storage${p.startsWith(".") ? p.slice(1) : "/" + p}`,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerService(svc: any) { capturedService = svc; },
      registerTool: vi.fn(),
      registerCli: vi.fn(),
      registerCommand: vi.fn(),
    };

    plugin.register(mockApi);

    // The service start should use the config storage path, not the resolvePath fallback
    // We verify by starting the service and checking that it creates files at the config path
    expect(capturedService).toBeDefined();
    expect(capturedService.id).toBe("doc-indexer");

    // Start the engine — it should use customStorage
    await capturedService.start();

    // Verify storage was created at the config path (not the fallback)
    const { existsSync } = await import("node:fs");
    expect(existsSync(customStorage)).toBe(true);

    await capturedService.stop();

    // Cleanup
    const { rm } = await import("node:fs/promises");
    await rm(customStorage, { recursive: true, force: true });
  });

  it("tool uses AgentTool-compatible format (parameters, execute, label)", async () => {
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

    // Must use 'parameters' (not 'inputSchema') for pi-ai AgentTool compatibility
    expect(tool.parameters).toBeDefined();
    expect(tool.parameters.type).toBe("object");
    expect(tool.parameters.properties.query).toBeDefined();
    expect(tool.parameters.required).toContain("query");

    // Must NOT have 'inputSchema' (gateway ignores it)
    expect(tool.inputSchema).toBeUndefined();

    // Must use 'execute' (not 'handler') for AgentTool compatibility
    expect(typeof tool.execute).toBe("function");
    expect(tool.handler).toBeUndefined();

    // Must have 'label' for AgentTool compatibility
    expect(typeof tool.label).toBe("string");
    expect(tool.label.length).toBeGreaterThan(0);
  });

  it("tool schema is fully compliant with Google OpenAPI 3.0 requirements", async () => {
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
    const params = tool.parameters;

    // Schema must be a proper object (not undefined, null, or boolean)
    expect(typeof params).toBe("object");
    expect(params).not.toBeNull();

    // Must have explicit type: "object" at top level
    expect(params.type).toBe("object");

    // Must have additionalProperties: false for Google API strict mode
    expect(params.additionalProperties).toBe(false);

    // Every property must be a valid schema object (not undefined/null)
    for (const [key, value] of Object.entries(params.properties)) {
      expect(typeof value).toBe("object");
      expect(value).not.toBeNull();
      // Each property must have an explicit type
      expect((value as any).type).toBeDefined();
      // type must be a string (not array) for OpenAPI 3.0 compat
      expect(typeof (value as any).type).toBe("string");
    }

    // required must be an array of strings
    expect(Array.isArray(params.required)).toBe(true);
    for (const r of params.required) {
      expect(typeof r).toBe("string");
      // Every required field must exist in properties
      expect(params.properties[r]).toBeDefined();
    }

    // Verify no unsupported JSON Schema keywords for OpenAPI 3.0
    const unsupportedKeywords = ["oneOf", "anyOf", "allOf", "$ref", "not", "if", "then", "else"];
    for (const keyword of unsupportedKeywords) {
      expect(params[keyword]).toBeUndefined();
      for (const prop of Object.values(params.properties)) {
        expect((prop as any)[keyword]).toBeUndefined();
      }
    }
  });

  it("tool execute returns AgentToolResult format (content array)", async () => {
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

    // execute takes (toolCallId, params, signal?) and returns {content, details}
    const result = await tool.execute("test-call-1", { query: "test" });
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0].type).toBe("text");
    expect(typeof result.content[0].text).toBe("string");
  });

  it("service falls back to resolvePath when no storage in config", async () => {
    const pluginModule = await import("../../src/index.js");
    const plugin = pluginModule.default;

    const fallbackPath = "/tmp/fallback-doc-storage/storage";
    let capturedService: any;
    const mockApi = {
      pluginConfig: {
        repositories: [],
        // no storage field
      },
      resolvePath: (_p: string) => fallbackPath,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerService(svc: any) { capturedService = svc; },
      registerTool: vi.fn(),
      registerCli: vi.fn(),
      registerCommand: vi.fn(),
    };

    plugin.register(mockApi);
    await capturedService.start();

    const { existsSync } = await import("node:fs");
    expect(existsSync(fallbackPath)).toBe(true);

    await capturedService.stop();

    const { rm } = await import("node:fs/promises");
    await rm(fallbackPath, { recursive: true, force: true });
  });
});
