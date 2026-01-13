import type { BugItem, BugSeverity } from '../../types';
import { TEAM_MEMBERS } from '../../types';

interface BugCardProps {
  item: BugItem;
  onDragStart: () => void;
  onClick: () => void;
}

const SEVERITY_COLORS: Record<BugSeverity, { bg: string; text: string }> = {
  low: { bg: '#dcfce7', text: '#166534' },
  medium: { bg: '#fef3c7', text: '#92400e' },
  high: { bg: '#fecaca', text: '#991b1b' },
};

function getOwnerInitials(email: string | null): string {
  if (!email) return '';
  const member = TEAM_MEMBERS.find((m) => m.email === email);
  if (member) {
    const parts = member.name.split(' ');
    return parts.map((p) => p[0]).join('').toUpperCase();
  }
  return email[0].toUpperCase();
}

export function BugCard({ item, onDragStart, onClick }: BugCardProps) {
  const severityStyle = SEVERITY_COLORS[item.severity];

  return (
    <div
      className="bugboard-card"
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
    >
      <div className="bugboard-card-header">
        <span
          className="bugboard-card-severity"
          style={{ backgroundColor: severityStyle.bg, color: severityStyle.text }}
        >
          {item.severity}
        </span>
        {item.ownerEmail && (
          <span className="bugboard-card-owner" title={item.ownerEmail}>
            {getOwnerInitials(item.ownerEmail)}
          </span>
        )}
      </div>

      <div className="bugboard-card-title">{item.title}</div>

      {item.description && (
        <div className="bugboard-card-description">
          {item.description.length > 100
            ? `${item.description.slice(0, 100)}...`
            : item.description}
        </div>
      )}

      {item.screenshots && item.screenshots.length > 0 && (
        <div className="bugboard-card-screenshots">
          {item.screenshots.slice(0, 3).map((src, index) => (
            <img
              key={index}
              src={src}
              alt={`Screenshot ${index + 1}`}
              className="bugboard-card-screenshot-thumb"
            />
          ))}
          {item.screenshots.length > 3 && (
            <span className="bugboard-card-screenshot-count">
              +{item.screenshots.length - 3}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
