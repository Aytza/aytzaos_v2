import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Modal, Input, Button } from '../common';
import { AccountsSection } from './AccountsSection';
import { MCPSection } from './MCPSection';
import { useProject } from '../../context/ProjectContext';
import { CREDENTIAL_TYPES, type BoardCredential } from '../../types';
import * as api from '../../api/client';
import './BoardSettings.css';

interface BoardSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BoardSettings({ isOpen, onClose }: BoardSettingsProps) {
  const { activeProject } = useProject();
  const [searchParams, setSearchParams] = useSearchParams();
  const [credentials, setCredentials] = useState<BoardCredential[]>([]);
  const [loading, setLoading] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyName, setApiKeyName] = useState('');
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<'github' | 'google' | null>(null);

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

  const handleAddApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject || !apiKeyInput.trim()) return;

    setSaving(true);
    setError(null);

    // Delete any existing Anthropic API key first (replace behavior)
    const existingKey = credentials.find(c => c.type === CREDENTIAL_TYPES.ANTHROPIC_API_KEY);
    if (existingKey) {
      await api.deleteCredential(activeProject.id, existingKey.id);
    }

    const result = await api.createCredential(activeProject.id, {
      type: CREDENTIAL_TYPES.ANTHROPIC_API_KEY,
      name: apiKeyName.trim() || 'Anthropic API Key',
      value: apiKeyInput.trim(),
    });

    if (result.success && result.data) {
      // Remove old key and add new one
      setCredentials((prev) =>
        prev.filter(c => c.type !== CREDENTIAL_TYPES.ANTHROPIC_API_KEY).concat(result.data!)
      );
      setApiKeyInput('');
      setApiKeyName('');
      setShowApiKeyForm(false);
    } else {
      setError(result.error?.message || 'Failed to save API key');
    }

    setSaving(false);
  };

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

  const anthropicKeys = credentials.filter((c) => c.type === CREDENTIAL_TYPES.ANTHROPIC_API_KEY);

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

          {loading ? (
            <div className="settings-loading">Loading...</div>
          ) : (
            <>
              {anthropicKeys.length > 0 && !showApiKeyForm ? (
                <div className="credentials-list">
                  {anthropicKeys.slice(0, 1).map((cred) => (
                    <div key={cred.id} className="credential-item">
                      <div className="credential-info">
                        <span className="credential-name">{cred.name}</span>
                        <span className="credential-type">sk-...****</span>
                      </div>
                      <div className="credential-actions">
                        <button
                          className="credential-replace"
                          onClick={() => setShowApiKeyForm(true)}
                          title="Replace API key"
                        >
                          Replace
                        </button>
                        <button
                          className="credential-delete"
                          onClick={() => handleDeleteCredential(cred.id)}
                          title="Remove API key"
                        >
                          &times;
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : !showApiKeyForm ? (
                <div className="settings-empty">
                  <p>No API key configured</p>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setShowApiKeyForm(true)}
                  >
                    + Add API Key
                  </Button>
                </div>
              ) : null}

              {showApiKeyForm && (
                <form className="api-key-form" onSubmit={handleAddApiKey}>
                  <Input
                    label="Name (optional)"
                    placeholder="My API Key"
                    value={apiKeyName}
                    onChange={(e) => setApiKeyName(e.target.value)}
                  />
                  <Input
                    label="API Key"
                    type="password"
                    placeholder="sk-ant-..."
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    autoFocus
                  />
                  <div className="api-key-form-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowApiKeyForm(false);
                        setApiKeyInput('');
                        setApiKeyName('');
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={!apiKeyInput.trim() || saving}
                    >
                      {saving ? 'Saving...' : anthropicKeys.length > 0 ? 'Replace' : 'Save'}
                    </Button>
                  </div>
                </form>
              )}
            </>
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
