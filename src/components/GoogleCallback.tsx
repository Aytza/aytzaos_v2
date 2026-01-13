import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

/**
 * Handles Google OAuth callback by forwarding to the backend API.
 * This is needed because browser navigation to /api/* routes
 * may not be intercepted by the Cloudflare Vite plugin.
 */
export function GoogleCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code || !state) {
      setError('Missing code or state parameter');
      return;
    }

    // Forward to backend API
    const processCallback = async () => {
      try {
        const response = await fetch(
          `/api/google/oauth/exchange?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
        );

        const result = await response.json() as {
          success: boolean;
          data?: { boardId?: string; projectId?: string; global?: boolean };
          error?: { message: string };
        };

        if (result.success && result.data) {
          // Handle global OAuth (user-level credentials)
          if (result.data.global) {
            navigate('/tasks?google=connected', { replace: true });
          } else {
            // Handle project-level OAuth (support both boardId and projectId)
            const projectId = result.data.projectId || result.data.boardId;
            navigate(`/project/${projectId}?google=connected`, { replace: true });
          }
        } else {
          setError(result.error?.message || 'OAuth failed');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'OAuth failed');
      }
    };

    processCallback();
  }, [searchParams, navigate]);

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>Google Connection Failed</h2>
        <p>{error}</p>
        <button onClick={() => navigate('/')}>Go Home</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <p>Connecting to Google...</p>
    </div>
  );
}
