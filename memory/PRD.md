# AOTG — AI On The Go (PRD & Change Log)

## Product
Bare React Native (0.87, New Architecture) Android app that:
1. Runs an **on-device LLM** (LiteRT-LM) for chat and vision.
2. Drives an **accessibility "agent"** that observes the current screen (accessibility
   tree + optional screenshot) and performs actions in an observe→think→act loop.

The product idea is unchanged — this iteration only fixes broken flows and edge cases.

## Original problem statement
"Fix and optimize the flow — check all the issues in the agent flow of screen
recognition, model loading, error handling, and edge-case handling."

## User decisions (this iteration)
- Full pass across agent loop, model loading, and error handling.
- LLM models are treated as **text-only** (not vision-capable). Agent must run
  text-only gracefully when the loaded model can't accept images.
- Verification = code correction + review (no device available in the env).
- Fix both native (Kotlin) and JS/TS layers. Preserve the product idea.

## Architecture
- `App.tsx` → HomePage (chat) / AgentPage (agent), Redux store (theme/llm/agent).
- `src/agents/*` — agent loop, orchestrator, prompt builder, types.
- `src/services/*` — TS wrappers over native Turbo Modules (LLM, Accessibility).
- `src/native/turbo_modules/*` — TS specs.
- `android/.../turbo_modules/llm/LLMModule.kt` — LiteRT-LM engine, download, generation.
- `android/.../services/AOTGAccessibilityService.kt` — UI tree, gestures, screenshot.

## Fixes implemented (this iteration)
### Critical (were causing hangs / non-working flows)
1. **Hung promise after Stop** — `LLMModule.stopGeneration` now emits a final
   `onGenerationComplete` (with partial text) so awaiting `generate()` /
   `generateWithVision()` promises resolve instead of hanging (chat + agent).
2. **Vision sent to text-only models** — added `supportsVision` to `ModelInfo`
   (all current models = false). Agent gates screenshots/vision on model
   capability; prompt builder has separate vision vs text-only system prompts.
3. **Cancel unresponsive during "thinking"** — `AccessibilityAgent.cancel()` now
   calls `LLMService.stopGeneration()`; loop returns "cancelled" cleanly.
4. **Chat auto-load stuck on "loading"** — HomePage loads only when the model is
   downloaded, guides user to the picker otherwise, and reverts status via new
   `setModelLoadFailed` reducer on failure.

### Robustness / edge cases
5. Single screenshot per agent step (removed the unused second capture).
6. Per-step LLM **inference timeout** (`inferenceTimeoutMs`, default 120s).
7. **Stuck/loop detection** — aborts if the same action repeats 3×.
8. Repeated **observe-failure** guard (aborts after 3 consecutive failures).
9. Strict `parseActionResponse` validation (rejects malformed actions).
10. Native click **coordinate-tap fallback** when semantic ACTION_CLICK fails.
11. Accessibility **event throttling** + reduced event mask (no bridge flooding).
12. On mount, HomePage syncs on-disk model status (downloaded models recognized
    after restart; status dot accurate).

## Files changed
- src/store/slices/llmSlice.ts, src/agents/types.ts, src/agents/promptBuilder.ts,
  src/agents/accessibilityAgent.ts, src/hooks/useLLM.ts,
  src/screens/HomePage/HomePage.tsx, src/screens/AgentPage/AgentPage.tsx
- android/.../turbo_modules/llm/LLMModule.kt,
  android/.../services/AOTGAccessibilityService.kt,
  android/.../res/xml/accessibility_service_config.xml

## Verification notes
- No backend / no web frontend → automated web/backend testing not applicable.
- Native LiteRT modules require a real Android build; validate on device after
  building via the normal build flow.

## Backlog / next
- P1: Mark a genuinely vision-capable model with `supportsVision: true` if/when
  one is added, to re-enable screenshot-based agent reasoning.
- P2: Persist Redux `llm` state so the loaded/selected model survives restarts.
- P2: Surface load/download errors as a toast/banner in the chat UI (currently
  shown as an assistant message).
