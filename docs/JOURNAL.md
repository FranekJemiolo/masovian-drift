# Development Journal

Newest entries first. Plan reference: [IMPROVEMENT_PLAN.md](./IMPROVEMENT_PLAN.md).

## 2026-10-09 — Plan created; isolated testing sweep status

**Done**
- Reviewed implementation (physics, audio, graphics, UI, net, build) and wrote `docs/IMPROVEMENT_PLAN.md` (≈70 items across mechanics, visuals, UI/UX, audio, performance, code quality; P0/P1/P2).
- Build (`npm run build`) passes; latest pushed commit `0d29cc8`.

**Isolated per-section browser testing (standing task) — honest status**

| Section | Result |
|---------|--------|
| 1 Main menu | First attempt failed (503 model capacity); retry launched, no result reported back → **unverified** |
| 2 Garage | Launched, no result reported back → **unverified** |
| 3 Quick race | Launched, no result reported back → **unverified** |
| 4 Pause/settings | Launched, no result reported back → **unverified** |
| 5 Split-screen | Launched, no result reported back → **unverified** |
| 6 Multiplayer lobby | Failed: 429 quota exhausted (resets ~1h43m) → **not run** |

Cause: browser subagent infrastructure errors (503/429), not application failures. No bugs were confirmed or ruled out for these sections. Replace with deterministic Playwright tests (plan item V1/V2) so verification doesn't depend on the subagent.

**Known issues spotted during review (tracked in plan)**
- Pause doesn't suspend audio/clock (U1); volume slider overrides mute and only affects player engine (U2).
- Split-screen skips post-processing (G1).
- `alert()` race-finish with wrong ordinals for rank ≥ 11 (M2).
- `restartRace` leaves damage/FX/heat state (M3).
- 5.4 MB single JS chunk (P7); per-frame allocations (P1).

**Next**
1. V1/V2 Playwright smoke suite + console-error gate.
2. P0 batch: M1–M3, U1–U2, A1, P1, P3, P7, G1.
3. Update this journal and tick items in the plan as each lands.

### Tracking
| Phase | Items | Status |
|-------|-------|--------|
| Stabilise (P0) | V1 V2 M1 M2 M3 U1 U2 A1 P1 P3 P7 G1 | `[ ]` not started |
| Feel & polish | G2 G6 G10 A2–A5 M4 M6 M7 U3–U7 U11 | `[ ]` not started |
| Depth | G3–G5 M5 M8–M12 A6–A9 U8–U12 G7–G12 | `[ ]` not started |
