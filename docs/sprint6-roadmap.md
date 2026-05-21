# Sprint 6 Roadmap — Self-correcting pipeline with player feedback loop

**Status:** Active
**Created:** 2026-05-21
**Owner:** escape-game pipeline team

> Sprint 6 closes the feedback loop : player error reports → LLM classifier
> → auto-rectify (if confident enough) OR admin queue → pattern extractor
> → learned_rules → preventive application in future generations.
>
> See `docs/pipeline-architecture.md` for context (Sprint 1-5 already shipped).

---

## Why Sprint 6 exists

Sprint 1-5 built a **self-managing** pipeline (quality gates, circuit breakers,
auto-tuning thresholds, narrative-offset rescue). But the system has no
visibility on the **downstream reality** — does the player actually find the
landmark? Is the audio synced? Are answers being rejected unfairly?

The infrastructure for collecting player reports already exists :
- `error_reports` table (migration 003)
- In-game button `<ReportError>` (`src/components/player/ReportError.tsx`)
- Endpoint `POST /api/report-error`
- Admin page `/admin/reports`

Sprint 6 connects these reports back into the pipeline to :
1. **Auto-rectify** common, reversible, low-risk fixes (audio regen, GPS
   correction with quorum + cross-validation)
2. **Surface** harder cases to operators with rich context
3. **Learn** patterns so future generations avoid the same mistakes
   preemptively (the "case-based reasoning" loop)

---

## Architecture overview

```
PLAYER  ───►  error_reports  ──►  LLM classifier  ──►  pipeline_incidents
                                       │                      │
                                       ▼                      ▼
                                  category +             learned_rules
                                  confidence                  │
                                       │                      ▼
                                       ▼            ┌─ MATCHED PATTERN ─┐
                          ┌─ AUTO-RECTIFY ─┐        │ next generation   │
                          │  (quorum ≥ N)  │        │ applies rule      │
                          └────────────────┘        │ preventively      │
                                                    └───────────────────┘
```

---

## Phased plan

### Sprint 6.1 — 2026-05-21 (TODAY) → 2026-05-24 (3 days)

**Goal :** classifier + simplest auto-rectifier + incidents table

- [ ] Migration `037_pipeline_incidents.sql` — table to store incidents
      with `trigger_type` (`sanity_check_fail` | `player_report` |
      `quality_floor_miss`), error_signature, pipeline_context JSONB,
      operator_actions JSONB, resolution status.
- [ ] `src/lib/error-report-classifier.ts` — Claude-powered classifier
      mapping free-text report to one of ~12 typed categories with
      confidence score. Prompt includes step context (landmark, GPS,
      answer) for grounded classification.
- [ ] `src/lib/auto-rectify-actions.ts` — initial 2 actions :
      `rectifyAudioTextMismatch` (regen audio for the step+slot) and
      `rectifyMissingAudio` (idempotent generation if missing).
- [ ] Inngest function `classifyAndRectify` triggered by INSERT on
      `error_reports`. Runs classifier, opens an incident, applies
      auto-rectifier if category is audio-related, else marks for
      admin review.
- [ ] Update `/admin/reports` UI to display classification + auto-
      rectified status alongside the raw message.

**Win after 6.1 :** audio reports auto-fix without operator intervention.

### Sprint 6.2 — 2026-05-25 (Monday) → 2026-05-28 (4 days)

**Goal :** quorum logic + GPS auto-fix with cross-validation

- [ ] Quorum module : `countPeerReports(stepId, category, sinceDays=7)`
      returns N reports on same step+category. Configurable threshold
      per category (see table in `docs/pipeline-architecture.md`
      Sprint 6 design notes).
- [ ] `rectifyWrongGps` action : when quorum ≥ 2 AND
      `crossValidateGeocode` returns `verdict='conflict'` OR
      `verdict='diverge'` AND `geocodeLocationRobust` finds a better
      candidate → update step lat/lon, log original coords in
      `auto_rectification_log` for reversibility.
- [ ] `rectifyCannotFindLandmark` action : extend
      validation_radius_meters from 30 to 50 when quorum ≥ 3.
- [ ] Admin UI : "Pending high-priority reports" section showing
      reports where quorum reached but auto-rectifier abstained
      (uncertain).

**Win after 6.2 :** GPS errors with 2+ player confirmations auto-fix
with external validation.

### Sprint 6.3 — 2026-06-01 (Monday) → 2026-06-05 (5 days)

**Goal :** pattern extractor + learned_rules + preventive evaluation

- [ ] Migration `038_learned_rules.sql` — table with preconditions
      (JSONB), action_template (JSONB), confidence (Bayesian posterior),
      applied_count, positive_outcomes, negative_outcomes, disabled
      flag, source_incidents UUIDs (provenance).
- [ ] Cron `api/cron/extract-learned-rules` (weekly Monday 04:00 UTC) :
      reads pipeline_incidents, clusters similar contexts, extracts
      patterns with ≥ N=5 confirmations and ≥ 80% positive outcome
      rate. UPSERTs into learned_rules.
- [ ] Rule evaluator in `inngest/build-game.ts` : before each phase,
      query active rules matching the pipeline context. Apply ones
      with confidence > 0.7 ranked descending. Log every application.
- [ ] Admin page `/admin/learned-rules` : list all rules with their
      confidence, applied count, outcome ratio. Operator can disable
      a rule manually with one click.

**Win after 6.3 :** patterns from past incidents auto-prevent same
issues in future generations.

### Sprint 6.4 — 2026-06-08 (Monday) → 2026-06-10 (3 days)

**Goal :** effectiveness audit + extended auto-rectify catalogue

- [ ] Cron `api/cron/audit-rule-effectiveness` (weekly) : for each rule
      applied in past 30d, compute positive vs negative outcomes from
      downstream signals (player_outcome on generated games, new
      reports incidence). Update Bayesian confidence. Auto-disable
      rules whose confidence drops below 0.5 after ≥ 10 applications.
- [ ] Extended auto-rectify actions :
      - `rectifyWrongAnswerRejected` : add accepted variants to step
      - `rectifyRiddleTooHard` : auto-generate +1 hint
      - `rectifyTranslationError` : trigger Gemini re-translate
- [ ] Reversibility UI : on `/admin/reports`, every auto-rectified
      report shows the diff + a "Revert" button that restores DB
      state via the auto_rectification_log.

**Win after 6.4 :** ~80% of player reports never reach the operator,
and bad rules self-disable.

---

## Reminders scheduled

- **2026-05-25 09:00** — Start Sprint 6.2 (quorum + GPS auto-fix)
- **2026-06-01 09:00** — Start Sprint 6.3 (pattern extractor)
- **2026-06-08 09:00** — Start Sprint 6.4 (effectiveness audit)

Each reminder fires a scheduled task that opens a new session pre-loaded
with the relevant sub-sprint context.

---

## Risks & safeguards

See `docs/pipeline-architecture.md` and the Sprint 6 design notes
(in the session log 2026-05-21). Key safeguards :

1. **Quorum** : never auto-rectify on a single report (except audio
   slots, which are content-independent and trivially regenerated).
2. **Cross-validation** : GPS auto-fix requires Nominatim agreement
   with the proposed new coords (verdict 'agree' or 'close').
3. **Reversibility** : every auto-rectification logs the original
   value in `auto_rectification_log` so admin can revert in 1 click.
4. **Never auto-rectify factual content** : factual_error,
   narrative_inconsistency, wrong_answer_accepted are admin-only.
5. **Effectiveness audit** : rules whose confidence drops below 0.5
   after ≥10 applications auto-disable.
6. **Rate limiting** : max 3 reports per session_id per game to
   prevent troll amplification.
