import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { BoardProvider, useBoard } from './context/BoardContext';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Header } from './components/Header/Header';
import { Home } from './components/Home/Home';
import { Board } from './components/Board/Board';
import { Roadmap } from './components/Roadmap';
import { BugBoard } from './components/BugBoard';
import { GitHubCallback } from './components/GitHubCallback';
import { GoogleCallback } from './components/GoogleCallback';
import { MCPOAuthCallback } from './components/MCP/MCPOAuthCallback';
import { CommandPalette } from './components/CommandPalette';
import { ToastContainer, WorkflowToastListener } from './components/Toast';
import { ErrorBoundary } from './components/common';
import './App.css';

// Full-page callback routes (no header/layout)
const CALLBACK_ROUTES = ['/github/callback', '/google/callback', '/mcp/oauth/callback'];

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoading, error } = useAuth();

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="app-loading-spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-error">
        <h1>Authentication Required</h1>
        <p>{error}</p>
      </div>
    );
  }

  return <>{children}</>;
}

function AppContent() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { activeBoard, setAddingToColumn } = useBoard();
  const location = useLocation();

  const handleNewTask = useCallback((columnIndex: number) => {
    if (activeBoard && activeBoard.columns[columnIndex]) {
      setAddingToColumn(activeBoard.columns[columnIndex].id);
    }
  }, [activeBoard, setAddingToColumn]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if in an input or textarea
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Cmd/Ctrl + K - open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }

      // Escape - close palette
      if (e.key === 'Escape' && paletteOpen) {
        setPaletteOpen(false);
        return;
      }

      // Shortcuts that only work when not in an input
      if (!isInput && !paletteOpen) {
        // n - new task in first column
        if (e.key === 'n' && activeBoard) {
          e.preventDefault();
          handleNewTask(0);
          return;
        }

        // 1, 2, 3 - new task in column 1, 2, or 3
        if (['1', '2', '3'].includes(e.key) && activeBoard) {
          const colIndex = parseInt(e.key) - 1;
          if (activeBoard.columns[colIndex]) {
            e.preventDefault();
            handleNewTask(colIndex);
          }
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [paletteOpen, activeBoard, handleNewTask]);

  // Render full-page callbacks without the app layout
  const isCallbackRoute = CALLBACK_ROUTES.includes(location.pathname);
  if (isCallbackRoute) {
    return (
      <Routes>
        <Route path="/github/callback" element={<GitHubCallback />} />
        <Route path="/google/callback" element={<GoogleCallback />} />
        <Route path="/mcp/oauth/callback" element={<MCPOAuthCallback />} />
      </Routes>
    );
  }

  return (
    <>
      <div className="app">
        <Header />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/board/:boardId" element={<Board />} />
            <Route path="/roadmap" element={<Roadmap />} />
            <Route path="/bugs" element={<BugBoard />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNewTask={handleNewTask}
      />

      {/* Toast notifications */}
      <WorkflowToastListener />
      <ToastContainer />
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <AuthGate>
              <BoardProvider>
                <AppContent />
              </BoardProvider>
            </AuthGate>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
