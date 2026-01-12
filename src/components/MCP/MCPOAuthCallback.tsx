/**
 * MCPOAuthCallback - Handles OAuth callback for MCP server authentication
 *
 * After the user authorizes with the OAuth provider, they are redirected back
 * to this component with an authorization code. We exchange the code for tokens
 * and redirect back to the board.
 */

import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as api from '../../api/client';
import './MCPOAuthCallback.css';

export function MCPOAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'exchanging' | 'success' | 'error'>('exchanging');
  const [error, setError] = useState<string | null>(null);
  const hasRun = useRef(false);

  useEffect(() => {
    // Prevent double-run in React Strict Mode
    if (hasRun.current) return;
    hasRun.current = true;

    async function exchangeCode() {
      // Get OAuth parameters from URL
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const errorParam = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');

      // Check for OAuth error response
      if (errorParam) {
        setStatus('error');
        setError(errorDescription || errorParam);
        return;
      }

      if (!code || !state) {
        setStatus('error');
        setError('Missing authorization code or state');
        return;
      }

      // Get stored OAuth context
      const serverId = sessionStorage.getItem('mcp_oauth_server_id');
      const projectId = sessionStorage.getItem('mcp_oauth_project_id');
      const storedState = sessionStorage.getItem('mcp_oauth_state');

      if (!serverId || !projectId) {
        setStatus('error');
        setError('OAuth session data not found. Please try again.');
        return;
      }

      // Validate state matches
      if (state !== storedState) {
        setStatus('error');
        setError('Invalid state parameter. This may be a security issue.');
        return;
      }

      // Exchange code for tokens
      const redirectUri = `${window.location.origin}/mcp/oauth/callback`;
      const result = await api.exchangeMCPOAuthCode(projectId, serverId, code, state, redirectUri);

      // Clear stored OAuth context only after exchange attempt
      sessionStorage.removeItem('mcp_oauth_server_id');
      sessionStorage.removeItem('mcp_oauth_project_id');
      sessionStorage.removeItem('mcp_oauth_state');

      if (!result.success) {
        setStatus('error');
        setError(result.error?.message || 'Failed to exchange authorization code');
        return;
      }

      setStatus('success');

      // Redirect back to project after a short delay
      setTimeout(() => {
        navigate(`/project/${projectId}?mcp_connected=true`);
      }, 1500);
    }

    exchangeCode();
  }, [searchParams, navigate]);

  return (
    <div className="mcp-oauth-callback">
      <div className="mcp-oauth-callback-card">
        {status === 'exchanging' && (
          <>
            <div className="mcp-oauth-spinner" />
            <h2>Completing Authentication</h2>
            <p>Please wait while we complete the OAuth authorization...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="mcp-oauth-icon mcp-oauth-success">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h2>Connected Successfully</h2>
            <p>Your MCP server has been authenticated. Redirecting...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mcp-oauth-icon mcp-oauth-error">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h2>Authentication Failed</h2>
            <p className="mcp-oauth-error-message">{error}</p>
            <button
              className="mcp-oauth-retry-button"
              onClick={() => navigate(-1)}
            >
              Go Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
