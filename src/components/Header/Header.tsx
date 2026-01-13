import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useProject } from '../../context/ProjectContext';
import { useAuth } from '../../context/AuthContext';
import { Modal, Input, Button } from '../common';
import { BoardSettings, UserSettings } from '../Settings';
import { WeftLogo } from './WeftLogo';
import * as api from '../../api/client';
import './Header.css';

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { projects, activeProject, clearActiveProject, createProject, activeWorkflows, updateWorkflowPlan, removeWorkflowPlan } = useProject();
  const { user, signOut } = useAuth();
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showSelector, setShowSelector] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showExecutions, setShowExecutions] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [confirmingCancel, setConfirmingCancel] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const executionsRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const isHome = location.pathname === '/';
  const isTasksPage = location.pathname === '/tasks';
  const isRoadmap = location.pathname === '/roadmap';
  const isBugs = location.pathname === '/bugs';

  // Auto-open settings modal when returning from GitHub OAuth
  useEffect(() => {
    const githubConnected = searchParams.get('github');
    const githubError = searchParams.get('github_error');
    if ((githubConnected === 'connected' || githubError) && activeProject) {
      setShowSettings(true);
    }
  }, [searchParams, activeProject]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSelector(false);
      }
      if (executionsRef.current && !executionsRef.current.contains(event.target as Node)) {
        setShowExecutions(false);
        setConfirmingCancel(null);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    if (showSelector || showExecutions || showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSelector, showExecutions, showUserMenu]);

  const handleGoHome = () => {
    clearActiveProject();
    navigate('/');
  };

  const handleCreateProject = async () => {
    if (newProjectName.trim()) {
      const projectId = await createProject(newProjectName.trim());
      setNewProjectName('');
      setShowProjectModal(false);
      if (projectId) {
        navigate(`/project/${projectId}`);
      }
    }
  };

  const handleSelectProject = (projectId: string) => {
    navigate(`/project/${projectId}`);
    setShowSelector(false);
  };

  return (
    <header className="header">
      <div className="header-left">
        <WeftLogo onClick={handleGoHome} />
        <nav className="header-nav">
          <button
            className={`header-nav-link ${isRoadmap ? 'active' : ''}`}
            onClick={() => navigate('/roadmap')}
          >
            Roadmap
          </button>
          <button
            className={`header-nav-link ${isBugs ? 'active' : ''}`}
            onClick={() => navigate('/bugs')}
          >
            Bugs
          </button>
        </nav>
      </div>

      <div className="header-center">
        {!isHome && (
          <div className="board-selector-wrapper" ref={dropdownRef}>
            <button
              className="board-selector-trigger"
              onClick={() => setShowSelector(!showSelector)}
            >
              <span className="board-selector-name">
                {activeProject?.name || 'Select Project'}
              </span>
              <span className="board-selector-arrow">▼</span>
            </button>

            {showSelector && (
              <div className="board-selector-dropdown">
                {projects.length === 0 ? (
                  <div className="board-selector-empty">No projects yet</div>
                ) : (
                  projects.map((project) => (
                    <button
                      key={project.id}
                      className={`board-selector-item ${
                        activeProject?.id === project.id ? 'active' : ''
                      }`}
                      onClick={() => handleSelectProject(project.id)}
                    >
                      {project.name}
                    </button>
                  ))
                )}
                <div className="board-selector-divider" />
                <button
                  className="board-selector-item board-selector-new"
                  onClick={() => {
                    setShowSelector(false);
                    setShowProjectModal(true);
                  }}
                >
                  + New Project
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="header-right">
        {/* My Tasks link */}
        <button
          className={`header-nav-btn ${isTasksPage ? 'active' : ''}`}
          onClick={() => navigate('/tasks')}
          title="My Tasks"
        >
          Tasks
        </button>

        {/* Active Agents dropdown */}
        {!isHome && !isTasksPage && activeProject && (
          <div className="executions-wrapper" ref={executionsRef}>
            <button
              className={`executions-trigger ${activeWorkflows.length === 0 ? 'executions-trigger-empty' : ''}`}
              onClick={() => setShowExecutions(!showExecutions)}
              title="Running agents"
              aria-label={`Running agents: ${activeWorkflows.length}`}
            >
              <span className="executions-icon">⚡</span>
              <span className="executions-count">{activeWorkflows.length}</span>
            </button>

            {showExecutions && (
              <div className="executions-dropdown">
                <div className="executions-header">Running Agents</div>
                {activeWorkflows.length === 0 ? (
                  <div className="executions-empty">No agents running</div>
                ) : (
                  activeWorkflows.map((workflow) => {
                    // Look up task title from active project
                    const task = activeProject?.tasks?.find((t) => t.id === workflow.taskId);
                    const taskTitle = task?.title || `Task ${workflow.taskId.slice(0, 8)}`;

                    // Get current step info
                    const currentStep = workflow.steps?.[workflow.currentStepIndex || 0];
                    const stepName = currentStep?.name;

                    // Build secondary text
                    let secondaryText = '';
                    if (workflow.status === 'checkpoint') {
                      secondaryText = 'Awaiting approval';
                    } else if (workflow.status === 'executing' && stepName) {
                      secondaryText = stepName;
                    } else if (workflow.status === 'planning') {
                      secondaryText = 'Starting...';
                    }

                    return (
                      <div key={workflow.id} className="executions-item">
                        <button
                          className="executions-item-main"
                          onClick={() => {
                            setShowExecutions(false);
                            window.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: workflow.taskId } }));
                          }}
                        >
                          <span className={`executions-item-status ${workflow.status === 'checkpoint' ? 'status-checkpoint' : ''}`}>
                            {workflow.status === 'checkpoint' ? '⏸' : '●'}
                          </span>
                          <div className="executions-item-info">
                            <span className="executions-item-title">{taskTitle}</span>
                            {secondaryText && (
                              <span className="executions-item-step">{secondaryText}</span>
                            )}
                          </div>
                        </button>
                        <button
                          className={`executions-item-stop ${confirmingCancel === workflow.id ? 'confirming' : ''}`}
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (confirmingCancel === workflow.id && activeProject) {
                              const result = await api.cancelWorkflow(activeProject.id, workflow.id);
                              if (result.success && result.data) {
                                updateWorkflowPlan(result.data);
                              } else {
                                // Plan not found or already completed - just remove from UI
                                removeWorkflowPlan(workflow.id);
                              }
                              setConfirmingCancel(null);
                            } else {
                              setConfirmingCancel(workflow.id);
                            }
                          }}
                          title={confirmingCancel === workflow.id ? 'Click to confirm' : 'Stop this agent'}
                        >
                          {confirmingCancel === workflow.id ? 'Confirm' : 'Stop'}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

        {/* Project Settings - separate from user menu since it's project-scoped */}
        {!isHome && !isTasksPage && activeProject && (
          <button
            className="header-settings-btn"
            onClick={() => setShowSettings(true)}
            title="Project Settings"
          >
            Settings
          </button>
        )}

        {/* User menu */}
        {user && (
          <div className="user-menu-wrapper" ref={userMenuRef}>
            <button
              className="user-menu-trigger"
              onClick={() => setShowUserMenu(!showUserMenu)}
              title={user.email}
            >
              <span className="user-avatar-circle">
                {user.email.charAt(0).toUpperCase()}
              </span>
              <span className="user-menu-chevron">▼</span>
            </button>

            {showUserMenu && (
              <div className="user-menu-dropdown">
                <div className="user-menu-email">{user.email}</div>
                <div className="user-menu-divider" />
                <button
                  className="user-menu-item"
                  onClick={() => {
                    setShowUserMenu(false);
                    setShowUserSettings(true);
                  }}
                >
                  Settings
                </button>
                <button
                  className="user-menu-item user-menu-signout"
                  onClick={() => {
                    setShowUserMenu(false);
                    signOut();
                  }}
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <Modal
        isOpen={showProjectModal}
        onClose={() => setShowProjectModal(false)}
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
                onClick={() => setShowProjectModal(false)}
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

      <BoardSettings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      <UserSettings
        isOpen={showUserSettings}
        onClose={() => setShowUserSettings(false)}
      />
    </header>
  );
}
