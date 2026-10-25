# Notices

[🇻🇳 Tiếng Việt](NOTICE.md) &bull; 🇬🇧 English

## The code is MIT. The data is not ours to license.

[LICENSE](LICENSE) covers the code in this repository and nothing else. OpenAlpha ships **no
market data**: it reads from each provider at run time, on your machine, under your own network
identity, and stores the result in your own database. This repository redistributes no quotes, no
bars, no fundamentals, no news and no vendor gold board.

That matters because the data belongs to the people who publish it, and their terms are between
**you** and **them**. A permissive licence on an HTTP client grants you nothing about the service
it calls.

## What you are agreeing to when you run it

Before you point OpenAlpha at a provider, especially in anything beyond personal research:

- **Read that provider's terms.** Several of these are endpoints a broker or an exchange publishes
  for its own web and mobile clients rather than as a documented public API. Reading one is not the
  same as being licensed to read it, and no rate limit in this code is a permission.
- **Redistribution is a separate question.** Storing a provider's data locally is not the same as
  republishing it, forwarding it to your users, or feeding it to a service you sell.
- **Credentials are yours.** Where a provider issues a key, it is issued to you under their terms.
  This project never ships one and never transmits one anywhere but to that provider.
- **Attribution may be required.** Some providers require visible attribution for displayed data.
  OpenAlpha prints the source id on every reading so you can see which provider answered, but
  satisfying an attribution clause is yours to do.

Outbound requests carry a common browser user-agent by default (`BROWSER_HEADERS`) so that a
provider's bot management does not fingerprint a client that declares nothing. That is a
compatibility default, not a claim of authorisation, and it does not change whose terms apply.

## Providers this project can read

34 adapters under [`src/trading/sources/adapters/`](src/trading/sources/adapters/), reaching these
hosts. None is enabled by reading this list: a market's routes decide what is asked, and a
key-required provider that has no credential is never registered at all.

**Vietnam equities and indices** - `api-finfo.vndirect.com.vn`, `iq.vietcap.com.vn`,
`trading.vietcap.com.vn`, `services.entrade.com.vn`, `histdatafeed.vps.com.vn`,
`iboard-query.ssi.com.vn`, `kbbuddywts.kbsec.com.vn`, `api.hsx.vn`, `cafef.vn`

**Vietnam macro and gold** - `sbv.gov.vn`, `www.nso.gov.vn`, `edge-api.pnj.io`, `giavang.now`,
`vang.today`

**Crypto** - `www.okx.com`, `api.binance.com`, `fapi.binance.com`, `api.bybit.com`,
`api.mexc.com`, `api.exchange.coinbase.com`, `api.coingecko.com`, `pro-api.coinmarketcap.com`,
`api.coinlore.net`, `api.coinpaprika.com`, `api.alternative.me`

**US macro, rates and futures positioning** - `fred.stlouisfed.org`, `api.stlouisfed.org`,
`api.bls.gov`, `home.treasury.gov`, `www.federalreserve.gov`, `publicreporting.cftc.gov`

**Prices, FX and news** - `query1.finance.yahoo.com`, `open.er-api.com`, `news.google.com`,
`www.cnbc.com`, `www.coindesk.com`, `vnexpress.net`

Endpoints are code-owned by design: no configuration can redirect a request to a different host.
See [docs/en/data-sources.md](docs/en/data-sources.md) for the routing and failover rules, and
[docs/nguon-du-lieu.md](docs/nguon-du-lieu.md) in Vietnamese.

## Model providers

OpenAlpha calls whichever model provider you configure, with your key, under their terms. Nothing
is sent to any model provider by default, and no install calls one until you configure it. What
reaches a model is bounded on purpose: the prompts never carry your amounts, costs, quantities,
realised returns or fill prices. See [docs/en/budgets.md](docs/en/budgets.md).

## Credit the providers ask for

OpenAlpha is not affiliated with, endorsed or certified by any provider named here, and every name
belongs to its owner. Each reading the app prints names the provider that answered it. Where a
provider's terms ask for a line of credit, this is that line:

- **FRED** - This product uses the FRED® API but is not endorsed or certified by the Federal
  Reserve Bank of St. Louis. Some FRED series belong to third parties and carry their own terms;
  check a series' notes before reusing it.
- **BLS** - BLS.gov cannot vouch for the data or analyses derived from these data after the data
  have been retrieved from BLS.gov.
- **Federal Reserve Board** - source: Board of Governors of the Federal Reserve System.
- **CoinGecko** - Powered by CoinGecko (https://www.coingecko.com/en/api).
- **ExchangeRate-API** - Rates By Exchange Rate API (https://www.exchangerate-api.com).
- **alternative.me** - Crypto Fear & Greed Index data from alternative.me.
- **General Statistics Office of Vietnam** - source: www.nso.gov.vn.
- **VnExpress** - headlines from the VnExpress RSS feeds, which VnExpress offers free to
  individuals and non-profits.
- **Yahoo** - Yahoo! and Yahoo! Finance are trademarks of Yahoo, Inc. OpenAlpha is not affiliated
  with Yahoo and reads its public chart endpoint for personal research only.

## Name and logo are not licensed

The MIT licence covers the code, not the brand. The name "OpenAlpha", the α logo on its gradient
tile and the Bé Alpha character belong to the project, and [LICENSE](LICENSE) grants no right to
use them.

- You may fork, change and redistribute the code under MIT, commercially too.
- A fork or a product built from this code should carry its own name and logo, so nobody takes it
  for OpenAlpha.
- Saying "based on OpenAlpha" or "works with OpenAlpha" to describe where it came from is fine.

## Third-party code

Runtime dependencies, all permissive: `@modelcontextprotocol/sdk`, `pg`, `pino`, `turndown`,
`zca-js` and `zod` under MIT, `smol-toml` under BSD-3-Clause. Their own notices travel with them in
`node_modules`. `scripts/check-dep-licenses.ts` fails the build if a copyleft licence enters the
tree, so the MIT the README promises stays true for anyone who embeds this runtime.

`zca-js` is an unofficial Zalo client. The Zalo Personal channel is opt-in, is not an official
integration, and using it is between you and Zalo.

A few line icons on the office page are hand-copied from [Lucide](https://lucide.dev), under the
ISC licence:

> ISC License. Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of
> Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
>
> Permission to use, copy, modify, and/or distribute this software for any purpose with or without
> fee is hereby granted, provided that the above copyright notice and this permission notice appear
> in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
> SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
> AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
> WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
> NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
> THIS SOFTWARE.

## Not financial advice

OpenAlpha is a research and bookkeeping assistant. Its suggestions are educational, can be wrong,
and are not financial advice. It places an order only when you approve one. You own every decision.
