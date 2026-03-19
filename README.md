# SMTP MCP Server

MCP-Server zum Senden von E-Mails über SMTP. Funktioniert mit jedem SMTP-Anbieter (All-Inkl, Gmail, etc.).

## Tools

- `email_send` — E-Mail senden (Text/HTML, CC, BCC, Anhänge)
- `email_verify` — SMTP-Verbindung testen

## Installation

### Voraussetzung
- [Node.js](https://nodejs.org/) (Version 18+)

### Claude Desktop konfigurieren

Füge folgendes in deine `claude_desktop_config.json` ein:

**Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

#### All-Inkl

```json
{
  "mcpServers": {
    "smtp": {
      "command": "npx",
      "args": ["-y", "github:fabienbutz/smtp-mcp"],
      "env": {
        "SMTP_HOST": "smtp.all-inkl.com",
        "SMTP_PORT": "465",
        "SMTP_USER": "deine@email.de",
        "SMTP_PASS": "dein-passwort",
        "SMTP_FROM_NAME": "Dein Name"
      }
    }
  }
}
```

#### Gmail

```json
{
  "mcpServers": {
    "smtp": {
      "command": "npx",
      "args": ["-y", "github:fabienbutz/smtp-mcp"],
      "env": {
        "SMTP_HOST": "smtp.gmail.com",
        "SMTP_PORT": "465",
        "SMTP_USER": "deine@gmail.com",
        "SMTP_PASS": "app-passwort",
        "SMTP_FROM_NAME": "Dein Name"
      }
    }
  }
}
```

Claude Desktop neu starten — fertig!

## Features

- Text- und HTML-E-Mails
- Mehrere Empfänger, CC, BCC
- Reply-To
- Dateianhänge (via URL, Dateipfad oder Base64)
- Absendername konfigurierbar
- Verbindungstest
