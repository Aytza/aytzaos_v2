/**
 * Google Sheets Approval View
 *
 * Row-based diff for approving Google Sheets changes.
 * Shows current rows vs new rows with diff highlighting.
 *
 * Used for: appendRows, updateCells, replaceSheetContent
 * Note: createSpreadsheet shows new content only (no diff)
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { McpIcon } from '../common';
import { ApprovalFooter } from './ApprovalFooter';
import { useTitleEdit } from '../../hooks';
import type { ApprovalViewProps } from './ApprovalViewRegistry';
import './GoogleSheetsApproval.css';

interface GoogleSheetsApprovalData {
  spreadsheetId?: string;
  title?: string;
  sheetName?: string;
  currentData?: string[][];
  currentRows?: string[][];  // Alternative name for currentData
  newData?: string[][];
  newRows?: string[][];      // Alternative name for newData
  data?: string[][];
  rows?: string[][];
  range?: string;
  action?: 'create' | 'append' | 'update' | 'replace';
  url?: string;
}

interface RowComment {
  id: string;
  rowStart: number;
  rowEnd: number;
  side: 'left' | 'right';
  content: string;
}

interface RowSelection {
  startIndex: number;
  endIndex: number;
  side: 'left' | 'right';
}

export function GoogleSheetsApproval({
  tool,
  action,
  data,
  onApprove,
  onRequestChanges,
  onCancel,
  isLoading,
}: ApprovalViewProps) {
  const [comments, setComments] = useState<RowComment[]>([]);
  const [selection, setSelection] = useState<RowSelection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [wrapText, setWrapText] = useState(false);
  const dragStartRef = useRef<{ index: number; side: 'left' | 'right' } | null>(null);

  // Editable title (for create spreadsheet) - using shared hook
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

  // Refs for synchronized scrolling
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);

  // Synchronized scroll handler
  const handleScroll = useCallback((source: 'left' | 'right') => {
    if (isScrollingRef.current) return;

    const sourcePanel = source === 'left' ? leftPanelRef.current : rightPanelRef.current;
    const targetPanel = source === 'left' ? rightPanelRef.current : leftPanelRef.current;

    if (!sourcePanel || !targetPanel) return;

    isScrollingRef.current = true;
    targetPanel.scrollTop = sourcePanel.scrollTop;

    // Reset flag after scroll completes
    requestAnimationFrame(() => {
      isScrollingRef.current = false;
    });
  }, []);

  // Attach scroll listeners
  useEffect(() => {
    const leftPanel = leftPanelRef.current;
    const rightPanel = rightPanelRef.current;

    const onLeftScroll = () => handleScroll('left');
    const onRightScroll = () => handleScroll('right');

    leftPanel?.addEventListener('scroll', onLeftScroll);
    rightPanel?.addEventListener('scroll', onRightScroll);

    return () => {
      leftPanel?.removeEventListener('scroll', onLeftScroll);
      rightPanel?.removeEventListener('scroll', onRightScroll);
    };
  }, [handleScroll]);

  // Parse data
  let sheetData: GoogleSheetsApprovalData = {};
  if (typeof data === 'string') {
    try {
      sheetData = JSON.parse(data);
    } catch {
      sheetData = {};
    }
  } else {
    sheetData = data as GoogleSheetsApprovalData;
  }

  const {
    title = 'Untitled Spreadsheet',
    sheetName = 'Sheet1',
    action: sheetAction,
  } = sheetData;

  // Accept multiple field names for current/new data
  const currentData = sheetData.currentData || sheetData.currentRows || [];
  const newData = sheetData.newData || sheetData.newRows || sheetData.data || sheetData.rows || [];

  // Infer action from tool name if not explicitly provided
  const inferredAction = sheetAction || (
    tool.includes('createSpreadsheet') ? 'create' :
    tool.includes('appendRows') ? 'append' :
    tool.includes('updateCells') ? 'update' :
    'replace'
  );

  const isCreate = inferredAction === 'create';
  const isAppend = inferredAction === 'append';
  const isUpdate = inferredAction === 'update';
  const showSinglePanel = isCreate || (isAppend && currentData.length === 0);

  const actionLabel = isCreate
    ? 'Create Spreadsheet'
    : isAppend
      ? 'Append Rows'
      : isUpdate
        ? 'Update Cells'
        : 'Replace Sheet Content';

  // For append, combine current + new rows
  const afterRows = isAppend ? [...currentData, ...newData] : newData;

  // Get max columns for consistent table width
  const maxCols = Math.max(
    ...currentData.map(r => r.length),
    ...afterRows.map(r => r.length),
    1
  );

  // Normalize row to have consistent column count
  const normalizeRow = (row: string[]): string[] => {
    const normalized = [...row];
    while (normalized.length < maxCols) {
      normalized.push('');
    }
    return normalized;
  };

  // Compare two rows for equality
  const rowsEqual = (a: string[], b: string[]): boolean => {
    const normA = normalizeRow(a);
    const normB = normalizeRow(b);
    return normA.every((cell, i) => cell === normB[i]);
  };

  // Get diff status for a row
  const getDiffStatus = (row: string[], rowIndex: number, side: 'left' | 'right'): 'added' | 'removed' | 'unchanged' => {
    if (side === 'left') {
      if (isAppend || isCreate) return 'unchanged';
      // Check if this row exists in new data
      const existsInNew = newData.some(newRow => rowsEqual(row, newRow));
      return existsInNew ? 'unchanged' : 'removed';
    } else {
      if (isAppend) {
        // In append mode, rows from current are unchanged, new rows are added
        if (rowIndex < currentData.length) return 'unchanged';
        return 'added';
      }
      if (isCreate) {
        return 'added';
      }
      // For replace/update, check if row exists in current
      const existsInCurrent = currentData.some(currRow => rowsEqual(row, currRow));
      return existsInCurrent ? 'unchanged' : 'added';
    }
  };

  // Selection handlers - only for right side
  const handleRowMouseDown = useCallback((index: number, side: 'left' | 'right', e: React.MouseEvent) => {
    if (isLoading || side === 'left') return;
    e.preventDefault();

    dragStartRef.current = { index, side };
    setIsDragging(true);
    setSelection({ startIndex: index, endIndex: index, side });
    setShowCommentInput(false);
  }, [isLoading]);

  const handleRowMouseEnter = useCallback((index: number, side: 'left' | 'right') => {
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

    const newComment: RowComment = {
      id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      rowStart: selection.startIndex,
      rowEnd: selection.endIndex,
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

  const isRowSelected = (index: number, side: 'left' | 'right') => {
    if (!selection || selection.side !== side) return false;
    return index >= selection.startIndex && index <= selection.endIndex;
  };

  const hasComment = useCallback((index: number, side: 'left' | 'right') => {
    return comments.some(c =>
      c.side === side && index >= c.rowStart && index <= c.rowEnd
    );
  }, [comments]);

  const getCommentsEndingAt = (index: number, side: 'left' | 'right') => {
    return comments.filter(c => c.rowEnd === index && c.side === side);
  };

  const formatCommentsFeedback = (): string => {
    const hasTitleComment = titleComment !== null;
    const hasRowComments = comments.length > 0;

    if (!hasTitleComment && !hasRowComments) return '';

    const lines: string[] = ['SPREADSHEET COMMENTS:'];

    // Title comment
    if (hasTitleComment) {
      lines.push(`\n[Spreadsheet Name]: "${titleComment}"`);
    }

    // Row comments
    for (const c of comments) {
      const sideLabel = c.side === 'left' ? 'Current' : 'New';
      const rowRef = c.rowEnd !== c.rowStart
        ? `Rows ${c.rowStart + 1}-${c.rowEnd + 1}`
        : `Row ${c.rowStart + 1}`;
      lines.push(`\n[${sideLabel} - ${rowRef}]: "${c.content}"`);
    }
    return lines.join('\n');
  };

  const handleApprove = () => {
    // Pass back edited title if changed (for create spreadsheet)
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

  // Render a single row
  const renderRow = (row: string[], rowIndex: number, side: 'left' | 'right') => {
    const status = getDiffStatus(row, rowIndex, side);
    const isSelected = isRowSelected(rowIndex, side);
    const rowHasComment = hasComment(rowIndex, side);
    const rowComments = getCommentsEndingAt(rowIndex, side);
    const showInputAfterRow = showCommentInput && selection?.endIndex === rowIndex && selection?.side === side;
    const normalizedRow = normalizeRow(row);

    return (
      <div key={rowIndex} className="sheets-row-wrapper">
        <div
          className={`sheets-row sheets-row-${status} ${isSelected ? 'selected' : ''}`}
          onMouseDown={(e) => handleRowMouseDown(rowIndex, side, e)}
          onMouseEnter={() => handleRowMouseEnter(rowIndex, side)}
        >
          <span className="sheets-row-number">{rowIndex + 1}</span>
          <div className="sheets-row-cells">
            {normalizedRow.map((cell, cellIndex) => (
              <span
                key={cellIndex}
                className={`sheets-cell ${wrapText ? 'sheets-cell-wrap' : ''}`}
                title={cell || undefined}
              >
                {cell || '\u00A0'}
              </span>
            ))}
          </div>
          {side === 'right' && (
            <span className={`sheets-comment-indicator ${rowHasComment ? 'has-comment' : ''} ${!isLoading ? 'can-comment' : ''}`}>
              +
            </span>
          )}
          {side === 'left' && status === 'removed' && (
            <span className="sheets-diff-marker">−</span>
          )}
        </div>

        {/* Comment input */}
        {showInputAfterRow && (
          <div className="sheets-comment-input">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={selection && selection.startIndex !== selection.endIndex
                ? `Add feedback on rows ${selection.startIndex + 1}-${selection.endIndex + 1}...`
                : 'Add your feedback on this row...'
              }
              autoFocus
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.metaKey) handleAddComment();
                if (e.key === 'Escape') handleCancelComment();
              }}
            />
            <div className="sheets-comment-actions">
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

        {/* Existing comments */}
        {rowComments.map(comment => (
          <div key={comment.id} className="sheets-comment">
            {comment.rowEnd !== comment.rowStart && (
              <span className="sheets-comment-rows">
                Rows {comment.rowStart + 1}-{comment.rowEnd + 1}
              </span>
            )}
            <span className="sheets-comment-content">{comment.content}</span>
            <button
              className="sheets-comment-remove"
              onClick={(e) => { e.stopPropagation(); handleRemoveComment(comment.id); }}
              title="Remove comment"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    );
  };

  // Calculate max rows for padding (so both sides have same height in diff view)
  const maxRows = Math.max(currentData.length, afterRows.length);

  // Render placeholder row for padding
  const renderPlaceholderRow = (rowIndex: number) => (
    <div key={`placeholder-${rowIndex}`} className="sheets-row-wrapper">
      <div className="sheets-row sheets-row-placeholder">
        <span className="sheets-row-number">{rowIndex + 1}</span>
        <div className="sheets-row-cells">
          {Array.from({ length: maxCols }, (_, i) => (
            <span key={i} className="sheets-cell">{'\u00A0'}</span>
          ))}
        </div>
      </div>
    </div>
  );

  // Render a panel
  const renderPanel = (
    rows: string[][],
    side: 'left' | 'right',
    emptyMessage: string,
    panelRef?: React.RefObject<HTMLDivElement | null>
  ) => {
    // Calculate how many placeholder rows to add
    const placeholderCount = !showSinglePanel ? maxRows - rows.length : 0;

    return (
      <div
        className={`sheets-approval-panel sheets-approval-panel-${side === 'left' ? 'current' : 'after'}`}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div className="sheets-approval-panel-header">
          <span className="sheets-approval-panel-label">
            {side === 'left' ? 'Current' : showSinglePanel ? 'New Content' : 'After Changes'}
          </span>
        </div>
        <div className="sheets-approval-panel-body" ref={panelRef}>
          {rows.length === 0 && placeholderCount === 0 ? (
            <div className="sheets-approval-empty-panel">{emptyMessage}</div>
          ) : (
            <div className="sheets-table">
              {rows.map((row, idx) => renderRow(row, idx, side))}
              {/* Add placeholder rows to match the other side's height */}
              {placeholderCount > 0 && Array.from({ length: placeholderCount }, (_, i) =>
                renderPlaceholderRow(rows.length + i)
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Count stats
  const addedRows = afterRows.filter((row, idx) => getDiffStatus(row, idx, 'right') === 'added').length;
  const removedRows = currentData.filter((row, idx) => getDiffStatus(row, idx, 'left') === 'removed').length;

  return (
    <div className="sheets-approval-view">
      {/* Header */}
      <div className="sheets-approval-header">
        <div className="sheets-approval-title">
          <div className="sheets-approval-title-row">
            <McpIcon type="google-sheets" size={20} />
            <h3>{action || actionLabel}</h3>
          </div>
          {isCreate ? (
            /* Editable title for create spreadsheet */
            <div className="sheets-approval-editable-title">
              <label className="sheets-approval-title-label">Spreadsheet Name:</label>
              <div className="sheets-approval-title-input-row">
                <input
                  type="text"
                  className="sheets-approval-title-input"
                  value={editedTitle ?? title}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  disabled={isLoading}
                  placeholder="Enter spreadsheet name..."
                />
                {!showTitleCommentInput && !titleComment && !isLoading && (
                  <button
                    className="sheets-approval-add-comment"
                    onClick={handleStartTitleComment}
                    title="Add comment"
                  >
                    + comment
                  </button>
                )}
              </div>

              {/* Title comment input */}
              {showTitleCommentInput && (
                <div className="sheets-approval-title-comment-input">
                  <input
                    type="text"
                    value={titleCommentText}
                    onChange={(e) => setTitleCommentText(e.target.value)}
                    placeholder="Add feedback on the spreadsheet name..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && titleCommentText.trim()) handleAddTitleComment();
                      if (e.key === 'Escape') handleCancelTitleComment();
                    }}
                  />
                  <div className="sheets-approval-title-comment-actions">
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
                <div className="sheets-approval-title-comment">
                  <span className="sheets-approval-title-comment-content">{titleComment}</span>
                  <button
                    className="sheets-approval-title-comment-edit"
                    onClick={handleEditTitleComment}
                    title="Edit comment"
                  >
                    Edit
                  </button>
                  <button
                    className="sheets-approval-title-comment-remove"
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
            <div className="sheets-approval-doc-info">
              <span className="sheets-approval-doc-name">{title}</span>
              {sheetName && sheetName !== 'Sheet1' && (
                <span className="sheets-approval-sheet-name">/ {sheetName}</span>
              )}
            </div>
          )}
        </div>
        <div className="sheets-approval-stats">
          {!showSinglePanel && currentData.length > 0 && (
            <span className="stat-current">{currentData.length} rows</span>
          )}
          {addedRows > 0 && (
            <span className="stat-additions">+{addedRows} rows</span>
          )}
          {removedRows > 0 && (
            <span className="stat-deletions">-{removedRows} rows</span>
          )}
          <button
            className={`sheets-wrap-toggle ${wrapText ? 'active' : ''}`}
            onClick={() => setWrapText(!wrapText)}
            title={wrapText ? 'Truncate text' : 'Wrap text'}
          >
            {wrapText ? 'Truncate' : 'Wrap text'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className={`sheets-approval-content ${showSinglePanel ? 'single-panel' : ''}`}>
        {!showSinglePanel && renderPanel(currentData, 'left', 'Empty sheet', leftPanelRef)}
        {renderPanel(afterRows, 'right', 'No data', rightPanelRef)}
      </div>

      {/* Footer */}
      <ApprovalFooter
        onApprove={handleApprove}
        onRequestChanges={handleRequestChanges}
        onCancel={onCancel}
        isLoading={isLoading}
        approveLabel={isCreate ? 'Create Spreadsheet' : isAppend ? 'Append Rows' : 'Update Sheet'}
        commentCount={comments.length + (titleComment ? 1 : 0)}
      />
    </div>
  );
}
