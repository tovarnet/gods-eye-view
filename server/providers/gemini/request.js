import { readRequestBody } from '../common/request.js';
import { admitSameSiteRequest } from '../../../src/localRequestGate.mjs';
import {
  isAllowedHost,
  resolveAllowedHosts,
} from '../../../build/allowedHosts.js';

/** Use the app's Host and request policies, with a required browser Origin. */
export function isGeminiRequestOriginAllowed(
  req,
  configuredHost = '',
  configuredAllowedHosts,
  trustReverseProxy = process.env.GEV_TRUST_REVERSE_PROXY,
) {
  const directHost = req.headers?.host;
  const origin = req.headers?.origin;
  const allowProxy = ['1', 'true', 'yes'].includes(
    String(trustReverseProxy || '').trim().toLowerCase(),
  );
  const forwardedHost = String(req.headers?.['x-forwarded-host'] || '').trim();
  const host =
    allowProxy &&
    forwardedHost &&
    !forwardedHost.includes(',') &&
    !/[\s/?#@\\]/.test(forwardedHost)
      ? forwardedHost
      : directHost;
  if (
    typeof host !== 'string' ||
    typeof origin !== 'string' ||
    !host ||
    !origin ||
    /[\s/?#@\\]/.test(host)
  )
    return false;
  const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '')
    .trim()
    .toLowerCase();
  const protocol =
    allowProxy && (forwardedProto === 'https' || forwardedProto === 'http')
      ? `${forwardedProto}:`
      : req.socket?.encrypted
        ? 'https:'
        : 'http:';
  if (
    !admitSameSiteRequest({
      hostHeader: host,
      protocol,
      origin,
      secFetchSite: req.headers?.['sec-fetch-site'],
      proxyHeaders: req.headers || {},
      allowProxy,
    }).ok
  )
    return false;
  // The shared gate compares a present Origin exactly with the public
  // authority. In trusted-proxy mode the allowed-host check must use that same
  // forwarded public Host rather than the container's internal Host.
  const boundHost = String(configuredHost || '')
    .trim()
    .toLowerCase();
  return isAllowedHost(host, resolveAllowedHosts(configuredAllowedHosts), [
    boundHost,
  ]);
}

/** Admit only the existing input gesture; callers cannot supply model/setup. */
export async function readGeminiTokenRequest(req, signal, maxBytes = 1024) {
  const declared = Number(req.headers?.['content-length']);
  const fail = (code) =>
    Object.assign(new Error('Invalid token request'), { code });
  const body = await readRequestBody(
    req,
    maxBytes,
    Number.isFinite(declared) && declared > maxBytes
      ? AbortSignal.abort(fail('BODY_TOO_LARGE'))
      : signal,
  );
  if (!body.trim()) return 'open-mic';
  if (
    !/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '')
  )
    throw fail('BAD_CONTENT_TYPE');
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw fail('BAD_BODY');
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
    throw fail('BAD_BODY');
  const keys = Object.keys(parsed);
  if (!keys.length) return 'open-mic';
  if (
    keys.length === 1 &&
    keys[0] === 'inputMode' &&
    parsed.inputMode === 'push-to-talk'
  )
    return 'push-to-talk';
  throw fail('BAD_BODY');
}
