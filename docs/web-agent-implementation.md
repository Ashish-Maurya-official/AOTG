# Web tools in chat and LiveTalk

Branch: `feat/modular-web-agent`. Android implementation, 28 November 2026.

This change implements automatic local-model tool dispatch, direct public website reading, optional search discovery and shared lexical retrieval. It is an initial integration behind an opt-in setting, not a completed rollout of every phase in [the architecture](web-agent-architecture.md).

## Enable and use

1. Build/install the Android app with its new native `AgentTools` TurboModule. A JavaScript-only update cannot install the module.
2. Open Settings and enable **Online tools in chat and LiveTalk**.
3. Reload a model marked `supportsFunctionCalling`, or start a new LiveTalk session. The catalog is attached when the native conversation is constructed.
4. Ask, for example, “Read https://example.org/news and summarize its recent announcements.” The model may call `web_read` and follow returned links. For LiveTalk, use a compatible audio/function-calling model or the existing speech-recognition fallback.
5. For broad discovery, optionally configure the HTTPS `/search` endpoint of a SearXNG instance that permits your requests and has JSON search enabled. No provider is configured by default. Without one, direct URL reading works and `web_search` reports unavailable.

The model chooses whether to invoke a tool; support in the model catalog is not a measured guarantee of tool-selection quality. The system instruction asks it to retrieve current information and disclose retrieval failures. Validate this with each shipped model. Fetch time describes when the app read the page, not when the publisher last updated its information.

Disabling the setting cancels pending tools and clears the native catalog. Existing conversations may still know old tool names until rebuilt, but dispatch refuses them. Unsupported platforms do not show the setting. Model generation, TTS and existing Android accessibility tasks retain their existing ownership controls.

## Implementation boundaries

| Component | Responsibility |
| --- | --- |
| `src/agentCore/types.ts` | Tool schemas, structured results, source metadata, cancellation and request identity |
| `src/agentCore/registry.ts` | Atomic plugin registration, argument validation, unavailable-tool handling and UTF-8 response limits |
| `src/agentCore/toolRuntime.ts` | Preferences, native request dispatch, deadlines, cancellation and turn-scoped activity |
| `src/plugins/registerPlugins.ts` | Sole composition point for new plugins |
| `src/plugins/web/` | `web_read`, `web_search`, `web_recall`, search settings and saved-source controls |
| `src/rag/retrieval.ts` | Bounded Unicode chunks, BM25-style lexical retrieval, summary sampling and context packing |
| Native `agenttools/` | Checked public HTTPS transport, HTML extraction and suspension/resumption of native tool calls |
| Native `LLMModule.streamWithTools` | Shared manual LiteRT-LM tool loop for chat and LiveTalk |

The existing `documentService` API delegates retrieval to the same core. Irrelevant questions return no evidence. Summaries sample sections explicitly. No existing document extraction/OCR implementation, chat schema or accessibility task schema is migrated.

Tool results enter LiteRT-LM's dedicated tool-message role as structured JSON. They do not become system instructions. The loop retains at most five unique source references and appends a **Sources checked** footer to stored chat/voice text; it does not send that footer to TTS. The footer records retrieved sources and does not independently prove every generated claim. LiveTalk cancellation discards late results and preserves sources for text already spoken.

## Add or remove a plugin

A plugin exports an `AgentPlugin` with a unique ID and bounded tools. Parameters support strings, booleans, numbers, integers, objects and arrays. `execute` receives validated JSON and a `ToolContext` with an AbortSignal, request/generation IDs and a result byte budget. The native model interface does not change for another tool using these shared capabilities.

Register a new plugin with one line in `createToolRegistry`:

```ts
registry.register(require('./myPlugin').default);
```

Its folder exports the plugin from `index.ts` and owns its settings and tests. Use `retrieveContext(query, text, budget, customRetriever)` to replace lexical selection. For saved websites, SQLite selects candidate passages and the lexical retriever ranks them.

To remove web support, delete exactly this line and then delete `src/plugins/web/`:

```ts
registry.register(require('./web').default);
```

Rebuild the application. No screen, reducer or native tool-name switch references that folder. Unregistered names return unavailable and never fall back to Android accessibility. Shared native transport remains installed but dormant. Previously saved source footers remain ordinary message text. This removal contract applies to new plugins; the existing accessibility runtime remains in its original location. Adding a new native SDK still requires normal native registration/build changes.

## Enforced limits

| Boundary | Limit |
| --- | --- |
| Native tool catalog | 12 tools, 16,000 JSON characters |
| Native model turn | 5 calls; 120-second check before starting another tool batch |
| Tool bridge request | 24-second native wait; 22-second JS cancellation deadline |
| Tool arguments | 6,000 serialized characters; schema validation, nesting/array/string limits |
| Tool evidence | At most 5,000 UTF-8 JSON bytes per response, further reduced by remaining model context and batch size |
| HTTP | HTTPS port 443, 2 simultaneous requests, 5 redirects, 20-second transfer deadline |
| Response body | 2 MiB of decompressed bytes; extracted text capped at 64,000 characters |
| HTML parsing | At most 10,000 markup delimiters; bounded block/table assembly to prevent nested-text expansion |
| Links/sources | 25 extracted links, 8 exposed per page, 5 final source references |

The HTTP resolver checks the same IP addresses used by the connection. It rejects private/local/reserved destinations, embedded credentials, unsafe schemes and ports; redirects are revalidated. There are no shared browser cookies, authenticated browsing, uploads, form submission or account-changing tools. HTML scripts, hidden elements and form controls are removed before extraction; article text inside a form wrapper remains readable. Cancellation reaches the active OkHttp call. DNS cancellation timing remains subject to the platform resolver.

Retrieved text remains untrusted. The foreground renderer executes a bounded page snapshot with network loads blocked. Scoped authorization and outbound-data controls remain open work before adding private accounts or privileged tools.

## Validation and shipping gates

TypeScript passed its static check, and all ten changed production Kotlin files parsed without syntax errors. Verification of the Android build and device behavior remains pending.

Automated checks cover registry validation/removal behavior, Unicode retrieval, explicit no-evidence responses, byte budgets, search discovery, actual React Native URL semantics, deadlines, interruption, stale activity and existing application regressions. Native tests cover private/reserved addresses and unsafe URLs. Metro release bundling checks the composition root and codegen must include `NativeAgentToolsSpec`.

Before release, run:

```sh
npx tsc --noEmit
npm test -- --runInBand
npx eslint src/agentCore src/plugins src/rag src/components/AgentToolActivity.tsx src/components/AgentToolSettings.tsx src/native/turbo_modules/AgentTools src/services/documentService.ts
cd android
./gradlew :app:compileDebugKotlin :app:testDebugUnitTest :app:assembleRelease
```

Physical-device checks are required for model tool-call selection, response context accounting, chat Stop, LiveTalk barge-in while fetching, model switching, accessibility ownership, app background/foreground, phone/tablet wrapping, network loss and memory pressure with the 8 GB target. Unit tests and a JavaScript bundle cannot establish these native/model guarantees.

## Implemented scope and remaining work

- Foreground rendering uses a visible offline WebView. It can run inline scripts and up to three same-origin JavaScript files fetched through the public HTTPS transport. Pages requiring live XHR, module imports, authentication or third-party bundles can return insufficient evidence. Full interactive navigation remains future work.
- Settings supports explicit background saves, status and clearing. Android JobScheduler owns one queued fetch across app process death. A stopped job may restart the fetch; SQLite commits new passages atomically. Reboot persistence and resuming an interrupted chat generation are outside this implementation.
- A device-local SQLite FTS4 index retains up to 32 saved pages across sessions. The model can call `web_recall` to retrieve passages and observation dates. HTTP cache revalidation, version history and optional embeddings remain future work.
- Per-source scheduling/rate policy, robots handling for crawling, scoped outbound authorization, claim-support evaluation and measurements across supported websites/models.
- iOS native transport and model integration.

Direct reading, foreground rendering and saved-source lookup use the phone's resources. Search availability depends on the configured provider. Source capacity and measured device performance determine practical rollout limits.
