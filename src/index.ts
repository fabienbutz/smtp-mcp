#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";

function getTransporter(): nodemailer.Transporter<SMTPTransport.SentMessageInfo> {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables are required");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

const server = new McpServer({
  name: "smtp",
  version: "1.0.0",
});

// --- Send Email ---
server.tool(
  "email_send",
  "Send an email via SMTP. Supports text and HTML body, CC, BCC, reply-to, and attachments via URL.",
  {
    to: z.union([z.string(), z.array(z.string())]).describe("Recipient email(s) (required)"),
    subject: z.string().describe("Email subject (required)"),
    text: z.string().optional().describe("Plain text body"),
    html: z.string().optional().describe("HTML body (alternative to text)"),
    cc: z.union([z.string(), z.array(z.string())]).optional().describe("CC recipient(s)"),
    bcc: z.union([z.string(), z.array(z.string())]).optional().describe("BCC recipient(s)"),
    reply_to: z.string().optional().describe("Reply-to address"),
    from_name: z.string().optional().describe("Sender display name (default: SMTP_FROM_NAME or SMTP_USER)"),
    attachments: z.array(z.object({
      filename: z.string().describe("Attachment filename"),
      path: z.string().optional().describe("URL or file path to attachment"),
      content: z.string().optional().describe("Base64 encoded content (alternative to path)"),
      content_type: z.string().optional().describe("MIME type (e.g. application/pdf)"),
    })).optional().describe("File attachments"),
  },
  async (params) => {
    const transporter = getTransporter();
    const user = process.env.SMTP_USER!;
    const fromName = params.from_name || process.env.SMTP_FROM_NAME || user;
    const from = `"${fromName}" <${user}>`;

    const mailOptions: nodemailer.SendMailOptions = {
      from,
      to: Array.isArray(params.to) ? params.to.join(", ") : params.to,
      subject: params.subject,
    };

    if (params.text) mailOptions.text = params.text;
    if (params.html) mailOptions.html = params.html;
    if (!params.text && !params.html) throw new Error("Either text or html body is required");

    if (params.cc) mailOptions.cc = Array.isArray(params.cc) ? params.cc.join(", ") : params.cc;
    if (params.bcc) mailOptions.bcc = Array.isArray(params.bcc) ? params.bcc.join(", ") : params.bcc;
    if (params.reply_to) mailOptions.replyTo = params.reply_to;

    if (params.attachments?.length) {
      mailOptions.attachments = params.attachments.map((a) => {
        const att: Record<string, unknown> = { filename: a.filename };
        if (a.path) att.path = a.path;
        if (a.content) {
          att.content = a.content;
          att.encoding = "base64";
        }
        if (a.content_type) att.contentType = a.content_type;
        return att;
      });
    }

    const info = await transporter.sendMail(mailOptions);

    return {
      content: [{
        type: "text",
        text: [
          `Email gesendet!`,
          `An: ${mailOptions.to}`,
          params.cc ? `CC: ${mailOptions.cc}` : null,
          params.bcc ? `BCC: ${mailOptions.bcc}` : null,
          `Betreff: ${params.subject}`,
          `Message-ID: ${info.messageId}`,
        ].filter(Boolean).join("\n"),
      }],
    };
  }
);

// --- Verify Connection ---
server.tool(
  "email_verify",
  "Test the SMTP connection. Returns success if credentials and server are working.",
  {},
  async () => {
    const transporter = getTransporter();
    await transporter.verify();
    return {
      content: [{
        type: "text",
        text: `SMTP-Verbindung erfolgreich!\nServer: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 465}\nUser: ${process.env.SMTP_USER}`,
      }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
