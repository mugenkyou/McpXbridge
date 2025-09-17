#!/usr/bin/env node

// src/index.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { program } from "commander";

// src/config/app.config.ts
var appConfig = {
  name: "Mirailens",
  version: "0.1.3"
};

// src/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

// src/messaging/ws/sender.ts
function createSocketMessageSender(ws) {
  return {
    async sendSocketMessage(type2, payload, options = { timeoutMs: 3e4 }) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Request timeout"));
        }, options.timeoutMs);
        const messageId = Math.random().toString(36).substr(2, 9);
        const message = {
          id: messageId,
          type: type2,
          payload
        };
        const handleMessage = (data) => {
          try {
            const response = JSON.parse(data.toString());
            if (response.id === messageId) {
              clearTimeout(timeout);
              ws.off("message", handleMessage);
              if (response.error) {
                reject(new Error(response.error));
              } else {
                resolve(response.result);
              }
            }
          } catch (e) {
          }
        };
        ws.on("message", handleMessage);
        ws.send(JSON.stringify(message));
      });
    }
  };
}

// src/config/mcp.config.ts
var mcpConfig = {
  defaultWsPort: 3001,
  errors: {
    noConnectedTab: "No connected tab"
  }
};

// src/context.ts
var noConnectionMessage = `No connection to browser extension. In order to proceed, you must first connect a tab by clicking the Mirailens extension icon in the browser toolbar and clicking the 'Connect' button.`;
var Context = class {
  _ws;
  get ws() {
    if (!this._ws) {
      throw new Error(noConnectionMessage);
    }
    return this._ws;
  }
  set ws(ws) {
    this._ws = ws;
  }
  hasWs() {
    return !!this._ws;
  }
  async sendSocketMessage(type2, payload, options = { timeoutMs: 3e4 }) {
    const { sendSocketMessage } = createSocketMessageSender(
      this.ws
    );
    try {
      return await sendSocketMessage(type2, payload, options);
    } catch (e) {
      if (e instanceof Error && e.message === mcpConfig.errors.noConnectedTab) {
        throw new Error(noConnectionMessage);
      }
      throw e;
    }
  }
  async close() {
    if (!this._ws) {
      return;
    }
    await this._ws.close();
  }
};

// src/ws.ts
import { WebSocketServer } from "ws";

// src/utils/wait.ts
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/utils/port.ts
import { execSync } from "child_process";
import net from "net";
async function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port);
  });
}
function killProcessOnPort(port) {
  try {
    if (process.platform === "win32") {
      execSync(
        `FOR /F "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a`
      );
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9`);
    }
  } catch (error) {
    console.error(`Failed to kill process on port ${port}:`, error);
  }
}

// src/ws.ts
async function createWebSocketServer(port = mcpConfig.defaultWsPort) {
  killProcessOnPort(port);
  while (await isPortInUse(port)) {
    await wait(100);
  }
  return new WebSocketServer({ port });
}

// src/server.ts
async function createServerWithTools(options) {
  const { name, version, tools, resources: resources2 } = options;
  const context = new Context();
  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  );
  const wss = await createWebSocketServer();
  wss.on("connection", (websocket) => {
    if (context.hasWs()) {
      context.ws.close();
    }
    context.ws = websocket;
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: tools.map((tool) => tool.schema) };
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: resources2.map((resource) => resource.schema) };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((tool2) => tool2.schema.name === request.params.name);
    if (!tool) {
      return {
        content: [
          { type: "text", text: `Tool "${request.params.name}" not found` }
        ],
        isError: true
      };
    }
    try {
      const result = await tool.handle(context, request.params.arguments);
      return result;
    } catch (error) {
      return {
        content: [{ type: "text", text: String(error) }],
        isError: true
      };
    }
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources2.find(
      (resource2) => resource2.schema.uri === request.params.uri
    );
    if (!resource) {
      return { contents: [] };
    }
    const contents = await resource.read(context, request.params.uri);
    return { contents };
  });
  server.close = async () => {
    await server.close();
    await wss.close();
    await context.close();
  };
  return server;
}

// src/tools/common.ts
import { zodToJsonSchema } from "zod-to-json-schema";

// src/types/mcp/tool.ts
import { z } from "zod";
var NavigateTool = z.object({
  name: z.literal("mcp_mcpbridgex_navigate"),
  description: z.literal("Navigate the active tab to a URL"),
  arguments: z.object({
    url: z.string().url()
  })
});
var GoBackTool = z.object({
  name: z.literal("mcp_mcpbridgex_go_back"),
  description: z.literal("Navigate back in history"),
  arguments: z.object({
    random_string: z.string().describe("Dummy parameter for no-parameter tools")
  })
});
var GoForwardTool = z.object({
  name: z.literal("goForward"),
  description: z.literal("Navigate forward in history"),
  arguments: z.object({
    random_string: z.string().describe("Dummy parameter for no-parameter tools")
  })
});
var SnapshotTool = z.object({
  name: z.literal("snapshot"),
  description: z.literal("Capture an accessibility snapshot of the page"),
  arguments: z.object({
    random_string: z.string().describe("Dummy parameter for no-parameter tools")
  })
});
var ClickTool = z.object({
  name: z.literal("mcp_mcpbridgex_click"),
  description: z.literal("Click an element by selector or ARIA query"),
  arguments: z.object({
    element: z.string().min(1)
  })
});
var DragTool = z.object({
  name: z.literal("mcp_mcpbridgex_drag"),
  description: z.literal("Drag an element to another element"),
  arguments: z.object({
    startElement: z.string().min(1),
    endElement: z.string().min(1)
  })
});
var HoverTool = z.object({
  name: z.literal("mcp_mcpbridgex_hover"),
  description: z.literal("Hover over an element"),
  arguments: z.object({
    element: z.string().min(1)
  })
});
var TypeTool = z.object({
  name: z.literal("type"),
  description: z.literal("Type text into an element"),
  arguments: z.object({
    element: z.string().min(1),
    text: z.string()
  })
});
var SelectOptionTool = z.object({
  name: z.literal("selectOption"),
  description: z.literal("Select an option in a select element"),
  arguments: z.object({
    element: z.string().min(1),
    values: z.array(z.string()).min(1)
  })
});
var PressKeyTool = z.object({
  name: z.literal("pressKey"),
  description: z.literal("Press a keyboard key"),
  arguments: z.object({
    key: z.string().min(1)
  })
});
var WaitTool = z.object({
  name: z.literal("wait"),
  description: z.literal("Wait for a number of seconds"),
  arguments: z.object({
    time: z.number().gt(0)
  })
});
var GetConsoleLogsTool = z.object({
  name: z.literal("getConsoleLogs"),
  description: z.literal("Get recent console logs from the page"),
  arguments: z.object({
    random_string: z.string().describe("Dummy parameter for no-parameter tools")
  })
});
var ScreenshotTool = z.object({
  name: z.literal("screenshot"),
  description: z.literal("Capture a PNG screenshot of the page"),
  arguments: z.object({
    random_string: z.string().describe("Dummy parameter for no-parameter tools")
  })
});

// src/utils/aria-snapshot.ts
async function captureAriaSnapshot(context, status = "") {
  const url = await context.sendSocketMessage("getUrl", void 0);
  const title = await context.sendSocketMessage("getTitle", void 0);
  const snapshot2 = await context.sendSocketMessage("browser_snapshot", {});
  return {
    content: [
      {
        type: "text",
        text: `${status ? `${status}
` : ""}
- Page URL: ${url}
- Page Title: ${title}
- Page Snapshot
\`\`\`yaml
${snapshot2}
\`\`\`
`
      }
    ]
  };
}

// src/tools/common.ts
var navigate = (snapshot2) => ({
  schema: {
    name: NavigateTool.shape.name.value,
    description: NavigateTool.shape.description.value,
    inputSchema: zodToJsonSchema(NavigateTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { url } = NavigateTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_navigate", { url });
    if (snapshot2) {
      return captureAriaSnapshot(context);
    }
    return {
      content: [
        {
          type: "text",
          text: `Navigated to ${url}`
        }
      ]
    };
  }
});
var goBack = (snapshot2) => ({
  schema: {
    name: GoBackTool.shape.name.value,
    description: GoBackTool.shape.description.value,
    inputSchema: zodToJsonSchema(GoBackTool.shape.arguments)
  },
  handle: async (context) => {
    await context.sendSocketMessage("browser_go_back", {});
    if (snapshot2) {
      return captureAriaSnapshot(context);
    }
    return {
      content: [
        {
          type: "text",
          text: "Navigated back"
        }
      ]
    };
  }
});
var goForward = (snapshot2) => ({
  schema: {
    name: GoForwardTool.shape.name.value,
    description: GoForwardTool.shape.description.value,
    inputSchema: zodToJsonSchema(GoForwardTool.shape.arguments)
  },
  handle: async (context) => {
    await context.sendSocketMessage("browser_go_forward", {});
    if (snapshot2) {
      return captureAriaSnapshot(context);
    }
    return {
      content: [
        {
          type: "text",
          text: "Navigated forward"
        }
      ]
    };
  }
});
var wait2 = {
  schema: {
    name: WaitTool.shape.name.value,
    description: WaitTool.shape.description.value,
    inputSchema: zodToJsonSchema(WaitTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { time } = WaitTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_wait", { time });
    return {
      content: [
        {
          type: "text",
          text: `Waited for ${time} seconds`
        }
      ]
    };
  }
};
var pressKey = {
  schema: {
    name: PressKeyTool.shape.name.value,
    description: PressKeyTool.shape.description.value,
    inputSchema: zodToJsonSchema(PressKeyTool.shape.arguments)
  },
  handle: async (context, params) => {
    const { key } = PressKeyTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_press_key", { key });
    return {
      content: [
        {
          type: "text",
          text: `Pressed key ${key}`
        }
      ]
    };
  }
};

// src/tools/custom.ts
import { zodToJsonSchema as zodToJsonSchema2 } from "zod-to-json-schema";
var getConsoleLogs = {
  schema: {
    name: GetConsoleLogsTool.shape.name.value,
    description: GetConsoleLogsTool.shape.description.value,
    inputSchema: zodToJsonSchema2(GetConsoleLogsTool.shape.arguments)
  },
  handle: async (context, _params) => {
    const consoleLogs = await context.sendSocketMessage(
      "browser_get_console_logs",
      {}
    );
    const text = consoleLogs.map((log) => JSON.stringify(log)).join("\n");
    return {
      content: [{ type: "text", text }]
    };
  }
};
var screenshot = {
  schema: {
    name: ScreenshotTool.shape.name.value,
    description: ScreenshotTool.shape.description.value,
    inputSchema: zodToJsonSchema2(ScreenshotTool.shape.arguments)
  },
  handle: async (context, _params) => {
    const screenshot2 = await context.sendSocketMessage(
      "browser_screenshot",
      {}
    );
    return {
      content: [
        {
          type: "image",
          data: screenshot2,
          mimeType: "image/png"
        }
      ]
    };
  }
};

// src/tools/snapshot.ts
import zodToJsonSchema3 from "zod-to-json-schema";
var snapshot = {
  schema: {
    name: SnapshotTool.shape.name.value,
    description: SnapshotTool.shape.description.value,
    inputSchema: zodToJsonSchema3(SnapshotTool.shape.arguments)
  },
  handle: async (context) => {
    return await captureAriaSnapshot(context);
  }
};
var click = {
  schema: {
    name: ClickTool.shape.name.value,
    description: ClickTool.shape.description.value,
    inputSchema: zodToJsonSchema3(ClickTool.shape.arguments)
  },
  handle: async (context, params) => {
    const validatedParams = ClickTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_click", validatedParams);
    const snapshot2 = await captureAriaSnapshot(context);
    return {
      content: [
        {
          type: "text",
          text: `Clicked "${validatedParams.element}"`
        },
        ...snapshot2.content
      ]
    };
  }
};
var drag = {
  schema: {
    name: DragTool.shape.name.value,
    description: DragTool.shape.description.value,
    inputSchema: zodToJsonSchema3(DragTool.shape.arguments)
  },
  handle: async (context, params) => {
    const validatedParams = DragTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_drag", validatedParams);
    const snapshot2 = await captureAriaSnapshot(context);
    return {
      content: [
        {
          type: "text",
          text: `Dragged "${validatedParams.startElement}" to "${validatedParams.endElement}"`
        },
        ...snapshot2.content
      ]
    };
  }
};
var hover = {
  schema: {
    name: HoverTool.shape.name.value,
    description: HoverTool.shape.description.value,
    inputSchema: zodToJsonSchema3(HoverTool.shape.arguments)
  },
  handle: async (context, params) => {
    const validatedParams = HoverTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_hover", validatedParams);
    const snapshot2 = await captureAriaSnapshot(context);
    return {
      content: [
        {
          type: "text",
          text: `Hovered over "${validatedParams.element}"`
        },
        ...snapshot2.content
      ]
    };
  }
};
var type = {
  schema: {
    name: TypeTool.shape.name.value,
    description: TypeTool.shape.description.value,
    inputSchema: zodToJsonSchema3(TypeTool.shape.arguments)
  },
  handle: async (context, params) => {
    const validatedParams = TypeTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_type", validatedParams);
    const snapshot2 = await captureAriaSnapshot(context);
    return {
      content: [
        {
          type: "text",
          text: `Typed "${validatedParams.text}" into "${validatedParams.element}"`
        },
        ...snapshot2.content
      ]
    };
  }
};
var selectOption = {
  schema: {
    name: SelectOptionTool.shape.name.value,
    description: SelectOptionTool.shape.description.value,
    inputSchema: zodToJsonSchema3(SelectOptionTool.shape.arguments)
  },
  handle: async (context, params) => {
    const validatedParams = SelectOptionTool.shape.arguments.parse(params);
    await context.sendSocketMessage("browser_select_option", validatedParams);
    const snapshot2 = await captureAriaSnapshot(context);
    return {
      content: [
        {
          type: "text",
          text: `Selected option in "${validatedParams.element}"`
        },
        ...snapshot2.content
      ]
    };
  }
};

// package.json
var package_default = {
  name: "mcpXbridge",
  version: "0.1.0",
  description: "MCP server for browser automation using McpXbridge",
  keywords: [
    "mcp",
    "model-context-protocol",
    "browser-automation",
    "ai-assistant",
    "web-automation",
    "cursor",
    "claude",
    "accessibility",
    "web-scraping",
    "browser-control",
    "typescript",
    "nodejs"
  ],
  author: "McpXbridge",
  homepage: "https://github.com/mugenkyou/mcpXbridge",
  bugs: "https://github.com/mugenkyou/mcpXbridge/issues",
  type: "module",
  bin: {
    mcpbridgex: "dist/index.js"
  },
  files: [
    "dist"
  ],
  scripts: {
    typecheck: "tsc --noEmit",
    build: "tsup src/index.ts --format esm && shx chmod +x dist/*.js",
    prepare: "npm run build",
    watch: "tsup src/index.ts --format esm --watch ",
    inspector: "CLIENT_PORT=9001 SERVER_PORT=9002 pnpx @modelcontextprotocol/inspector node dist/index.js"
  },
  dependencies: {
    "@modelcontextprotocol/sdk": "^1.8.0",
    commander: "^13.1.0",
    ws: "^8.18.1",
    zod: "^3.24.2",
    "zod-to-json-schema": "^3.24.3"
  },
  devDependencies: {
    "@types/ws": "^8.18.0",
    shx: "^0.3.4",
    tsup: "^8.4.0",
    typescript: "^5.6.2"
  }
};

// src/index.ts
function setupExitWatchdog(server) {
  process.stdin.on("close", async () => {
    setTimeout(() => process.exit(0), 15e3);
    await server.close();
    process.exit(0);
  });
}
var commonTools = [pressKey, wait2];
var customTools = [getConsoleLogs, screenshot];
var snapshotTools = [
  navigate(true),
  goBack(true),
  goForward(true),
  snapshot,
  click,
  hover,
  type,
  selectOption,
  ...commonTools,
  ...customTools
];
var resources = [];
async function createServer() {
  return createServerWithTools({
    name: appConfig.name,
    version: package_default.version,
    tools: snapshotTools,
    resources
  });
}
program.version("Version " + package_default.version).name(package_default.name).action(async () => {
  const server = await createServer();
  setupExitWatchdog(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
});
program.parse(process.argv);
