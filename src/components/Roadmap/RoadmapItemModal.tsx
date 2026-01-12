import { useState, useEffect, useCallback } from 'react';
import { useRoadmap } from '../../context/RoadmapContext';
import { Modal } from '../common/Modal';
import type { ItemSize, RoadmapColumn } from '../../types';
import { TEAM_MEMBERS } from '../../types';

const SIZE_OPTIONS: ItemSize[] = ['S', 'M', 'L'];
const COLUMN_OPTIONS: { id: RoadmapColumn; name: string }[] = [
  { id: 'ideas', name: 'Ideas' },
  { id: 'prototyping', name: 'Prototyping' },
  { id: 'building', name: 'Building' },
  { id: 'shipped', name: 'Shipped' },
];

// Generate weeks for the dropdown (current week + 8 weeks ahead)
function generateWeekOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [{ value: '', label: 'No target week' }];
  const today = new Date();

  for (let i = 0; i < 12; i++) {
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + i * 7 - today.getDay() + 1);
    const value = weekStart.toISOString().split('T')[0];
    const label = weekStart.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    options.push({ value, label: `Week of ${label}` });
  }

  return options;
}

export function RoadmapItemModal() {
  const { state, updateItem, deleteItem, selectItem, moveItem } = useRoadmap();
  const selectedItem = state.items.find((i) => i.id === state.selectedItemId);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [targetWeek, setTargetWeek] = useState('');
  const [size, setSize] = useState<ItemSize>('M');
  const [notes, setNotes] = useState('');
  const [column, setColumn] = useState<RoadmapColumn>('ideas');
  const [isDeleting, setIsDeleting] = useState(false);

  const weekOptions = generateWeekOptions();

  useEffect(() => {
    if (selectedItem) {
      setTitle(selectedItem.title);
      setDescription(selectedItem.description || '');
      setOwnerEmail(selectedItem.ownerEmail || '');
      setTargetWeek(selectedItem.targetWeek || '');
      setSize(selectedItem.size);
      setNotes(selectedItem.notes || '');
      setColumn(selectedItem.column);
    }
  }, [selectedItem]);

  const handleClose = useCallback(() => {
    selectItem(null);
    setIsDeleting(false);
  }, [selectItem]);

  const handleSave = useCallback(async () => {
    if (!selectedItem) return;

    // Update item details
    await updateItem(selectedItem.id, {
      title,
      description: description || undefined,
      ownerEmail: ownerEmail || null,
      targetWeek: targetWeek || null,
      size,
      notes: notes || null,
    });

    // Move to new column if changed
    if (column !== selectedItem.column) {
      const itemsInColumn = state.items.filter((i) => i.column === column);
      await moveItem(selectedItem.id, column, itemsInColumn.length);
    }

    handleClose();
  }, [selectedItem, title, description, ownerEmail, targetWeek, size, notes, column, state.items, updateItem, moveItem, handleClose]);

  const handleDelete = useCallback(async () => {
    if (!selectedItem) return;
    await deleteItem(selectedItem.id);
    handleClose();
  }, [selectedItem, deleteItem, handleClose]);

  if (!selectedItem) return null;

  return (
    <Modal isOpen={true} onClose={handleClose} title="Edit Item">
      <div className="roadmap-modal-content">
        <div className="roadmap-modal-field">
          <label>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter title..."
          />
        </div>

        <div className="roadmap-modal-field">
          <label>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Enter description..."
            rows={3}
          />
        </div>

        <div className="roadmap-modal-row">
          <div className="roadmap-modal-field">
            <label>Status</label>
            <select value={column} onChange={(e) => setColumn(e.target.value as RoadmapColumn)}>
              {COLUMN_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
          </div>

          <div className="roadmap-modal-field">
            <label>Size</label>
            <div className="roadmap-size-buttons">
              {SIZE_OPTIONS.map((s) => (
                <button
                  key={s}
                  className={`size-btn ${size === s ? 'active' : ''}`}
                  onClick={() => setSize(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="roadmap-modal-row">
          <div className="roadmap-modal-field">
            <label>Owner</label>
            <select
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
            >
              <option value="">Unassigned</option>
              {TEAM_MEMBERS.map((member) => (
                <option key={member.email} value={member.email}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>

          <div className="roadmap-modal-field">
            <label>Target Week</label>
            <select
              value={targetWeek}
              onChange={(e) => setTargetWeek(e.target.value)}
            >
              {weekOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="roadmap-modal-field">
          <label>Notes</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g., n8n workflow link, PR #123..."
          />
        </div>

        <div className="roadmap-modal-meta">
          <span>Created by {selectedItem.createdBy}</span>
          <span>
            {new Date(selectedItem.createdAt).toLocaleDateString()}
          </span>
        </div>

        <div className="roadmap-modal-actions">
          {isDeleting ? (
            <div className="roadmap-delete-confirm">
              <span>Delete this item?</span>
              <button className="btn-danger" onClick={handleDelete}>
                Yes, delete
              </button>
              <button onClick={() => setIsDeleting(false)}>Cancel</button>
            </div>
          ) : (
            <>
              <button className="btn-danger-outline" onClick={() => setIsDeleting(true)}>
                Delete
              </button>
              <div className="roadmap-modal-actions-right">
                <button onClick={handleClose}>Cancel</button>
                <button className="btn-primary" onClick={handleSave}>
                  Save
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
