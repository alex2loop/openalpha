import { z } from 'zod'

// The page's CSP forbids `new Function`, which zod probes for when a schema is built. Imported
// before everything else in the worker entry, because every schema module builds at import time.
z.config({ jitless: true })
