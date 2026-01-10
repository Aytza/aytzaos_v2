/**
 * RichTextEditor - contenteditable editor with inline pill rendering
 *
 * Renders pill markdown as visual LinkPill components.
 * Handles paste events for URL detection.
 * Converts back to markdown format on change.
 */

import {
  useRef,
  useEffect,
  useCallback,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import type { LinkPillType } from '../../types';
import { createPortal } from 'react-dom';
import { McpIcon } from './McpIcon';
import './RichTextEditor.css';

// Regex to match [pill:type:title](url) syntax
const PILL_REGEX = /\[pill:([^:]+):([^\]]+)\]\(([^)]+)\)/g;

// Regex to match markdown links [text](url) - but NOT pills
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;

// Regex to match bare URLs (http/https) - used for auto-linking on input
// Negative lookbehind to exclude trailing punctuation
const URL_REGEX = /https?:\/\/[^\s<>")\]]+(?<![.,;:!?)\]])/g;

// URLs that can be enriched to pills - don't auto-linkify these
const ENRICHABLE_URL_PATTERNS = [
  /^https?:\/\/(www\.)?docs\.google\.com\/document\//,
  /^https?:\/\/(www\.)?docs\.google\.com\/spreadsheets\//,
  /^https?:\/\/(www\.)?github\.com\//,
];

export interface PendingUrl {
  url: string;
  metadata: {
    type: LinkPillType;
    title: string;
  };
}

export interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  onPaste?: (e: ClipboardEvent<HTMLDivElement>) => void;
  /** Called after paste with the URL end position in the markdown */
  onPasteUrlPosition?: (endIndex: number) => void;
  placeholder?: string;
  rows?: number;
  label?: string;
  /** Pending URL for pill conversion tooltip */
  pendingUrl?: PendingUrl | null;
  isCheckingUrl?: boolean;
  onAcceptPill?: () => void;
  onDismissPill?: () => void;
}

interface PillData {
  type: LinkPillType;
  title: string;
  url: string;
}

interface LinkData {
  url: string;
  text?: string; // Display text (defaults to URL if not provided)
}

type Segment = {
  type: 'text' | 'pill' | 'link';
  content: string;
  pill?: PillData;
  link?: LinkData;
};

/**
 * Create a link element with proper styling and event handlers
 */
function createLinkElement(url: string, displayText?: string): HTMLAnchorElement {
  const linkEl = document.createElement('a');
  linkEl.className = 'rte-link';
  linkEl.href = url;
  linkEl.target = '_blank';
  linkEl.rel = 'noopener noreferrer';
  linkEl.dataset.linkUrl = url;
  linkEl.textContent = displayText || url;

  // Handle click: normal click positions cursor, Cmd/Ctrl+click opens link
  linkEl.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      window.open(linkEl.href, '_blank', 'noopener,noreferrer');
    } else {
      e.preventDefault(); // Prevent navigation, allow cursor positioning
    }
  });

  // Handle double-click: open link in new tab
  linkEl.addEventListener('dblclick', (e) => {
    e.preventDefault();
    window.open(linkEl.href, '_blank', 'noopener,noreferrer');
  });

  return linkEl;
}

/**
 * Parse markdown links within a text string, returning segments of text and links
 * Only detects explicit markdown syntax [text](url), NOT bare URLs
 */
function parseLinksInText(text: string): Segment[] {
  const result: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  MARKDOWN_LINK_REGEX.lastIndex = 0;

  while ((match = MARKDOWN_LINK_REGEX.exec(text)) !== null) {
    // Add text before link
    if (match.index > lastIndex) {
      result.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }

    const [fullMatch, linkText, url] = match;
    // Add as link segment
    result.push({
      type: 'link',
      content: fullMatch,
      link: { url, text: linkText },
    });

    lastIndex = match.index + fullMatch.length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    result.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return result.length > 0 ? result : [{ type: 'text', content: text }];
}

/**
 * Parse markdown to extract pills, links, and text segments
 * Links must be in markdown syntax [text](url) - bare URLs are treated as plain text
 */
function parseMarkdown(markdown: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  PILL_REGEX.lastIndex = 0;

  // First pass: extract pills
  while ((match = PILL_REGEX.exec(markdown)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: markdown.slice(lastIndex, match.index),
      });
    }

    const [fullMatch, pillType, title, url] = match;
    segments.push({
      type: 'pill',
      content: fullMatch,
      pill: { type: pillType as LinkPillType, title, url },
    });

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < markdown.length) {
    segments.push({
      type: 'text',
      content: markdown.slice(lastIndex),
    });
  }

  // Second pass: detect markdown links [text](url) within text segments
  return segments.flatMap((segment) => {
    if (segment.type !== 'text') return [segment];
    return parseLinksInText(segment.content);
  });
}

/**
 * Convert HTML content back to markdown
 */
function htmlToMarkdown(element: HTMLElement): string {
  let result = '';
  const ZWS = '\u200B';
  let lastAddedNewline = false;

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);

  let node: Node | null = walker.currentNode;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Strip zero-width spaces (used for cursor positioning)
      const text = (node.textContent || '').replace(new RegExp(ZWS, 'g'), '');
      result += text;
      if (text.length > 0) {
        lastAddedNewline = false;
      }
    } else if (node instanceof HTMLElement) {
      if (node.classList.contains('rte-pill')) {
        const type = node.dataset.pillType || 'google_doc';
        const title = node.dataset.pillTitle || '';
        const url = node.dataset.pillUrl || '';
        result += `[pill:${type}:${title}](${url})`;
        lastAddedNewline = false;
        // Skip ALL descendants of pill - find next node that's not inside this pill
        let next: Node | null = walker.nextSibling();
        while (!next) {
          const parent = walker.parentNode();
          if (!parent || parent === element) break;
          next = walker.nextSibling();
        }
        node = next;
        continue;
      } else if (node.classList.contains('rte-link')) {
        // For links, the text content IS the URL (user may have edited it)
        const linkText = node.textContent || '';
        // Check if the edited text is still a valid URL
        URL_REGEX.lastIndex = 0;
        const urlMatch = URL_REGEX.exec(linkText);
        if (urlMatch && urlMatch[0] === linkText.trim()) {
          // Text is a valid URL - use it as both text and href
          result += `[${linkText}](${linkText})`;
        } else {
          // Text is no longer a valid URL - output as plain text (unlink)
          result += linkText;
        }
        lastAddedNewline = false;
        // Skip ALL descendants of link - find next node that's not inside this link
        let next: Node | null = walker.nextSibling();
        while (!next) {
          const parent = walker.parentNode();
          if (!parent || parent === element) break;
          next = walker.nextSibling();
        }
        node = next;
        continue;
      } else if (node.tagName === 'BR') {
        result += '\n';
        lastAddedNewline = true;
      } else if (node.tagName === 'DIV' && node !== element && node.previousSibling) {
        // Divs after the first act as line breaks in contenteditable
        // But don't add newline if we just added one (avoids double-counting with BR)
        // and don't add leading newline if there's no content yet
        if (result.length > 0 && !lastAddedNewline) {
          result += '\n';
          lastAddedNewline = true;
        }
      }
    }
    node = walker.nextNode();
  }

  return result;
}

/**
 * Get icon type for pill type
 */
function getIconType(type: LinkPillType): 'google-docs' | 'google-sheets' | 'github' {
  switch (type) {
    case 'google_doc':
      return 'google-docs';
    case 'google_sheet':
      return 'google-sheets';
    case 'github_pr':
    case 'github_issue':
    case 'github_repo':
      return 'github';
  }
}

export function RichTextEditor({
  value,
  onChange,
  onPaste,
  onPasteUrlPosition,
  placeholder = '',
  rows = 4,
  label,
  pendingUrl,
  isCheckingUrl,
  onAcceptPill,
  onDismissPill,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<{ top: number; left: number } | null>(null);
  const isUpdatingRef = useRef(false);

  // Link hover tooltip state
  const [hoveredLink, setHoveredLink] = useState<{
    url: string;
    linkIndex: number; // Index of this link among all links (survives re-renders)
    position: { top: number; left: number };
  } | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Store pasted text to linkify in next input event
  const pendingPasteRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  // Render markdown as HTML with pill elements
  const renderContent = useCallback(() => {
    if (!editorRef.current || isUpdatingRef.current) return;

    const segments = parseMarkdown(value);
    const fragment = document.createDocumentFragment();
    const ZWS = '\u200B'; // Zero-width space for cursor positioning

    let lastNodeType: 'text' | 'br' | 'pill' | 'link' | 'none' = 'none';

    segments.forEach((segment) => {
      if (segment.type === 'text') {
        // Split by newlines and add <br> elements
        const lines = segment.content.split('\n');
        lines.forEach((line, i) => {
          if (i > 0) {
            fragment.appendChild(document.createElement('br'));
            lastNodeType = 'br';
          }
          if (line) {
            fragment.appendChild(document.createTextNode(line));
            lastNodeType = 'text';
          }
        });
      } else if (segment.type === 'link' && segment.link) {
        const linkEl = createLinkElement(segment.link.url, segment.link.text);
        fragment.appendChild(linkEl);
        lastNodeType = 'link';
      } else if (segment.pill) {
        // Add ZWS before pill if it follows a BR or is first element (cursor can't render there otherwise)
        if (lastNodeType === 'br' || lastNodeType === 'none') {
          fragment.appendChild(document.createTextNode(ZWS));
        }

        // Create pill as a link element
        const pillLink = document.createElement('a');
        pillLink.className = 'rte-pill';
        pillLink.contentEditable = 'false';
        pillLink.href = segment.pill.url;
        pillLink.target = '_blank';
        pillLink.rel = 'noopener noreferrer';
        pillLink.dataset.pillType = segment.pill.type;
        pillLink.dataset.pillTitle = segment.pill.title;
        pillLink.dataset.pillUrl = segment.pill.url;

        // Build pill content using DOM APIs (safe from XSS)
        const iconSpan = document.createElement('span');
        iconSpan.className = 'rte-pill-icon';
        iconSpan.dataset.type = segment.pill.type;

        const titleSpan = document.createElement('span');
        titleSpan.className = 'rte-pill-title';
        titleSpan.textContent = segment.pill.title; // textContent escapes HTML

        pillLink.appendChild(iconSpan);
        pillLink.appendChild(titleSpan);
        fragment.appendChild(pillLink);
        lastNodeType = 'pill';
      }
    });

    // Save selection
    const selection = window.getSelection();
    const savedRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const wasAtEnd = savedRange && editorRef.current.contains(savedRange.endContainer) &&
      savedRange.endOffset === (savedRange.endContainer.textContent?.length || 0);

    editorRef.current.innerHTML = '';
    editorRef.current.appendChild(fragment);

    // Restore cursor to end if it was there
    if (isFocused && wasAtEnd && editorRef.current.lastChild) {
      const range = document.createRange();
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }, [value, isFocused]);

  // Initial render and value changes
  useEffect(() => {
    renderContent();
  }, [renderContent]);

  // Validate and update links in-place (without full re-render)
  const validateLinksInPlace = useCallback(() => {
    if (!editorRef.current) return;

    const selection = window.getSelection();
    const links = editorRef.current.querySelectorAll('a.rte-link');

    links.forEach((link) => {
      const text = link.textContent || '';
      URL_REGEX.lastIndex = 0;
      const match = URL_REGEX.exec(text);
      const isValidUrl = match && match[0] === text.trim();

      if (isValidUrl) {
        // Update href and data attribute to match edited text
        (link as HTMLAnchorElement).href = text;
        (link as HTMLElement).dataset.linkUrl = text;
      } else {
        // Text is no longer a valid URL - unwrap to plain text
        // Save cursor position relative to link
        let cursorOffset = 0;
        let cursorInLink = false;
        if (selection?.rangeCount) {
          const range = selection.getRangeAt(0);
          if (link.contains(range.startContainer)) {
            cursorInLink = true;
            // Calculate offset from start of link text
            if (range.startContainer.nodeType === Node.TEXT_NODE) {
              cursorOffset = range.startOffset;
            }
          }
        }

        const textNode = document.createTextNode(text);
        link.parentNode?.replaceChild(textNode, link);

        // Restore cursor position
        if (cursorInLink && selection) {
          try {
            const newRange = document.createRange();
            newRange.setStart(textNode, Math.min(cursorOffset, text.length));
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
          } catch {
            // Ignore cursor restoration errors
          }
        }
      }
    });
  }, []);

  // Linkify URL immediately before cursor (called after space/enter)
  const linkifyUrlBeforeCursor = useCallback(() => {
    if (!editorRef.current) return;

    const selection = window.getSelection();
    if (!selection?.rangeCount) return;

    const range = selection.getRangeAt(0);
    if (!range.collapsed) return;

    const container = range.startContainer;
    const cursorPos = range.startOffset;

    // Case 1: Cursor in a text node (space was typed)
    if (container.nodeType === Node.TEXT_NODE) {
      if ((container.parentElement as HTMLElement)?.closest('.rte-link, .rte-pill')) return;

      const textNode = container as Text;
      const text = textNode.textContent || '';

      // Get text before cursor (excluding the just-typed space)
      const textBeforeCursor = text.slice(0, cursorPos - 1);
      if (!textBeforeCursor) return;

      URL_REGEX.lastIndex = 0;
      let lastMatch: RegExpExecArray | null = null;
      let match: RegExpExecArray | null;
      while ((match = URL_REGEX.exec(textBeforeCursor)) !== null) {
        lastMatch = { ...match, index: match.index } as RegExpExecArray;
      }

      // URL must end right before the space
      if (!lastMatch || lastMatch.index + lastMatch[0].length !== textBeforeCursor.length) {
        return;
      }

      const url = lastMatch[0];
      const isEnrichable = ENRICHABLE_URL_PATTERNS.some((pattern) => pattern.test(url));
      if (isEnrichable) return;

      const urlStart = lastMatch.index;
      const beforeUrl = text.slice(0, urlStart);
      const afterUrl = text.slice(urlStart + url.length);

      const linkEl = createLinkElement(url);

      const fragment = document.createDocumentFragment();
      if (beforeUrl) {
        fragment.appendChild(document.createTextNode(beforeUrl));
      }
      fragment.appendChild(linkEl);
      const afterNode = document.createTextNode(afterUrl);
      fragment.appendChild(afterNode);

      textNode.parentNode?.replaceChild(fragment, textNode);

      try {
        const newRange = document.createRange();
        newRange.setStart(afterNode, 1);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
      } catch {
        // Ignore cursor restoration errors
      }
      return;
    }

    // Case 2: Cursor at start of new line after Enter (look at previous line)
    // Find the text node just before the cursor position
    let prevTextNode: Text | null = null;
    const cursorContainer = range.startContainer;
    const cursorOffset = range.startOffset;
    let nodeBeforeCursor: Node | null = null;

    if (cursorContainer.nodeType === Node.ELEMENT_NODE) {
      // Cursor is in an element - get the child just before cursor offset
      const element = cursorContainer as Element;
      if (cursorOffset > 0) {
        nodeBeforeCursor = element.childNodes[cursorOffset - 1];
      } else {
        // Cursor at start of element - look at previous sibling of element
        nodeBeforeCursor = element.previousSibling;
      }
    } else {
      // Cursor in a text node at position 0 - look at previous sibling
      nodeBeforeCursor = cursorContainer.previousSibling;
    }

    // Walk backwards from nodeBeforeCursor to find a text node ending with URL
    const findTextNodeEndingWithUrl = (startNode: Node | null): Text | null => {
      let current: Node | null = startNode;

      while (current) {
        if (current.nodeType === Node.TEXT_NODE) {
          const tn = current as Text;
          // Skip if inside link or pill
          if (!tn.parentElement?.closest('.rte-link, .rte-pill')) {
            const text = tn.textContent || '';
            if (text) {
              URL_REGEX.lastIndex = 0;
              let lastMatch: RegExpExecArray | null = null;
              let match: RegExpExecArray | null;
              while ((match = URL_REGEX.exec(text)) !== null) {
                lastMatch = { ...match, index: match.index } as RegExpExecArray;
              }
              // URL must be at the end of this text node
              if (lastMatch && lastMatch.index + lastMatch[0].length === text.length) {
                return tn;
              }
              // Found a text node that doesn't end with URL - stop looking
              return null;
            }
          }
        }

        // If it's an element, check its last text node descendant
        if (current.nodeType === Node.ELEMENT_NODE) {
          const element = current as Element;
          // Skip links and pills entirely
          if (!element.closest('.rte-link, .rte-pill')) {
            // Get the last text node inside this element
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
            let lastTextInElement: Text | null = null;
            let n: Text | null;
            while ((n = walker.nextNode() as Text | null)) {
              lastTextInElement = n;
            }
            if (lastTextInElement) {
              const text = lastTextInElement.textContent || '';
              if (text && !lastTextInElement.parentElement?.closest('.rte-link, .rte-pill')) {
                URL_REGEX.lastIndex = 0;
                let lastMatch: RegExpExecArray | null = null;
                let match: RegExpExecArray | null;
                while ((match = URL_REGEX.exec(text)) !== null) {
                  lastMatch = { ...match, index: match.index } as RegExpExecArray;
                }
                if (lastMatch && lastMatch.index + lastMatch[0].length === text.length) {
                  return lastTextInElement;
                }
                // Found text that doesn't end with URL - stop
                return null;
              }
            }
          }
        }

        // Move to previous sibling, or parent's previous sibling
        if (current.previousSibling) {
          current = current.previousSibling;
        } else {
          current = current.parentNode;
          if (current === editorRef.current || !current) break;
          current = current.previousSibling;
        }
      }

      return null;
    };

    prevTextNode = findTextNodeEndingWithUrl(nodeBeforeCursor);

    if (!prevTextNode) return;

    const text = prevTextNode.textContent || '';
    URL_REGEX.lastIndex = 0;
    let lastMatch: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = URL_REGEX.exec(text)) !== null) {
      lastMatch = { ...match, index: match.index } as RegExpExecArray;
    }

    if (!lastMatch) return;

    const url = lastMatch[0];
    const isEnrichable = ENRICHABLE_URL_PATTERNS.some((pattern) => pattern.test(url));
    if (isEnrichable) return;

    const urlStart = lastMatch.index;
    const beforeUrl = text.slice(0, urlStart);

    const linkEl = createLinkElement(url);

    const fragment = document.createDocumentFragment();
    if (beforeUrl) {
      fragment.appendChild(document.createTextNode(beforeUrl));
    }
    fragment.appendChild(linkEl);

    prevTextNode.parentNode?.replaceChild(fragment, prevTextNode);
  }, []);

  // Simple markdown update without linkification (used after pill removal, etc.)
  const updateMarkdown = useCallback(() => {
    if (!editorRef.current) return;
    isUpdatingRef.current = true;
    const markdown = htmlToMarkdown(editorRef.current);
    onChange(markdown);
    isUpdatingRef.current = false;
  }, [onChange]);

  // Convert bare URLs in markdown to link syntax, but only for URLs in the pasted text
  const linkifyPastedUrlsInMarkdown = useCallback(
    (markdown: string, pastedText: string): string => {
      URL_REGEX.lastIndex = 0;
      const urlsInPaste: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = URL_REGEX.exec(pastedText)) !== null) {
        urlsInPaste.push(match[0]);
      }
      if (urlsInPaste.length === 0) return markdown;

      // Replace each pasted URL with markdown link syntax (if not already linked)
      let result = markdown;
      for (const url of urlsInPaste) {
        const isEnrichable = ENRICHABLE_URL_PATTERNS.some((pattern) => pattern.test(url));
        if (isEnrichable) continue;

        // Find bare URL (not already in [text](url) or [pill:...](url) format)
        const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match URL not preceded by [ or ]( and not followed by ] or )
        // This prevents matching URLs already inside markdown link syntax
        const bareUrlRegex = new RegExp(
          `(?<!\\[)(?<!\\]\\()${escapedUrl}(?!\\])(?!\\))`,
          'g'
        );
        result = result.replace(bareUrlRegex, `[${url}](${url})`);
      }
      return result;
    },
    []
  );

  // Handle input changes
  const handleInput = useCallback(
    (e: React.FormEvent<HTMLDivElement>) => {
      if (!editorRef.current) return;
      isUpdatingRef.current = true;

      // First, validate/update links in place (handles edited links)
      validateLinksInPlace();

      // Check if user just typed space/enter - trigger URL linkification
      const inputEvent = e.nativeEvent as InputEvent;
      if (
        inputEvent.data === ' ' ||
        inputEvent.data === '\n' ||
        inputEvent.inputType === 'insertParagraph' ||
        inputEvent.inputType === 'insertLineBreak'
      ) {
        linkifyUrlBeforeCursor();
      }

      let markdown = htmlToMarkdown(editorRef.current);

      // If there's a pending paste, linkify URLs from the pasted content
      if (pendingPasteRef.current) {
        // Remove artifact leading newlines only if content starts with pasted text
        // (i.e., editor was empty before paste). Preserves intentional empty lines above.
        const stripped = markdown.replace(/^\n+/, '');
        if (stripped.startsWith(pendingPasteRef.current)) {
          markdown = stripped;
        }
        markdown = linkifyPastedUrlsInMarkdown(markdown, pendingPasteRef.current);
        pendingPasteRef.current = null;
      }

      onChange(markdown);

      // Reset flag via microtask - runs after current code but before React's effects
      // This ensures renderContent can run on the next render cycle
      queueMicrotask(() => {
        isUpdatingRef.current = false;
      });
    },
    [onChange, validateLinksInPlace, linkifyUrlBeforeCursor, linkifyPastedUrlsInMarkdown]
  );

  // Handle paste
  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      const pastedText = e.clipboardData?.getData('text') || '';

      // Store pasted text for linkification in handleInput
      if (pastedText) {
        pendingPasteRef.current = pastedText;
      }

      // Let parent handle URL detection
      onPaste?.(e);

      // Calculate tooltip position after paste completes
      requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (selection?.rangeCount) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          setTooltipPosition({
            top: rect.bottom + 4,
            left: rect.left,
          });

          // Calculate the URL's end position in markdown
          if (editorRef.current && onPasteUrlPosition && pastedText) {
            const markdown = htmlToMarkdown(editorRef.current);
            // Find plain text URL (not inside pill syntax)
            let searchStart = 0;
            let foundIndex = -1;
            while (true) {
              const idx = markdown.indexOf(pastedText, searchStart);
              if (idx === -1) break;
              const prefix = markdown.slice(Math.max(0, idx - 2), idx);
              if (!prefix.endsWith('](')) {
                foundIndex = idx;
              }
              searchStart = idx + 1;
            }
            if (foundIndex !== -1) {
              onPasteUrlPosition(foundIndex + pastedText.length);
            }
          }
        }
      });
    },
    [onPaste, onPasteUrlPosition]
  );

  // Handle keyboard
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      // Tab to accept pill
      if (e.key === 'Tab' && pendingUrl && onAcceptPill) {
        e.preventDefault();
        onAcceptPill();
        return;
      }
      // Escape to dismiss
      if (e.key === 'Escape' && pendingUrl && onDismissPill) {
        e.preventDefault();
        onDismissPill();
        return;
      }
      // Arrow keys or other navigation dismisses the prompt
      if (pendingUrl && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        onDismissPill?.();
      }

      // Get the node immediately before/after the cursor in DOM order
      const getAdjacentNode = (direction: 'before' | 'after'): Node | null => {
        const selection = window.getSelection();
        if (!selection?.rangeCount) return null;
        const range = selection.getRangeAt(0);
        if (!range.collapsed) return null;

        const node = range.startContainer;
        const offset = range.startOffset;

        if (direction === 'before') {
          if (node.nodeType === Node.TEXT_NODE) {
            // If at start of text node, get previous sibling
            if (offset === 0) {
              return node.previousSibling;
            }
            // Otherwise we're in the middle of text, no adjacent element
            return null;
          }
          // If in element node, get child at offset-1
          if (offset > 0) {
            return node.childNodes[offset - 1];
          }
          return null;
        } else {
          if (node.nodeType === Node.TEXT_NODE) {
            // If at end of text node, get next sibling
            if (offset === node.textContent?.length) {
              return node.nextSibling;
            }
            return null;
          }
          // If in element node, get child at offset
          return node.childNodes[offset] || null;
        }
      };

      const isPill = (node: Node | null): node is HTMLElement => {
        return node instanceof HTMLElement && node.classList.contains('rte-pill');
      };

      const ZWS = '\u200B';
      const isZwsOnly = (node: Node | null): boolean => {
        return node?.nodeType === Node.TEXT_NODE && node.textContent === ZWS;
      };

      // Handle ArrowLeft - skip ZWS-only nodes and position before pills
      if (e.key === 'ArrowLeft' && editorRef.current) {
        const selection = window.getSelection();
        if (!selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (!range.collapsed) return;

        const node = range.startContainer;
        const offset = range.startOffset;

        // If we're in a ZWS-only text node, go to end of previous line
        if (isZwsOnly(node) && (offset === 0 || offset === 1)) {
          e.preventDefault();
          const prev = node.previousSibling;
          const newRange = document.createRange();

          if (prev && prev.nodeName === 'BR') {
            const beforeBr = prev.previousSibling;
            if (beforeBr) {
              if (beforeBr.nodeType === Node.TEXT_NODE) {
                newRange.setStart(beforeBr, beforeBr.textContent?.length || 0);
              } else if (beforeBr.nodeName === 'BR') {
                newRange.setStartAfter(beforeBr);
              } else {
                newRange.setStartAfter(beforeBr);
              }
            } else {
              newRange.setStart(node.parentNode!, 0);
            }
          } else if (prev) {
            if (prev.nodeType === Node.TEXT_NODE) {
              newRange.setStart(prev, prev.textContent?.length || 0);
            } else {
              newRange.setStartAfter(prev);
            }
          } else {
            newRange.setStart(node.parentNode!, 0);
          }
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
          return;
        }

        const prevNode = getAdjacentNode('before');

        // If prev is pill, check if there's a ZWS before it we should land in
        if (isPill(prevNode)) {
          e.preventDefault();
          const newRange = document.createRange();
          const beforePill = prevNode.previousSibling;
          if (beforePill && isZwsOnly(beforePill)) {
            newRange.setStart(beforePill, 1);
          } else {
            newRange.setStartBefore(prevNode);
          }
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
          return;
        }

        // If prev is ZWS, skip over it entirely
        if (prevNode && isZwsOnly(prevNode)) {
          e.preventDefault();
          const beforeZws = prevNode.previousSibling;
          const newRange = document.createRange();
          if (beforeZws) {
            if (beforeZws.nodeType === Node.TEXT_NODE) {
              newRange.setStart(beforeZws, beforeZws.textContent?.length || 0);
            } else {
              newRange.setStartAfter(beforeZws);
            }
          } else {
            newRange.setStart(node, 0);
          }
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
          return;
        }
      }

      // Handle ArrowRight - skip ZWS-only nodes and position after pills
      if (e.key === 'ArrowRight' && editorRef.current) {
        const selection = window.getSelection();
        if (!selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (!range.collapsed) return;

        const node = range.startContainer;
        const offset = range.startOffset;

        // If we're in a ZWS-only text node at the end, skip to after it
        if (isZwsOnly(node) && offset === 1) {
          e.preventDefault();
          const next = node.nextSibling;
          if (next) {
            const newRange = document.createRange();
            if (next.nodeType === Node.TEXT_NODE) {
              newRange.setStart(next, 0);
            } else if (isPill(next)) {
              newRange.setStartAfter(next);
            } else {
              newRange.setStartBefore(next);
            }
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
          }
          return;
        }

        // If we're at the start of ZWS (offset 0), skip entire ZWS and pill
        if (isZwsOnly(node) && offset === 0) {
          e.preventDefault();
          const next = node.nextSibling;
          const newRange = document.createRange();
          if (isPill(next)) {
            newRange.setStartAfter(next);
          } else if (next) {
            newRange.setStartBefore(next);
          } else {
            newRange.setStartAfter(node);
          }
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
          return;
        }

        const nextNode = getAdjacentNode('after');

        // If next is ZWS, skip it and go to after the pill (or wherever)
        if (nextNode && isZwsOnly(nextNode)) {
          e.preventDefault();
          const afterZws = nextNode.nextSibling;
          const newRange = document.createRange();
          if (isPill(afterZws)) {
            newRange.setStartAfter(afterZws);
          } else if (afterZws) {
            newRange.setStartBefore(afterZws);
          } else {
            newRange.setStartAfter(nextNode);
          }
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
          return;
        }

        if (isPill(nextNode)) {
          e.preventDefault();
          const newRange = document.createRange();
          newRange.setStartAfter(nextNode);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
          return;
        }
      }

      // Handle Backspace to delete pills (especially at line start)
      if (e.key === 'Backspace' && editorRef.current) {
        const selection = window.getSelection();
        if (!selection?.rangeCount) return;

        const range = selection.getRangeAt(0);
        if (!range.collapsed) return; // Let browser handle selection deletion

        const node = range.startContainer;
        const offset = range.startOffset;

        // Check if cursor is at start of a text node that follows a pill
        if (node.nodeType === Node.TEXT_NODE && offset === 0) {
          const prev = node.previousSibling;
          if (prev instanceof HTMLElement && prev.classList.contains('rte-pill')) {
            e.preventDefault();
            prev.remove();
            updateMarkdown();
            return;
          }
        }

        // Check if cursor is in editor directly and previous sibling is a pill
        if (node === editorRef.current && offset > 0) {
          const children = Array.from(editorRef.current.childNodes);
          const prevChild = children[offset - 1];
          if (prevChild instanceof HTMLElement && prevChild.classList.contains('rte-pill')) {
            e.preventDefault();
            prevChild.remove();
            updateMarkdown();
            return;
          }
        }

        // Check if at start of editor with pill as first child
        if (node === editorRef.current && offset === 0) {
          // Nothing before cursor
          return;
        }

        // Handle case where cursor is right after a pill (pill is previous sibling of parent)
        if (node.nodeType === Node.TEXT_NODE && offset === 0 && node.parentNode) {
          const parent = node.parentNode;
          if (parent !== editorRef.current) {
            const prev = parent.previousSibling;
            if (prev instanceof HTMLElement && prev.classList.contains('rte-pill')) {
              e.preventDefault();
              prev.remove();
              updateMarkdown();
              return;
            }
          }
        }
      }

      // Handle Delete key for pills
      if (e.key === 'Delete' && editorRef.current) {
        const selection = window.getSelection();
        if (!selection?.rangeCount) return;

        const range = selection.getRangeAt(0);
        if (!range.collapsed) return;

        const node = range.startContainer;
        const offset = range.startOffset;

        // Check if cursor is at end of text node before a pill
        if (node.nodeType === Node.TEXT_NODE && offset === node.textContent?.length) {
          const next = node.nextSibling;
          if (next instanceof HTMLElement && next.classList.contains('rte-pill')) {
            e.preventDefault();
            next.remove();
            updateMarkdown();
            return;
          }
        }

        // Check if cursor is in editor directly and next sibling is a pill
        if (node === editorRef.current) {
          const children = Array.from(editorRef.current.childNodes);
          const nextChild = children[offset];
          if (nextChild instanceof HTMLElement && nextChild.classList.contains('rte-pill')) {
            e.preventDefault();
            nextChild.remove();
            updateMarkdown();
            return;
          }
        }
      }
    },
    [pendingUrl, onAcceptPill, onDismissPill, updateMarkdown]
  );

  // Handle focus
  const handleFocus = useCallback(() => {
    setIsFocused(true);
  }, []);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    // No linkification on blur - links are only created during active input
  }, []);

  // Link hover handlers
  const handleLinkMouseEnter = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const linkEl = target.closest('.rte-link') as HTMLElement | null;
    if (!linkEl || !editorRef.current) return;

    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    // Calculate this link's index among all links (for finding it after re-renders)
    const allLinks = editorRef.current.querySelectorAll('a.rte-link');
    let linkIndex = -1;
    for (let i = 0; i < allLinks.length; i++) {
      if (allLinks[i] === linkEl) {
        linkIndex = i;
        break;
      }
    }

    // Delay to prevent tooltip flash on quick mouse movements
    hoverTimeoutRef.current = setTimeout(() => {
      const rect = linkEl.getBoundingClientRect();
      setHoveredLink({
        url: linkEl.dataset.linkUrl || linkEl.textContent || '',
        linkIndex,
        position: {
          top: rect.bottom + 4,
          left: rect.left,
        },
      });
    }, 200);
  }, []);

  const handleLinkMouseLeave = useCallback((e: MouseEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;

    // Don't hide if moving to the tooltip
    if (relatedTarget?.closest('.rte-link-tooltip')) return;

    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }

    // Small delay before hiding to allow moving to tooltip
    setTimeout(() => {
      setHoveredLink((current) => {
        // Only clear if we haven't re-entered
        if (current && !document.querySelector('.rte-link-tooltip:hover')) {
          return null;
        }
        return current;
      });
    }, 100);
  }, []);

  const handleCopyLink = useCallback(async () => {
    if (!hoveredLink) return;
    await navigator.clipboard.writeText(hoveredLink.url);
    setHoveredLink(null);
  }, [hoveredLink]);

  const handleRemoveLink = useCallback(() => {
    if (!hoveredLink || !editorRef.current || hoveredLink.linkIndex < 0) return;

    // Find the link by index (survives re-renders, handles duplicate URLs)
    const allLinks = editorRef.current.querySelectorAll('a.rte-link');
    const linkEl = allLinks[hoveredLink.linkIndex];

    if (linkEl && linkEl.parentNode) {
      const textNode = document.createTextNode(linkEl.textContent || '');
      linkEl.parentNode.replaceChild(textNode, linkEl);

      // Directly extract markdown WITHOUT auto-linking (to prevent re-linkifying)
      isUpdatingRef.current = true;
      const markdown = htmlToMarkdown(editorRef.current);
      onChange(markdown);
      requestAnimationFrame(() => {
        isUpdatingRef.current = false;
      });
    }

    setHoveredLink(null);
  }, [hoveredLink, onChange]);

  // Add hover listeners to editor for links
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.addEventListener('mouseover', handleLinkMouseEnter);
    editor.addEventListener('mouseout', handleLinkMouseLeave);

    return () => {
      editor.removeEventListener('mouseover', handleLinkMouseEnter);
      editor.removeEventListener('mouseout', handleLinkMouseLeave);
    };
  }, [handleLinkMouseEnter, handleLinkMouseLeave]);

  // Clear hovered link when value changes (DOM elements get recreated)
  useEffect(() => {
    setHoveredLink(null);
  }, [value]);

  // Update tooltip position when pending URL changes
  useEffect(() => {
    if (!pendingUrl && !isCheckingUrl) {
      setTooltipPosition(null);
    }
  }, [pendingUrl, isCheckingUrl]);

  // Click outside to dismiss tooltip
  useEffect(() => {
    if (!pendingUrl && !isCheckingUrl) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't dismiss if clicking on the tooltip itself
      if (target.closest('.rte-tooltip')) return;
      // Dismiss on any other click
      onDismissPill?.();
    };

    // Use capture phase to catch clicks before they're handled
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [pendingUrl, isCheckingUrl, onDismissPill]);

  const showTooltip = (pendingUrl || isCheckingUrl) && tooltipPosition;
  const isEmpty = !value;

  return (
    <div className="rte-container">
      {label && <label className="rte-label">{label}</label>}
      <div className="rte-wrapper">
        <div
          ref={editorRef}
          className={`rte-editor ${isEmpty ? 'rte-empty' : ''}`}
          contentEditable
          onInput={handleInput}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          data-placeholder={placeholder}
          style={{ minHeight: `${rows * 1.5}em` }}
          role="textbox"
          aria-multiline="true"
          aria-label={label}
        />

        {/* Floating tooltip for pill conversion */}
        {showTooltip &&
          createPortal(
            <div
              className="rte-tooltip"
              style={{
                position: 'fixed',
                top: tooltipPosition.top,
                left: tooltipPosition.left,
              }}
            >
              {isCheckingUrl ? (
                <span className="rte-tooltip-loading">Checking link...</span>
              ) : pendingUrl ? (
                <>
                  <span className="rte-tooltip-key">tab</span>
                  <span className="rte-tooltip-text">to replace with</span>
                  <button
                    type="button"
                    className="rte-tooltip-pill"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAcceptPill?.();
                    }}
                  >
                    <McpIcon type={getIconType(pendingUrl.metadata.type)} size={14} />
                    <span className="rte-tooltip-title">{pendingUrl.metadata.title}</span>
                  </button>
                </>
              ) : null}
            </div>,
            document.body
          )}

        {/* Link hover tooltip */}
        {hoveredLink &&
          createPortal(
            <div
              className="rte-link-tooltip"
              style={{
                position: 'fixed',
                top: hoveredLink.position.top,
                left: hoveredLink.position.left,
              }}
              onMouseEnter={() => {
                // Keep tooltip open when hovering over it
                if (hoverTimeoutRef.current) {
                  clearTimeout(hoverTimeoutRef.current);
                }
              }}
              onMouseLeave={() => {
                setHoveredLink(null);
              }}
            >
              <a
                href={hoveredLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rte-link-tooltip-url"
                onClick={() => setHoveredLink(null)}
              >
                {hoveredLink.url}
              </a>
              <span className="rte-link-tooltip-divider" />
              <button
                type="button"
                className="rte-link-tooltip-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCopyLink();
                }}
                title="Copy link"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ width: 14, height: 14 }}
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
              <button
                type="button"
                className="rte-link-tooltip-btn rte-link-tooltip-btn-danger"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleRemoveLink();
                }}
                title="Remove link"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ width: 14, height: 14 }}
                >
                  {/* Broken chain link icon */}
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  <line x1="4" y1="4" x2="20" y2="20" />
                </svg>
              </button>
            </div>,
            document.body
          )}
      </div>
    </div>
  );
}
