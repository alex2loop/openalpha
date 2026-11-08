#!/usr/bin/env bun
// Makes the push key pair for one environment. stdout is the private key as a JWK JSON, for
// `wrangler secret put VAPID_PRIVATE_KEY`; stderr is the public key, for `build:brief
// --vapid-public-key`. Run it once per environment and keep neither on disk.
import { importVapidKey, VAPID_CURVE } from '../deploy/brief/src/vapid'

const pair = await crypto.subtle.generateKey(VAPID_CURVE, true, ['sign', 'verify'])
const { kty, crv, d, x, y } = await crypto.subtle.exportKey('jwk', pair.privateKey)
const secret = JSON.stringify({ kty, crv, d, x, y })
const { publicKey } = await importVapidKey(secret)

process.stdout.write(secret)
console.error(`vapid-keys: public key ${publicKey}`)
