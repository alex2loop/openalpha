# Deep research - internals

For contributors. How a research run is built, how evidence is admitted, and where the fixed bounds
come from. What it does for an operator is in [Deep research](../research.md). Where research sits
among the other features: [Internals](internals.md).

## Pipeline

A run is an orchestrator plus four single-purpose workers: `research-planner`, `research-crawler`,
`research-synthesizer` and `research-reviewer` (profiles under `src/engine/agents/`). Each runs as an
isolated child run with temporary storage and no access to another worker's transcript. The stages
are `plan`, `crawl`, `synthesize` and `review`. `/research` runs this through the built-in
`deep-researcher` agent.

```text
/research "question"
  |
  +- planner ................. one question per independent evidence direction
  |
  +- per question, in parallel (bounded by [loop] max_parallel_delegations):
  |    search providers ...... candidate pages          (deterministic code)
  |    fetch and extract ..... page text                (deterministic code)
  |    crawler model ......... claims + verbatim quotes (no tools)
  |    grounding check ....... ungrounded output dropped (deterministic code)
  |
  +- admission and coverage .. surviving claims
  |
  +- synthesizer ............. report over admitted claims only
  |
  +- reviewer ................ approve, or revise -> follow-up questions -> re-crawl
```

Profiles map to internal depths: `quick` is `light`, `standard` is `medium`, `thorough` is `deep`
(`RESEARCH_PROFILE_DEPTHS`). `light` skips the planner and asks one question. A top-level `thorough`
run requires an interactive plan reviewer and is cancelled before spending anything without one.

## Retrieval runs before the model

Every research worker is declared with `tools = []`: none can search, fetch or reach the network.
Retrieval is deterministic code that runs first; the model is invoked afterwards on what it collected.

For each question the pass:

1. Takes the search terms the planner produced.
2. Records each term in the run's subquery ledger before any search starts. A term already used is
   skipped as `duplicate_subquery`; at 42 recorded subqueries the pass stops with a `content_limit`
   gap. The ledger is shared across questions, so the cap covers the whole run.
3. Searches the configured default provider for every surviving term at once, so a question costs about
   one provider timeout. Results are pooled, deduplicated by URL and ranked before anything is read: a
   page whose title or snippet names the question's entities ranks first. A requested freshness window
   demotes a stale page but never drops it, because the date here is only the provider's estimate. The
   best 8 are kept; fewer than two records a `low_recall` gap.
4. Takes exactly one follow-up action, not a loop: reading the discovered pages, or, when the default
   provider failed or returned nothing usable, one attempt at the configured fallback provider.
5. Reads page text. With Exa the reads are batched through its Contents API; with any other provider the
   best 3 pages are fetched directly, all at once. Pages past that limit are a `content_limit` gap.

Page text is stored in shared run state keyed by canonical URL, so two questions landing on one page
read it once. Gathered material is also cached per question, so the crawl retry re-runs the model
without paying for retrieval again.

## The model extracts, the code decides

The crawler prompt holds the question and the fetched material. The model returns flat JSON: claims,
each with sources and character-for-character quotes. It never assigns identifiers: the system creates
every source, excerpt, claim and numeric-link id and wires the references.

These checks run on that output before anything is admitted:

| Check | Failure |
| --- | --- |
| The cited URL is one retrieval actually fetched | `source_not_retrieved` |
| The quote appears verbatim in that page's stored text | `quote_not_in_content` |
| A numeric claim's value, unit and date spans are grounded in its quotes | `numeric_fields_absent` |

The quote check compares normalized text: whitespace and formatting differences pass, wording does
not. A source whose content was never read grounds nothing; search snippets and provider summaries are
for discovery only.

## From branches to a result

Each question yields one evidence branch. Branches fold into one result:

1. **Admission** merges branches, canonicalizes and deduplicates sources, bounds excerpts, and runs the
   prompt-injection scan over source metadata and quote text.
2. **Coverage** merges claims that say the same thing across questions, drops any claim whose support
   did not survive, and raises conflicts for numbers that do not match their quotes.
3. **Disposition** decides whether what remains can be answered at all and trims the evidence to
   128 KiB. Answer-section claims are bounded first so supporting material cannot squeeze out the
   mandatory answer; better-corroborated claims are kept first within each priority tier.
4. **Synthesis** writes the report from surviving claims. The report is only lists of claim ids, with
   no prose of its own.

### Evidence chain and drop reasons

A source is a page, an excerpt a verbatim quote, a claim a statement citing one or more excerpts. A
claim is `factual`, `numeric` or `inference`. `factual` and `numeric` are extractive and must cite
excerpts; `numeric` also carries literal value, unit and date spans that must appear verbatim in the
cited excerpt. `inference` is the model's own reasoning and is labelled as such. `forecast: true`
marks a claim whose source states an expectation, projection, price target, estimate or guidance; a
forecast never merges with the outcome it anticipates, and two disagreeing forecasts never raise a
`factual_contradiction`.

A source or excerpt is dropped when:

| Reason | Gap code |
| --- | --- |
| URL does not canonicalize to `https:` | `validation` |
| Title, publisher or author text trips the injection scan | `unsafe_content` |
| Excerpt text trips the injection scan | `unsafe_content` |
| Excerpt cites a source that was never admitted | `unresolved_reference` |
| The same reference is used twice in one branch | `duplicate_reference` |
| Excerpt was cut to 4,000 characters | `truncation` |
| Source exceeded 8 excerpts | `content_limit` |
| Publication date outside a requested freshness window | `freshness_out_of_window` |
| Publication date missing or low-confidence | `freshness_uncertain` |
| Evidence trimmed to fit 128 KiB | `artifact_limit` |

Duplicate URLs and byte-identical quotes are deduplicated silently. URLs canonicalize before
comparison: fragment stripped, host lowercased, default port and trailing slash removed, query
parameters sorted.

Freshness does not delete a source on a weak signal. A date outside the window is rejected only when it
is high-confidence. Dates come from two independent signals: the search provider's metadata (an
estimate) and the page's own markup (JSON-LD, published-time metas, a dated `<time>` tag). If they
agree, the date is high-confidence. If they disagree, the page's date is recorded at low confidence,
which admits the source with a penalty. A page-only date is a medium-confidence extraction.

### Coverage rules

- A `factual` claim survives if at least one cited excerpt is still admitted and its source is live;
  otherwise it is dropped with `missing_support`.
- A `numeric` claim survives only where its value, unit and date text appear verbatim in the cited
  excerpt. If links exist and none match, it is dropped and a `numeric_mismatch` conflict is raised; if
  some match, it is kept restricted to the matching evidence.
- An `inference` claim survives if it still cites at least one excerpt.

A `factual_contradiction` is raised when two admitted numeric claims state the same measure (same
unit, scope, effective day) with values that differ by more than rounding. Units are compared, never
converted, so figures in different units are skipped. Every claim handed back to the calling agent
carries `independentSources`, derived at that boundary from the evidence graph: distinct publishing
hosts, with byte-identical text counted once.

## Review loop

The reviewer scores six dimensions (`factualSupport`, `citationAccuracy`, `completeness`,
`sourceQuality`, `relevance`, `clarity`). Approval needs every dimension at or above 0.4, a composite at
or above 0.7, no unsupported claims and no outstanding issues; anything short is a revision.

A revision turns the reviewer's issues into follow-up questions and re-crawls only those. The reviewer
also sees how many independent publishers stand behind each claim and may spend one follow-up per
review corroborating a single-source answer claim. A follow-up retrieves fresh material instead of
reusing the cache.

It re-synthesizes only when the evidence changed or a non-research correction is outstanding. A revision
that produces neither is stalled and ends the loop at once. The loop also ends at the round limit, and
the result is then `completed_with_gaps`.

## Retries and fallback

Each question gets at most two crawl attempts. The second replays the first failure's validation detail
to the model as a correction and reuses the cached retrieval material. Terminal failures (cancellation,
budget or capacity exhaustion, loop detection, model incompatibility) are never retried.

If every planned question fails and every failure is retryable, the run falls back to a single
exact-query search on the original wording, preferring official sources. Fallback results are
`completed_with_gaps`, carry evidence level `limited` and skip review. Recovery from a failed
synthesis uses a deterministic section-pick report and records a `synthesis_recovery` gap.

## Capacity and budget

Research reserves its delegated calls up front. If the requested depth needs more than the turn has
left, it fails at once with `capacity_exhausted`. It reserves 85% of the turn's remaining budget
(`AGENT_BUDGET_FRACTION`) and leaves the rest for the parent turn.

Optional calls draw on what the turn has left beyond that: extra questions, the review rounds a
complex plan earns, a correction retry, a retried question and a review follow-up. The planner's
question limit counts only calls that can still be reserved. When a call cannot be funded, research
skips it and notes the gap instead of failing after the work is spent. A question that finds no
sources spends no call asking the crawler to read them, and its retry searches afresh. Crawl slices
leave 25% of their phase unreserved so a paid search provider's charge has somewhere to land.

## Bounds

Fixed in `RESEARCH_LIMITS` (`src/core/config/resolvers/research.ts`); there is no `[research]` section.
A profile may narrow a bound, never raise it.

| Bound | Value |
| --- | --- |
| Questions | 7 |
| Search terms per question | 3 |
| Search subqueries | 42 (7 x 3 x 3 passes, capped) |
| Review rounds | 2 |
| Review threshold | 0.7 |
| Excerpt size | 4,000 characters, cut at a sentence boundary |
| Excerpts per source | 8 |
| Artifact size | 128 KiB (UTF-8) |
| Direct pages per question | 3 |
| Full text per source | 64 KiB, never enters the result |

Each stage's reasoning effort and output ceiling are fixed and override the worker's `agent.toml`:

| Stage | Reasoning | Max output tokens |
| --- | --- | --- |
| planner | `medium` | 6,000 |
| reviewer | `medium` | 6,000 |
| synthesizer | `low` | 6,000 |
| crawler | `low` | 12,000 |

Thinking tokens count toward the output ceiling, so each stage needs room for its full reasoning plus
the answer, or the provider cuts the reply at `finish=length` before any answer exists. An
adaptive-thinking model does not hold `low` to a fixed budget: on eight Vietnamese pages Claude Haiku
5.5 spent over 4,000 thinking tokens in the crawler alone, which is why its cap is larger.

Schema ceilings (`src/engine/research/contracts.ts`) apply to a single run whatever the configuration:
8 claims per question branch, 3 sources per claim, 8 entries per report section, 12 gaps, 6 review
issues, 64 retrieval attempts, 500-character failure messages and a 20,000-character query. A page
read is capped at 1 MiB before extraction, and search snippets at 400 characters
(`snippetMaxChars` in `core/config/resolvers/web-search.ts`).

## Source map

- Pipeline, stages and depth profiles: [`engine/research/`](../../../src/engine/research)
- Retrieval (search phase, ranking, material, page dates): [`engine/research/retrieval/`](../../../src/engine/research/retrieval)
- Evidence model, admission, coverage, disposition: [`engine/research/evidence/`](../../../src/engine/research/evidence)
- Review loop: [`engine/research/review/`](../../../src/engine/research/review)
- Limits and stage settings: [`core/config/resolvers/research.ts`](../../../src/core/config/resolvers/research.ts)
- Contracts, failure codes, schema ceilings: [`engine/research/contracts.ts`](../../../src/engine/research/contracts.ts)
- The `research` tool: [`tools/research.ts`](../../../src/tools/research.ts)
- Web search and page fetching: [`tools/web/`](../../../src/tools/web)
- Worker profiles: [`engine/agents/research-planner/`](../../../src/engine/agents/research-planner), `research-crawler/`, `research-synthesizer/`, `research-reviewer/`, `deep-researcher/` beside it
