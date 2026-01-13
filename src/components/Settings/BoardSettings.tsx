import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Modal, Button } from '../common';
import { AccountsSection } from './AccountsSection';
import { MCPSection } from './MCPSection';
import { useProject } from '../../context/ProjectContext';
import { useAuth } from '../../context/AuthContext';
import { type BoardCredential } from '../../types';
import * as api from '../../api/client';
import './BoardSettings.css';

interface BoardSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BoardSettings({ isOpen, onClose }: BoardSettingsProps) {
  const { activeProject } = useProject();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [credentials, setCredentials] = useState<BoardCredential[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<'github' | 'google' | null>(null);

  // Check if Anthropic API key is configured via environment
  const anthropicConfiguredViaEnv = user?.config?.anthropicApiKeyConfigured ?? false;

  // Check for OAuth success/error in URL params
  useEffect(() => {
    const githubConnected = searchParams.get('github');
    const githubError = searchParams.get('github_error');
    const googleConnected = searchParams.get('google');
    const googleError = searchParams.get('google_error');

    if (githubConnected === 'connected') {
      if (activeProject) {
        loadCredentials();
      }
      searchParams.delete('github');
      setSearchParams(searchParams, { replace: true });
    }

    if (githubError) {
      setError(`GitHub connection failed: ${githubError}`);
      searchParams.delete('github_error');
      setSearchParams(searchParams, { replace: true });
    }

    if (googleConnected === 'connected') {
      if (activeProject) {
        loadCredentials();
      }
      searchParams.delete('google');
      setSearchParams(searchParams, { replace: true });
    }

    if (googleError) {
      setError(`Google connection failed: ${googleError}`);
      searchParams.delete('google_error');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, activeProject]);

  const loadCredentials = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    setError(null);
    const result = await api.getCredentials(activeProject.id);
    if (result.success && result.data) {
      setCredentials(result.data);
    } else {
      setError(result.error?.message || 'Failed to load credentials');
    }
    setLoading(false);
  }, [activeProject]);

  useEffect(() => {
    if (isOpen && activeProject) {
      loadCredentials();
    }
  }, [isOpen, activeProject, loadCredentials]);

  const handleDeleteCredential = async (credentialId: string) => {
    if (!activeProject) return;

    const result = await api.deleteCredential(activeProject.id, credentialId);
    if (result.success) {
      setCredentials((prev) => prev.filter((c) => c.id !== credentialId));
    } else {
      setError(result.error?.message || 'Failed to delete credential');
    }
  };

  const handleConnect = async (provider: 'github' | 'google') => {
    if (!activeProject) return;

    setConnecting(provider);
    setError(null);

    const getUrl = provider === 'github' ? api.getGitHubOAuthUrl : api.getGoogleOAuthUrl;
    const result = await getUrl(activeProject.id);

    if (result.success && result.data) {
      window.location.href = result.data.url;
    } else {
      setError(result.error?.message || `Failed to connect ${provider}`);
      setConnecting(null);
    }
  };

  if (!activeProject) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Project Settings" width="lg">
      <div className="settings-content">
        {error && <div className="settings-error">{error}</div>}

        {/* Anthropic API Key Section - Required for agent */}
        <section className="settings-section">
          <div className="settings-section-header">
            <h3 className="settings-section-title">Anthropic API Key</h3>
            <span className="settings-section-hint">Required for agent execution</span>
          </div>

          {anthropicConfiguredViaEnv ? (
            <div className="credentials-list">
              <div className="credential-item">
                <div className="credential-info">
                  <span className="credential-name">Configured via environment</span>
                  <span className="credential-type">ANTHROPIC_API_KEY</span>
                </div>
                <div className="credential-status credential-status-connected">
                  Active
                </div>
              </div>
            </div>
          ) : (
            <div className="settings-empty">
              <p>Not configured</p>
              <p className="settings-hint">
                Set <code>ANTHROPIC_API_KEY</code> in your <code>.dev.vars</code> file (development) or as a Cloudflare secret (production).
              </p>
            </div>
          )}
        </section>

        {/* Connected Accounts Section */}
        <section className="settings-section">
          <div className="settings-section-header">
            <h3 className="settings-section-title">Connected Accounts</h3>
            <span className="settings-section-hint">Authenticate with services that have multiple integrations</span>
          </div>

          <AccountsSection
            credentials={credentials}
            onConnect={(accountId) => handleConnect(accountId as 'github' | 'google')}
            onDisconnect={handleDeleteCredential}
            connecting={connecting}
          />
        </section>

        {/* MCP Servers Section */}
        <section className="settings-section">
          <div className="settings-section-header">
            <h3 className="settings-section-title">MCP Servers</h3>
            <span className="settings-section-hint">Tool providers for AI workflows</span>
          </div>

          <MCPSection
            projectId={activeProject.id}
            credentials={credentials}
            onConnectGitHub={() => handleConnect('github')}
            connectingGitHub={connecting === 'github'}
          />
        </section>
      </div>
    </Modal>
  );
}
