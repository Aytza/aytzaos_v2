/**
 * Google Docs Approval View
 *
 * For createDocument: Single-panel document preview with commenting support.
 * For append/replace: Side-by-side document diff with paragraph-level diff highlighting.
 *
 * Used for: createDocument, appendToDocument, replaceDocumentContent
 */

import { useState, useCallback, useRef } from 'react';
import Markdown from 'react-markdown';
import { McpIcon } from '../common';
import { ApprovalFooter } from './ApprovalFooter';
import { useTitleEdit } from '../../hooks';
import type { ApprovalViewProps } from './ApprovalViewRegistry';
import './GoogleDocsApproval.css';

interface GoogleDocsApprovalData {
  documentId?: string;
  title?: string;
  currentContent?: string;
  newContent?: string;
  content?: string;
  action?: 'append' | 'replace';
  url?: string;
}

interface TextComment {
  id: string;
  paragraphStart: number;
  paragraphEnd: number;
  side: 'left' | 'right';
  content: string;
}

interface ParagraphSelection {
  startIndex: number;
  endIndex: number;
  side: 'left' | 'right';
}

export function GoogleDocsApproval({
  action,
  data,
  onApprove,
  onRequestChanges,
  onCancel,
  isLoading,
}: ApprovalViewProps) {
  const [comments, setComments] = useState<TextComment[]>([]);
  const [selection, setSelection] = useState<ParagraphSelection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState('');
  const dragStartRef = useRef<{ index: number; side: 'left' | 'right' } | null>(null);

  // Editable title (for create document) - using shared hook
  const {
    editedTitle,
    setEditedTitle,
    titleComment,
    showTitleCommentInput,
    titleCommentText,
    handleStartTitleComment,
    handleEditTitleComment,
    handleAddTitleComment,
    handleCancelTitleComment,
    handleRemoveTitleComment,
    setTitleCommentText,
  } = useTitleEdit();

  // Parse data
  let docData: GoogleDocsApprovalData = {};
  if (typeof data === 'string') {
    try {
      docData = JSON.parse(data);
    } catch {
      docData = {};
    }
  } else {
    docData = data as GoogleDocsApprovalData;
  }

  const {
    title = 'Untitled Document',
    currentContent = '',
    newContent = docData.content || '',
    action: docAction,
  } = docData;

  // Detect mode: create (no currentContent), append, or replace
  const isCreate = !currentContent && !docAction;
  const isAppend = docAction === 'append';
  const actionLabel = isCreate
    ? 'Create Document'
    : isAppend
      ? 'Append to Document'
      : 'Replace Document Content';

  // Split content into paragraphs for diff display
  const currentParagraphs = currentContent.split(/\n\n+/).filter(p => p.trim());
  const newParagraphs = newContent.split(/\n\n+/).filter(p => p.trim());

  // For append, combine current + new
  const afterParagraphs = isAppend
    ? [...currentParagraphs, ...newParagraphs]
    : newParagraphs;

  // Simple diff: mark paragraphs as added, removed, or unchanged
  const getDiffStatus = (para: string, side: 'left' | 'right'): 'added' | 'removed' | 'unchanged' => {
    if (side === 'left') {
      if (isAppend) return 'unchanged';
      const existsInNew = newParagraphs.some(p => p.trim() === para.trim());
      return existsInNew ? 'unchanged' : 'removed';
    } else {
      if (isAppend) {
        const isFromCurrent = currentParagraphs.some(p => p.trim() === para.trim());
        return isFromCurrent ? 'unchanged' : 'added';
      }
      const existsInCurrent = currentParagraphs.some(p => p.trim() === para.trim());
      return existsInCurrent ? 'unchanged' : 'added';
    }
  };

  // Selection handlers (like CommentableText) - only for right side
  const handleParagraphMouseDown = useCallback((index: number, side: 'left' | 'right', e: React.MouseEvent) => {
    if (isLoading || side === 'left') return; // Only allow comments on "After Changes" side
    e.preventDefault();

    dragStartRef.current = { index, side };
    setIsDragging(true);
    setSelection({ startIndex: index, endIndex: index, side });
    setShowCommentInput(false);
  }, [isLoading]);

  const handleParagraphMouseEnter = useCallback((index: number, side: 'left' | 'right') => {
    if (!isDragging || !dragStartRef.current || dragStartRef.current.side !== side) return;

    const start = dragStartRef.current.index;
    setSelection({
      startIndex: Math.min(start, index),
      endIndex: Math.max(start, index),
      side,
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    if (isDragging && selection) {
      setShowCommentInput(true);
    }
    setIsDragging(false);
    dragStartRef.current = null;
  }, [isDragging, selection]);

  const handleAddComment = () => {
    if (!selection || !commentText.trim()) return;

    const newComment: TextComment = {
      id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      paragraphStart: selection.startIndex,
      paragraphEnd: selection.endIndex,
      side: selection.side,
      content: commentText.trim(),
    };
    setComments(prev => [...prev, newComment]);
    setSelection(null);
    setShowCommentInput(false);
    setCommentText('');
  };

  const handleRemoveComment = (id: string) => {
    setComments(prev => prev.filter(c => c.id !== id));
  };

  const handleCancelComment = () => {
    setSelection(null);
    setShowCommentInput(false);
    setCommentText('');
  };

  // Check if paragraph is in selection
  const isParagraphSelected = (index: number, side: 'left' | 'right') => {
    if (!selection || selection.side !== side) return false;
    return index >= selection.startIndex && index <= selection.endIndex;
  };

  // Check if paragraph has a comment
  const hasComment = useCallback((index: number, side: 'left' | 'right') => {
    return comments.some(c =>
      c.side === side && index >= c.paragraphStart && index <= c.paragraphEnd
    );
  }, [comments]);

  // Get comments that end on a specific paragraph
  const getCommentsEndingAt = (index: number, side: 'left' | 'right') => {
    return comments.filter(c => c.paragraphEnd === index && c.side === side);
  };

  // Format comments as feedback
  const formatCommentsFeedback = (): string => {
    const hasTitleComment = titleComment !== null;
    const hasParaComments = comments.length > 0;

    if (!hasTitleComment && !hasParaComments) return '';

    const lines: string[] = ['DOCUMENT COMMENTS:'];

    // Title comment
    if (hasTitleComment) {
      lines.push(`\n[Document Title]: "${titleComment}"`);
    }

    // Paragraph comments
    for (const c of comments) {
      const sideLabel = c.side === 'left' ? 'Current' : 'New';
      const paraRef = c.paragraphEnd !== c.paragraphStart
        ? `Paragraphs ${c.paragraphStart + 1}-${c.paragraphEnd + 1}`
        : `Paragraph ${c.paragraphStart + 1}`;
      lines.push(`\n[${sideLabel} - ${paraRef}]: "${c.content}"`);
    }
    return lines.join('\n');
  };

  const handleApprove = () => {
    // Pass back edited title if changed (for create document)
    if (isCreate && editedTitle !== null && editedTitle !== title) {
      onApprove({ title: editedTitle });
    } else {
      onApprove();
    }
  };

  const handleRequestChanges = () => {
    const feedback = formatCommentsFeedback();
    onRequestChanges(feedback);
  };

  // Render a single panel
  const renderPanel = (paragraphs: string[], side: 'left' | 'right', emptyMessage: string) => (
    <div
      className={`docs-approval-panel docs-approval-panel-${side === 'left' ? 'current' : 'after'}`}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {!isCreate && (
        <div className="docs-approval-panel-header">
          <span className="docs-approval-panel-label">
            {side === 'left' ? 'Current' : 'After Changes'}
          </span>
        </div>
      )}
      <div className="docs-approval-panel-body">
        {paragraphs.length === 0 ? (
          <div className="docs-approval-empty-panel">{emptyMessage}</div>
        ) : (
          paragraphs.map((para, idx) => {
            const status = getDiffStatus(para, side);
            const isSelected = isParagraphSelected(idx, side);
            const paragraphHasComment = hasComment(idx, side);
            const paragraphComments = getCommentsEndingAt(idx, side);
            const showInputAfterPara = showCommentInput && selection?.endIndex === idx && selection?.side === side;

            return (
              <div key={idx} className="docs-paragraph-wrapper">
                <div
                  className={`docs-paragraph docs-paragraph-${status} ${isSelected ? 'selected' : ''}`}
                  onMouseDown={(e) => handleParagraphMouseDown(idx, side, e)}
                  onMouseEnter={() => handleParagraphMouseEnter(idx, side)}
                >
                  <div className="docs-paragraph-content">
                    <Markdown>{para}</Markdown>
                  </div>
                  {side === 'right' && (
                    <span className={`docs-comment-indicator ${paragraphHasComment ? 'has-comment' : ''} ${!isLoading ? 'can-comment' : ''}`}>
                      {status === 'added' ? '+' : '+'}
                    </span>
                  )}
                  {side === 'left' && status === 'removed' && (
                    <span className="docs-diff-marker">−</span>
                  )}
                </div>

                {/* Comment input */}
                {showInputAfterPara && (
                  <div className="docs-comment-input">
                    <textarea
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder={selection && selection.startIndex !== selection.endIndex
                        ? `Add feedback on paragraphs ${selection.startIndex + 1}-${selection.endIndex + 1}...`
                        : 'Add your feedback on this paragraph...'
                      }
                      autoFocus
                      onMouseDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.metaKey) handleAddComment();
                        if (e.key === 'Escape') handleCancelComment();
                      }}
                    />
                    <div className="docs-comment-actions">
                      <button onClick={handleCancelComment}>Cancel</button>
                      <button
                        className="primary"
                        onClick={handleAddComment}
                        disabled={!commentText.trim()}
                      >
                        Add Comment
                      </button>
                    </div>
                  </div>
                )}

                {/* Existing comments that end on this paragraph */}
                {paragraphComments.map(comment => (
                  <div key={comment.id} className="docs-comment">
                    {comment.paragraphEnd !== comment.paragraphStart && (
                      <span className="docs-comment-paras">
                        Paragraphs {comment.paragraphStart + 1}-{comment.paragraphEnd + 1}
                      </span>
                    )}
                    <span className="docs-comment-content">{comment.content}</span>
                    <button
                      className="docs-comment-remove"
                      onClick={(e) => { e.stopPropagation(); handleRemoveComment(comment.id); }}
                      title="Remove comment"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="docs-approval-view">
      {/* Header */}
      <div className="docs-approval-header">
        <div className="docs-approval-title">
          <div className="docs-approval-title-row">
            <McpIcon type="google-docs" size={20} />
            <h3>{action || actionLabel}</h3>
          </div>
          {isCreate ? (
            /* Editable title for create document */
            <div className="docs-approval-editable-title">
              <label className="docs-approval-title-label">Document Title:</label>
              <div className="docs-approval-title-input-row">
                <input
                  type="text"
                  className="docs-approval-title-input"
                  value={editedTitle ?? title}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  disabled={isLoading}
                  placeholder="Enter document title..."
                />
                {!showTitleCommentInput && !titleComment && !isLoading && (
                  <button
                    className="docs-approval-add-comment"
                    onClick={handleStartTitleComment}
                    title="Add comment"
                  >
                    + comment
                  </button>
                )}
              </div>

              {/* Title comment input */}
              {showTitleCommentInput && (
                <div className="docs-approval-title-comment-input">
                  <input
                    type="text"
                    value={titleCommentText}
                    onChange={(e) => setTitleCommentText(e.target.value)}
                    placeholder="Add feedback on the document title..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && titleCommentText.trim()) handleAddTitleComment();
                      if (e.key === 'Escape') handleCancelTitleComment();
                    }}
                  />
                  <div className="docs-approval-title-comment-actions">
                    <button onClick={handleCancelTitleComment}>Cancel</button>
                    <button
                      className="primary"
                      onClick={handleAddTitleComment}
                      disabled={!titleCommentText.trim()}
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              {/* Existing title comment */}
              {titleComment && !showTitleCommentInput && (
                <div className="docs-approval-title-comment">
                  <span className="docs-approval-title-comment-content">{titleComment}</span>
                  <button
                    className="docs-approval-title-comment-edit"
                    onClick={handleEditTitleComment}
                    title="Edit comment"
                  >
                    Edit
                  </button>
                  <button
                    className="docs-approval-title-comment-remove"
                    onClick={handleRemoveTitleComment}
                    title="Remove comment"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Read-only title for mutate operations */
            <div className="docs-approval-doc-info">
              <span className="docs-approval-doc-name">{title}</span>
            </div>
          )}
        </div>
        <div className="docs-approval-stats">
          {!isCreate && currentParagraphs.length > 0 && (
            <span className="stat-current">{currentParagraphs.length} current</span>
          )}
          {isCreate ? (
            <span className="stat-additions">{newParagraphs.length} paragraphs</span>
          ) : isAppend ? (
            <span className="stat-additions">+{newParagraphs.length} new</span>
          ) : (
            <span className="stat-additions">{afterParagraphs.length} after</span>
          )}
        </div>
      </div>

      {/* Content - single panel for create, side by side for diff */}
      <div className={`docs-approval-content ${isCreate ? 'docs-approval-content-single' : ''}`}>
        {!isCreate && renderPanel(currentParagraphs, 'left', 'Empty document')}
        {renderPanel(isCreate ? newParagraphs : afterParagraphs, 'right', 'No content')}
      </div>

      {/* Footer */}
      <ApprovalFooter
        onApprove={handleApprove}
        onRequestChanges={handleRequestChanges}
        onCancel={onCancel}
        isLoading={isLoading}
        approveLabel={isCreate ? 'Create Document' : isAppend ? 'Append Content' : 'Replace Content'}
        commentCount={comments.length + (titleComment ? 1 : 0)}
      />
    </div>
  );
}
