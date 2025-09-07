# MCPBridge - Model Context Protocol Server for Browser Automation

[![npm version](https://badge.fury.io/js/mcpbridgex.svg)](https://badge.fury.io/js/mcpbridgex)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)


MCPBridge is a Model Context Protocol (MCP) server that provides browser automation capabilities for AI assistants and applications. It offers a standardized interface for controlling web browsers, enabling seamless integration with MCP-compatible clients such as Cursor, Claude, and other development tools.

## Features

- **Standards Compliant**: Full MCP server implementation following official specifications
- **Comprehensive Browser Control**: Navigate, interact with elements, and automate web workflows
- **Real-time Monitoring**: Accessibility tree inspection, console log capture, and screenshot functionality
- **Simple Deployment**: Quick setup via npx or local installation
- **TypeScript Support**: Complete type definitions for enhanced development experience
- **Cross-Platform**: Compatible with Windows, macOS, and Linux environments

## System Requirements

- Node.js version 18 or higher
- Chrome or Chromium browser
- MCPBridge browser extension (included)

## Installation

### Quick Start

```bash
npx mcpbridgex@latest
```

### Local Installation

```bash
npm install -g mcpbridgex
mcpbridgex
```

## Configuration

### Cursor IDE Integration

Create or modify the MCP configuration file in your Cursor settings directory:

**File Location:**
- Windows: `%APPDATA%/Cursor/User/globalStorage/cursor.mcp/mcp.json`
- macOS: `~/Library/Application Support/Cursor/User/globalStorage/cursor.mcp/mcp.json`
- Linux: `~/.config/Cursor/User/globalStorage/cursor.mcp/mcp.json`

**Configuration (using npx):**
```json
{
  "mcpServers": {
    "mcpbridgex": {
      "command": "npx",
      "args": ["mcpbridgex"],
      "env": {}
    }
  }
}
```

**Configuration (global installation):**
```json
{
  "mcpServers": {
    "mcpbridgex": {
      "command": "mcpbridgex",
      "args": [],
      "env": {}
    }
  }
}
```

Restart Cursor after saving the configuration file.

## Available Tools

### Navigation Tools
- `mcp_mcpbridgex_navigate` - Navigate to a specified URL
- `mcp_mcpbridgex_go_back` - Navigate to the previous page in browser history
- `mcp_mcpbridgex_go_forward` - Navigate to the next page in browser history

### Interaction Tools
- `mcp_mcpbridgex_click` - Click on page elements using CSS selectors or ARIA queries
- `mcp_mcpbridgex_hover` - Hover over specified elements
- `mcp_mcpbridgex_type` - Input text into form fields and text areas
- `mcp_mcpbridgex_select_option` - Select options from dropdown menus
- `mcp_mcpbridgex_press_key` - Send keyboard events to the active page
- `mcp_mcpbridgex_wait` - Pause execution for specified time intervals

### Inspection Tools
- `mcp_mcpbridgex_snapshot` - Generate accessibility tree snapshots of page content
- `mcp_mcpbridgex_get_console_logs` - Retrieve browser console messages and errors
- `mcp_mcpbridgex_screenshot` - Capture PNG screenshots of the current page state

## Browser Extension Setup

The MCPBridge browser extension facilitates communication between the MCP server and browser tabs:

1. Open Chrome or Chromium browser
2. Go to the Chrome Web Store
3. Search for "MCPBRIDGEX" extension
4. Click "Add to Chrome" to install the extension
5. The extension will connect automatically to your running MCPBridge server

## API Reference

MCPBridge implements the Model Context Protocol specification, providing a standardized interface for browser automation. All tools follow MCP conventions for parameter passing and result handling.

### Example Usage

```javascript
// Navigate to a website
await client.callTool('mcp_mcpbridgex_navigate', {
  url: 'https://example.com'
});

// Click an element
await client.callTool('mcp_mcpbridgex_click', {
  selector: 'button[type="submit"]'
});

// Capture page content
const snapshot = await client.callTool('mcp_mcpbridgex_snapshot');
```

## Architecture

MCPBridge consists of:
- **MCP Server**: Handles client connections and tool execution requests
- **Browser Extension**: Executes automation commands within browser context
- **WebSocket Transport**: Manages real-time communication between components
- **Tool Registry**: Provides standardized browser automation capabilities

## Troubleshooting

### Common Issues

**Server Connection Failed:**
- Ensure Node.js version 18+ is installed
- Verify the MCP configuration syntax is correct
- Check that the server process is running

**Browser Extension Not Working:**
- Confirm the extension is loaded and enabled in Chrome
- Verify the extension has necessary permissions
- Check browser console for error messages

**Tool Execution Timeouts:**
- Increase wait times for slow-loading pages
- Ensure target elements exist before interaction
- Use snapshots to verify page state before actions

## Performance Considerations

- Browser automation tools execute asynchronously
- Large page snapshots may impact performance
- Screenshot generation requires additional processing time
- Multiple concurrent operations should be managed carefully

## Security Notes

MCPBridge operates with browser-level permissions and should be used in trusted environments. The extension requires access to active tabs for automation functionality.

## Support

For technical support and documentation updates, please refer to the npm package page and version release notes.

## License

This software is licensed under the MIT License.

---

**Version:** Check npm for the latest release
**Compatibility:** MCP Protocol v1.0+
**Node.js:** 18.0.0 or higher