// TRUST-4 (DESIGN-8): SeedPhraseDisplay used to always render the real word
// text and merely dim it (`opacity: showSeedPhrase ? 1 : 0.1`) -- the
// plaintext recovery phrase stayed in the DOM (and the accessibility tree)
// the entire time, regardless of "hidden" state. A screen reader would read
// it, and it was trivially visible via DOM inspection. This suite pins the
// fixed contract: while hidden, the real words are never in the rendered
// output at all (masked placeholders render instead, and the grid is
// aria-hidden); revealing swaps in the genuine words.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { SeedPhraseDisplay } from '../../../src/renderer/components/common/SeedPhraseDisplay';

const SENTINEL_PHRASE =
  'sentinelalpha sentinelbravo sentinelcharlie sentineldelta sentinelecho sentinelfoxtrot ' +
  'sentinelgolf sentinelhotel sentinelindia sentineljuliett sentinelkilo sentinellima';

describe('SeedPhraseDisplay masking (TRUST-4)', () => {
  it('never renders the real words in the DOM while hidden', () => {
    render(<SeedPhraseDisplay seedPhrase={SENTINEL_PHRASE} showByDefault={false} />);

    // None of the real words should appear anywhere in the rendered output.
    for (const word of SENTINEL_PHRASE.split(' ')) {
      expect(screen.queryByText(word)).not.toBeInTheDocument();
    }
  });

  it('aria-hides the word grid while masked, so assistive tech gets nothing', () => {
    render(<SeedPhraseDisplay seedPhrase={SENTINEL_PHRASE} showByDefault={false} />);
    expect(screen.getByTestId('seed-phrase-grid')).toHaveAttribute('aria-hidden', 'true');
  });

  it('reveals the genuine words (and clears aria-hidden) once the user clicks Reveal', async () => {
    const user = userEvent.setup();
    render(<SeedPhraseDisplay seedPhrase={SENTINEL_PHRASE} showByDefault={false} />);

    await user.click(screen.getByText('Reveal Recovery Phrase'));

    expect(screen.getByText('sentinelalpha')).toBeInTheDocument();
    expect(screen.getByText('sentinellima')).toBeInTheDocument();
    expect(screen.getByTestId('seed-phrase-grid')).toHaveAttribute('aria-hidden', 'false');
  });

  it('renders the real words directly when showByDefault is true', () => {
    render(<SeedPhraseDisplay seedPhrase={SENTINEL_PHRASE} showByDefault={true} />);
    expect(screen.getByText('sentinelalpha')).toBeInTheDocument();
  });
});
