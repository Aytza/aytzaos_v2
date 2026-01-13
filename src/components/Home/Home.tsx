import { useNavigate } from 'react-router-dom';
import './Home.css';

export function Home() {
  const navigate = useNavigate();

  const products = [
    {
      id: 'roadmap',
      name: 'Product Roadmap',
      description: 'Plan and visualize your product journey with timeline views and milestone tracking.',
      icon: '📍',
      path: '/roadmap',
      color: 'purple',
    },
    {
      id: 'bugs',
      name: 'Bug Tracker',
      description: 'Track, triage, and resolve issues with priority management and status workflows.',
      icon: '🐛',
      path: '/bugs',
      color: 'teal',
    },
    {
      id: 'tasks',
      name: 'Standalone Tasks',
      description: 'Quick AI-powered tasks without project context. More agent types coming soon.',
      icon: '⚡',
      path: '/tasks',
      color: 'gold',
      badge: 'AI Agents',
    },
    {
      id: 'projects',
      name: 'Projects',
      description: 'Full kanban boards with columns, tasks, and AI agent workflows for complex work.',
      icon: '📋',
      path: '/projects',
      color: 'blue',
    },
  ];

  return (
    <div className="landing">
      {/* Hero Section */}
      <section className="hero">
        <div className="hero-content">
          <div className="hero-badge">
            <span className="hero-badge-icon">✦</span>
            <span>AI-POWERED INTERNAL OS</span>
          </div>

          <h1 className="hero-title">
            Your team's
            <br />
            operating system
            <span className="hero-title-accent"> for getting things done.</span>
          </h1>

          <p className="hero-description">
            Aytza combines intelligent task management with AI agents that work alongside your team.
            Plan roadmaps, track bugs, and let AI handle the routine work.
          </p>

          <div className="hero-features">
            <span className="hero-feature">ROADMAP PLANNING</span>
            <span className="hero-feature">BUG TRACKING</span>
            <span className="hero-feature">AI AGENTS</span>
          </div>
        </div>

        <div className="hero-shapes">
          <div className="shape shape-purple"></div>
          <div className="shape shape-teal"></div>
          <div className="shape shape-gold"></div>
        </div>
      </section>

      {/* Products Section */}
      <section className="products">
        <div className="products-header">
          <h2 className="products-title">Tools in Aytza Workspace</h2>
          <p className="products-description">
            Everything you need to manage work and ship faster. Each tool is designed to work
            independently or together as part of your workflow.
          </p>
        </div>

        <div className="products-grid">
          {products.map((product) => (
            <button
              key={product.id}
              className={`product-card product-card-${product.color}`}
              onClick={() => navigate(product.path)}
            >
              <div className="product-card-header">
                <span className="product-card-icon">{product.icon}</span>
                {product.badge && (
                  <span className="product-card-badge">{product.badge}</span>
                )}
              </div>
              <h3 className="product-card-name">{product.name}</h3>
              <p className="product-card-description">{product.description}</p>
              <span className="product-card-arrow">→</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
