import { TeletextTerminal } from "./core/teletext.js"; // Import the Teletext core
import { runStoryLoop } from "./story/story.js"; // Import the story runner

const canvas = document.getElementById("crt"); // Fetch the canvas element

if (!canvas) { // Fail clearly if the element is missing
  throw new Error('Canvas element with id "crt" was not found.'); // Throw a helpful error
} // End guard

// Detect if we're on a touch device
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

// Mobile keyboard handling
const mobileKeyboard = document.getElementById("mobile-keyboard");
let keyboardVisible = false;

function showMobileKeyboard() {
  if (isTouchDevice && mobileKeyboard) {
    mobileKeyboard.classList.add("active");
    keyboardVisible = true;
  }
}

function hideMobileKeyboard() {
  if (isTouchDevice && mobileKeyboard) {
    mobileKeyboard.classList.remove("active");
    keyboardVisible = false;
  }
}

// Hook into terminal's input mode
const originalSetInputMode = TeletextTerminal.prototype.setInputMode;
TeletextTerminal.prototype.setInputMode = function(on) {
  originalSetInputMode.call(this, on);
  if (on) {
    showMobileKeyboard();
  } else {
    hideMobileKeyboard();
  }
};

const term = new TeletextTerminal(canvas, { // Create a terminal instance
  cols: 40, // Teletext columns
  rows: 25, // Teletext rows
  scale: 3 // Upscaling factor (keeps the chunky look)
}); // End terminal creation

// Wire up mobile keyboard buttons
if (isTouchDevice && mobileKeyboard) {
  mobileKeyboard.addEventListener("click", (e) => {
    const key = e.target.closest(".keyboard-key");
    if (!key) return;

    const keyValue = key.dataset.key;
    if (!keyValue) return;

    // Simulate keyboard events
    if (keyValue === "enter") {
      term._pushKey({ type: "enter" });
    } else if (keyValue === "backspace") {
      term._pushKey({ type: "backspace" });
    } else {
      term._pushKey({ type: "char", ch: keyValue });
    }

    // Visual feedback
    key.style.transform = "scale(0.95)";
    setTimeout(() => {
      key.style.transform = "";
    }, 100);
  });
}

term.start(); // Start the render loop

// Make it easy to "wake" key handling on click (handy on Safari). // Note
canvas.addEventListener("pointerdown", () => { // On click/tap
  canvas.focus(); // Focus the canvas (helps some browsers deliver key events)
  
  // On mobile, tapping the canvas acts like pressing Enter to advance
  if (isTouchDevice && !keyboardVisible) {
    term._pushKey({ type: "enter" });
  }
}); // End listener

// Run the story with top-level error handling. // Note
(async () => { // Start async wrapper
  try { // Try to run the story loop
    await runStoryLoop(term); // Run story runner
  } catch (err) { // If anything explodes
    console.error(err); // Log for debugging
    term.clearScreen(); // Clear screen
    term.printStreamAt(1, 1, term.T(term.CC.ALPHA_RED) + "FATAL ERROR"); // Title
    term.printStreamAt(1, 3, term.T(term.CC.ALPHA_WHITE) + String(err?.message ?? err)); // Message
    term.forceRedraw(); // Ensure the user sees it
  } // End catch
})(); // End wrapper
