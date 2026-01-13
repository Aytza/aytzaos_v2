import type { ReactElement } from 'react';
import { Button } from '../common';
import type { BoardCredential } from '../../types';
import './AccountsSection.css';

/**
 * Account definitions for the UI
 * These match the accounts in worker/mcp/AccountMCPRegistry.ts
 *
 * Note: Google is no longer here - it uses a service account configured
 * via environment variables, so no per-user OAuth is needed.
 */
const ACCOUNTS: Array<{
  id: string;
  name: string;
  credentialType: string;
  description: string;
  icon: ReactElement;
}> = [
  // Future accounts can be added here:
  // {
  //   id: 'microsoft',
  //   name: 'Microsoft',
  //   credentialType: 'microsoft_oauth',
  //   description: 'Outlook, OneDrive, Teams',
  //   icon: <MicrosoftIcon />,
  // },
];

interface AccountsSectionProps {
  credentials: BoardCredential[];
  onConnect: (accountId: string) => void;
  onDisconnect: (credentialId: string) => void;
  connecting: string | null;
}

export function AccountsSection({
  credentials,
  onConnect,
  onDisconnect,
  connecting,
}: AccountsSectionProps) {
  const getCredential = (credentialType: string) =>
    credentials.find((c) => c.type === credentialType);

  const getConnectionInfo = (cred: BoardCredential) => {
    if (cred.metadata?.email) return cred.metadata.email as string;
    if (cred.metadata?.login) return cred.metadata.login as string;
    return 'Connected';
  };

  const hasAnyAccount = ACCOUNTS.some((account) =>
    getCredential(account.credentialType)
  );

  return (
    <div className="accounts-section">
      {ACCOUNTS.map((account) => {
        const credential = getCredential(account.credentialType);
        const isConnecting = connecting === account.id;

        return (
          <div
            key={account.id}
            className={`account-card ${credential ? 'connected' : ''}`}
          >
            <div className="account-card-left">
              <div className="account-card-icon">{account.icon}</div>
              <div className="account-card-info">
                <span className="account-card-name">{account.name}</span>
                <span className="account-card-meta">
                  {credential
                    ? getConnectionInfo(credential)
                    : account.description}
                </span>
              </div>
            </div>
            <div className="account-card-actions">
              {credential ? (
                <button
                  className="account-disconnect-btn"
                  onClick={() => onDisconnect(credential.id)}
                  title="Disconnect"
                >
                  Disconnect
                </button>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => onConnect(account.id)}
                  disabled={isConnecting}
                >
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </Button>
              )}
            </div>
          </div>
        );
      })}

      {!hasAnyAccount && (
        <p className="accounts-hint">
          Connect an account to enable its associated MCP servers
        </p>
      )}
    </div>
  );
}
