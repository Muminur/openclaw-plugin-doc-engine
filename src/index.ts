import { createEngine } from "./engine.js";
import type { DocEngine } from "./engine.js";

const configSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    repositories: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "path", "priority", "type"],
        properties: {
          name: { type: "string" },
          path: { type: "string" },
          priority: { type: "number", minimum: 1 },
          type: { type: "string", enum: ["core", "extension"] },
          glob: { type: "string" },
        },
      },
    },
    storage: { type: "string" },
    chunkMaxTokens: { type: "number", default: 800 },
    topK: { type: "number", default: 5 },
    watchEnabled: { type: "boolean", default: true },
    watchDebounceMs: { type: "number", default: 2000 },
    secretPatterns: { type: "array", items: { type: "string" } },
    englishOnly: { type: "boolean", default: true },
  },
};

export default {
  id: "doc-engine",
  name: "Semantic Documentation Engine",
  version: "1.0.0",
  configSchema,

  register(api: any) {
    let engine: DocEngine | null = null;

    api.registerService({
      id: "doc-indexer",
      start: async () => {
        const config = api.pluginConfig || {};
        const storagePath = config.storage || api.resolvePath("./storage");
        engine = createEngine(config, storagePath);
        await engine.start();
        api.logger.info("Doc engine indexed and ready");
      },
      stop: async () => {
        if (engine) await engine.stop();
      },
    });

    api.registerTool(
      () => ({
        name: "semantic_doc_search",
        label: "Semantic Doc Search",
        description:
          "Search OpenClaw documentation, deep-dive knowledge, and skills semantically. Returns ranked chunks with source attribution and relevance scores.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural language search query",
            },
            topK: {
              type: "number",
              description: "Number of results (default 5)",
            },
            repoFilter: {
              type: "string",
              description: "Filter by repo name",
            },
          },
          required: ["query"],
        },
        async execute(
          _toolCallId: string,
          params: Record<string, unknown>,
        ) {
          const query = params.query as string;
          const topK = params.topK as number | undefined;
          const repoFilter = params.repoFilter as string | undefined;
          if (!engine)
            return {
              content: [{ type: "text" as const, text: "Doc engine not initialized yet. Try again shortly." }],
              details: {},
            };
          const results = await engine.search(query, {
            topK: topK ?? 5,
            repoFilter,
          });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
            details: { resultCount: results.length },
          };
        },
      }),
      { names: ["semantic_doc_search"] }
    );

    api.registerCli(
      ({ program }: any) => {
        const docs = program
          .command("docsearch")
          .description("Semantic documentation engine commands");

        const ensureEngine = async () => {
          if (engine) return true;
          // CLI runs standalone — start engine on demand
          try {
            const config = api.pluginConfig || {};
            const storagePath = config.storage || api.resolvePath("./storage");
            engine = createEngine(config, storagePath);
            await engine.start();
            return true;
          } catch (err: any) {
            console.error("Failed to start engine:", err.message);
            return false;
          }
        };

        const searchAction = async (query: string, opts: any) => {
          if (!(await ensureEngine())) return;
          const results = await engine!.search(query, {
            topK: parseInt(opts.topK || "5"),
            repoFilter: opts.repo,
          });
          if (results.length === 0) {
            console.log("No results found.");
            return;
          }
          for (const r of results) {
            console.log(
              `[${r.score.toFixed(3)}] ${r.repo}:${r.file} — ${r.sectionPath}`
            );
            console.log(`  ${r.text.slice(0, 120)}...\n`);
          }
        };

        docs
          .command("search <query>")
          .option("-k, --top-k <n>", "Number of results", "5")
          .option("-r, --repo <name>", "Filter by repo")
          .action(searchAction);

        // Allow `openclaw docsearch <query>` as shorthand for `openclaw docsearch search <query>`
        docs
          .argument("[query]")
          .option("-k, --top-k <n>", "Number of results", "5")
          .option("-r, --repo <name>", "Filter by repo")
          .action(async (query: string | undefined, opts: any) => {
            if (query) await searchAction(query, opts);
          });

        docs
          .command("index")
          .option("--full", "Force full re-index")
          .action(async (opts: any) => {
            if (!(await ensureEngine())) return;
            const stats = await engine!.index(opts.full);
            console.log("Indexing complete:", JSON.stringify(stats, null, 2));
          });

        docs.command("status").action(async () => {
          if (!(await ensureEngine())) return;
          console.log(JSON.stringify(engine!.getStats(), null, 2));
        });
      },
      { commands: ["docsearch"] }
    );

    api.registerCommand({
      name: "docsearch",
      description: "Quick semantic doc search (no AI needed)",
      acceptsArgs: true,
      requireAuth: false,
      handler: async (ctx: any) => {
        if (!engine) return { text: "Doc engine not ready yet." };
        const results = await engine.search(ctx.args || ctx.commandBody || "", {
          topK: 3,
        });
        const text = results
          .map(
            (r: any) =>
              `**[${r.repo}]** ${r.sectionPath}\n${r.text.slice(0, 200)}`
          )
          .join("\n---\n");
        return { text: text || "No results found." };
      },
    });
  },
};
