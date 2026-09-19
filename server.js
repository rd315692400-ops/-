import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 10000;
const API = "https://api.open-finance.ai";

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });

  res.end(
    type.startsWith("application/json")
      ? JSON.stringify(data)
      : data
  );
}

async function token() {
  const {
    OPEN_FINANCE_CLIENT_ID,
    OPEN_FINANCE_CLIENT_SECRET,
    OPEN_FINANCE_USER_ID
  } = process.env;

  if (
    !OPEN_FINANCE_CLIENT_ID ||
    !OPEN_FINANCE_CLIENT_SECRET ||
    !OPEN_FINANCE_USER_ID
  ) {
    throw new Error("Missing Open Finance environment variables");
  }

  const r = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      userId: OPEN_FINANCE_USER_ID,
      clientId: OPEN_FINANCE_CLIENT_ID,
      clientSecret: OPEN_FINANCE_CLIENT_SECRET
    })
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok || !data.accessToken) {
    throw new Error(
      `Open Finance authentication failed (${r.status})`
    );
  }

  return data.accessToken;
}

async function openFinanceGet(endpoint, params = {}) {
  const accessToken = await token();

  const u = new URL(`${API}${endpoint}`);

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      u.searchParams.set(k, v);
    }
  }

  const r = await fetch(u, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw new Error(
      `Open Finance request failed (${r.status})`
    );
  }

  return data;
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(
      req.url,
      `http://${req.headers.host}`
    );

    // בדיקת שרת
    if (u.pathname === "/api/health") {
      return send(res, 200, {
        ok: true
      });
    }

    // חשבונות
    if (u.pathname === "/api/accounts") {
      const data = await openFinanceGet(
        "/v2/data/accounts",
        {
          limit: u.searchParams.get("limit") || 100
        }
      );

      return send(res, 200, data);
    }

    // תנועות
    if (u.pathname === "/api/transactions") {
      const params = {
        dateFrom: u.searchParams.get("dateFrom"),
        dateTo: u.searchParams.get("dateTo"),
        accountId: u.searchParams.get("accountId"),
        sort: u.searchParams.get("sort") || -1,
        includeDuplicates: 0
      };

      // אם לא נשלח טווח תאריכים
      if (!params.dateFrom && !params.dateTo) {
        params.limit =
          u.searchParams.get("limit") || 100;
      }

      const data = await openFinanceGet(
        "/v2/data/transactions",
        params
      );

      return send(res, 200, data);
    }

    // קבצי האפליקציה
    const file =
      u.pathname === "/"
        ? "index.html"
        : u.pathname.slice(1);

    const safe = path
      .normalize(file)
      .replace(/^(\.\.(\/|\\|$))+/, "");

    const full = path.join(__dirname, safe);

    if (
      fs.existsSync(full) &&
      fs.statSync(full).isFile()
    ) {
      const ext = path.extname(full);

      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8"
      };

      return send(
        res,
        200,
        fs.readFileSync(full),
        types[ext] || "application/octet-stream"
      );
    }

    send(res, 404, {
      error: "Not found"
    });

  } catch (e) {
    console.error(e);

    send(res, 500, {
      error: e.message || "Server error"
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Financial Manager API listening on ${PORT}`
  );
});
