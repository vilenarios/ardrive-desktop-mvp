// SYNC-19: link-generator.ts's Arweave link builders used to hardcode
// arweave.net directly, so "View on Arweave" / raw-file / tx links opened
// the exact host the product owner made the app avoid everywhere else
// (arweave.net rate-limits, 429s, some users - see src/main/gateway.ts /
// SYNC-17). These functions now take the resolved gateway host as a
// parameter and default it to turbo-gateway.com, never arweave.net, so no
// caller can silently fall back to the rate-limited host.
import { describe, it, expect } from 'vitest';
import {
  generateFileLinks,
  generateExplorerLinks,
  generateShareableFileLink,
  generateShareableDriveLink,
  DEFAULT_GATEWAY_HOST
} from '@/utils/link-generator';

describe('SYNC-19 link-generator gateway host', () => {
  it('DEFAULT_GATEWAY_HOST is turbo-gateway.com, not arweave.net', () => {
    expect(DEFAULT_GATEWAY_HOST).toBe('turbo-gateway.com');
    expect(DEFAULT_GATEWAY_HOST).not.toBe('arweave.net');
  });

  describe('generateFileLinks', () => {
    it('defaults raw/tx links to turbo-gateway.com when no host is passed', () => {
      const links = generateFileLinks('DATA_TX_ID', 'META_TX_ID');
      expect(links.rawFileUrl).toBe('https://turbo-gateway.com/DATA_TX_ID');
      expect(links.dataTransactionUrl).toBe('https://turbo-gateway.com/tx/DATA_TX_ID');
      expect(links.metadataTransactionUrl).toBe('https://turbo-gateway.com/tx/META_TX_ID');
      expect(links.rawFileUrl).not.toContain('arweave.net');
      expect(links.dataTransactionUrl).not.toContain('arweave.net');
    });

    it('builds raw/tx links from a caller-supplied gateway host', () => {
      const links = generateFileLinks('DATA_TX_ID', 'META_TX_ID', undefined, undefined, undefined, 'my-gateway.example');
      expect(links.rawFileUrl).toBe('https://my-gateway.example/DATA_TX_ID');
      expect(links.dataTransactionUrl).toBe('https://my-gateway.example/tx/DATA_TX_ID');
      expect(links.metadataTransactionUrl).toBe('https://my-gateway.example/tx/META_TX_ID');
    });

    it('still builds ArDrive app links unaffected by the gateway host param', () => {
      const links = generateFileLinks(undefined, undefined, 'file-id', 'drive-id', 'file-key', 'my-gateway.example');
      expect(links.fileViewUrl).toBe('https://app.ardrive.io/#/file/file-id/view?fileKey=file-key');
      expect(links.driveViewUrl).toBe('https://app.ardrive.io/#/drives/drive-id');
    });

    it('omits raw/tx links entirely when no tx ids are provided', () => {
      const links = generateFileLinks();
      expect(links.rawFileUrl).toBeUndefined();
      expect(links.dataTransactionUrl).toBeUndefined();
      expect(links.metadataTransactionUrl).toBeUndefined();
    });
  });

  describe('generateExplorerLinks', () => {
    it('defaults the arweave explorer link to turbo-gateway.com', () => {
      const links = generateExplorerLinks('TX_ID');
      expect(links.arweave).toBe('https://turbo-gateway.com/tx/TX_ID');
      expect(links.arweave).not.toContain('arweave.net');
    });

    it('uses a caller-supplied gateway host for the arweave explorer link', () => {
      const links = generateExplorerLinks('TX_ID', 'my-gateway.example');
      expect(links.arweave).toBe('https://my-gateway.example/tx/TX_ID');
    });

    it('leaves the third-party explorers (viewblock, arscan) untouched by the gateway host', () => {
      const links = generateExplorerLinks('TX_ID', 'my-gateway.example');
      expect(links.viewblock).toBe('https://viewblock.io/arweave/tx/TX_ID');
      expect(links.arscan).toBe('https://arscan.io/tx/TX_ID');
    });
  });

  describe('ArDrive app links (unrelated to the gateway host, sanity check)', () => {
    it('generateShareableFileLink / generateShareableDriveLink still point at app.ardrive.io', () => {
      expect(generateShareableFileLink('file-id')).toBe('https://app.ardrive.io/#/file/file-id/view');
      expect(generateShareableDriveLink('drive-id')).toBe('https://app.ardrive.io/#/drives/drive-id');
    });
  });
});
