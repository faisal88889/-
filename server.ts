import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Database from "better-sqlite3";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Database Setup
const db = new Database("mawthooq.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    subscription_plan TEXT DEFAULT 'Basic',
    usage_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS verification_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    document_type TEXT,
    status TEXT,
    FOREIGN KEY (company_id) REFERENCES companies(id)
  );
`);

// Seed a demo company if none exists
const seedCompany = db.prepare("SELECT * FROM companies LIMIT 1").get();
if (!seedCompany) {
  db.prepare("INSERT INTO companies (name, api_key) VALUES (?, ?)").run("Demo Hotel", "mawthooq_test_key_123");
}

app.use(express.json());

app.post("/api/log-verification", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  const { documentType, status } = req.body;

  if (!apiKey) {
    return res.status(401).json({ error: "API Key is required" });
  }

  const company = db.prepare("SELECT * FROM companies WHERE api_key = ?").get(apiKey) as any;
  if (!company) {
    return res.status(403).json({ error: "Invalid API Key" });
  }

  try {
    // Update usage count and log
    db.prepare("UPDATE companies SET usage_count = usage_count + 1 WHERE id = ?").run(company.id);
    db.prepare("INSERT INTO verification_logs (company_id, document_type, status) VALUES (?, ?, ?)").run(
      company.id,
      documentType || "Unknown",
      status || "Processed"
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to log verification" });
  }
});

// Remove the old /api/verify-document endpoint

// Admin endpoint to get company info (for the demo UI)
app.get("/api/company-info", (req, res) => {
  const apiKey = req.query.apiKey;
  if (!apiKey) return res.status(400).json({ error: "API Key required" });
  
  const company = db.prepare("SELECT name, subscription_plan, usage_count FROM companies WHERE api_key = ?").get(apiKey);
  if (!company) return res.status(404).json({ error: "Company not found" });
  
  res.json(company);
});

// Vite Integration
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
