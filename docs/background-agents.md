# Background Android agents

The Agent screen submits a task to `agentRuntime`. Android's
`AgentForegroundService` starts the registered `AOTGAgentTask` Headless JS task,
which owns execution independently of the screen's mount/unmount lifecycle.
The existing accessibility agent uses the loaded local model and observes the
visible Android app before each action.

## Running a task

1. Load a local model and enable AOTG's accessibility service.
2. Finish any chat generation or Live Voice Talk session.
3. Open the Agent screen, enter an instruction, and start the task.
4. Keep the phone unlocked while the agent operates the target app.
5. Use **Stop** in the notification or **Cancel** in the Agent screen to stop it.

Background means AOTG's screen does not have to remain visible. The agent still
uses the phone's visible UI. It cannot independently operate an app on a hidden
display while the user works in a different app. Screen-off and keyguard lock
pause actions; unlocking causes the agent to observe again. The task deadline
continues while paused.

## Lifecycle and ownership

- Only one task may start or run at a time. Task IDs scope controls, progress,
  model ownership and cleanup. Duplicate headless deliveries do not execute twice.
- The starting checkpoint is persisted before claiming the model and starting
  the foreground service. Failed startup does not press Home or execute a plan.
- Model ownership excludes chat, model replacement/unloading, and Live Voice Talk.
  Starting and ending an agent create separate model conversations. Generation
  request IDs prevent late tokens or completions from reaching a different caller.
- Stop closes the native action gate immediately and interrupts agent inference.
  A native watchdog stops the service if JS does not acknowledge cancellation.
- Default limits are 25 steps, 120 seconds per inference, and 10 minutes per task.
  Native code caps the task lifetime at 10 minutes. Cleanup gets a short grace
  period; a model session that fails to stop stays reserved rather than being reused.
- Every planned action is checkpointed before execution. Native code then checks
  task status, lock state, screen epoch, package, window and observed elements.
  Changed targets are rejected so the agent can observe again.
- Task history is stored locally with a maximum of 50 records. Screenshots,
  captured accessibility trees and streamed model output are omitted. Instructions,
  chosen actions (including entered text), summaries and short action reasoning
  remain in local history.
- A process kill or force-stop ends execution. On reopening AOTG, unfinished
  records become **Interrupted**. Actions are never automatically replayed: the
  user should inspect the target app before starting a new task. There is no boot
  receiver, scheduling service or automatic restart in this implementation.

## Automated validation

```sh
npm ci
npx tsc --noEmit
npx jest --runInBand
node node_modules/react-native/scripts/generate-codegen-artifacts.js --path . --targetPlatform android --outputPath /tmp/aotg-codegen
cd android
./gradlew :app:compileDebugKotlin :app:assembleDebug --console=plain
```

Jest covers startup failure, cancellation while acquiring the model, duplicate
submissions/deliveries, interrupted recovery, checkpoint failures, lock/unlock
replanning, inference timeouts, repeated actions, malformed model output, and
request-scoped generation events. These use mocked Android services and do not
replace compilation or device testing.

## Device verification before release

Use a physical Android device with a local model loaded. Test both text-only and
vision-capable model configurations and the Android versions supported by the app.

| Scenario | Expected behavior |
| --- | --- |
| Start a simple task such as opening Settings | Notification appears before AOTG goes Home; task continues after its screen unmounts. |
| Stop during inference, a wait, or between actions | No further UI action; cancelled result persists; notification disappears after cleanup. |
| Start twice quickly | Only one task and model owner exist. |
| Lock and unlock during inference | No action while locked; pre-lock plan is discarded. |
| Change the target UI during inference | Old target is rejected; a fresh observation is used. |
| Start chat/Live Talk, switch or unload models during a task | Native ownership rejects the conflicting operation; agent remains isolated. |
| Let a task exceed its deadline | Failed timeout result; native gate closes and service stops. |
| Kill/force-stop AOTG, then reopen | Interrupted record; no automatic action replay. |
| Deny foreground startup or revoke accessibility | Failure is visible and the model reservation is released. |
| Return to Agent on phone and tablet layouts | Current progress or terminal result is displayed; active task cannot be reset. |

The foreground service uses Android's `specialUse` type with an explanatory
manifest property. This declaration alone does not grant store approval or remove
Android/OEM process restrictions. Validate distribution requirements separately
before releasing autonomous accessibility features.
