// Compatibility shim for callers that still import the historical module name.
// Pending JSON/CSV state no longer exists; package sizing lives in public-package.mjs.
export { INITIAL_CSV_RECORD_LIMIT, takeInitialPackage } from './public-package.mjs';
