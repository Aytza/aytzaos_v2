import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProject } from '../../context/ProjectContext';
import { Button, Modal, Input } from '../common';
import './Projects.css';

export function Projects() {
  const navigate = useNavigate();
  const { projects, createProject, renameProject, deleteProject, loading } = useProject();
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renameModalProject, setRenameModalProject] = useState<{ id: string; name: string } | null>(null);
  const [deleteModalProject, setDeleteModalProject] = useState<{ id: string; name: string } | null>(null);
  const [renameName, setRenameName] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

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

  const filteredProjects = projects.filter((project) =>
    project.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateProject = async () => {
    if (newProjectName.trim()) {
      const projectId = await createProject(newProjectName.trim());
      setNewProjectName('');
      setShowCreateModal(false);
      if (projectId) {
        navigate(`/project/${projectId}`);
      }
    }
  };

  const handleSelectProject = (projectId: string) => {
    navigate(`/project/${projectId}`);
  };

  const handleRename = async () => {
    if (renameModalProject && renameName.trim()) {
      await renameProject(renameModalProject.id, renameName.trim());
      setRenameModalProject(null);
      setRenameName('');
    }
  };

  const handleDelete = async () => {
    if (deleteModalProject) {
      await deleteProject(deleteModalProject.id);
      setDeleteModalProject(null);
    }
  };

  const openRenameModal = (project: { id: string; name: string }) => {
    setRenameName(project.name);
    setRenameModalProject(project);
    setMenuOpenId(null);
  };

  const openDeleteModal = (project: { id: string; name: string }) => {
    setDeleteModalProject(project);
    setMenuOpenId(null);
  };

  return (
    <div className="projects-page">
      <div className="projects-container">
        <div className="projects-header">
          <div className="projects-header-text">
            <h1 className="projects-title">Projects</h1>
            <p className="projects-subtitle">Kanban boards with AI agent workflows for complex work</p>
          </div>
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            + New Project
          </Button>
        </div>

        <div className="projects-search">
          <Input
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="projects-loading">Loading projects...</div>
        ) : filteredProjects.length === 0 ? (
          <div className="projects-empty">
            {searchQuery ? (
              <p>No projects matching "{searchQuery}"</p>
            ) : (
              <>
                <p>No projects yet</p>
                <Button variant="ghost" onClick={() => setShowCreateModal(true)}>
                  Create your first project
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="projects-grid">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                className="project-card"
                onClick={() => handleSelectProject(project.id)}
                ref={menuOpenId === project.id ? menuRef : null}
              >
                <div className="project-card-icon">
                  <span>📋</span>
                </div>
                <div className="project-card-content">
                  <span className="project-card-name">{project.name}</span>
                  <span className="project-card-meta">
                    Created {new Date(project.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  className="project-card-menu-trigger"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(menuOpenId === project.id ? null : project.id);
                  }}
                >
                  ⋯
                </button>
                {menuOpenId === project.id && (
                  <div className="project-card-dropdown">
                    <button onClick={(e) => { e.stopPropagation(); openRenameModal(project); }}>Rename</button>
                    <button className="danger" onClick={(e) => { e.stopPropagation(); openDeleteModal(project); }}>Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create New Project"
        width="sm"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleCreateProject();
          }}
        >
          <div className="modal-form">
            <Input
              label="Project Name"
              placeholder="My Project"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              autoFocus
            />
            <div className="modal-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Create Project
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Rename Modal */}
      <Modal
        isOpen={!!renameModalProject}
        onClose={() => setRenameModalProject(null)}
        title="Rename Project"
        width="sm"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRename();
          }}
        >
          <div className="modal-form">
            <Input
              label="Project Name"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              autoFocus
            />
            <div className="modal-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRenameModalProject(null)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Rename
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteModalProject}
        onClose={() => setDeleteModalProject(null)}
        title="Delete Project"
        width="sm"
      >
        <div className="modal-form">
          <p className="delete-warning">
            Are you sure you want to delete "{deleteModalProject?.name}"? This action cannot be undone.
          </p>
          <div className="modal-actions">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteModalProject(null)}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
