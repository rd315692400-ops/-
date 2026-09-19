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

function numericValue(v, depth = 0) {
  if (depth > 6 || v === null || v === undefined) {
    return null;
  }

  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }

  if (typeof v === "string") {
    const cleaned = v
      .replace(/,/g, "")
      .replace(/[^\d.-]/g, "");

    if (cleaned === "") return null;

    const n = Number(cleaned);

    return Number.isFinite(n) ? n : null;
  }

  if (typeof v === "object") {
    const keys = [
      "amount",
      "value",
      "balanceAmount",
      "availableBalance",
      "currentBalance",
      "balance"
    ];

    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(v, key)) {
        const n = numericValue(v[key], depth + 1);

        if (n !== null) {
          return n;
        }
      }
    }
  }

  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(
      req.url,
      `http://${req.headers.host}`
    );

    // HEALTH
    if (u.pathname === "/api/health") {
      return send(res, 200, {
        ok: true
      });
    }

    // ACCOUNTS
    if (u.pathname === "/api/accounts") {
      const data = await openFinanceGet(
        "/v2/data/accounts",
        {
          limit: u.searchParams.get("limit") || 100
        }
      );

      return send(res, 200, data);
    }

    // TRANSACTIONS
    // לא משנים את החלק הזה
    if (u.pathname === "/api/transactions") {
      const params = {
        dateFrom: u.searchParams.get("dateFrom"),
        dateTo: u.searchParams.get("dateTo"),
        accountId: u.searchParams.get("accountId"),
        sort: u.searchParams.get("sort") || -1,
        includeDuplicates: 0
      };

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

    // BALANCE DIAGNOSTIC
    if (u.pathname === "/api/account-balance") {
      const data = await openFinanceGet(
        "/v2/data/accounts",
        {
          limit: 100
        }
      );

      const fields = [];

      function walk(value, pathParts = [], depth = 0) {
        if (
          depth > 12 ||
          value === null ||
          value === undefined
        ) {
          return;
        }

        if (Array.isArray(value)) {
          value.forEach((item, index) => {
            walk(
              item,
              [...pathParts, `[${index}]`],
              depth + 1
            );
          });

          return;
        }

        if (typeof value !== "object") {
          return;
        }

        for (const [key, child] of Object.entries(value)) {
          const nextPath = [...pathParts, key];
          const lower = key.toLowerCase();

          const relevant =
            lower.includes("balance") ||
            lower.includes("available") ||
            lower.includes("current") ||
            lower.includes("booked") ||
            lower.includes("interim") ||
            lower.includes("credit") ||
            lower.includes("funds");

          if (relevant) {
            const n = numericValue(child);

            if (n !== null) {
              fields.push({
                field: nextPath.join("."),
                value: n
              });
            } else if (
              typeof child === "string" ||
              typeof child === "boolean"
            ) {
              fields.push({
                field: nextPath.join("."),
                type: String(child)
              });
            }
          }

          walk(
            child,
            nextPath,
            depth + 1
          );
        }
      }

      walk(data);

      return send(res, 200, {
        balanceFields: fields
      });
    }

    // STATIC FILES
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
        ".json": "application/json; charset=utf-8",
        ".webmanifest": "application/manifest+json",
        ".png": "image/png"
      };

      return send(
        res,
        200,
        fs.readFileSync(full),
        types[ext] || "application/octet-stream"
      );
    }

    return send(res, 404, {
      error: "Not found"
    });

  } catch (e) {
    console.error(e);

    return send(res, 500, {
      error: e.message || "Server error"
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Financial Manager API listening on ${PORT}`
  );
});
