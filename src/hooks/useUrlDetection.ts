/**
 * Hook for detecting and enriching URLs with metadata from connected MCPs
 *
 * Used by TaskModal to detect pasted URLs and offer to convert them to pills.
 */

import { useState, useCallback } from 'react';
import { getLinkMetadata, type LinkMetadata } from '../api/client';

export interface PendingUrl {
  url: string;
  metadata: LinkMetadata;
}

export interface UseUrlDetectionResult {
  /** Currently pending URL awaiting user decision */
  pendingUrl: PendingUrl | null;
  /** Whether we're currently fetching metadata */
  isLoading: boolean;
  /** Check if a URL can be enriched and set it as pending if so */
  checkUrl: (url: string) => Promise<boolean>;
  /** Clear the pending URL (user declined or accepted) */
  clear: () => void;
  /** Convert URL to pill markdown syntax */
  toPillSyntax: (pending: PendingUrl) => string;
}

const URL_REGEX = /https?:\/\/[^\s<>"\]]+/g;

/**
 * Extract the first URL from text
 */
export function extractUrl(text: string): string | null {
  const matches = text.match(URL_REGEX);
  return matches?.[0] ?? null;
}

/**
 * Convert a pending URL to pill markdown syntax
 */
function toPillSyntax(pending: PendingUrl): string {
  return `[pill:${pending.metadata.type}:${pending.metadata.title}](${pending.url})`;
}

/**
 * Hook for URL detection and metadata fetching
 */
export function useUrlDetection(projectId?: string): UseUrlDetectionResult {
  const [pendingUrl, setPendingUrl] = useState<PendingUrl | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const checkUrl = useCallback(
    async (url: string): Promise<boolean> => {
      if (!projectId || !url) return false;

      setIsLoading(true);
      try {
        const result = await getLinkMetadata(projectId, url);
        if (result.success && result.data) {
          setPendingUrl({ url, metadata: result.data });
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [projectId]
  );

  const clear = useCallback(() => {
    setPendingUrl(null);
  }, []);

  return {
    pendingUrl,
    isLoading,
    checkUrl,
    clear,
    toPillSyntax,
  };
}
