import { useEffect, useState, useCallback, type DragEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useProject } from '../../context/ProjectContext';
import { Column } from '../Column/Column';
import './Board.css';

export function Board() {
  // Support both project and board URL params for backward compatibility
  const { projectId } = useParams<{ projectId: string }>();
  const { activeProject, loading, loadProject, createColumn, columnDragState, setColumnDragState, moveColumn } = useProject();
  const [newColumnId, setNewColumnId] = useState<string | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  // Load project from URL param on mount or when projectId changes
  useEffect(() => {
    if (projectId && projectId !== activeProject?.id) {
      loadProject(projectId);
    }
  }, [projectId, activeProject?.id, loadProject]);

  // Clear newColumnId after it's been used to trigger edit mode
  useEffect(() => {
    if (newColumnId) {
      const timer = setTimeout(() => setNewColumnId(null), 100);
      return () => clearTimeout(timer);
    }
  }, [newColumnId]);

  const handleAddColumn = useCallback(async () => {
    const column = await createColumn('New Column');
    if (column) {
      setNewColumnId(column.id);
    }
  }, [createColumn]);

  if (loading) {
    return (
      <div className="board-loading">
        <span className="loading-text">Loading...</span>
      </div>
    );
  }

  if (!activeProject) {
    return (
      <div className="board-empty">
        <div className="empty-content">
          <span className="empty-icon">&gt;_</span>
          <h2 className="empty-title">No Project Selected</h2>
          <p className="empty-text">
            Create a new project or select an existing one to get started.
          </p>
        </div>
      </div>
    );
  }

  const sortedColumns = [...activeProject.columns].sort(
    (a, b) => a.position - b.position
  );

  const handleColumnDragStart = (columnId: string) => {
    setColumnDragState({ isDragging: true, columnId });
  };

  const handleColumnDragEnd = () => {
    setColumnDragState({ isDragging: false, columnId: null });
    setDropTargetIndex(null);
  };

  const handleColumnDragOver = (e: DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (!columnDragState.isDragging || !columnDragState.columnId) return;

    const draggedColumnIndex = sortedColumns.findIndex(c => c.id === columnDragState.columnId);
    if (draggedColumnIndex === targetIndex) return;

    setDropTargetIndex(targetIndex);
  };

  const handleColumnDrop = async (e: DragEvent, targetIndex: number) => {
    e.preventDefault();
    const columnId = e.dataTransfer.getData('application/column');
    if (!columnId) return;

    const sourceIndex = sortedColumns.findIndex(c => c.id === columnId);
    if (sourceIndex === -1 || sourceIndex === targetIndex) return;

    await moveColumn(columnId, targetIndex);
    setDropTargetIndex(null);
    setColumnDragState({ isDragging: false, columnId: null });
  };

  return (
    <div className="board">
      <div className="board-columns">
        {sortedColumns.map((column, index) => (
          <div
            key={column.id}
            className="column-wrapper"
            onDragOver={(e) => handleColumnDragOver(e, index)}
            onDrop={(e) => handleColumnDrop(e, index)}
          >
            <Column
              column={column}
              onStartEdit={column.id === newColumnId ? () => {} : undefined}
              onColumnDragStart={() => handleColumnDragStart(column.id)}
              onColumnDragEnd={handleColumnDragEnd}
              isColumnDragTarget={dropTargetIndex === index && columnDragState.columnId !== column.id}
            />
          </div>
        ))}
        <button className="add-column-btn" onClick={handleAddColumn} title="Add column" aria-label="Add column">
          <span className="add-column-icon">+</span>
        </button>
      </div>
    </div>
  );
}
