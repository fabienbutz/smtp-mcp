# Email MCP Server (SMTP + IMAP)

MCP-Server zum Senden und Empfangen von E-Mails. Funktioniert mit jedem Provider (All-Inkl, Gmail, etc.).

## 9 Tools

### Senden (SMTP)
- `email_send` — E-Mail senden (Text/HTML, CC, BCC, Anhänge)
- `email_verify` — SMTP-Verbindung testen
- `email_reply` — Auf E-Mail antworten (liest Original via IMAP, sendet via SMTP)

### Lesen (IMAP)
- `email_folders` — Alle Ordner auflisten
- `email_list` — E-Mails in einem Ordner auflisten (neueste zuerst)
- `email_read` — Einzelne E-Mail lesen (mit Anhang-Info)
- `email_search` — E-Mails suchen (Absender, Betreff, Datum, ungelesen, etc.)
- `email_move` — E-Mail in anderen Ordner verschieben
- `email_delete` — E-Mail löschen (Papierkorb oder endgültig)

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
    "email": {
      "command": "npx",
      "args": ["-y", "github:fabienbutz/smtp-mcp"],
      "env": {
        "SMTP_HOST": "smtp.all-inkl.com",
        "SMTP_PORT": "465",
        "IMAP_HOST": "imap.all-inkl.com",
        "IMAP_PORT": "993",
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
    "email": {
      "command": "npx",
      "args": ["-y", "github:fabienbutz/smtp-mcp"],
      "env": {
        "SMTP_HOST": "smtp.gmail.com",
        "SMTP_PORT": "465",
        "IMAP_HOST": "imap.gmail.com",
        "IMAP_PORT": "993",
        "SMTP_USER": "deine@gmail.com",
        "SMTP_PASS": "app-passwort",
        "SMTP_FROM_NAME": "Dein Name"
      }
    }
  }
}
```

Claude Desktop neu starten — fertig!

## Umgebungsvariablen

| Variable | Erforderlich | Beschreibung |
|----------|-------------|--------------|
| `SMTP_HOST` | Ja | SMTP Server |
| `SMTP_PORT` | Nein | SMTP Port (Standard: 465) |
| `SMTP_USER` | Ja | Email-Adresse / Login |
| `SMTP_PASS` | Ja | Passwort |
| `SMTP_FROM_NAME` | Nein | Absendername |
| `IMAP_HOST` | Ja* | IMAP Server (*nur für Lese-Tools) |
| `IMAP_PORT` | Nein | IMAP Port (Standard: 993) |
| `IMAP_USER` | Nein | IMAP Login (Standard: SMTP_USER) |
| `IMAP_PASS` | Nein | IMAP Passwort (Standard: SMTP_PASS) |
