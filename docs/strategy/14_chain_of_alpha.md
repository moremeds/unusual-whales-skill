# Chain-of-Alpha (LLM Alpha Mining) (Deferred)

## Status: Research Only

## Why Deferred

Chain-of-Alpha uses LLMs to auto-generate and screen formulaic alpha factors from price/volume data. While conceptually interesting, it is a research-stage approach with no proven production implementations. The multiple-testing problem is severe — generating thousands of candidate factors and selecting the best ones is a textbook recipe for overfitting without extremely careful validation governance.

## The Idea

Feed an LLM a library of price/volume operators (rank, ts_mean, ts_std, etc.) and have it propose, evaluate, and refine alpha formulas through iterative prompting. The LLM acts as a creative search engine over the space of possible technical indicators, with backtest metrics as feedback.

## Partial Relevance

Could theoretically discover novel technical patterns for swing trading — combinations of indicators that a human researcher would not think to test. However, the risk of finding spurious patterns that look great in-sample but fail live is extremely high without strict anti-leakage controls, CPCV-style robustness checks, and frozen holdout datasets.

## What Would Be Needed

- Alpha-research governance layer (experiment registry, frozen datasets)
- Anti-leakage and complexity controls
- Walk-forward validation with turnover and capacity penalties
- Economic interpretability requirement before any factor enters production

## Verdict

Research only. Monitor the academic papers. Do not build infrastructure for this until the evidence base matures. The user's time is better spent refining existing technical strategies than chasing auto-generated factors.

---

## Original Paper Benchmark (Verified)

- Note: This section is the authoritative paper-backed benchmark reference for this strategy; do not use unsourced heuristic ranges as paper benchmarks.

- Paper: *Chain of Alpha* (Qiao et al., 2025 preprint).
- Sample: Chinese A-share equities in the paper's benchmark environment.
- Methodology: LLM-guided chain framework to generate and evaluate alpha formulas.
- Reported result: The authors report outperformance versus baseline methods across their benchmark metrics.
- Benchmark caveat: No independently audited live-trading Sharpe/net-of-cost production benchmark is reported in the original paper.

### Inline Suggestions

- Keep deferred until an external replication confirms out-of-sample and cost-adjusted stability.
- Require frozen holdout and experiment-registry controls before any implementation work.
- Treat this as research tooling, not a production signal source.

### Sources

- https://www.emergentmind.com/papers/2507.18243
