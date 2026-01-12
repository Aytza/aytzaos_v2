import { Modal } from '../common';
import { GlobalMCPSection } from './GlobalMCPSection';
import './BoardSettings.css';

interface UserSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function UserSettings({ isOpen, onClose }: UserSettingsProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" width="lg">
      <div className="settings-content">
        {/* Global MCP Servers Section */}
        <section className="settings-section">
          <div className="settings-section-header">
            <h3 className="settings-section-title">Global MCP Servers</h3>
            <span className="settings-section-hint">Available across all your projects</span>
          </div>

          <GlobalMCPSection />
        </section>
      </div>
    </Modal>
  );
}
