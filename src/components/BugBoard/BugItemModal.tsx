import { useState, useEffect, useCallback, useRef } from 'react';
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

// Max file size: 2MB (base64 will be ~33% larger)
const MAX_FILE_SIZE = 2 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function BugItemModal() {
  const { state, updateItem, deleteItem, selectItem, moveItem } = useBugBoard();
  const selectedItem = state.items.find((i) => i.id === state.selectedItemId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<BugSeverity>('medium');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [column, setColumn] = useState<BugColumn>('reported');
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  useEffect(() => {
    if (selectedItem) {
      setTitle(selectedItem.title);
      setDescription(selectedItem.description || '');
      setSeverity(selectedItem.severity);
      setOwnerEmail(selectedItem.ownerEmail || '');
      setColumn(selectedItem.column);
      setScreenshots(selectedItem.screenshots || []);
    }
  }, [selectedItem]);

  const handleClose = useCallback(() => {
    selectItem(null);
    setIsDeleting(false);
    setPreviewImage(null);
  }, [selectItem]);

  const handleSave = useCallback(async () => {
    if (!selectedItem) return;

    await updateItem(selectedItem.id, {
      title,
      description: description || undefined,
      severity,
      ownerEmail: ownerEmail || null,
      screenshots,
    });

    if (column !== selectedItem.column) {
      const itemsInColumn = state.items.filter((i) => i.column === column);
      await moveItem(selectedItem.id, column, itemsInColumn.length);
    }

    handleClose();
  }, [selectedItem, title, description, severity, ownerEmail, column, screenshots, state.items, updateItem, moveItem, handleClose]);

  const handleDelete = useCallback(async () => {
    if (!selectedItem) return;
    await deleteItem(selectedItem.id);
    handleClose();
  }, [selectedItem, deleteItem, handleClose]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newScreenshots: string[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) {
        alert(`File ${file.name} is too large. Max size is 2MB.`);
        continue;
      }
      if (!file.type.startsWith('image/')) {
        alert(`File ${file.name} is not an image.`);
        continue;
      }
      try {
        const base64 = await fileToBase64(file);
        newScreenshots.push(base64);
      } catch (err) {
        console.error('Failed to read file:', err);
      }
    }

    if (newScreenshots.length > 0) {
      setScreenshots((prev) => [...prev, ...newScreenshots]);
    }

    // Reset the input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleRemoveScreenshot = useCallback((index: number) => {
    setScreenshots((prev) => prev.filter((_, i) => i !== index));
  }, []);

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

        <div className="bugboard-modal-field">
          <label>Screenshots</label>
          <div className="bugboard-screenshots">
            {screenshots.length > 0 && (
              <div className="bugboard-screenshot-grid">
                {screenshots.map((src, index) => (
                  <div key={index} className="bugboard-screenshot-item">
                    <img
                      src={src}
                      alt={`Screenshot ${index + 1}`}
                      onClick={() => setPreviewImage(src)}
                    />
                    <button
                      className="bugboard-screenshot-remove"
                      onClick={() => handleRemoveScreenshot(index)}
                      title="Remove screenshot"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              className="bugboard-screenshot-add"
              onClick={() => fileInputRef.current?.click()}
            >
              + Add Screenshot
            </button>
          </div>
        </div>

        {previewImage && (
          <div className="bugboard-screenshot-preview" onClick={() => setPreviewImage(null)}>
            <img src={previewImage} alt="Preview" />
            <span className="bugboard-screenshot-preview-close">Click to close</span>
          </div>
        )}

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
