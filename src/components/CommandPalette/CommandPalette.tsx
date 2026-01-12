import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProject } from '../../context/ProjectContext';
import './CommandPalette.css';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNewTask: (columnIndex: number) => void;
}

type ResultItem = {
  id: string;
  type: 'board' | 'task' | 'action';
  title: string;
  subtitle?: string;
  action: () => void;
};

export function CommandPalette({ isOpen, onClose, onNewTask }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { projects, activeProject } = useProject();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const getResults = useCallback((): ResultItem[] => {
    const q = query.toLowerCase().trim();

    // Actions
    const actions: ResultItem[] = [
      {
        id: 'new-task-1',
        type: 'action',
        title: 'New task in first column',
        subtitle: activeProject?.columns[0]?.name,
        action: () => { onNewTask(0); onClose(); },
      },
    ];

    if (activeProject && activeProject.columns.length > 1) {
      actions.push({
        id: 'new-task-2',
        type: 'action',
        title: 'New task in second column',
        subtitle: activeProject.columns[1]?.name,
        action: () => { onNewTask(1); onClose(); },
      });
    }

    if (activeProject && activeProject.columns.length > 2) {
      actions.push({
        id: 'new-task-3',
        type: 'action',
        title: 'New task in third column',
        subtitle: activeProject.columns[2]?.name,
        action: () => { onNewTask(2); onClose(); },
      });
    }

    // Projects
    const projectResults: ResultItem[] = projects.map((project) => ({
      id: `project-${project.id}`,
      type: 'board' as const,
      title: project.name,
      subtitle: project.id === activeProject?.id ? 'Current project' : 'Switch to project',
      action: () => {
        navigate(`/project/${project.id}`);
        onClose();
      },
    }));

    // Tasks from active project
    const taskResults: ResultItem[] = activeProject?.tasks.map((task) => {
      const column = activeProject.columns.find((c: { id: string }) => c.id === task.columnId);
      return {
        id: `task-${task.id}`,
        type: 'task' as const,
        title: task.title,
        subtitle: column?.name || '',
        action: () => {
          // For now just close - could open task modal
          onClose();
        },
      };
    }) || [];

    // Filter by query
    if (q) {
      const filtered = [...actions, ...projectResults, ...taskResults].filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.subtitle?.toLowerCase().includes(q)
      );
      return filtered;
    }

    // Default: show actions first, then projects
    return [...actions, ...projectResults.slice(0, 5)];
  }, [query, projects, activeProject, navigate, onClose, onNewTask]);

  const results = getResults();

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  useEffect(() => {
    if (selectedIndex >= results.length) {
      setSelectedIndex(Math.max(0, results.length - 1));
    }
  }, [results.length, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.querySelector('.palette-item.selected');
      selected?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          results[selectedIndex].action();
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-wrapper">
          <span className="palette-prompt">&gt;</span>
          <input
            ref={inputRef}
            type="text"
            className="palette-input"
            placeholder="Search projects, tasks, or actions..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div className="palette-results" ref={listRef}>
          {results.length === 0 ? (
            <div className="palette-empty">No results found</div>
          ) : (
            results.map((item, index) => (
              <button
                key={item.id}
                className={`palette-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => item.action()}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className={`palette-item-icon ${item.type}`}>
                  {item.type === 'board' && '#'}
                  {item.type === 'task' && '-'}
                  {item.type === 'action' && '+'}
                </span>
                <span className="palette-item-content">
                  <span className="palette-item-title">{item.title}</span>
                  {item.subtitle && (
                    <span className="palette-item-subtitle">{item.subtitle}</span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="palette-footer">
          <span className="palette-hint">
            <kbd>↑↓</kbd> navigate
          </span>
          <span className="palette-hint">
            <kbd>↵</kbd> select
          </span>
          <span className="palette-hint">
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
