import { useState, useCallback } from 'react';
import { useRoadmap } from '../../context/RoadmapContext';
import { RoadmapCard } from './RoadmapCard';
import type { RoadmapColumn, RoadmapItem } from '../../types';

const COLUMNS: { id: RoadmapColumn; name: string }[] = [
  { id: 'ideas', name: 'Ideas' },
  { id: 'prototyping', name: 'Prototyping' },
  { id: 'building', name: 'Building' },
  { id: 'shipped', name: 'Shipped' },
];

export function RoadmapBoard() {
  const { getItemsByColumn, createItem, moveItem, selectItem } = useRoadmap();
  const [addingToColumn, setAddingToColumn] = useState<RoadmapColumn | null>(null);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [draggedItem, setDraggedItem] = useState<RoadmapItem | null>(null);

  const handleAddItem = useCallback(async (column: RoadmapColumn) => {
    if (!newItemTitle.trim()) return;

    await createItem({
      title: newItemTitle.trim(),
      column,
    });

    setNewItemTitle('');
    setAddingToColumn(null);
  }, [newItemTitle, createItem]);

  const handleDragStart = useCallback((item: RoadmapItem) => {
    setDraggedItem(item);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((column: RoadmapColumn, position: number) => {
    if (draggedItem) {
      moveItem(draggedItem.id, column, position);
      setDraggedItem(null);
    }
  }, [draggedItem, moveItem]);

  return (
    <div className="roadmap-board">
      {COLUMNS.map((column) => {
        const items = getItemsByColumn(column.id);

        return (
          <div
            key={column.id}
            className="roadmap-column"
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(column.id, items.length)}
          >
            <div className="roadmap-column-header">
              <h2>{column.name}</h2>
              <span className="roadmap-column-count">{items.length}</span>
            </div>

            <div className="roadmap-column-items">
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
                  <RoadmapCard
                    item={item}
                    onDragStart={() => handleDragStart(item)}
                    onClick={() => selectItem(item.id)}
                  />
                </div>
              ))}

              {addingToColumn === column.id ? (
                <div className="roadmap-add-form">
                  <input
                    type="text"
                    placeholder="Enter title..."
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
                  <div className="roadmap-add-form-actions">
                    <button
                      className="roadmap-add-form-btn primary"
                      onClick={() => handleAddItem(column.id)}
                    >
                      Add
                    </button>
                    <button
                      className="roadmap-add-form-btn"
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
                  className="roadmap-add-btn"
                  onClick={() => setAddingToColumn(column.id)}
                >
                  + Add item
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
