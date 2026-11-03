# The web version

The web version is OpenAlpha running in a tab of your browser. Open the page and use it, no account. When you want an analysis, add an AI key of your own. Your ledger, portfolio, keys and results stay on your device.

> The web version is in testing and has no public address yet. This page describes how it works once it opens to everyone.

It is an analysis tool for your own use. Each analysis sets two sides next to each other and ends with no conclusion, and no name is ranked or marked good or bad. The decision stays yours. It is also a way to see what OpenAlpha does with your own names before you install the full version; [Web against installed](#web-against-installed) says where the two differ and why.

## Getting started

1. **Open the page** in a recent browser: Chrome, Edge, Firefox or Safari. The page must keep your data on your device (it needs private file storage and a lock between tabs). A browser that cannot do that gets a plain message instead of a half-working page. Saving straight to a file on your computer exists only in Chrome and Edge.
2. **Use it with no key.** Prices and markets, the screen, the watchlist, the ledger, the portfolio, rebalance and `/brief` run with no key and no account. The first time you open the page it loads price history in the background. The factor board is incomplete until that finishes and says so; everything else works meanwhile.
3. **Add an AI key** when you want an analysis: Settings, "AI and search keys". Create a key just for this, with a spend limit set at the provider, so every call stays within an amount you chose. OpenRouter is the easiest start: one key reaches most models, and "Connect OpenRouter" signs you in there, so you paste nothing and can revoke the key at OpenRouter. Pasting a key works for every provider. Before the first send to each provider, the page says what would be sent and asks you to agree for that provider; until you agree, nothing is sent.
4. **Record a trade.** You place the order at your broker or exchange as usual, then record it so the ledger stays true:

   ```
   /record deposit vps 100000000 VND 2026-11-03
   /record buy FPT 100 62000
   /portfolio
   ```

   Change the ticker, quantity and price to your own trade; the lines only show how to type it. If the page does not know a ticker, type `/refresh equity-vn` and try again, or name the market: `equity-vn:FPT`. `/transactions` lists the ledger; `/update <handle> buy FPT 100 61500` (the corrected line without the `/record` word) and `/delete <handle>` edit or remove a row by the handle `/transactions` prints, and `/delete` asks you to confirm.
5. **Run an analysis.** `/suggest FPT` sets a bull case and a bear case side by side on the same evidence, with the claims the data refutes and what would make each side wrong. Both sides use the same evidence, so read them side by side and do not count which has more points. You can press Stop during a run; a run that has not finished stores nothing. Every result states the data date and the AI model, and carries an "AI-generated" label that stays with the record when you save or export it. **The analysis is AI-generated, can be wrong and is not investment advice. Investing always carries risk, including losing capital.**
6. **Save your data to a file.** A browser can delete a site's data when the device is short of space, and your ledger cannot be fetched again. See [where your data lives](#where-your-data-lives).

## Which keys unlock what

| You have | You can run |
|---|---|
| No key | Prices and markets, the screen, the watchlist, the ledger, the portfolio and its value over time, rebalance (the gap to your targets), the brief while the page is open (`/brief`), export and open |
| An AI key: OpenRouter, OpenAI, DeepSeek, Anthropic, Google Gemini, xAI or Mistral | `/suggest` (bull and bear analysis) |
| An AI key and a search key: Tavily, Serper or DeepSeek | `/research` |
| A key from another provider (Brave, Exa, any other AI provider), an exchange key, a ChatGPT plan sign-in | Installed version only |

Why the short list: a provider can be used from a web page only if its API answers a browser (it has to allow the page to call it). The providers above do. Others do not, so they work in the installed version only. OpenRouter reaches most models with one key, so it is the place to start. DeepSeek's search key is a different key from its AI key.

A feature that needs a key you have not added does not run until you paste that key in Settings. The web version accepts no exchange key of any kind, even read-only; you place orders at your broker or exchange.

## Web against installed

Each row below is one job. "Why the web version stops short" gives the reason for each gap. The page shows the same rows under "Web and installed versions", each reason as a line under its row, and the "Installed version" column is the one-line hint it shows where the web version stops.

| Job | Web version | Installed version | Why the web version stops short |
|---|---|---|---|
| Markets and prices <!--id:market-prices--> | **Partly.** VN stocks, crypto and VN gold, read straight from public sources in your browser (`/market`, `/overview`, `/price`, `/refresh`). | The installed version adds US stocks, world gold and more fallback sources. | A browser can only read sources that let a web page call them directly; US stocks and world gold prices are not on the web version yet. |
| Screen and factors <!--id:screen-factors--> | **Partly.** The board lists each name with the value and the percentile of every factor, computed in your browser. You choose the sort: there is no default order, no overall score and no "best" label. The board says which factors are missing. | The installed version scores every factor for the whole board, including financial statements, the warning list and index membership. | Financial statements of VN stocks are in the installed version only, because the source does not let a browser read it directly; the factors built on them are missing on the web. |
| Watchlist <!--id:watchlist--> | **Yes.** Follow the prices of names you pick (`/watchlist add`, `/watchlist`). | Same as the web version. | - |
| Ledger <!--id:ledger--> | **Partly.** Record deposits, buys, sells, dividends, fees, and edit or delete any row (`/record`, `/update`, `/delete`, `/transactions`) for VN stocks, crypto and VN gold. You type the fill figures from your broker or exchange. | The installed version also has US stocks, and reads fill figures from a connected exchange when you give it a key. | US stocks are not on the web version yet, and the web version takes no exchange keys, so it cannot read fills from an exchange. |
| Portfolio and NAV <!--id:portfolio-nav--> | **Yes.** Value, the weight of each segment, and your book value over time (`/portfolio`, `/portfolio nav`, `/profile`), computed from your ledger and the prices already loaded. The value history is kept for the default history window; older points are gone. | Same as the web version. | - |
| Rebalance <!--id:rebalance--> | **Partly.** Shows how far each segment and each name you hold sits from the targets you set, in weight and in value. It gives no buy or sell instruction and no reason (`/rebalance`). | The installed version lays out steps toward your targets; you decide whether to act. | The web version only does the arithmetic of the gap to the targets you set and says nothing about what to do. |
| Bull and bear analysis <!--id:analysis--> | **Needs an AI key.** Two sides argue from the same evidence, with the claims the data refutes and what would make each side wrong. No conclusion (`/suggest <ticker>`). | The installed version runs the full debate (see the next row). | The analysis runs on an AI model through your own key (OpenRouter, OpenAI, DeepSeek, Anthropic, Google Gemini, xAI or Mistral); without a key it does not run. |
| Scope of the analysis <!--id:verdict-levels--> | **Partly.** Each analysis puts two arguments side by side for you to weigh yourself, with no conclusion for any name. | The installed version goes further than the web analysis; the details are in the installed version's guide. | The web edition gives you both sides to weigh yourself. |
| Brief while the page is open <!--id:brief-open--> | **Yes.** A market brief plus a summary of your own book, built from the data already loaded when you ask while the page is open (`/brief`). It needs no AI key, and no part of it states a direction for any single name. | The installed version builds the brief at the time you choose and sends it to you. | - |
| Scheduled brief by Telegram or Zalo <!--id:brief-schedule--> | **Installed version only.** | The installed version sends the brief by Telegram or Zalo at the time you choose, even when you have nothing open. | A browser does not run when you close the tab, so a brief at a set time exists only in the installed version. |
| Alerts <!--id:alerts--> | **Installed version only.** | The installed version watches prices even when you have nothing open and sends alerts by Telegram or Zalo. | An alert has to keep watching, and a browser stops running when you close the tab. |
| Research with sources <!--id:research--> | **Needs an AI key and a search key.** One question researched within limits, with cited sources, running in your browser (`/research <question>`). | The installed version also uses the Brave and Exa search tools. | It needs both an AI key and a search key (Tavily, Serper or DeepSeek); without either it cannot run. |
| Themes <!--id:themes--> | **Installed version only.** | The installed version follows the themes you set and runs them again when you ask (`/themes`). | The first web version has no themes; the installed version has them in full. |
| Track record <!--id:track-record--> | **Installed version only.** | The installed version checks each past call against what the price did afterwards (`/reflect`). | The web version stores no past call to score, so there is nothing to check. |
| Venue sync and orders <!--id:venue-orders--> | **Installed version only.** You place the order at your broker or exchange, then record it in the ledger. | The installed version syncs trades from the exchange you connect and places an order only when you approve it. | The web version accepts no exchange key of any kind, even read-only, so it does not sync trades and does not place orders. |
| Use your ChatGPT plan <!--id:chatgpt-plan--> | **Installed version only.** | Use your ChatGPT plan: it is in the installed version. | The ChatGPT model server does not let a web page call it directly, so signing in with a ChatGPT plan works only in the installed version. |
| Chat with tools <!--id:chat-tools--> | **Installed version only.** | The installed version lets you chat and lets the assistant call tools such as prices, the ledger and research. | The first web version has no chat with tools; the installed version does. |
| MCP <!--id:mcp--> | **Installed version only.** | The installed version runs as an MCP server so your other AI apps can use the OpenAlpha tools. | MCP is a server that runs on your machine so other apps can connect to it; a web page cannot open a port for anyone to connect to. |
| Model tiers <!--id:model-tiers--> | **Partly.** You can edit four tiers: two-sided analysis, research, deep research, and reading and extracting figures, with OpenRouter, OpenAI, DeepSeek, Anthropic, Google Gemini, xAI or Mistral. Settings are stored in the browser; after a change the page asks you and then restarts the worker. | The installed version edits every model tier and every provider in the config file. | The web version can only call providers that let a web page call them directly, and has no tiers for headline reading, themes or delegation. |
| Data sources <!--id:data-sources--> | **Partly.** The web version reads the sources that answer a browser: VN stocks, VN gold, crypto, some macro series and news from CNBC. Not on the web version: VN financial statements, the warning and control list, SBV policy rates, FRED series (dollar, VIX), US stocks, world gold, VN30 and VN100 membership (when the source does not answer), and most news feeds. | The installed version reads all of those sources, with fallbacks when one fails. | Many sources do not let a browser call them directly, or need headers a browser cannot set; wherever something is missing, the screen says what. |
| Where data lives <!--id:where-data-lives--> | **Partly.** In this browser, in the site storage. You can also keep a copy in a file (Chrome, Edge) or export a file at any time. | On your machine, in the data folder, with a daily backup. | A browser can delete a site's data when the device is short of space, and Safari deletes it after 7 days without a visit unless you add the page to the Home Screen. Prices can be fetched again, the ledger cannot, so save a file. |
| Cost <!--id:cost--> | **Partly.** The operator charges you nothing. The only cost is the AI and search calls, billed to your own key at the provider; create a dedicated key with a spend limit. The cost chip at the top of the page shows what the page estimates you used today. | The installed version shows the cost of each run and has optional daily, monthly and per-run spend limits. | The page has a daily spend limit of its own to stop a run getting out of hand, but it counts at list prices so it is only an estimate; the real limit is the one you set on your key at the provider. |

## Where your data lives

- **The working database** sits in this browser's private storage for the page, with the same structure as the installed version's. The operator does not receive, store or see it. The page is served as static files; the operator keeps Workers Logs, Logpush and web analytics off and reads no logs, and what Cloudflare does with a request follows its own policy, linked from the privacy page in the web version.
- **What leaves your browser.** Reads of public sources (prices, news, macro figures) go from your browser straight to those sources and carry no amounts. When you use an AI feature, the browser sends the content straight to the provider you chose, with your key. Your amounts, cost basis, quantities, fill prices and AI spend are never sent to a model. `/brief` makes no model call. The privacy page in the web version lists what each feature sends.
- **Keys** live in the tab's memory by default and are gone when you close the tab. "Remember on this device" is off by default; turn it on and the key is kept in the browser's storage on this device. A key is never in the exported database. "Delete key" removes one provider's key together with your agreement to send to that provider. A key change applies from the next request, including the later requests of a run already going.
- **Save to a file** (Chrome and Edge): in Settings, "Data on this device", "Save to a file on this computer", and pick a file. After each time you record something, and when you leave the tab, the page writes a full copy to that file through a temporary file that then replaces it, so closing the tab midway never breaks the file. Chrome may ask for write permission again on each visit; without it the page shows "Continue saving to the file" and never opens a popup by itself. Firefox and Safari have no such option; use "Export to a file".
- **Export and open.** "Export to a file" downloads a full copy: ledger, portfolio, saved analyses and settings, never keys. "Open a file" loads a file the web version saved, from another computer or browser, and replaces the data here after you confirm. A file from the installed version cannot be opened in the web version yet; the page says so and changes nothing.
- **A browser may delete a site's data** when the device is short of space. The page asks the browser to keep it, which is not guaranteed; Settings says whether the browser agreed. Safari also deletes a site's data after 7 days without a visit unless you add the page to the Home Screen. Prices can be fetched again; the ledger cannot, so save to a file or export regularly. When the device is full the page says so, stops writing and keeps what it has; free some space or export, then reload.
- **How long things are kept.** The page tidies what it can fetch or rebuild again by the same windows as the installed version's [`[retention]`](configuration.md#retention): finished runs and notices, older chat sessions, saved briefs past the newest, and records of past model calls. Never tidied away: ledger rows, your profile and targets, saved analyses and settings. Your portfolio value over time follows the history window (`history_days`, three years by default); older points are gone and cannot be fetched back.
- **Two tabs at once.** Only one tab writes to the data. The second tab asks whether to use that tab instead ("Use in this tab"); the tab that was displaced says it was taken over and stops.
- **"Data as of ..."** is the time of the newest data held in the browser, not the current time. The page loads more when you open it, on a schedule while it stays open, and when you type `/refresh`. Offline, the stored part still reads and the page says it could not fetch anything new.
- **Deleting.** "Delete all data on this device", in Settings, removes the stored database, keys, your agreements, the remembered file and settings after you confirm. It cannot be undone, so export first if you want to keep anything.

## Moving to the installed version

The installed version restores the database you export, so everything you recorded comes with you. Keys do not: they are never in the file.

1. In Settings, "Data on this device", press "Export to move" and keep the file.
2. Install OpenAlpha following the [install guide](../../README.md). The installed release must be the same as the web version's or newer: a file carrying migrations the installed version does not know is refused when it starts.
3. If the installed version's background service is running, stop it: `openalpha stop`.
4. Load the file: `openalpha db restore <path to the file>`. The command checks that the file is a sound SQLite database, asks for confirmation, and keeps the database it replaces under `backups/` in the data folder ([storage guide](storage.md#sqlite-backup-and-restore)).

The other direction is not there yet: the web version cannot open an installed version's file.

## Sources missing in v1

The web version can only read sources that let a browser call them directly. Wherever something is missing, the screen says what and never counts it as zero.

| Missing | Effect |
|---|---|
| The exchanges' warning and control list | A name's warning flag does not show |
| State Bank of Vietnam policy rates | The VN macro block lacks this item |
| FRED series (dollar index, VIX) | The US macro block lacks those items |
| US stocks | No price, screen or ledger for US stocks |
| World gold | No world gold price; domestic gold still works |
| VN30 and VN100 membership | The one source a browser can read publishes a list the app refuses for now, so the factor board does not know which basket a name is in |
| Yearly financial statements of VN stocks | Factors built on them are missing on the web board; the board says which |
| Most news feeds | News from VNDIRECT (VN stocks) and CNBC (economy, US markets) remains |

A source may change or block browsers at any time; the feature that needs it then pauses and the page says so. The installed version reads all of the above, with fallbacks when one fails.

## Limits to keep in mind

- The web version analyses; each analysis ends with a line saying how it differs from the installed version, never with a conclusion about a name.
- Every analysis and research report is AI-generated and labelled as such with the model's name. The label travels with the record when it is stored and when it is exported.
- The web version runs while the page is open. A brief at a set time, price alerts and anything that must run while the tab is closed exist only in the installed version.
- Analysis can be wrong and is not investment advice. Investing always carries risk, including losing capital.
