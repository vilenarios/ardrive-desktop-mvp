// @vitest-environment node
//
// SYNC-17 flapping tolerance: turbo-gateway.com data availability is
// eventually-consistent — the same txid can flap 200 -> 302 -> 404/504 under
// load. The app's own direct download path (StreamingDownloader, used by
// DownloadManager for public files) must NOT treat a single transient failure
// as a permanent "not found"/failure.
//
// StreamingDownloader wraps each fetch attempt (performDownload) in a bounded
// retry-with-backoff loop (attempt <= maxRetries, delay = retryDelay * attempt).
// Under the hood the fetch is axios, which throws on a 404/504 response
// (default validateStatus rejects >= 400) and follows the sandbox 302
// (default maxRedirects: 5) — so a thrown attempt IS a flap and MUST be retried.
//
// These tests drive the real downloadFile() retry loop, standing in a spy for
// the private performDownload so we exercise the retry/backoff/abort logic
// without real network or file streams.
import { describe, it, expect, vi } from 'vitest';
import { StreamingDownloader } from '@/main/sync/StreamingDownloader';

// Shape of a real axios 4xx/5xx rejection (retryable — NOT an abort).
function httpError(status: number): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status }
  });
}

describe('SYNC-17 StreamingDownloader flapping tolerance', () => {
  it('recovers from a transient 404 then succeeds on retry (does not fail permanently)', async () => {
    const dl = new StreamingDownloader();
    const perform = vi
      .spyOn(dl as any, 'performDownload')
      .mockRejectedValueOnce(httpError(404)) // first attempt flaps
      .mockResolvedValueOnce({ hash: 'deadbeef' }); // gateway becomes consistent

    const result = await dl.downloadFile(
      'https://turbo-gateway.com/some-txid',
      '/tmp/sync17-does-not-exist/file.bin',
      'dl-flap-1',
      { maxRetries: 3, retryDelay: 5 }
    );

    expect(result).toEqual({ hash: 'deadbeef' });
    expect(perform).toHaveBeenCalledTimes(2); // retried exactly once
  });

  it('recovers from a transient 504 as well', async () => {
    const dl = new StreamingDownloader();
    const perform = vi
      .spyOn(dl as any, 'performDownload')
      .mockRejectedValueOnce(httpError(504))
      .mockRejectedValueOnce(httpError(504))
      .mockResolvedValueOnce({ hash: 'cafef00d' });

    const result = await dl.downloadFile('https://turbo-gateway.com/tx', '/tmp/sync17-x/f', 'dl-flap-2', {
      maxRetries: 3,
      retryDelay: 5
    });

    expect(result).toEqual({ hash: 'cafef00d' });
    expect(perform).toHaveBeenCalledTimes(3);
  });

  it('gives up after the bounded retries when the gateway never recovers (no false success)', async () => {
    const dl = new StreamingDownloader();
    const perform = vi.spyOn(dl as any, 'performDownload').mockRejectedValue(httpError(504));

    await expect(
      dl.downloadFile('https://turbo-gateway.com/tx', '/tmp/sync17-y/f', 'dl-flap-3', {
        maxRetries: 2,
        retryDelay: 5
      })
    ).rejects.toThrow(/after 3 attempts/);

    expect(perform).toHaveBeenCalledTimes(3); // initial + 2 retries, then throw
  });

  it('does NOT retry an aborted (user-cancelled) download', async () => {
    const dl = new StreamingDownloader();
    const abortErr = Object.assign(new Error('canceled'), { code: 'ABORT_ERR' });
    const perform = vi.spyOn(dl as any, 'performDownload').mockRejectedValue(abortErr);

    await expect(
      dl.downloadFile('https://turbo-gateway.com/tx', '/tmp/sync17-z/f', 'dl-flap-4', {
        maxRetries: 5,
        retryDelay: 5
      })
    ).rejects.toThrow('canceled');

    expect(perform).toHaveBeenCalledTimes(1); // aborted → no retries
  });
});
