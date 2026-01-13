import { useNavigate } from 'react-router-dom';
import './Home.css';

export function Home() {
  const navigate = useNavigate();

  const adminTools = [
    {
      id: 'roadmap',
      name: 'Roadmap',
      description: 'Plan and visualize your product journey with timeline views and milestone tracking.',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18" />
          <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />
        </svg>
      ),
      path: '/roadmap',
    },
    {
      id: 'bugs',
      name: 'Bug Reporting',
      description: 'Track, triage, and resolve issues with priority management and status workflows.',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2l1.88 1.88" />
          <path d="M14.12 3.88 16 2" />
          <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
          <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
          <path d="M12 20v-9" />
          <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
          <path d="M6 13H2" />
          <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
          <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
          <path d="M22 13h-4" />
          <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
        </svg>
      ),
      path: '/bugs',
    },
  ];

  const taskTypes = [
    {
      id: 'general',
      name: 'General Task',
      description: 'Quick AI-powered tasks for any purpose. Research, analysis, writing, and more.',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v4" />
          <path d="m16.2 7.8 2.9-2.9" />
          <path d="M18 12h4" />
          <path d="m16.2 16.2 2.9 2.9" />
          <path d="M12 18v4" />
          <path d="m4.9 19.1 2.9-2.9" />
          <path d="M2 12h4" />
          <path d="m4.9 4.9 2.9 2.9" />
        </svg>
      ),
      path: '/tasks',
      color: 'purple',
    },
    {
      id: 'company-scout',
      name: 'Company Scout',
      description: 'Research companies, competitors, and market opportunities with AI assistance.',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
          <path d="M11 8v6" />
          <path d="M8 11h6" />
        </svg>
      ),
      path: '/tasks?type=company-scout',
      color: 'teal',
    },
    {
      id: 'content-writer',
      name: 'Content Writer',
      description: 'Generate blog posts, documentation, marketing copy, and other written content.',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z" />
        </svg>
      ),
      path: '/tasks?type=content-writer',
      color: 'gold',
    },
  ];

  return (
    <div className="home">
      {/* Hero Section */}
      <section className="home-hero">
        <div className="home-hero-content">
          <h1 className="home-hero-title">
            Welcome to <span className="home-hero-brand">Aytza</span>
          </h1>
          <p className="home-hero-subtitle">
            Your AI-powered workspace for managing tasks, projects, and workflows.
          </p>
        </div>
      </section>

      {/* Main Content */}
      <div className="home-content">
        {/* Admin Section */}
        <section className="home-section">
          <div className="home-section-header">
            <h2 className="home-section-title">Admin</h2>
            <p className="home-section-description">Manage your product roadmap and track issues</p>
          </div>
          <div className="home-admin-grid">
            {adminTools.map((tool) => (
              <button
                key={tool.id}
                className="home-admin-card"
                onClick={() => navigate(tool.path)}
              >
                <div className="home-admin-card-icon">{tool.icon}</div>
                <div className="home-admin-card-content">
                  <h3 className="home-admin-card-name">{tool.name}</h3>
                  <p className="home-admin-card-description">{tool.description}</p>
                </div>
                <span className="home-card-arrow">→</span>
              </button>
            ))}
          </div>
        </section>

        {/* Projects Section */}
        <section className="home-section">
          <div className="home-section-header">
            <h2 className="home-section-title">Projects</h2>
            <p className="home-section-description">Organize work with kanban boards and AI agents</p>
          </div>
          <button
            className="home-projects-card"
            onClick={() => navigate('/projects')}
          >
            <div className="home-projects-card-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="7" height="9" x="3" y="3" rx="1" />
                <rect width="7" height="5" x="14" y="3" rx="1" />
                <rect width="7" height="9" x="14" y="12" rx="1" />
                <rect width="7" height="5" x="3" y="16" rx="1" />
              </svg>
            </div>
            <div className="home-projects-card-content">
              <h3 className="home-projects-card-name">View All Projects</h3>
              <p className="home-projects-card-description">
                Full kanban boards with columns, tasks, and AI agent workflows for complex work.
              </p>
            </div>
            <span className="home-card-arrow">→</span>
          </button>
        </section>

        {/* Launch a Task Section */}
        <section className="home-section">
          <div className="home-section-header">
            <h2 className="home-section-title">Launch a Task</h2>
            <p className="home-section-description">Start AI-powered tasks without project context</p>
          </div>
          <div className="home-tasks-grid">
            {taskTypes.map((task) => (
              <button
                key={task.id}
                className={`home-task-card home-task-card-${task.color}`}
                onClick={() => navigate(task.path)}
              >
                <div className="home-task-card-icon">{task.icon}</div>
                <h3 className="home-task-card-name">{task.name}</h3>
                <p className="home-task-card-description">{task.description}</p>
                <span className="home-card-arrow">→</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
