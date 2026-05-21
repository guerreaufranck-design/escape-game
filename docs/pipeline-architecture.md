# Pipeline Architecture — Self-Managing Game Generation

**Status:** Living document
**Last updated:** 2026-05-21
**Owner:** escape-game pipeline team

> The architecture below replaces 3 days of symptom patching with a
> coherent, self-managing system. Every section maps to a Sprint that
> can be shipped independently and yields a measurable reduction in
> crash rate or quality drift.

---

## 1. Failure modes observed (2026-05-15 → 2026-05-21)

| # | Failure mode | Category | Sev | Root cause | Sprint |
|---|---|---|---|---|---|
| 1 | Vercel maxDuration 800s on monolithic step | Orchestration | Critical | Pipeline > 800s on roadtrip 60km | ✅ Sprint 0 (V2 split) |
| 2 | Inngest HTTP timeout ~2m43s | Orchestration | Critical | step.run() exceeds HTTP read window | ✅ Sprint 0 (V3+V4, 5 steps) |
| 3 | Phase 1 Perplexity Deep Research silent failure | Orchestration | Critical | sonar-deep-research 3-5min on roadtrip | ✅ Sprint 0 (V4, phase1a isolated) |
| 4 | Sanity-check thresholds calibrated for walking | Quality | Minor (false flag) | Hardcoded 5/15km on radius_km=60 game | ✅ Sprint 0 (scaled by mode+radius) |
| 5 | **Geocode → narrative offset on roadtrip** | Quality | **Critical (wrong GPS)** | city="Loire Valley" ambigu → Google fail → fallback 350m de startPoint | **Sprint 1.1** |
| 6 | startPoint not persisted | Observability | Minor | Sent in body but never stored | **Sprint 1.2** |
| 7 | OddballTrip city transform lossy | Contract | Cascading | "Chambord" → "Loire Valley, France" | Sprint 1.3 (OddballTrip + defensive) |
| 8 | OddballTrip walking instead of mixed | Contract | Critical | Their `radiusKm: 30` hardcoded | ✅ Fixed OddballTrip side |
| 9 | Translation cache miss FR→FR | Quality | Cosmetic | detectSourceLanguage false-positive | ✅ Earlier patch |
| 10 | Audio cache stale after step reorder | Quality | Critical (audio desync) | Reorder didn't DELETE old audio rows | ✅ Earlier patch |
| 11 | Anthropic streaming requirement | API | Critical | max_tokens > threshold needs stream | ✅ Earlier patch |
| 12 | Validator infinite loop city_tour | Pipeline | Critical | translation_incomplete on wrong schema | ✅ Earlier patch |

**Pattern**: 12 failures cluster into **4 root categories**:

- **A. Orchestration timeouts** (1, 2, 3) — pipeline = N external APIs, variance lognormal, queue tail lourde
- **B. Quality drift silencieuse** (5, 10, 11) — fallbacks accepted without signaling quality loss
- **C. Contract drift OddballTrip ↔ escape-game** (7, 8) — no contract validator at ingress
- **D. Observability blind spots** (6, plus 1+3 in detection) — what's running, where, with what quality?

---

## 2. Three-layer self-managing controller

### Layer 1 — Predictor (pre-flight)

Before invoking the pipeline, **estimate cost/duration probabilistically**:

```
E[phase1a_ms]  =  β₀ + β₁·radius_km + β₂·is_archaeological + β₃·multi_landmark_density + ε
σ[phase1a_ms]  =  γ₀ + γ₁·radius_km                                                       (lognormal tail)
```

Trained on `pipeline_telemetry` rows (already exists in DB). Bayesian
linear regression with hierarchical priors per `transport_mode`.

Decision rule:

```
if P(phase1a > inngest_http_timeout_ms) > 0.20:
  → switch to sonar-pro (faster, slight quality reduction)
  → flag game `needs_review` (human ratifies before activation code release)
  → log to telemetry as "predictor_intervention"
else:
  → proceed with sonar-deep-research as usual
```

Outcome: zero crashes on Phase 1a. Worst case = sonar-pro + human review.

### Layer 2 — Adaptive Executor (during)

Each `step.run()` has **3 guard rails**:

```typescript
const stepBudget = {
  hard_timeout_ms: Math.min(stepMaxBudget, p99_observed_ms * 1.5),
  soft_warn_ms:    p50_observed_ms * 2,    // log + ping admin
  quality_floor:   minQualityScore(stepName),
};
```

Post-step quality gate:

```
quality_score(output) = w_schema·schemaValid + w_coverage·fieldCoverage
                      + w_geo·geoConsistency + w_content·contentDepth

if quality_score < quality_floor:
  → mark step as degraded → trigger recovery strategy (Layer 3)
```

`geoConsistency` for `phase1b`:
- Cross-geocoder check (Mapbox / Nominatim secondary) on each stop
- Divergence > 500m vs primary Google = -0.1 on the geo score per stop
- Stop at NARRATIVE_OFFSET_M exactly from startPoint = -0.3 (signal of geocode failure)

### Layer 3 — Recovery (auto-réparation)

Saga pattern — every step has a typed compensation:

```typescript
type FailureClass = "transient" | "timeout" | "bad_quality" | "contract" | "fatal";

const recovery: Record<FailureClass, Strategy> = {
  transient:   { action: "retry", maxAttempts: 3, backoff: "exponential" },
  timeout:     { action: "retry_with_bigger_budget", multiplier: 1.5, maxAttempts: 2 },
  bad_quality: { action: "fallback_strategy", chain: ["altGeocoder", "skipStop", "manualNarrative"] },
  contract:    { action: "reject_400", notify: "oddballtrip_dev" },
  fatal:       { action: "halt_publish", flag: "needs_review", notify: "operator" },
};
```

Crucially: a `fatal` failure never publishes. We'd rather have a delayed
game than a broken game in the wild.

---

## 3. Self-tuning loop

Weekly cron `cron/recompute-pipeline-thresholds` reads `pipeline_telemetry`
of the last N=200 runs per mode bucket and recomputes:

```
p50, p90, p99 latency per (phase, transport_mode, radius_km_bucket)
quality_score distribution per phase
failure_class frequencies (alert if any class > 5% over 7d)
```

Updates `pipeline_thresholds` table → the executor reads these on next
run → seuils adapt to reality. No human re-tuning.

Math: this is online learning with delayed feedback. We use windowed
EWMA (exponentially weighted moving average) with α = 0.3 to balance
reactivity vs stability. Cold start uses a-priori from manual eyeballing
(documented in `seed_thresholds.json`).

---

## 4. Sprints — implementation roadmap

### Sprint 0 — Already shipped (this session)
- ✅ 5-step Inngest split (1a, 1b, 2a, 2b, 2c)
- ✅ Sanity-check threshold scaled by mode + radius_km
- ✅ Historical photo feature removed

### Sprint 1 — Stop the bleeding (immediate)
- **1.1** Multi-strategy geocode with N=3 fallbacks before narrative mode
- **1.2** Migration `034_persist_start_point.sql` + INSERT pipeline writes lat/lon/text
- **1.3** Zod contract validator at `POST /api/games/generate` ingress + reject 400 on contract drift

### Sprint 2 — Quality gates (1-3 days after Sprint 1)
- **2.1** Cross-geocoder validation via Nominatim (free, no API key) on each stop, divergence > 500m = -0.1 score
- **2.2** `qualityScore(stepName, output)` function + circuit breaker (publish blocked if any step < floor)
- **2.3** `pipeline_telemetry.quality_score` column populated per step

### Sprint 3 — Predictor (3-5 days after Sprint 2)
- **3.1** `lib/pipeline-predictor.ts` — Bayesian regression model
- **3.2** Pre-flight check before `step.run("phase1a")` → switch sonar-pro if P(timeout) > 20%
- **3.3** `GET /api/admin/predict-run-time` endpoint for operators

### Sprint 4 — Self-tuning + observability (3-5 days after Sprint 3)
- **4.1** Migration `035_pipeline_thresholds.sql` + seed thresholds
- **4.2** Cron `cron/recompute-pipeline-thresholds` weekly
- **4.3** Dashboard `/admin/observability` with SLO 95% success rate, p99 per phase, quality distribution
- **4.4** Slack/email alert if SLO < 95% on 7d rolling window

---

## 5. Mathematical framing — the optimization problem

The orchestration design is **not arbitrary**. It solves:

```
minimize    E[total_latency] = Σᵢ E[stepᵢ_latency]

subject to  ∀i: E[stepᵢ_latency] + 2·σ(stepᵢ_latency) ≤ inngest_http_timeout (2m43s)
            Σᵢ E[stepᵢ_latency] ≤ vercel_max_duration_total
            ∀i: quality_score(outputᵢ) ≥ quality_floorᵢ
            cost = Σᵢ api_calls_costᵢ ≤ cost_budget_per_game
```

This is a convex optimization under chance constraints. The 5-step
decomposition (1a, 1b, 2a, 2b, 2c) is the **mathematically optimal**
number given the observed latency distributions:

- Each step's distribution has a known p99 in `pipeline_telemetry`
- Splitting reduces tail risk per step (each gets its own HTTP window)
- Adding more steps adds serialization overhead (~5s per HTTP roundtrip)
- Optimum: split until p99 < timeout × 0.7 for safety margin

A 6th split would add latency without reducing crash rate (no current
step has p99 > 2m). A 4th split (merging two of {2a,2b,2c}) would
re-create the timeout risk. Hence 5.

---

## 6. Observability — what we measure

Per run, persist to `pipeline_telemetry`:

```sql
run_id           uuid                 -- one row per game build
game_id          uuid                 -- post-insert
phase            text                 -- "1a"|"1b"|"2a"|"2b"|"2c"|"post-insert"
started_at       timestamptz
ended_at         timestamptz
duration_ms      int
quality_score    numeric(3,2)         -- [0.0..1.0]
quality_breakdown jsonb               -- { schema, coverage, geo, content }
failure_class    text                 -- null | "transient"|"timeout"|...
retry_count      int                  -- 0 if first attempt success
transport_mode   text                 -- "walking"|"mixed"|"driving"
radius_km        int
stop_count       int
api_calls        jsonb                -- { perplexity_dr_ms, google_geocode_count, claude_tokens, ... }
```

Aggregations driven by this table:
- p50/p99 per (phase, mode, radius_km_bucket) → recomputed weekly → updates `pipeline_thresholds`
- SLO success rate per 7d window → alert if < 95%
- Quality score distribution → detect drift (if median moves > 0.1 week-over-week)
- API cost per game → budget alarm if > $X

---

## 7. Non-goals

- **Not a self-healing AI**. We design with explicit rules + bounded retries. No reinforcement learning loop.
- **Not zero-touch**. Operator review remains the floor of trust — Predictor flags ambiguous cases to humans.
- **Not multi-tenant**. We optimize for OddballTrip + Lume (same DB tenant). Multi-customer comes later.
- **Not real-time**. Pipeline is async by design. We optimize for reliability, not latency.

---

## 8. Open questions (to revisit post-Sprint 4)

1. **Should we cache Perplexity DR per theme?** A roadtrip Loire châteaux generated twice in 30d has 99% the same DR output. Could save 3-5min per regeneration.
2. **Can we run phase 1a + 2b in parallel?** They share no state. Could save ~30s per game.
3. **Multi-region Vercel deployment?** Latency to Perplexity (us-east) is the long pole. Putting us in us-east region would reduce phase1a by ~20%.
4. **Switch Perplexity → Anthropic web_search?** New tool 2026-04. Possibly faster and same quality. Need A/B comparison.
