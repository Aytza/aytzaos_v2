import { useState, useEffect, useCallback } from 'react';
import { useBugBoard } from '../../context/BugBoardContext';
import { Modal } from '../common/Modal';
import type { BugColumn, BugSeverity } from '../../types';
import { TEAM_MEMBERS } from '../../types';

const SEVERITY_OPTIONS: BugSeverity[] = ['low', 'medium', 'high'];
const COLUMN_OPTIONS: { id: BugColumn; name: string }[] = [
  { id: 'reported', name: 'Reported' },
  { id: 'triaged', name: 'Triaged' },
  { id: 'fixing', name: 'Fixing' },
  { id: 'fixed', name: 'Fixed' },
];

export function BugItemModal() {
  const { state, updateItem, deleteItem, selectItem, moveItem } = useBugBoard();
  const selectedItem = state.items.find((i) => i.id === state.selectedItemId);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<BugSeverity>('medium');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [column, setColumn] = useState<BugColumn>('reported');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (selectedItem) {
      setTitle(selectedItem.title);
      setDescription(selectedItem.description || '');
      setSeverity(selectedItem.severity);
      setOwnerEmail(selectedItem.ownerEmail || '');
      setColumn(selectedItem.column);
    }
  }, [selectedItem]);

  const handleClose = useCallback(() => {
    selectItem(null);
    setIsDeleting(false);
  }, [selectItem]);

  const handleSave = useCallback(async () => {
    if (!selectedItem) return;

    await updateItem(selectedItem.id, {
      title,
      description: description || undefined,
      severity,
      ownerEmail: ownerEmail || null,
    });

    if (column !== selectedItem.column) {
      const itemsInColumn = state.items.filter((i) => i.column === column);
      await moveItem(selectedItem.id, column, itemsInColumn.length);
    }

    handleClose();
  }, [selectedItem, title, description, severity, ownerEmail, column, state.items, updateItem, moveItem, handleClose]);

  const handleDelete = useCallback(async () => {
    if (!selectedItem) return;
    await deleteItem(selectedItem.id);
    handleClose();
  }, [selectedItem, deleteItem, handleClose]);

  if (!selectedItem) return null;

  return (
    <Modal isOpen={true} onClose={handleClose} title="Edit Bug">
      <div className="bugboard-modal-content">
        <div className="bugboard-modal-field">
          <label>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter bug title..."
          />
        </div>

        <div className="bugboard-modal-field">
          <label>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the bug, steps to reproduce..."
            rows={4}
          />
        </div>

        <div className="bugboard-modal-row">
          <div className="bugboard-modal-field">
            <label>Status</label>
            <select value={column} onChange={(e) => setColumn(e.target.value as BugColumn)}>
              {COLUMN_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
          </div>

          <div className="bugboard-modal-field">
            <label>Severity</label>
            <div className="bugboard-severity-buttons">
              {SEVERITY_OPTIONS.map((s) => (
                <button
                  key={s}
                  className={`severity-btn severity-${s} ${severity === s ? 'active' : ''}`}
                  onClick={() => setSeverity(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bugboard-modal-field">
          <label>Assignee</label>
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

        <div className="bugboard-modal-meta">
          <span>Reported by {selectedItem.createdBy}</span>
          <span>
            {new Date(selectedItem.createdAt).toLocaleDateString()}
          </span>
        </div>

        <div className="bugboard-modal-actions">
          {isDeleting ? (
            <div className="bugboard-delete-confirm">
              <span>Delete this bug?</span>
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
              <div className="bugboard-modal-actions-right">
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
