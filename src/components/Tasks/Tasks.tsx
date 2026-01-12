import { useState, useEffect, useRef } from 'react';
import { Button, Modal, Input, RichTextEditor } from '../common';
import type { Task, TaskPriority } from '../../types';
import * as api from '../../api/client';
import './Tasks.css';

export function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('medium');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Load tasks on mount
  useEffect(() => {
    loadTasks();
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadTasks = async () => {
    setLoading(true);
    const result = await api.getStandaloneTasks();
    if (result.success && result.data) {
      setTasks(result.data);
    }
    setLoading(false);
  };

  const handleCreateTask = async () => {
    if (newTaskTitle.trim()) {
      const result = await api.createStandaloneTask({
        title: newTaskTitle.trim(),
        description: newTaskDescription.trim() || undefined,
        priority: newTaskPriority,
      });
      if (result.success && result.data) {
        setTasks((prev) => [...prev, result.data!]);
        resetCreateForm();
        setShowCreateModal(false);
      }
    }
  };

  const handleUpdateTask = async () => {
    if (editingTask && editingTask.title.trim()) {
      const result = await api.updateStandaloneTask(editingTask.id, {
        title: editingTask.title,
        description: editingTask.description || undefined,
        priority: editingTask.priority,
      });
      if (result.success && result.data) {
        setTasks((prev) =>
          prev.map((t) => (t.id === editingTask.id ? result.data! : t))
        );
        setEditingTask(null);
        setShowEditModal(false);
      }
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    const result = await api.deleteStandaloneTask(taskId);
    if (result.success) {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setMenuOpenId(null);
    }
  };

  const resetCreateForm = () => {
    setNewTaskTitle('');
    setNewTaskDescription('');
    setNewTaskPriority('medium');
  };

  const openEditModal = (task: Task) => {
    setEditingTask({ ...task });
    setShowEditModal(true);
    setMenuOpenId(null);
  };

  const getPriorityColor = (priority: TaskPriority) => {
    switch (priority) {
      case 'high':
        return 'priority-high';
      case 'low':
        return 'priority-low';
      default:
        return 'priority-medium';
    }
  };

  return (
    <div className="tasks-page">
      <div className="tasks-container">
        <div className="tasks-header">
          <h1 className="tasks-title">&gt; My Tasks</h1>
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            + New Task
          </Button>
        </div>

        {loading ? (
          <div className="tasks-loading">Loading tasks...</div>
        ) : tasks.length === 0 ? (
          <div className="tasks-empty">
            <p>No tasks yet</p>
            <Button variant="ghost" onClick={() => setShowCreateModal(true)}>
              Create your first task
            </Button>
          </div>
        ) : (
          <div className="tasks-list">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="task-item"
                onClick={() => openEditModal(task)}
                ref={menuOpenId === task.id ? menuRef : null}
              >
                <div className="task-item-main">
                  <span className={`task-priority-dot ${getPriorityColor(task.priority)}`} />
                  <span className="task-item-title">{task.title}</span>
                </div>
                <div className="task-item-right">
                  <span className="task-item-date">
                    {new Date(task.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    className="task-item-menu-trigger"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === task.id ? null : task.id);
                    }}
                  >
                    ...
                  </button>
                </div>
                {menuOpenId === task.id && (
                  <div className="task-item-dropdown">
                    <button onClick={(e) => { e.stopPropagation(); openEditModal(task); }}>Edit</button>
                    <button className="danger" onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}>Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Task Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => { setShowCreateModal(false); resetCreateForm(); }}
        title="Create Task"
        width="md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleCreateTask();
          }}
        >
          <div className="modal-form">
            <Input
              label="Title"
              placeholder="What needs to be done?"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              autoFocus
            />
            <RichTextEditor
              label="Description (optional)"
              placeholder="Add details or instructions..."
              value={newTaskDescription}
              onChange={setNewTaskDescription}
              rows={3}
            />
            <div className="form-field">
              <label className="form-label">Priority</label>
              <select
                className="form-select"
                value={newTaskPriority}
                onChange={(e) => setNewTaskPriority(e.target.value as TaskPriority)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="modal-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setShowCreateModal(false); resetCreateForm(); }}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={!newTaskTitle.trim()}>
                Create Task
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Edit Task Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => { setShowEditModal(false); setEditingTask(null); }}
        title="Edit Task"
        width="md"
      >
        {editingTask && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleUpdateTask();
            }}
          >
            <div className="modal-form">
              <Input
                label="Title"
                value={editingTask.title}
                onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                autoFocus
              />
              <RichTextEditor
                label="Description"
                placeholder="Add details or instructions..."
                value={editingTask.description || ''}
                onChange={(desc) => setEditingTask({ ...editingTask, description: desc })}
                rows={4}
              />
              <div className="form-field">
                <label className="form-label">Priority</label>
                <select
                  className="form-select"
                  value={editingTask.priority}
                  onChange={(e) => setEditingTask({ ...editingTask, priority: e.target.value as TaskPriority })}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="modal-actions">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setShowEditModal(false); setEditingTask(null); }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={!editingTask.title.trim()}>
                  Save Changes
                </Button>
              </div>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
