import { Resolver } from 'node:dns/promises'

import { abortError, ToolError } from '@/core/errors'
import { isBlockedIpv4 } from '@/core/ssrf/ipv4'
import { isBlockedIpv6 } from '@/core/ssrf/ipv6'

const DNS_LOOKUP_TIMEOUT_MS = 5_000

export type DnsLookupFn = (hostname: string, signal: AbortSignal) => Promise<string>

export const defaultDnsLookup: DnsLookupFn = async (hostname, signal) => {
  if (signal.aborted) {
    return Promise.reject(abortError(signal))
  }

  // Raw DNS rather than dns.lookup: OS resolution answers from /etc/hosts, mDNS and split-horizon
  // resolvers, which would decide the address behind this check. The accepted cost is that a host
  // reachable only through those paths fails here while every other tool on the box resolves it.
  const resolver = new Resolver()
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  function cleanup(): void {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
      timeoutId = undefined
    }
    resolver.cancel()
    signal.removeEventListener('abort', onAbort)
  }

  function onAbort(): void {
    cleanup()
  }

  try {
    signal.addEventListener('abort', onAbort, { once: true })

    const lookup = Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)])
    // Raced against the timeout rather than gated behind it: resolver.cancel() is expected to
    // reject the pending queries, but if the runtime's DNS shim never honours cancel(), `lookup`
    // would otherwise never settle and this function would hang forever past the timeout.
    const timeout = new Promise<'timeout'>((resolveTimeout) => {
      timeoutId = setTimeout(() => resolveTimeout('timeout'), DNS_LOOKUP_TIMEOUT_MS)
    })

    const outcome = await Promise.race([lookup, timeout])

    if (signal.aborted) {
      return Promise.reject(abortError(signal))
    }

    if (outcome === 'timeout') {
      throw new ToolError('timeout', `DNS resolution timed out for ${hostname}`)
    }

    const [v4, v6] = outcome
    const addresses = {
      v4: v4.status === 'fulfilled' ? v4.value : [],
      v6: v6.status === 'fulfilled' ? v6.value : [],
    }

    assertAddressesAllowed(hostname, addresses)
    const address = addresses.v4[0] ?? addresses.v6[0]

    if (address !== undefined) {
      return address
    }

    // Distinct from host_blocked: a dead or mistyped host is an outage, not a policy refusal, and
    // an operator auditing blocks must be able to tell them apart by code.
    throw new ToolError('dns_failure', `DNS resolution failed for ${hostname}`)
  } finally {
    cleanup()
  }
}

interface ResolvedAddresses {
  readonly v4: readonly string[]
  readonly v6: readonly string[]
}

// Every record is vetted, not only the one that will be dialed: a host answering with a mix of
// public and private addresses is refused outright instead of by luck of record ordering.
function assertAddressesAllowed(hostname: string, addresses: ResolvedAddresses): void {
  for (const address of addresses.v4) {
    if (isBlockedIpv4(address)) {
      throw new ToolError('host_blocked', `host ${hostname} resolves to blocked IPv4 ${address}`)
    }
  }

  for (const address of addresses.v6) {
    if (isBlockedIpv6(address)) {
      throw new ToolError('host_blocked', `host ${hostname} resolves to blocked IPv6 ${address}`)
    }
  }
}
