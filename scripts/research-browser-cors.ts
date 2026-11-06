#!/usr/bin/env bun
// Measure which providers a browser page can read, and print what the browser route set serves.
//
// Each adapter is run against a recording `fetch`, so the request measured is the one its real
// request path builds (path, params, headers) under `PAGE_REQUEST_SHAPE`, never a host root: a root
// misreports, cafef's has no CORS header while its `GDTuDoanh.ashx` sends `*`. The recorded request
// is then sent once with an `Origin` header, redirects followed by hand because a browser checks
// each hop (and sends `Origin: null` once a hop leaves the origin), with an OPTIONS preflight first
// when the request is not simple.
//
// Read-only: GET and OPTIONS against public endpoints, one request per provider origin. A provider
// whose credential is not in the environment is listed as not measured; no key is read from a file.
//
// Usage:
//   bun scripts/research-browser-cors.ts
//
// Stands outside the runtime on purpose: it fires real requests the runtime never sends this way.
import { captureRequests } from './research-browser-cors/capture'
import { measureAll } from './research-browser-cors/measure'
import {
  passingIds,
  printMeasurements,
  printNotMeasured,
  printRouteTable,
  printVerdict,
} from './research-browser-cors/report'

const { captured, unprobed, needsKey } = await captureRequests()
const measured = await measureAll(captured)

printMeasurements(measured)
printNotMeasured(unprobed, needsKey)
printVerdict(passingIds(measured), measured)
printRouteTable()
