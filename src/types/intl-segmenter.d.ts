/**
 * Type declarations for Intl.Segmenter (ES2022+).
 * Needed because TypeScript's lib.es2022.intl.d.ts isn't being loaded properly.
 */

declare namespace Intl {
  interface SegmenterOptions {
    localeMatcher?: 'best fit' | 'lookup';
    granularity?: 'grapheme' | 'word' | 'sentence';
  }

  interface SegmentData {
    segment: string;
    index: number;
    input: string;
    isWordLike?: boolean;
  }

  interface Segments {
    containing(codeUnitIndex?: number): SegmentData | undefined;
    [Symbol.iterator](): IterableIterator<SegmentData>;
  }

  class Segmenter {
    constructor(locales?: string | string[], options?: SegmenterOptions);
    segment(input: string): Segments;
    resolvedOptions(): {
      locale: string;
      granularity: 'grapheme' | 'word' | 'sentence';
    };
    static supportedLocalesOf(
      locales: string | string[],
      options?: { localeMatcher?: 'best fit' | 'lookup' }
    ): string[];
  }
}
