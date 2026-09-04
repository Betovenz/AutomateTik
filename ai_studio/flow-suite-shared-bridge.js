// Client-side ESM bootstrap for the flow-suite shared catalog/prompt modules
// (lib/flow-suite/shared/{catalog,prompt}.mjs). app.js is a classic (non-
// module) script, so it can't `import` these directly — this module script
// loads them once and republishes everything on window.FlowSuiteShared,
// firing a "flow-suite-shared-ready" event so app.js's flow-page init can
// either read it synchronously (if already loaded) or wait for the event
// (module scripts execute after classic scripts of the same relative order,
// so there IS a real race here — never assume window.FlowSuiteShared is
// already set at classic-script parse time).
import * as catalog from "/lib/flow-suite/shared/catalog.mjs";
import * as prompt from "/lib/flow-suite/shared/prompt.mjs";

window.FlowSuiteShared = { ...catalog, ...prompt };
window.dispatchEvent(new Event("flow-suite-shared-ready"));
