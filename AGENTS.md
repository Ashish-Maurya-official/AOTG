# AGENTS.md

## 1. Core Objective

- Treat every user request as a complete engineering goal, not a partial task.
- Continue working until the requested task is fully implemented, verified, and cleaned up.
- Do not stop after making only part of the requested change.
- Do not ask for clarification when the answer can be determined by inspecting the existing codebase, related files, configuration, or documentation.
- Make reasonable engineering decisions based on the actual repository and existing patterns.
- If something is genuinely unknown, investigate it before making changes.
- Never guess about existing logic when the repository can be inspected.

## 2. Analyse Before Changing Code

- Before editing any file, understand the complete flow related to the requested change.
- Trace the relevant logic from the entry point through state, props, services, APIs, native modules, persistence, and UI as applicable.
- Identify all callers, consumers, side effects, dependencies, and related components before changing shared code.
- Search for the same feature or pattern elsewhere in the project before creating a new implementation.
- Inspect reducers, actions, hooks, utilities, services, navigation, native code, and related screens when they are part of the flow.
- Check edge cases before implementation, especially:
  - loading states
  - empty states
  - error states
  - repeated actions
  - race conditions
  - stale state
  - asynchronous behavior
  - unmount behavior
  - platform differences
  - large data sets
  - keyboard behavior
  - tablet layout
- Do not make a fix until the cause of the problem is understood.
- Prefer root-cause fixes over symptom-based fixes.

## 3. Never Guess Existing Logic

- The actual codebase is the source of truth.
- Do not assume a function, reducer, API, component, prop, state value, or data shape behaves a certain way.
- Find and inspect the actual implementation before using it.
- When a similar implementation exists, compare it carefully instead of copying it blindly.
- Verify assumptions by tracing the real call flow and data flow.
- Do not create compatibility code for behavior that does not exist.

## 4. Match the Existing Codebase

- Preserve the current project's code-writing style.
- Before creating a new file, inspect several nearby files serving a similar purpose.
- Match their:
  - naming conventions
  - import order
  - component structure
  - hook patterns
  - state-management approach
  - styling approach
  - prop handling
  - utility patterns
  - error handling
  - export style
- Do not introduce a new architectural pattern when an established project pattern already solves the problem.
- Do not rewrite existing code into a different style merely because another style is personally preferred.
- New code must look like it naturally belongs in the existing project.

## 5. Minimal and Targeted Changes

- Change only what is required to solve the requested problem.
- Do not refactor unrelated files or logic.
- Do not rename variables, components, files, or APIs without a concrete reason.
- Do not create unnecessary abstraction layers.
- Do not create unnecessary helper functions.
- Do not create unnecessary variables.
- Reuse existing utilities, components, hooks, constants, services, and patterns whenever appropriate.
- Avoid duplicate logic.
- Do not "clean up" unrelated code while working on a feature.
- Keep the final diff as small as reasonably possible while still producing a correct and maintainable solution.

## 6. React Native Component Rules

- Prefer functional components with hooks unless the existing component architecture requires otherwise.
- Follow the project's established JavaScript/TypeScript conventions.
- Keep components focused and avoid unnecessary responsibility inside one component.
- Reuse components and shared utilities instead of duplicating UI or logic.
- Avoid unnecessary wrapper views and unnecessary nesting.
- Avoid unnecessary state.
- Prefer derived values over duplicated state.
- Keep state only for values that actually need to trigger a render.
- Use local variables, `useRef`, memoized values, or constants when state is not required.
- Do not use state merely as a temporary variable.
- Do not trigger a render when a mutable value can safely live in a ref or normal variable.
- Never introduce state without understanding its render lifecycle.

## 7. Rendering and Re-render Optimization

- Think about render frequency before adding state, context, props, or callbacks.
- Identify which values actually affect the UI before putting them into state.
- Avoid storing derived values in state when they can be calculated from existing props/state.
- Use `useMemo` for expensive derived calculations when memoization provides real value.
- Use `useCallback` for functions when stable function identity matters, especially when passed to memoized children, dependency arrays, lists, or expensive child components.
- Do not blindly wrap every function in `useCallback`.
- Do not blindly wrap every value in `useMemo`.
- Memoization must solve an actual render/dependency problem and must not make the code harder to understand.
- Use `React.memo` for components that benefit from stable props and meaningful render avoidance.
- Check dependency arrays carefully. Never omit dependencies merely to silence rerenders.
- Avoid creating new objects, arrays, or functions during every render when they are passed into memoized children or performance-sensitive lists.
- Avoid unnecessary context updates.
- For large lists, use the project's appropriate virtualization strategy and avoid expensive work inside render functions.
- Check whether a change introduces a render loop, stale closure, unnecessary parent rerender, or repeated API/native call.

## 8. Hooks

- Use the appropriate hook for the actual lifecycle requirement.
- Prefer:
  - `useState` for UI state that must trigger rendering
  - `useRef` for mutable values that must persist without causing rerenders
  - `useMemo` for expensive derived values
  - `useCallback` for stable function identity when it matters
  - `useEffect` only for synchronization/side effects
- Do not use `useEffect` for values that can be derived during render.
- Do not use effects as a substitute for event-driven logic.
- Avoid chains of effects that update state only to derive another state value.
- Clean up subscriptions, listeners, timers, animations, and async operations when required.
- Verify hook dependency arrays against actual captured values.
- Be alert for stale closures and race conditions.

## 9. Styles and UI

- Never use inline styles.
- Never use inline functions for event handlers, render callbacks, or other frequently-created callbacks when a named/memoized function can be used.
- Follow the project's existing styling system and conventions.
- Keep styles in the established stylesheet/style structure used by the project.
- Reuse existing spacing, typography, colors, dimensions, and components where available.
- Do not create duplicate style constants when an existing token or style already exists.
- Avoid unnecessary style objects created during render.

## 10. Tablet Optimization

Whenever creating or substantially modifying UI, explicitly consider tablet layouts.

Use:

```javascript
const isTablet = Dimensions.get('window').width >= 768;
```

when the UI needs tablet-specific behavior.

- Analyze the layout at phone and tablet widths before finalizing the implementation.
- Do not simply scale phone dimensions upward.
- Check:
  - horizontal spacing
  - max content width
  - columns/rows
  - modal width
  - drawer width
  - text wrapping
  - button sizing
  - image sizing
  - keyboard behavior
  - scroll behavior
- Use responsive behavior only where it improves the actual layout.
- Do not introduce tablet-specific code when the existing responsive layout already handles it correctly.

## 11. List and Collection Logic

- Use appropriate collection methods such as:
  - `.map()`
  - `.filter()`
  - `.find()`
  - `.some()`
  - `.every()`
  - `.reduce()`
  - `.includes()`
  - `.findIndex()`
- Use these methods when they make the logic clearer and reduce redundant code.
- Do not force `.map()` where a more appropriate method exists.
- Avoid repeated loops over the same collection when the logic can be safely combined.
- Avoid deeply nested ternaries and repetitive conditional blocks.
- Preserve behavior while simplifying duplicated logic.
- Do not optimize readability at the cost of correctness.

## 12. Reusability Without Over-Abstraction

- Extract shared logic only when there is a real reuse benefit.
- Do not create generic helpers for one-off logic without a clear reason.
- Prefer small focused utilities over large "do everything" helpers.
- Do not create a new component when an existing component can safely support the requirement.
- Keep abstractions consistent with the project's current architecture.
- Every new abstraction must have a clear ownership and responsibility.

## 13. Async, Race Conditions, and Side Effects

- Treat asynchronous logic as a potential source of race conditions.
- Before modifying async flows, identify:
  - request ordering
  - cancellation
  - duplicate requests
  - retries
  - stale responses
  - loading state transitions
  - unmount behavior
  - concurrent actions
- Do not fix concurrency bugs by adding arbitrary delays.
- Do not use timeouts as a substitute for synchronization.
- Preserve existing queue/lock/serialization mechanisms when they are part of the architecture.
- Verify that a fix does not introduce duplicate submissions or stale updates.

## 14. Navigation and Data Flow

- Before changing navigation, trace:
  - current route
  - route parameters
  - state passed before navigation
  - Redux state
  - query parameters
  - data loaded on destination
  - back-navigation behavior
- Do not pass duplicate data when the destination already derives it.
- Do not hardcode IDs, slugs, URLs, or configuration values that already exist elsewhere.
- Follow the project's established navigation pattern.

## 15. State Management

- Inspect the existing Redux/store architecture before creating new state.
- Reuse existing actions, selectors, reducers, and slices where appropriate.
- Do not create duplicate sources of truth.
- Keep derived state derived unless persistence or lifecycle requirements justify storing it.
- Check for stale Redux data when changing navigation or asynchronous flows.
- Verify reset/cleanup behavior when a flow completes, is cancelled, or is retried.

## 16. API and Backend Changes

- Inspect the complete request/response flow before changing API usage.
- Verify actual endpoint names, payloads, response structures, authentication, and error handling.
- Match existing API service patterns.
- Do not invent response fields.
- Do not add fallback behavior for nonexistent backend behavior.
- If a backend change is required, understand all existing consumers before changing shared contracts.

## 17. Native React Native Changes

- Before modifying Android/iOS/native code, inspect the corresponding JS/TS interface and registration flow.
- Respect the project's current New Architecture/TurboModule/JSI patterns.
- Do not introduce legacy architecture patterns when the existing project uses New Architecture.
- Match the existing native module registration and lifecycle patterns.
- Consider thread ownership, lifecycle, cleanup, and bridge/JSI overhead.
- Do not move work between threads without understanding the current runtime model.

## 18. Dependencies

- Do not install unnecessary dependencies.
- Before adding a dependency:
  1. Search the existing project for an equivalent implementation.
  2. Check whether the required capability already exists in a current dependency.
  3. Consider whether the feature can be implemented cleanly without a dependency.
  4. Check compatibility with the project's React Native/New Architecture setup.
- Never add a package just to avoid writing a small amount of existing-style code.
- Avoid dependency duplication.
- If an external dependency is genuinely required, inspect its current documentation and compatibility before integrating it.

## 19. Internet Research

- When the repository does not contain enough information to solve a technical problem safely, research the solution instead of guessing.
- Search official documentation first when the question concerns:
  - React Native
  - Android
  - iOS
  - a library/API
  - framework behavior
  - build configuration
- Prefer primary sources and current documentation.
- Verify version compatibility with the project's actual versions.
- Do not copy random snippets without understanding how they apply to this codebase.
- After researching, adapt the solution to the project's existing architecture and coding style.

## 20. File and Code Inspection

- Do not analyze the codebase lazily.
- Do not inspect only the first matching file and assume the rest.
- Search all relevant usages before modifying shared code.
- Inspect related declarations, imports, callers, consumers, and configuration.
- When a bug involves state, inspect where that state is created, changed, read, reset, and persisted.
- When a bug involves a component, inspect parent and child interactions when relevant.
- When a bug involves an API, inspect the complete request and response lifecycle.
- When a bug involves native code, inspect both sides of the JS/native boundary.
- Use IDE search and file-inspection tools for code analysis and editing.

## 21. Terminal Usage

- Do not use terminal commands as a substitute for proper code inspection.
- Do not use terminal commands to perform code edits or scripted code rewrites.
- Do not use scripts to mass-edit or mechanically rewrite project source files.
- Make code changes through the IDE/code-editing workflow so each change is deliberate and reviewable.
- Terminal/build commands may be used only when necessary for actual project validation, builds, native compilation, tests, linting, or other repository-defined verification.

## 22. No Scripted Code Changes

- Never generate or run a script whose purpose is to modify source code automatically.
- Never perform blind global replacements.
- Never use regex-based bulk edits on production code.
- Make each source change intentionally and verify its surrounding logic.
- For repetitive changes, inspect all affected files and apply the smallest safe edits.

## 23. Error Handling and Edge Cases

- Every fix must consider failure paths, not only the successful path.
- Check:
  - null/undefined values
  - empty arrays
  - missing properties
  - invalid user input
  - failed requests
  - rejected promises
  - unmounted components
  - duplicate events
  - slow responses
  - stale state
  - platform differences
  - accessibility behavior
- Do not introduce behavior that works only for the happy path.

## 24. Analyse the Fix After Implementation

After making changes, do a second complete analysis of the modified flow.

Verify:

- the original bug/problem is actually fixed
- no related logic was accidentally changed
- state updates are correct
- rerenders are reasonable
- hook dependencies are correct
- memoization is correct
- async behavior is safe
- error paths still work
- existing consumers remain compatible
- navigation/data flow remains correct
- UI behavior is correct
- tablet behavior is correct where applicable
- no unnecessary variables or abstractions were introduced
- no duplicated logic was introduced
- no unrelated files were modified

Do not consider a change finished immediately after writing the code.

## 25. Regression Analysis

- Search the repository for usages of every changed shared function, component, action, selector, hook, type, or API.
- Check whether the changed contract affects another feature.
- Test or reason through existing consumers.
- Pay special attention to shared components and utilities.
- Do not assume "the file compiles" means the feature is safe.

## 26. Verification

- Use the project's existing validation workflow.
- Run the appropriate project-defined checks after implementation.
- Validate the narrowest relevant scope first, then broader checks when practical.
- Fix errors caused by your changes.
- Do not introduce unrelated formatting or dependency churn just to make a check pass.
- If a validation step cannot be run, inspect the result another reliable way and clearly identify what remains unverified.

## 27. Diff Discipline

Before declaring the task complete:

- Review the full diff.
- Check every changed file.
- Remove accidental changes.
- Remove temporary logs.
- Remove dead variables.
- Remove unused imports.
- Remove unnecessary abstractions.
- Confirm the final implementation matches the requested scope.
- Keep unrelated existing changes untouched.

## 28. Production-Quality Standard

Code should be:

- correct
- readable
- maintainable
- reusable where appropriate
- performant
- consistent with the existing project
- safe under edge cases
- easy for another React Native developer to understand

Do not optimize for the shortest code.
Do not optimize for cleverness.
Do not optimize for abstraction count.

Optimize for clear, correct, production-safe code.

## 29. Task Completion Rule

A task is complete only when all requested behavior has been implemented and verified.

Do not stop because:

- the main screen works
- one scenario works
- the first test passes
- the code compiles
- one file was changed
- a partial implementation looks correct

Continue until the entire requested goal is covered.

## 30. Final Checklist

Before finishing any task, verify:

- [ ] I inspected the actual existing flow before changing it.
- [ ] I checked related files/usages and did not guess behavior.
- [ ] I matched the existing code-writing style.
- [ ] I kept changes minimal and relevant.
- [ ] I avoided unnecessary variables and abstractions.
- [ ] I used the correct state/ref/local-variable choice.
- [ ] I considered rerender behavior.
- [ ] I used hooks correctly.
- [ ] I memoized callbacks/values where there is a real performance benefit.
- [ ] I avoided inline styles.
- [ ] I avoided unnecessary inline functions.
- [ ] I used appropriate collection methods for readable logic.
- [ ] I considered tablet UI using `isTablet` where applicable.
- [ ] I checked async/concurrency edge cases.
- [ ] I checked failure and empty states.
- [ ] I did not install unnecessary dependencies.
- [ ] I did not use scripts for source-code changes.
- [ ] I researched externally when repository evidence was insufficient.
- [ ] I re-analyzed the changed flow after the fix.
- [ ] I checked regressions and shared consumers.
- [ ] I reviewed the final diff.
- [ ] I removed temporary/debug code.
- [ ] The requested task is fully completed, not partially completed.
