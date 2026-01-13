/* story.js - timed story runner with pressure and subtle corrupted repeats

Step types supported by the story engine (used in story.json):

  - goto            { scene }
    Jump to another scene by id.

  - end             { }
    Terminates the story loop.

  - clear           { }
    Clears the current print area.

  - clearScreen     { }
    Clears the whole screen.

  - setArea         { x, y, w, h }
    Sets the text print area rectangle.

  - tighten         { step }
    Shrinks the print area inward and bumps pressure slightly.

  - raw             { x, y, text }
    Prints text at fixed coordinates without wrapping.

  - line            { text }
    Prints wrapped text inside the current area.

  - lineIf          { condVar, equals, text }
    Like line, but only when state[condVar] === equals.

  - beep            { freq?, ms?, gain? }
    Plays a short retro beep.

  - pause           { ms?, skippable? }
    Waits for a duration (default meta.defaultPauseMs); Enter can skip.

  - return          { timeoutMs? }
    Waits for Enter indefinitely, or until timeoutMs via polling.

  - pressReturn     { timeoutMs?, prompt? }
    Optional prompt line, then wait for Enter or timeout
    (default timeout meta.defaultPressTimeoutMs).

  - input           { var, maxLen?, trim?, upper?, default?, defaultFromMeta? }
    Free-text input stored in state[var].

  - yesno           { var }
    Single-key Y/N input stored as 1/0 in state[var].

  - branch          { var, cases }
    Looks up cases[String(state[var])] to choose the next scene id.

  - glitch          { rounds?, intensity? }
    Runs a short glitch text burst and bumps pressure.
*/

export async function runStoryLoop(term) { // Run the story
  const story = await loadStoryData(); // Load JSON
  const state = {}; // State bag

  state._pressure = 0; // Pressure 0..1
  state._pressureStartMs = Date.now(); // Session start time
  state._stepsSeen = 0; // Steps counter
  state._echoCooldown = 0; // Echo cooldown steps
  state._echoHistory = []; // Recent echoes

  if (typeof term.setPressure === "function") term.setPressure(state._pressure); // Initialise pressure

  let sceneId = story.startScene; // Starting scene

  while (true) { // Main loop
    if (!sceneId) break; // Safety stop
    const scene = story.scenes[sceneId]; // Resolve scene
    if (!scene) throw new Error(`Unknown scene: ${sceneId}`); // Invalid scene id

    const nextSceneId = await runScene(term, story, state, scene); // Play scene
    if (nextSceneId === "__END__") break; // End sentinel
    sceneId = nextSceneId; // Advance
  } // End loop
} // End runStoryLoop

async function loadStoryData() { // Load story.json
  const url = new URL("./story.json", import.meta.url); // Resolve URL
  const res = await fetch(url); // Fetch
  if (!res.ok) throw new Error(`Failed to load story.json: ${res.status}`); // Validate
  return await res.json(); // Parse JSON
} // End loadStoryData

async function runScene(term, story, state, scene) { // Play a single scene
  let nextSceneId = null; // Transition target

  for (const step of scene.steps) { // Steps
    if (!step || !step.type) continue; // Skip invalid

    updatePressureBaseline(term, state, step); // Update pressure
    await executeStep(term, story, state, step, (id) => { nextSceneId = id; }); // Execute step
    await maybePrintEcho(term, state); // Occasional echoes

    if (nextSceneId) break; // Stop on transition
  } // End steps

  return nextSceneId; // Return next scene
} // End runScene

async function executeStep(term, story, state, step, setNextSceneId) { // Execute one story step
  const type = step.type; // Type

  if (type === "goto") { setNextSceneId(step.scene); return; } // Scene transition
  if (type === "end") { setNextSceneId("__END__"); return; } // End

  if (type === "clear") { term.procCLEAR(); return; } // Clear print area
  if (type === "clearScreen") { term.clearScreen(); return; } // Clear whole screen
  if (type === "setArea") { term.setPrintArea(step.x, step.y, step.w, step.h); return; } // Set area
  if (type === "tighten") { term.tighten(step.step); applyPressureSpike(term, state, 0.04); return; } // Tighten + pressure

  if (type === "raw") { // Raw print
    const txt = renderText(term, state, step.text ?? ""); // Render
    term.printStreamAt(step.x ?? 0, step.y ?? 0, txt); // Print
    term.forceRedraw(); // Ensure redraw
    return; // Done
  } // End raw

  if (type === "line") { // Wrapped line
    const txt = renderText(term, state, step.text ?? ""); // Render
    await term.procLINE(txt); // Print
    return; // Done
  } // End line

  if (type === "lineIf") { // Conditional wrapped line
    const condVar = step.condVar; // Variable to inspect
    const expected = step.equals; // Expected value
    const actual = state[condVar]; // Current value
    if (actual === expected) { // Only print when condition matches exactly
      const txt = renderText(term, state, step.text ?? ""); // Render
      await term.procLINE(txt); // Print
    }
    return; // Done either way
  } // End lineIf

  if (type === "beep") { // Beep
    term.beep(step.freq ?? 880, step.ms ?? 40, step.gain ?? 0.012); // Play
    return; // Done
  } // End beep

  if (type === "pause") { // Timed pause (silent, skippable by Enter)
    if (term._inputMode) return; // No pauses while waiting for input
    const ms = step.ms ?? (story.meta?.defaultPauseMs ?? 1200); // Duration
    increasePressureOverPause(term, state, ms); // Drift pressure
    await waitForEnterOrTimeout(term, ms); // Wait or Enter
    return; // Done
  } // End pause

  if (type === "pressReturn") { // Explicit "press Enter" beat with optional prompt
    if (term._inputMode) return; // No waits while gathering input

    const promptText = step.prompt ?? story.meta?.defaultPressPrompt ?? ""; // Optional prompt
    const timeoutMs = step.timeoutMs ?? (story.meta?.defaultPressTimeoutMs ?? 1600); // Duration

    if (promptText) { // Show prompt if provided
      const renderedPrompt = renderText(term, state, promptText); // Apply markup/vars
      await term.procLINE(renderedPrompt); // Print prompt line
    }

    await waitForEnterOrTimeout(term, timeoutMs); // Wait for Enter or timeout
    return; // Done
  } // End pressReturn

  if (type === "return") { // Wait for Enter (optionally timed)
    const timeoutMs = step.timeoutMs ?? null; // Timeout
    if (timeoutMs === null) await term.procRETURN(); // Wait
    else await waitForEnterOrTimeout(term, timeoutMs); // Timed wait
    return; // Done
  } // End return

  if (type === "input") { // Input
    const raw = await term.procGPI(step.maxLen ?? 18); // Read
    let val = raw; // Value
    if (step.trim) val = val.trim(); // Trim
    if (step.upper) val = val.toUpperCase(); // Upper
    if (!val.length) val = step.default ?? (story.meta?.[step.defaultFromMeta] ?? ""); // Default
    state[step.var] = val; // Store
    applyPressureSpike(term, state, 0.02); // Small pressure bump
    return; // Done
  } // End input

  if (type === "yesno") { // Yes/No input
    let y = -1; // Invalid
    while (y < 0) y = await term.procYESORNO(); // Loop
    state[step.var] = y; // Store
    applyPressureSpike(term, state, 0.015); // Small bump
    return; // Done
  } // End yesno

  if (type === "branch") { // Branch on state var
    const v = String(state[step.var]); // Value
    const targetSceneId = step.cases?.[v]; // Case
    if (!targetSceneId) throw new Error(`Branch missing case for ${step.var}=${v}`); // Validate
    setNextSceneId(targetSceneId); // Transition
    return; // Done
  } // End branch

  if (type === "glitch") { // Glitch pulse
    applyPressureSpike(term, state, 0.03); // Pressure bump
    await runGlitchBurst(term, story, step.rounds ?? 10, step.intensity ?? 3); // Pulse
    return; // Done
  } // End glitch
} // End executeStep

function renderText(term, state, text) { // Render variables and markup
  const withVars = String(text).replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, k) => { // Replace tokens
    const v = state[k]; // Lookup
    return v === undefined || v === null ? "" : String(v); // Substitute
  }); // End replace
  return applyMarkup(term, withVars); // Apply [COLOUR] tags
} // End renderText

function applyMarkup(term, text) { // Convert tags to control codes
  const map = { // Tag mapping
    BLACK: term.T(term.CC.ALPHA_BLACK),
    RED: term.T(term.CC.ALPHA_RED),
    GREEN: term.T(term.CC.ALPHA_GREEN),
    YELLOW: term.T(term.CC.ALPHA_YELLOW),
    BLUE: term.T(term.CC.ALPHA_BLUE),
    MAGENTA: term.T(term.CC.ALPHA_MAGENTA),
    CYAN: term.T(term.CC.ALPHA_CYAN),
    WHITE: term.T(term.CC.ALPHA_WHITE),
    FLASH: term.T(term.CC.FLASH),
    STEADY: term.T(term.CC.STEADY)
  }; // End map

  return String(text).replace(/\[([A-Z_]+)\]/g, (_, tag) => map[tag] ?? `[${tag}]`); // Replace tags
} // End applyMarkup

async function waitForEnterOrTimeout(term, timeoutMs) { // Wait for Enter or timeout
  const start = Date.now(); // Start time
  while (true) { // Poll loop
    const remaining = timeoutMs - (Date.now() - start); // Remaining
    if (remaining <= 0) return false; // Timed out
    const k = await term.nextKey(Math.min(remaining, 40)); // Poll keys more frequently for snappier input
    if (k && k.type === "enter") return true; // Enter
  } // End loop
} // End waitForEnterOrTimeout

async function runGlitchBurst(term, story, rounds, intensity) { // Glitch runner
  const tech = story.glitchPools?.tech ?? []; // Pools
  const cosmic = story.glitchPools?.cosmic ?? [];
  const rogue = story.glitchPools?.rogue ?? [];

  const pick = (arr) => arr[(Math.random() * arr.length) | 0] ?? ""; // Picker

  await term.glitchPulse(rounds, intensity, (i) => { // Print burst
    if (i % 3 === 0) return `SYSTEM: ${pick(tech)} — ${pick(cosmic)}.`; // System line
    return pick(rogue); // Rogue line
  }); // End pulse
} // End runGlitchBurst

function clamp01(x) { // Clamp into 0..1
  return Math.max(0, Math.min(1, x)); // Clamp
} // End clamp01

function smoothstep(edge0, edge1, x) { // Smoothstep
  const t = clamp01((x - edge0) / (edge1 - edge0)); // Normalise
  return t * t * (3 - 2 * t); // Smoothstep curve
} // End smoothstep

function updatePressureBaseline(term, state, step) { // Update pressure baseline
  state._stepsSeen += 1; // Count steps

  const stepRamp = Math.min(0.18, state._stepsSeen * 0.00035); // Step creep
  const elapsedSec = (Date.now() - state._pressureStartMs) / 1000; // Seconds
  const timeRamp = Math.min(0.35, elapsedSec * 0.0006); // Time creep
  const base = 0.08 + stepRamp + timeRamp; // Baseline

  state._pressure = clamp01(Math.max(state._pressure, base)); // Apply baseline

  if (step?.type === "tighten") state._pressure = clamp01(state._pressure + 0.015); // Tighten bump
  if (step?.type === "glitch") state._pressure = clamp01(state._pressure + 0.01); // Glitch bump

  if (typeof term.setPressure === "function") term.setPressure(state._pressure); // Inform terminal
} // End updatePressureBaseline

function increasePressureOverPause(term, state, ms) { // Drift pressure via time
  const drift = Math.min(0.02, (ms / 1000) * 0.0022); // Drift amount
  state._pressure = clamp01(state._pressure + drift); // Apply
  if (typeof term.setPressure === "function") term.setPressure(state._pressure); // Inform
} // End increasePressureOverPause

function applyPressureSpike(term, state, amt) { // Spike pressure
  state._pressure = clamp01(state._pressure + amt); // Apply
  if (typeof term.setPressure === "function") term.setPressure(state._pressure); // Inform
} // End applyPressureSpike

async function maybePrintEcho(term, state) { // Occasional corrupted repeats
  if (state._echoCooldown > 0) { state._echoCooldown -= 1; return; } // Cooldown

  const hasFuel = Boolean(state.day || state.avoid || state.fear || state.want || state.describe); // Any content
  if (!hasFuel) return; // No echo

  const p = state._pressure; // Pressure
  const chance = 0.003 + (0.06 - 0.003) * smoothstep(0.25, 0.95, p); // 0.3%..6%
  if (Math.random() > chance) return; // Usually do nothing

  const echo = buildEchoText(state, p); // Build echo
  if (!echo) return; // Skip if empty

  const recent = state._echoHistory.slice(-6); // Recent echoes
  if (recent.includes(echo)) return; // Avoid repeats

  state._echoHistory.push(echo); // Store
  state._echoCooldown = 4 + ((Math.random() * 8) | 0); // Cooldown

  // Run echo text back through the normal renderer so colour tags
  // like [CYAN]/[WHITE] are converted into control codes instead of
  // appearing literally on screen.
  const renderedEcho = renderText(term, state, echo);
  await term.procLINE(renderedEcho); // Print quietly
} // End maybePrintEcho

function buildEchoText(state, pressure) { // Build an echo line
  const options = []; // Candidate phrases
  if (state.day) options.push(`"${state.day}"`); // Day
  if (state.avoid) options.push(`${state.avoid}`); // Avoided word
  if (state.fear) options.push(`${state.fear}`); // Fear
  if (state.want) options.push(`${state.want}`); // Want
  if (state.describe) options.push(`${state.describe}`); // Describe

  if (!options.length) return ""; // Nothing

  const raw = options[(Math.random() * options.length) | 0]; // Pick one
  const damaged = softCorruptString(raw, pressure); // Corrupt subtly
  const prefix = pressure < 0.6 ? "[MAGENTA]…[WHITE] " : "[CYAN]TRACE:[WHITE] "; // Prefix
  return prefix + damaged; // Line
} // End buildEchoText

function softCorruptString(s, pressure) { // Subtle corruption (not screaming)
  const rate = 0.003 + 0.02 * smoothstep(0.35, 0.95, pressure); // 0.3%..2.3%
  const garble = ["░", "▒", "▓", "·", "•"]; // Noise glyphs
  let out = ""; // Output

  for (let i = 0; i < s.length; i += 1) { // Loop chars
    const ch = s[i]; // Char

    // Preserve any [TAG] style colour markers exactly so they
    // continue to be recognised by the markup renderer.
    if (ch === "[") { // Potential tag start
      const closeIdx = s.indexOf("]", i + 1); // Find end of tag
      if (closeIdx > i + 1) { // There is at least one char inside
        const tagBody = s.slice(i + 1, closeIdx); // TAG content
        if (/^[A-Z_]+$/.test(tagBody)) { // Looks like a colour tag
          out += s.slice(i, closeIdx + 1); // Copy [TAG] as-is
          i = closeIdx; // Skip to end of tag
          continue; // Next loop iteration
        }
      }
    }

    if (Math.random() > rate) { out += ch; continue; } // Usually unchanged

    const r = Math.random(); // Choose corruption
    if (/[a-zA-Z]/.test(ch) && r < 0.55) { // Case flip
      out += ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase(); // Flip
    } else if (r < 0.82) { // Small shift
      out += shiftChar(ch); // Shift
    } else { // Rare garble
      out += garble[(Math.random() * garble.length) | 0]; // Noise
    } // End choice
  } // End loop

  if (pressure > 0.78 && Math.random() < 0.10) out = out.replace(/["')\]]$/, ""); // Rare “missing close”
  return out; // Return
} // End softCorruptString

function shiftChar(ch) { // Shift a printable ASCII char slightly
  const code = ch.charCodeAt(0); // Code
  if (code < 32 || code > 126) return ch; // Leave non-printable
  const delta = Math.random() < 0.5 ? -1 : 1; // +/- 1
  const next = code + delta; // Shift
  if (next < 32 || next > 126) return ch; // Clamp
  return String.fromCharCode(next); // Return shifted
} // End shiftChar
