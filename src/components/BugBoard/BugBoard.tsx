import { useState, useCallback } from 'react';
import { BugBoardProvider, useBugBoard } from '../../context/BugBoardContext';
import { BugCard } from './BugCard';
import { BugItemModal } from './BugItemModal';
import type { BugColumn, BugItem } from '../../types';
import './BugBoard.css';

const COLUMNS: { id: BugColumn; name: string }[] = [
  { id: 'reported', name: 'Reported' },
  { id: 'triaged', name: 'Triaged' },
  { id: 'fixing', name: 'Fixing' },
  { id: 'fixed', name: 'Fixed' },
];

function BugBoardContent() {
  const { getItemsByColumn, createItem, moveItem, selectItem } = useBugBoard();
  const [addingToColumn, setAddingToColumn] = useState<BugColumn | null>(null);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [draggedItem, setDraggedItem] = useState<BugItem | null>(null);

  const handleAddItem = useCallback(async (column: BugColumn) => {
    if (!newItemTitle.trim()) return;

    await createItem({
      title: newItemTitle.trim(),
      column,
    });

    setNewItemTitle('');
    setAddingToColumn(null);
  }, [newItemTitle, createItem]);

  const handleDragStart = useCallback((item: BugItem) => {
    setDraggedItem(item);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((column: BugColumn, position: number) => {
    if (draggedItem) {
      moveItem(draggedItem.id, column, position);
      setDraggedItem(null);
    }
  }, [draggedItem, moveItem]);

  return (
    <div className="bugboard">
      <div className="bugboard-header">
        <h1>Bug Tracker</h1>
      </div>

      <div className="bugboard-columns">
        {COLUMNS.map((column) => {
          const items = getItemsByColumn(column.id);

          return (
            <div
              key={column.id}
              className="bugboard-column"
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(column.id, items.length)}
            >
              <div className="bugboard-column-header">
                <h2>{column.name}</h2>
                <span className="bugboard-column-count">{items.length}</span>
              </div>

              <div className="bugboard-column-items">
                {items.map((item, index) => (
                  <div
                    key={item.id}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.stopPropagation();
                      handleDrop(column.id, index);
                    }}
                  >
                    <BugCard
                      item={item}
                      onDragStart={() => handleDragStart(item)}
                      onClick={() => selectItem(item.id)}
                    />
                  </div>
                ))}

                {addingToColumn === column.id ? (
                  <div className="bugboard-add-form">
                    <input
                      type="text"
                      placeholder="Enter bug title..."
                      value={newItemTitle}
                      onChange={(e) => setNewItemTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddItem(column.id);
                        if (e.key === 'Escape') {
                          setAddingToColumn(null);
                          setNewItemTitle('');
                        }
                      }}
                      autoFocus
                    />
                    <div className="bugboard-add-form-actions">
                      <button
                        className="bugboard-add-form-btn primary"
                        onClick={() => handleAddItem(column.id)}
                      >
                        Add
                      </button>
                      <button
                        className="bugboard-add-form-btn"
                        onClick={() => {
                          setAddingToColumn(null);
                          setNewItemTitle('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="bugboard-add-btn"
                    onClick={() => setAddingToColumn(column.id)}
                  >
                    + Report bug
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <BugItemModal />
    </div>
  );
}

export function BugBoard() {
  return (
    <BugBoardProvider>
      <BugBoardContent />
    </BugBoardProvider>
  );
}
